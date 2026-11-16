"""Adaptive Farming API: saved properties and their annual crop plans in SQLite.

Run from api/:  uvicorn app.main:app --reload --port 8000
"""
import json
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers

from .db import connect, get_conn, migrate
from .detail_api import jobs as detail_jobs
from .detail_api import store as detail_store
from .detail_api.models import DetailJobRef
from .detail_api.routes import router as detail_router
from .detail_api.tiles import cog as detail_cog
from .geo import CheckedPolygon, GeometryError, check_polygon
from .models import PlanIn, PlanOut, PropertyIn, PropertyOut, PropertyPatch


@asynccontextmanager
async def lifespan(_: FastAPI):
    migrate()
    conn = connect()
    try:
        detail_store.backfill_geometry_meta(conn)
    finally:
        conn.close()
    detail_jobs.RUNNER.start()
    detail_jobs.RUNNER.recover()
    detail_jobs.RUNNER.purge()  # optional TTL (AF_DETAIL_TTL_DAYS); then hourly when the worker is idle
    yield


app = FastAPI(title="Adaptive Farming API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Sentinel-2 10 m detail per property (app/detail_api, processing in pipeline/src/detail)
app.include_router(detail_router)
app.include_router(detail_cog.router, prefix="/api/detail/cog", tags=["detail tiles"])
add_exception_handlers(app, DEFAULT_STATUS_CODES)  # rio-tiler errors → 4xx instead of 500

Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def to_out(row: sqlite3.Row) -> PropertyOut:
    return PropertyOut(
        id=row["id"],
        name=row["name"],
        notes=row["notes"],
        geometry=json.loads(row["geometry"]),
        area_m2=row["area_m2"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def checked(geometry: dict) -> CheckedPolygon:
    try:
        return check_polygon(geometry)
    except GeometryError as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, {"reason": e.reason, "message": str(e)}
        ) from e


def fetch(conn: sqlite3.Connection, pid: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM properties WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    return row


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """The app lives in web/ (http://localhost:4200); here, show the interactive API docs."""
    return RedirectResponse("/docs")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/properties", response_model=list[PropertyOut])
def list_properties(conn: Conn):
    rows = conn.execute("SELECT * FROM properties ORDER BY created_at, id").fetchall()
    return [to_out(r) for r in rows]


@app.post("/api/properties", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
def create_property(body: PropertyIn, conn: Conn):
    poly = checked(body.geometry.model_dump())
    ts = now()
    with conn:
        cur = conn.execute(
            """INSERT INTO properties (name, notes, geometry, area_m2,
                                       min_lon, min_lat, max_lon, max_lat, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (body.name.strip(), body.notes, json.dumps(poly.geometry), poly.area_m2, *poly.bbox, ts, ts),
        )
        detail_store.set_geometry_meta(conn, cur.lastrowid, poly.geometry)
    out = to_out(fetch(conn, cur.lastrowid))
    out.detail_job = job_ref(detail_jobs.request_job(conn, out.id))
    return out


def job_ref(job: sqlite3.Row) -> DetailJobRef:
    return DetailJobRef(id=job["id"], status=job["status"])


@app.get("/api/properties/{pid}", response_model=PropertyOut)
def get_property(pid: int, conn: Conn):
    return to_out(fetch(conn, pid))


@app.patch("/api/properties/{pid}", response_model=PropertyOut)
def update_property(pid: int, body: PropertyPatch, conn: Conn):
    old_hash = fetch(conn, pid)["geom_hash"]
    patch = body.model_dump(exclude_unset=True)
    sets: dict[str, object] = {}
    if patch.get("name") is not None:
        sets["name"] = patch["name"].strip()
    if patch.get("notes") is not None:
        sets["notes"] = patch["notes"]
    if patch.get("geometry") is not None:
        poly = checked(patch["geometry"])
        min_lon, min_lat, max_lon, max_lat = poly.bbox
        sets |= {
            "geometry": json.dumps(poly.geometry),
            "area_m2": poly.area_m2,
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat,
        }
    if sets:
        sets["updated_at"] = now()
        cols = ", ".join(f"{k} = ?" for k in sets)  # keys come from the fixed set above
        with conn:
            conn.execute(f"UPDATE properties SET {cols} WHERE id = ?", (*sets.values(), pid))
            if "geometry" in sets:
                # Stats were computed for the old shape.
                conn.execute("DELETE FROM property_stats WHERE property_id = ?", (pid,))
                new_hash = detail_store.set_geometry_meta(conn, pid, json.loads(sets["geometry"]))
    out = to_out(fetch(conn, pid))
    if "geometry" in sets:
        if new_hash != old_hash:
            detail_store.clear_detail(conn, pid)  # 10 m layers of the old shape are stale
        # New shape: full fetch. Same shape saved again: only acquisitions since the last one.
        out.detail_job = job_ref(detail_jobs.request_job(conn, pid))
    return out


@app.delete("/api/properties/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property(pid: int, conn: Conn):
    fetch(conn, pid)
    with conn:
        conn.execute("DELETE FROM properties WHERE id = ?", (pid,))  # detail rows cascade
    detail_store.remove_files(pid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def plan_out(pid: int, row: sqlite3.Row | None) -> PlanOut:
    if row is None:
        return PlanOut(property_id=pid, status="draft", cycles=[])
    return PlanOut(
        property_id=pid,
        status=row["status"],
        cycles=json.loads(row["cycles"]),
        saved_at=row["saved_at"],
        updated_at=row["updated_at"],
    )


@app.get("/api/plans", response_model=list[PlanOut])
def list_plans(conn: Conn):
    """Every stored plan (the lands page shows how many crops each land has planned)."""
    rows = conn.execute("SELECT * FROM plans ORDER BY property_id").fetchall()
    return [plan_out(r["property_id"], r) for r in rows]


@app.get("/api/properties/{pid}/plan", response_model=PlanOut)
def get_plan(pid: int, conn: Conn):
    fetch(conn, pid)
    row = conn.execute("SELECT * FROM plans WHERE property_id = ?", (pid,)).fetchone()
    return plan_out(pid, row)


@app.put("/api/properties/{pid}/plan", response_model=PlanOut)
def put_plan(pid: int, body: PlanIn, conn: Conn):
    fetch(conn, pid)
    ts = now()
    previous = conn.execute("SELECT saved_at FROM plans WHERE property_id = ?", (pid,)).fetchone()
    saved_at = ts if body.status == "saved" else (previous["saved_at"] if previous else None)
    cycles = json.dumps([c.model_dump(by_alias=True) for c in body.cycles])
    with conn:
        conn.execute(
            """
            INSERT INTO plans (property_id, status, cycles, saved_at, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(property_id) DO UPDATE SET
                status = excluded.status, cycles = excluded.cycles,
                saved_at = excluded.saved_at, updated_at = excluded.updated_at
            """,
            (pid, body.status, cycles, saved_at, ts),
        )
    return get_plan(pid, conn)
