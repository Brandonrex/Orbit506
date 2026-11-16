"""Monthly median composites and 'days since last clear observation', built from the stored day COGs.

No downloads: every valid day of a property is already on disk on the same grid (same footprint →
same window → same clip), so a month is a per-pixel nanmedian over that month's days.

    composites/{YYYY-MM}/{ndvi|ndmi|ndre}.tif     median of the month's clear observations
    composites/{YYYY-MM}/days_since_clear.tif      days from the last clear observation to the month's end
                                                    (or today, for the current month)
    composites/latest/days_since_clear.tif         same, counted to today
"""
from __future__ import annotations

import logging
import shutil
import warnings
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import rasterio
import rioxarray  # noqa: F401  (registers the .rio accessor)
import xarray as xr

from .config import INDEX_KEYS
from .outputs import write_cog

log = logging.getLogger("detail")

DAYS_SINCE_CLEAR = "days_since_clear"


@dataclass
class CompositeOutcome:
    period: str  # 'YYYY-MM' or 'latest'
    n_days: int  # valid days that went into it
    assets: dict[str, dict] = field(default_factory=dict)  # layer → {path, min, max, crs}


def month_end(ym: str) -> date:
    y, m = int(ym[:4]), int(ym[5:])
    return (date(y + (m == 12), m % 12 + 1, 1)) - timedelta(days=1)


def _open(path: Path) -> xr.DataArray:
    """Read a day COG fully and close it (rioxarray's cached handles would block deletes on Windows)."""
    with rasterio.open(path) as src:
        a = src.read(1).astype(np.float32)
        if src.nodata is not None:
            a[a == src.nodata] = np.nan
        t, crs, (h, w) = src.transform, src.crs, a.shape
    x = t.c + (np.arange(w) + 0.5) * t.a
    y = t.f + (np.arange(h) + 0.5) * t.e
    da = xr.DataArray(a, dims=("y", "x"), coords={"y": y, "x": x})
    return da.rio.write_crs(crs).rio.write_transform(t)


def build_composites(prop_dir: Path, valid_dates: list[str], today: date | None = None) -> list[CompositeOutcome]:
    """Rebuild every composite of a property from its valid days. Returns what was written."""
    today = today or date.today()
    out_root = prop_dir / "composites"
    shutil.rmtree(out_root, ignore_errors=True)
    dates = sorted(d for d in valid_dates if (prop_dir / d / "ndvi.tif").is_file())
    if not dates:
        return []

    stacks: dict[str, list[xr.DataArray]] = {k: [] for k in INDEX_KEYS}
    template = None
    kept: list[str] = []
    for d in dates:
        arrays = {k: _open(prop_dir / d / f"{k}.tif") for k in INDEX_KEYS}
        if template is None:
            template = arrays["ndvi"]
        if arrays["ndvi"].shape != template.shape:  # can only happen if files of another geometry survived
            log.warning("composites: %s has another grid, skipped", d)
            continue
        kept.append(d)
        for k in INDEX_KEYS:
            stacks[k].append(arrays[k].values)
    assert template is not None
    clear = np.stack([np.isfinite(a) for a in stacks["ndvi"]])  # (days, y, x)
    day_numbers = np.array([date.fromisoformat(d).toordinal() for d in kept])

    def like(values: np.ndarray) -> xr.DataArray:
        return template.copy(data=values.astype(np.float32)).rio.write_nodata(np.nan, encoded=False)

    def days_since(ref: date, upto: np.ndarray) -> np.ndarray:
        """Days from the last clear observation on or before `ref` (NaN: never clear, or outside)."""
        seen = clear & upto[:, None, None]
        last = np.where(seen, day_numbers[:, None, None], -1).max(axis=0)
        return np.where(last >= 0, ref.toordinal() - last, np.nan).astype(np.float32)

    by_month: dict[str, list[int]] = defaultdict(list)
    for i, d in enumerate(kept):
        by_month[d[:7]].append(i)

    results = []
    for ym, idx in sorted(by_month.items()):
        o = CompositeOutcome(period=ym, n_days=len(idx))
        folder = out_root / ym
        tags = {"period": ym, "n_days": len(idx), "dates": ",".join(kept[i] for i in idx)}
        for k in INDEX_KEYS:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN pixels → NaN
                med = np.nanmedian(np.stack([stacks[k][i] for i in idx]), axis=0)
            path = folder / f"{k}.tif"
            o.assets[k] = {"path": path, **write_cog(like(med), path, tags=tags | {"layer": f"{k} monthly median"})}
        ref = min(month_end(ym), today)
        path = folder / f"{DAYS_SINCE_CLEAR}.tif"
        dsc = days_since(ref, day_numbers <= ref.toordinal())
        o.assets[DAYS_SINCE_CLEAR] = {"path": path, **write_cog(like(dsc), path, tags={"period": ym, "reference": ref.isoformat()})}
        results.append(o)

    latest = CompositeOutcome(period="latest", n_days=len(kept))
    path = out_root / "latest" / f"{DAYS_SINCE_CLEAR}.tif"
    latest.assets[DAYS_SINCE_CLEAR] = {
        "path": path,
        **write_cog(like(days_since(today, np.ones(len(kept), bool))), path, tags={"reference": today.isoformat()}),
    }
    results.append(latest)
    log.info("composites: %d month(s) from %d valid day(s)", len(results) - 1, len(kept))
    return results
