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
    # v2: one annual crop plan per property (cycles stored as JSON)
    """
    CREATE TABLE plans (
        property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
        status      TEXT NOT NULL CHECK (status IN ('draft', 'saved')),
        cycles      TEXT NOT NULL,              -- JSON list of PlanCycle
        saved_at    TEXT,
        updated_at  TEXT NOT NULL
    );
    """,
    # v3: Sentinel-2 10 m detail per property (app/detail_api, pipeline/src/detail)
    """
    ALTER TABLE properties ADD COLUMN geom_hash TEXT;            -- detail/geometry.py geom_hash()
    ALTER TABLE properties ADD COLUMN utm_epsg INTEGER;          -- output CRS of the detail layers
    ALTER TABLE properties ADD COLUMN detail_touched_at TEXT;    -- last save / detail read (TTL purge)

    CREATE TABLE detail_jobs (
        id           INTEGER PRIMARY KEY,
        property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        kind         TEXT NOT NULL CHECK (kind IN ('full', 'incremental')),
        geom_hash    TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
        created_at   TEXT NOT NULL,
        started_at   TEXT,
        finished_at  TEXT,
        date_from    TEXT NOT NULL,             -- YYYY-MM-DD
        date_to      TEXT NOT NULL,
        source       TEXT,                      -- catalogue that answered: 'earth-search' | 'pc'
        scenes_found INTEGER NOT NULL DEFAULT 0,  -- acquisition days to process
        scenes_done  INTEGER NOT NULL DEFAULT 0,
        scenes_valid INTEGER NOT NULL DEFAULT 0,
        error_reason TEXT,                      -- 'area-too-large' | 'search-failed' | 'interrupted' | 'internal'
        error        TEXT
    );
    CREATE INDEX detail_jobs_property ON detail_jobs (property_id, id);

    CREATE TABLE detail_scenes (
        property_id       INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        acquired_at       TEXT NOT NULL,        -- YYYY-MM-DD (solar day)
        stac_item_id      TEXT NOT NULL,        -- comma-separated when several MGRS tiles were fused
        cloud_cover_scene REAL,
        valid_pct_polygon REAL,
        status            TEXT NOT NULL CHECK (status IN ('valid', 'cloudy', 'error')),
        source            TEXT NOT NULL,
        job_id            INTEGER,
        error             TEXT,
        processed_at      TEXT NOT NULL,
        PRIMARY KEY (property_id, acquired_at)
    );

    CREATE TABLE detail_assets (
        id          INTEGER PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        period      TEXT NOT NULL,              -- YYYY-MM-DD (scene) or YYYY-MM (composite)
        index_name  TEXT NOT NULL,              -- 'ndvi' | 'ndmi' | 'ndre'
        kind        TEXT NOT NULL CHECK (kind IN ('scene', 'composite')),
        path        TEXT NOT NULL,              -- relative to the detail root (pipeline/data/property_detail)
        min         REAL,
        max         REAL,
        crs         TEXT NOT NULL,
        source      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        UNIQUE (property_id, kind, period, index_name)
    );

    CREATE TABLE detail_stats (
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        date        TEXT NOT NULL,
        index_name  TEXT NOT NULL,
        mean REAL, median REAL, p10 REAL, p90 REAL, std REAL,
        valid_pct   REAL NOT NULL,
        n_pixels    INTEGER NOT NULL,
        class_dist  TEXT NOT NULL,              -- JSON {class label: % of valid pixels}
        source      TEXT NOT NULL,
        PRIMARY KEY (property_id, date, index_name)
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
