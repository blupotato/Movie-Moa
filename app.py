import os
from datetime import date, timedelta

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()

KOBIS_KEY = os.getenv("KOBIS_KEY")
TMDB_KEY = os.getenv("TMDB_KEY")

KOBIS_URL = "http://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie"
TMDB_IMG = "https://image.tmdb.org/t/p/w342"

app = Flask(__name__)
poster_cache = {}


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


if __name__ == "__main__":
    app.run(debug=True)
