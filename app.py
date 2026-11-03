import os
import sqlite3
import uuid
from datetime import date, timedelta

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
import db

load_dotenv()

KOBIS_KEY = os.getenv("KOBIS_KEY")
TMDB_KEY = os.getenv("TMDB_KEY")

KOBIS_URL = "http://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie"
TMDB_IMG = "https://image.tmdb.org/t/p/w342"

app = Flask(__name__)
db.init_db()
poster_cache = {}


def get_visitor_id():
    visitor_id = request.headers.get("X-Visitor-Id", "")
    try:
        return str(uuid.UUID(visitor_id))
    except (ValueError, AttributeError):
        return None


def read_review_payload():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None, "기록 데이터를 보내 주세요."
    movie_cd = data.get("movieCd")
    title = data.get("title")
    review_text = data.get("review", "")
    try:
        rating = int(data.get("rating"))
    except (TypeError, ValueError):
        return None, "별점은 1점부터 5점까지 선택해 주세요."
    if not isinstance(movie_cd, str) or not movie_cd or len(movie_cd) > 32:
        return None, "영화 코드가 올바르지 않습니다."
    if not isinstance(title, str) or not title.strip() or len(title) > 200:
        return None, "영화 제목이 올바르지 않습니다."
    if rating < 1 or rating > 5:
        return None, "별점은 1점부터 5점까지 선택해 주세요."
    if not isinstance(review_text, str) or len(review_text) > 180:
        return None, "감상은 180자 이내로 입력해 주세요."
    return {
        "movieCd": movie_cd,
        "title": title.strip(),
        "poster": data.get("poster") if isinstance(data.get("poster"), str) else None,
        "rating": rating,
        "review": review_text.strip(),
        "date": data.get("date") if isinstance(data.get("date"), str) else date.today().isoformat(),
        "openDt": data.get("openDt") if isinstance(data.get("openDt"), str) else "",
    }, None


def find_poster(title, open_dt):
    """영화명과 개봉연도로 TMDB에서 포스터 주소를 찾는다. 못 찾으면 None."""
    key = (title, open_dt)
    if key in poster_cache:
        return poster_cache[key]

    poster = None
    try:
        res = requests.get(
            TMDB_SEARCH_URL,
            params={"api_key": TMDB_KEY, "query": title, "language": "ko-KR"},
            timeout=5,
        )
        res.raise_for_status()
        year = (open_dt or "")[:4]
        for r in res.json().get("results", []):
            if r.get("poster_path") and (not year or r.get("release_date", "").startswith(year)):
                poster = TMDB_IMG + r["poster_path"]
                break
    except requests.RequestException:
        pass  # 포스터 실패는 전체 실패로 보지 않고 None으로 둔다

    poster_cache[key] = poster
    return poster


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/boxoffice")
def boxoffice():
    target = request.args.get("date") or (date.today() - timedelta(days=1)).strftime("%Y%m%d")
    if len(target) != 8 or not target.isdigit():
        return jsonify({"error": "날짜는 YYYYMMDD 형식으로 입력해 주세요."}), 400
    try:
        res = requests.get(KOBIS_URL, params={"key": KOBIS_KEY, "targetDt": target}, timeout=5)
        res.raise_for_status()
        items = res.json()["boxOfficeResult"]["dailyBoxOfficeList"]
    except (requests.RequestException, KeyError, ValueError):
        return jsonify({"error": "박스오피스 정보를 불러오지 못했어요."}), 502

    movies = [
        {
            "rank": m["rank"],
            "title": m["movieNm"],
            "openDt": m["openDt"],
            "audiCnt": m["audiCnt"],
            "audiAcc": m["audiAcc"],
            "isNew": m["rankOldAndNew"] == "NEW",
            "movieCd": m["movieCd"],
            "poster": find_poster(m["movieNm"], m["openDt"]),
        }
        for m in items
    ]
    return jsonify({"date": target, "movies": movies})


@app.route("/api/movie/<movie_cd>")
def movie_detail(movie_cd):
    """KOBIS 상세 정보와 TMDB 줄거리를 한 번에 제공한다."""
    try:
        kobis = requests.get(
            "http://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json",
            params={"key": KOBIS_KEY, "movieCd": movie_cd}, timeout=5,
        )
        kobis.raise_for_status()
        info = kobis.json()["movieInfoResult"]["movieInfo"]
    except (requests.RequestException, KeyError, ValueError):
        return jsonify({"error": "영화 상세 정보를 불러오지 못했어요."}), 502

    tmdb = {"overview": "", "vote_average": None}
    try:
        result = requests.get(
            TMDB_SEARCH_URL,
            params={"api_key": TMDB_KEY, "query": info.get("movieNm", ""), "language": "ko-KR"},
            timeout=5,
        )
        result.raise_for_status()
        year = (info.get("openDt") or "")[:4]
        matches = result.json().get("results", [])
        match = next((m for m in matches if year and m.get("release_date", "").startswith(year)), None)
        match = match or (matches[0] if matches else {})
        tmdb = {"overview": match.get("overview", ""), "vote_average": match.get("vote_average")}
    except requests.RequestException:
        pass

    return jsonify({
        "title": info.get("movieNm", ""), "titleEn": info.get("movieNmEn", ""),
        "openDt": info.get("openDt", ""), "showTm": info.get("showTm", ""),
        "genres": [g.get("genreNm", "") for g in info.get("genres", [])],
        "directors": [d.get("peopleNm", "") for d in info.get("directors", [])],
        "actors": [a.get("peopleNm", "") for a in info.get("actors", [])[:5]],
        **tmdb,
    })


@app.route("/api/reviews", methods=["GET", "POST"])
def reviews():
    visitor_id = get_visitor_id()
    if not visitor_id:
        return jsonify({"error": "브라우저 식별 정보가 올바르지 않습니다."}), 400
    if request.method == "GET":
        return jsonify({"reviews": db.list_reviews(visitor_id)})

    review, error = read_review_payload()
    if error:
        return jsonify({"error": error}), 400
    try:
        db.create_review(visitor_id, review)
    except sqlite3.IntegrityError as exc:
        if "UNIQUE constraint failed" in str(exc):
            return jsonify({"error": "이미 기록한 영화입니다."}), 409
        raise
    return jsonify({"review": review}), 201


@app.route("/api/reviews/<movie_cd>", methods=["PUT", "DELETE"])
def review_item(movie_cd):
    visitor_id = get_visitor_id()
    if not visitor_id:
        return jsonify({"error": "브라우저 식별 정보가 올바르지 않습니다."}), 400
    if request.method == "DELETE":
        if not db.delete_review(visitor_id, movie_cd):
            return jsonify({"error": "기록을 찾을 수 없습니다."}), 404
        return "", 204

    review, error = read_review_payload()
    if error:
        return jsonify({"error": error}), 400
    if review["movieCd"] != movie_cd:
        return jsonify({"error": "영화 코드가 일치하지 않습니다."}), 400
    if not db.update_review(visitor_id, movie_cd, review):
        return jsonify({"error": "수정할 기록을 찾을 수 없습니다."}), 404
    return jsonify({"review": review})


if __name__ == "__main__":
    app.run(debug=True)
