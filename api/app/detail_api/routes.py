"""Endpoints of the Sentinel-2 detail layer: /api/properties/{id}/detail/* and /api/detail/*."""
from __future__ import annotations

import json
import sqlite3
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from rio_tiler.colormap import cmap
from starlette.concurrency import run_in_threadpool

from detail.config import ATTRIBUTION, LAYERS

from ..db import get_conn
from . import jobs, store
from .models import (
    CompositeOut,
    DetailJobOut,
    DetailStatusOut,
    IndexDefOut,
    IndexName,
    LayerName,
    PointOut,
    PointValue,
    SceneOut,
    StatOut,
)
from .tiles import render_tile

router = APIRouter(prefix="/api", tags=["detail"])
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]
# A day (scene), a month (composite) or 'latest' (days since clear counted to today)
PERIOD_PATTERN = r"^(\d{4}-\d{2}(-\d{2})?|latest)$"
PeriodStr = Annotated[str, Path(pattern=PERIOD_PATTERN)]


def _kind(period: str) -> str:
    return "scene" if len(period) == 10 else "composite"


def _layer_path(conn: sqlite3.Connection, pid: int, layer: str, period: str):
    row = store.asset_for(conn, pid, layer, period, _kind(period))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No layer for this property, index and date")
    try:
        path = store.resolve_asset_path(row["path"])
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No layer") from None
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Layer file missing")
    return path


