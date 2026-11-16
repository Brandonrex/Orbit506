"""SQL for the detail tables (schema: db.py migration v3) and the files they point to."""
from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from detail.config import detail_root
from detail.geometry import geom_hash, utm_epsg
from shapely.geometry import shape


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def property_dir(pid: int) -> Path:
    return detail_root() / str(int(pid))


def set_geometry_meta(conn: sqlite3.Connection, pid: int, geometry: dict) -> str:
    """Store geom_hash and UTM zone for a property. Returns the hash."""
    h = geom_hash(geometry)
    c = shape(geometry).centroid
    conn.execute(
        "UPDATE properties SET geom_hash = ?, utm_epsg = ?, detail_touched_at = ? WHERE id = ?",
        (h, utm_epsg(c.x, c.y), now(), pid),
    )
    return h


def backfill_geometry_meta(conn: sqlite3.Connection) -> int:
    """Properties saved before migration v3 have no hash yet."""
    rows = conn.execute("SELECT id, geometry FROM properties WHERE geom_hash IS NULL").fetchall()
    with conn:
        for r in rows:
            set_geometry_meta(conn, r["id"], json.loads(r["geometry"]))
    return len(rows)


def touch(conn: sqlite3.Connection, pid: int) -> None:
    with conn:
        conn.execute("UPDATE properties SET detail_touched_at = ? WHERE id = ?", (now(), pid))


def clear_detail(conn: sqlite3.Connection, pid: int) -> None:
    """Drop every scene, asset and stat of a property and its files (jobs are kept as history)."""
    with conn:
        for t in ("detail_stats", "detail_assets", "detail_scenes"):
            conn.execute(f"DELETE FROM {t} WHERE property_id = ?", (pid,))  # table names are fixed above
    remove_files(pid)


def remove_files(pid: int) -> None:
    d = property_dir(pid)
    if d.is_dir():
        shutil.rmtree(d, ignore_errors=True)


