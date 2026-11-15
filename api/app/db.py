"""SQLite storage for saved properties (stdlib sqlite3, no ORM).

The database file defaults to api/data/app.db; set AF_DB_PATH to use another file (tests do).
"""
import os
import sqlite3
from collections.abc import Iterator
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "app.db"

# Each entry upgrades the schema by one version (PRAGMA user_version). Append only, never edit.
MIGRATIONS: list[str] = [
    # v1: properties + per-property stats (stats get filled in phase 2, from rasters)
    """
    CREATE TABLE properties (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        notes       TEXT NOT NULL DEFAULT '',
        geometry    TEXT NOT NULL,              -- GeoJSON Polygon, EPSG:4326
        area_m2     REAL NOT NULL,
        min_lon REAL NOT NULL, min_lat REAL NOT NULL,
        max_lon REAL NOT NULL, max_lat REAL NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE TABLE property_stats (
        property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        data_version TEXT NOT NULL,
        computed_at  TEXT NOT NULL,
        stats        TEXT NOT NULL,             -- JSON
        PRIMARY KEY (property_id, data_version)
    );
    """,
]


def db_path() -> Path:
    return Path(os.environ.get("AF_DB_PATH", DEFAULT_DB))


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def migrate() -> None:
    conn = connect()
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
            conn.executescript(sql)
            conn.execute(f"PRAGMA user_version = {i}")
            conn.commit()
    finally:
        conn.close()


def get_conn() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