def _property(conn: sqlite3.Connection, pid: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM properties WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    return row


def job_out(j: sqlite3.Row) -> DetailJobOut:
    found = j["scenes_found"]
    progress = 1.0 if j["status"] == "done" else (j["scenes_done"] / found if found else 0.0)
    return DetailJobOut(
        id=j["id"], status=j["status"], kind=j["kind"], created_at=j["created_at"], started_at=j["started_at"],
        finished_at=j["finished_at"], date_from=j["date_from"], date_to=j["date_to"], source=j["source"],
        scenes_found=found, scenes_done=j["scenes_done"], scenes_valid=j["scenes_valid"], progress=round(progress, 3),
        error_reason=j["error_reason"], error=j["error"],
    )


@router.get("/properties/{pid}/detail/status", response_model=DetailStatusOut)
def detail_status(pid: int, conn: Conn):
    _property(conn, pid)
    store.touch(conn, pid)
    j = store.latest_job(conn, pid)
    r = conn.execute(
        """SELECT SUM(status = 'valid'), SUM(status = 'cloudy'),
                  MAX(CASE WHEN status != 'error' THEN acquired_at END), MAX(CASE WHEN status = 'valid' THEN acquired_at END)
           FROM detail_scenes WHERE property_id = ?""",
        (pid,),
    ).fetchone()
    last_clear = r[3]
    year = (last_clear or date.today().isoformat())[:4]
    return DetailStatusOut(
        job=job_out(j) if j else None,
        scenes_valid=r[0] or 0,
        scenes_cloudy=r[1] or 0,
        last_acquired=r[2],
        last_clear_date=last_clear,
        days_since_clear=(date.today() - date.fromisoformat(last_clear)).days if last_clear else None,
        attribution=ATTRIBUTION.format(year=year),
    )


@router.post("/properties/{pid}/detail/refresh", response_model=DetailJobOut, status_code=status.HTTP_202_ACCEPTED)
def detail_refresh(pid: int, conn: Conn):
    """Fetch acquisitions newer than the last processed day (and retry days that failed to load)."""
    _property(conn, pid)
    return job_out(jobs.request_job(conn, pid))


@router.get("/properties/{pid}/detail/scenes", response_model=list[SceneOut])
def detail_scenes(pid: int, conn: Conn):
    """Every processed acquisition day (valid, cloudy, error), oldest first: feeds the date picker."""
    _property(conn, pid)
    assets = store.assets_by_date(conn, pid)
    return [
        SceneOut(
            date=s["acquired_at"], status=s["status"], valid_pct=s["valid_pct_polygon"], cloud_cover_scene=s["cloud_cover_scene"],
            source=s["source"], stac_item_id=s["stac_item_id"], assets=assets.get(s["acquired_at"], {}),
        )
        for s in store.scenes(conn, pid)
    ]


@router.get("/properties/{pid}/detail/stats", response_model=list[StatOut])
def detail_stats(
    pid: int,
    conn: Conn,
    index: IndexName = "ndvi",
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
):
    """Time series of zonal stats for one index (valid days only)."""
    _property(conn, pid)
    rows = store.stats(conn, pid, index, date_from and date_from.isoformat(), date_to and date_to.isoformat())
    return [
        StatOut(
            date=r["date"], mean=r["mean"], median=r["median"], p10=r["p10"], p90=r["p90"], std=r["std"],
            valid_pct=r["valid_pct"], n_pixels=r["n_pixels"], class_dist=json.loads(r["class_dist"]),
        )
        for r in rows
    ]


@router.get("/properties/{pid}/detail/composites", response_model=list[CompositeOut])
def detail_composites(pid: int, conn: Conn):
    """Monthly median composites (+ days since clear), oldest first, then 'latest'."""
    _property(conn, pid)
    per_month: dict[str, int] = {}
    for s in store.scenes(conn, pid):
        if s["status"] == "valid":
            per_month[s["acquired_at"][:7]] = per_month.get(s["acquired_at"][:7], 0) + 1
    out = [
        CompositeOut(period=p, n_days=sum(per_month.values()) if p == "latest" else per_month.get(p, 0), assets=a)
        for p, a in store.composites(conn, pid).items()
    ]
    return sorted(out, key=lambda c: (c.period == "latest", c.period))


@router.get("/properties/{pid}/detail/point", response_model=PointOut)
def detail_point(
    pid: int,
    conn: Conn,
    lon: Annotated[float, Query(ge=-180, le=180)],
    lat: Annotated[float, Query(ge=-90, le=90)],
    period: Annotated[str, Query(alias="date", pattern=PERIOD_PATTERN)],
):
    """Every layer's value at one pixel of a day or month (click-to-inspect on the map)."""
    _property(conn, pid)
    rows = conn.execute(
        "SELECT index_name, path FROM detail_assets WHERE property_id = ? AND period = ? AND kind = ?",
        (pid, period, _kind(period)),
    ).fetchall()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No layers for this date")
    values = {}
    for r in sorted(rows, key=lambda r: list(LAYERS).index(r["index_name"]) if r["index_name"] in LAYERS else 99):
        try:
            path = store.resolve_asset_path(r["path"])
        except ValueError:
            continue
        v = sample_point(path, lon, lat)
        cls = class_of(r["index_name"], v)
        values[r["index_name"]] = PointValue(value=v, class_label=cls and cls["label"], color=cls and cls["color"])
    return PointOut(date=period, lon=lon, lat=lat, inside=any(v.value is not None for v in values.values()), values=values)


@router.get(
    "/properties/{pid}/detail/tiles/{index}/{day}/{z}/{x}/{y}.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
async def detail_tile(
    pid: int,
    index: LayerName,
    day: PeriodStr,
    z: int,
    x: int,
    y: int,
    conn: Conn,
    style: Literal["classes", "continuous"] = "classes",
    rescale: Annotated[str | None, Query(pattern=r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?$", description="min,max (continuous)")] = None,
    colormap_name: Annotated[str, Query(pattern=r"^[a-z_]+$")] = "rdylgn",
):
    """XYZ tile of one layer on a day (YYYY-MM-DD), a month composite (YYYY-MM) or 'latest'.
    Class colors match /api/detail/indices; nearest resampling, so 10 m pixels stay square."""
    path = _layer_path(conn, pid, index, day)
    if colormap_name not in cmap.list():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown colormap '{colormap_name}'")
    rs = tuple(float(v) for v in rescale.split(",")) if rescale else None
    png = await run_in_threadpool(render_tile, str(path), index, z, x, y, style, rs, colormap_name)
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.get("/detail/indices", response_model=list[IndexDefOut])
def detail_indices():
    """Layer definitions, display ranges and classes (legend + the class_dist keys in /stats).
    `days_since_clear` exists for composites only."""
    return [IndexDefOut(key=k, **{f: v[f] for f in ("label", "formula", "provisional", "range", "classes")}) for k, v in LAYERS.items()]


def class_of(layer: str, v: float | None) -> dict | None:
    if v is None or layer not in LAYERS:
        return None
    for c in LAYERS[layer]["classes"]:
        if (c["min"] is None or v >= c["min"]) and (c["max"] is None or v < c["max"]):
            return c
    return None


def sample_point(path, lon: float, lat: float) -> float | None:
    """Pixel value at lon/lat (None outside the raster or on nodata)."""
    import rasterio
    from rasterio.warp import transform as warp

    with rasterio.open(path) as src:
        (x,), (y,) = warp("EPSG:4326", src.crs, [lon], [lat])
        row, col = src.index(x, y)
        if not (0 <= row < src.height and 0 <= col < src.width):
            return None
        v = float(src.read(1, window=((row, row + 1), (col, col + 1)))[0, 0])
        nodata = src.nodata
    return None if v == nodata or v != v else round(v, 4)