# ---------- jobs ----------
def job(conn: sqlite3.Connection, job_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM detail_jobs WHERE id = ?", (job_id,)).fetchone()


def latest_job(conn: sqlite3.Connection, pid: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM detail_jobs WHERE property_id = ? ORDER BY id DESC LIMIT 1", (pid,)).fetchone()


def active_job(conn: sqlite3.Connection, pid: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM detail_jobs WHERE property_id = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1",
        (pid,),
    ).fetchone()


def insert_job(conn, pid: int, kind: str, ghash: str, date_from: str, date_to: str) -> int:
    with conn:
        cur = conn.execute(
            """INSERT INTO detail_jobs (property_id, kind, geom_hash, status, created_at, date_from, date_to)
               VALUES (?, ?, ?, 'queued', ?, ?, ?)""",
            (pid, kind, ghash, now(), date_from, date_to),
        )
    return cur.lastrowid


_JOB_COLUMNS = {"status", "started_at", "finished_at", "source", "scenes_found", "scenes_done", "scenes_valid", "error_reason", "error"}


def update_job(conn, job_id: int, **fields) -> None:
    assert fields.keys() <= _JOB_COLUMNS, fields.keys() - _JOB_COLUMNS
    cols = ", ".join(f"{k} = ?" for k in fields)
    with conn:
        conn.execute(f"UPDATE detail_jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))


# ---------- scenes / assets / stats ----------
def known_dates(conn, pid: int) -> set[str]:
    """Days already processed for good (valid or cloudy). 'error' days are retried."""
    rows = conn.execute(
        "SELECT acquired_at FROM detail_scenes WHERE property_id = ? AND status IN ('valid', 'cloudy')", (pid,)
    ).fetchall()
    return {r[0] for r in rows}


def scene_bounds(conn, pid: int) -> tuple[str | None, str | None]:
    """(last processed day, earliest day that failed to load)."""
    r = conn.execute(
        """SELECT MAX(CASE WHEN status != 'error' THEN acquired_at END),
                  MIN(CASE WHEN status = 'error' THEN acquired_at END)
           FROM detail_scenes WHERE property_id = ?""",
        (pid,),
    ).fetchone()
    return r[0], r[1]


def save_scene(conn, pid: int, job_id: int, o) -> None:
    """Store one SceneOutcome (detail.run) in one transaction."""
    ts = now()
    root = detail_root()
    with conn:
        conn.execute(
            """INSERT INTO detail_scenes (property_id, acquired_at, stac_item_id, cloud_cover_scene, valid_pct_polygon,
                                          status, source, job_id, error, processed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (property_id, acquired_at) DO UPDATE SET
                   stac_item_id = excluded.stac_item_id, cloud_cover_scene = excluded.cloud_cover_scene,
                   valid_pct_polygon = excluded.valid_pct_polygon, status = excluded.status, source = excluded.source,
                   job_id = excluded.job_id, error = excluded.error, processed_at = excluded.processed_at""",
            (pid, o.date, o.item_ids, o.cloud_cover, o.valid_pct, o.status, o.source, job_id, o.error, ts),
        )
        for idx, a in o.assets.items():
            rel = Path(a["path"]).resolve().relative_to(root).as_posix()
            conn.execute(
                """INSERT INTO detail_assets (property_id, period, index_name, kind, path, min, max, crs, source, created_at)
                   VALUES (?, ?, ?, 'scene', ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (property_id, kind, period, index_name) DO UPDATE SET
                       path = excluded.path, min = excluded.min, max = excluded.max, crs = excluded.crs,
                       source = excluded.source, created_at = excluded.created_at""",
                (pid, o.date, idx, rel, a["min"], a["max"], a["crs"], o.source, ts),
            )
        for idx, s in o.stats.items():
            conn.execute(
                """INSERT OR REPLACE INTO detail_stats (property_id, date, index_name, mean, median, p10, p90, std,
                                                        valid_pct, n_pixels, class_dist, source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (pid, o.date, idx, s["mean"], s["median"], s["p10"], s["p90"], s["std"], s["valid_pct"], s["n_pixels"],
                 json.dumps(s["class_dist"]), o.source),
            )


def has_composites(conn, pid: int) -> bool:
    return conn.execute("SELECT 1 FROM detail_assets WHERE property_id = ? AND kind = 'composite' LIMIT 1", (pid,)).fetchone() is not None


def replace_composites(conn, pid: int, outcomes) -> None:
    """Swap the composite asset rows for a fresh set (detail.composites.CompositeOutcome)."""
    ts = now()
    root = detail_root()
    with conn:
        conn.execute("DELETE FROM detail_assets WHERE property_id = ? AND kind = 'composite'", (pid,))
        for o in outcomes:
            for layer, a in o.assets.items():
                conn.execute(
                    """INSERT INTO detail_assets (property_id, period, index_name, kind, path, min, max, crs, source, created_at)
                       VALUES (?, ?, ?, 'composite', ?, ?, ?, ?, 'composite', ?)""",
                    (pid, o.period, layer, Path(a["path"]).resolve().relative_to(root).as_posix(), a["min"], a["max"], a["crs"], ts),
                )


def composites(conn, pid: int) -> dict[str, dict[str, int]]:
    """period → {layer: asset id}, periods sorted ('latest' last)."""
    rows = conn.execute(
        "SELECT id, period, index_name FROM detail_assets WHERE property_id = ? AND kind = 'composite' ORDER BY period", (pid,)
    ).fetchall()
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["period"], {})[r["index_name"]] = r["id"]
    return out


def purge_untouched(conn, days: int) -> int:
    """Clear the detail data of properties not saved or viewed for `days` days. Returns how many."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="milliseconds")
    rows = conn.execute(
        """SELECT p.id FROM properties p
           WHERE COALESCE(p.detail_touched_at, p.updated_at) < ?
             AND EXISTS (SELECT 1 FROM detail_scenes s WHERE s.property_id = p.id)""",
        (cutoff,),
    ).fetchall()
    for r in rows:
        clear_detail(conn, r["id"])
    return len(rows)


def scenes(conn, pid: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM detail_scenes WHERE property_id = ? ORDER BY acquired_at", (pid,)).fetchall()


def assets_by_date(conn, pid: int) -> dict[str, dict[str, int]]:
    rows = conn.execute(
        "SELECT id, period, index_name FROM detail_assets WHERE property_id = ? AND kind = 'scene'", (pid,)
    ).fetchall()
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["period"], {})[r["index_name"]] = r["id"]
    return out


def asset(conn, asset_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM detail_assets WHERE id = ?", (asset_id,)).fetchone()


def asset_for(conn, pid: int, index: str, period: str, kind: str = "scene") -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM detail_assets WHERE property_id = ? AND index_name = ? AND period = ? AND kind = ?",
        (pid, index, period, kind),
    ).fetchone()


def stats(conn, pid: int, index: str, date_from: str | None, date_to: str | None) -> list[sqlite3.Row]:
    q = "SELECT * FROM detail_stats WHERE property_id = ? AND index_name = ?"
    args: list = [pid, index]
    if date_from:
        q += " AND date >= ?"
        args.append(date_from)
    if date_to:
        q += " AND date <= ?"
        args.append(date_to)
    return conn.execute(q + " ORDER BY date", args).fetchall()


def resolve_asset_path(rel: str) -> Path:
    """Absolute path of a stored asset, refusing anything outside the detail root."""
    root = detail_root()
    p = (root / rel).resolve()
    if not p.is_relative_to(root):
        raise ValueError("asset path escapes the detail root")
    return p
