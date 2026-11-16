"""Map tiles for the detail COGs.

* `/api/detail/cog/...` is a titiler.core TilerFactory (tiles, tilejson, info, statistics, preview).
  It takes `assetId` (a detail_assets row), never a URL or path, and the path is checked to lie under
  the detail root.
* `/api/properties/{id}/detail/tiles/{index}/{date}/{z}/{x}/{y}.png` (routes.py) is the friendly form
  the map uses, with the legend's class colors by default.
"""
from __future__ import annotations

import sqlite3
from functools import lru_cache
from typing import Annotated

import numpy as np
from fastapi import Depends, HTTPException, Query
from rio_tiler.colormap import cmap
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader
from rio_tiler.utils import render
from titiler.core.factory import TilerFactory

from detail.config import LAYERS

from ..db import get_conn
from . import store


def asset_path(
    asset_id: Annotated[int, Query(alias="assetId", description="detail_assets id (from /detail/scenes)")],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> str:
    row = store.asset(conn, asset_id)
    if row is None:
        raise HTTPException(404, "Unknown asset")
    try:
        path = store.resolve_asset_path(row["path"])
    except ValueError:
        raise HTTPException(404, "Unknown asset") from None
    if not path.is_file():
        raise HTTPException(404, "Asset file missing")
    return str(path)


cog = TilerFactory(path_dependency=asset_path, router_prefix="/api/detail/cog", add_viewer=False)


def _hex(c: str) -> tuple[int, int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), 255


@lru_cache
def class_colormap(index: str) -> list:
    """rio-tiler 'intervals' colormap from the layer classes (open ends → ±1e9, beyond any value)."""
    return [((-1e9 if c["min"] is None else c["min"], 1e9 if c["max"] is None else c["max"]), _hex(c["color"])) for c in LAYERS[index]["classes"]]


@lru_cache
def empty_png(size: int = 256) -> bytes:
    return render(np.zeros((1, size, size), np.uint8), mask=np.zeros((size, size), np.uint8), img_format="PNG")


def render_tile(path: str, index: str, z: int, x: int, y: int, style: str, rescale: tuple[float, float] | None, colormap_name: str) -> bytes:
    try:
        with Reader(path) as r:
            img = r.tile(x, y, z, tilesize=256, resampling_method="nearest", reproject_method="nearest")
    except TileOutsideBounds:
        return empty_png()
    if style == "classes":
        return img.render(img_format="PNG", colormap=class_colormap(index))
    lo, hi = rescale or LAYERS[index]["range"]
    img.rescale(in_range=((lo, hi),))
    return img.render(img_format="PNG", colormap=cmap.get(colormap_name))

