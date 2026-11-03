"""SQLite 저장소: 브라우저별 영화 감상 기록 CRUD."""
import os
import sqlite3


DATABASE_PATH = os.getenv(
    "DATABASE_PATH",
    os.path.join(os.path.dirname(__file__), "instance", "movie_moa.sqlite3"),
)


def connect():
    parent = os.path.dirname(DATABASE_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with connect() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS movie_reviews (
                visitor_id TEXT NOT NULL,
                movie_cd TEXT NOT NULL,
                title TEXT NOT NULL,
                poster TEXT,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                review TEXT NOT NULL DEFAULT '',
                watched_on TEXT NOT NULL,
                open_dt TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (visitor_id, movie_cd)
            )
        """)


def list_reviews(visitor_id):
    with connect() as connection:
        rows = connection.execute(
            """SELECT movie_cd, title, poster, rating, review, watched_on, open_dt
               FROM movie_reviews WHERE visitor_id = ? ORDER BY watched_on DESC, rowid DESC""",
            (visitor_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_review(visitor_id, review):
    with connect() as connection:
        connection.execute(
            """INSERT INTO movie_reviews
               (visitor_id, movie_cd, title, poster, rating, review, watched_on, open_dt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (visitor_id, review["movieCd"], review["title"], review.get("poster"),
             review["rating"], review.get("review", ""), review["date"], review.get("openDt", "")),
        )


def update_review(visitor_id, movie_cd, review):
    with connect() as connection:
        cursor = connection.execute(
            """UPDATE movie_reviews SET title = ?, poster = ?, rating = ?, review = ?,
               watched_on = ?, open_dt = ? WHERE visitor_id = ? AND movie_cd = ?""",
            (review["title"], review.get("poster"), review["rating"], review.get("review", ""),
             review["date"], review.get("openDt", ""), visitor_id, movie_cd),
        )
        return cursor.rowcount > 0


def delete_review(visitor_id, movie_cd):
    with connect() as connection:
        cursor = connection.execute(
            "DELETE FROM movie_reviews WHERE visitor_id = ? AND movie_cd = ?",
            (visitor_id, movie_cd),
        )
        return cursor.rowcount > 0
