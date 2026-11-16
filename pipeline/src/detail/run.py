"""Fetch and process Sentinel-2 detail for one polygon. Used by the API job runner and as a CLI.

CLI (from pipeline/src, with the api venv):
    python -m detail.run --geojson plot.geojson --out ../data/property_detail/_cli --days 90
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .config import CONFIG, INDEX_KEYS, DetailConfig
from .geometry import Footprint, footprint
from .outputs import write_cog
from .process import process_scene, window_geobox, zonal_stats
from .sources import SceneGroup, Source, default_sources

log = logging.getLogger("detail")


class DetailError(Exception):
    """A job-level failure with a machine-readable reason for the API."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


class Cancelled(Exception):
    pass


@dataclass
class SceneOutcome:
    date: str
    source: str
    item_ids: str
    cloud_cover: float | None
    status: str  # 'valid' | 'cloudy' | 'error'
    valid_pct: float | None = None
    assets: dict[str, dict] = field(default_factory=dict)  # index → {path, min, max, crs}
    stats: dict[str, dict] = field(default_factory=dict)  # index → zonal stats
    error: str | None = None


def check_scope(fp: Footprint, cfg: DetailConfig = CONFIG) -> None:
    if fp.area_ha > cfg.max_area_ha:
        raise DetailError(
            "area-too-large",
            f"Property is {fp.area_ha:,.0f} ha; the 10 m detail layer is limited to {cfg.max_area_ha:,.0f} ha.",
        )


def search(fp: Footprint, date_from: date, date_to: date, sources: Sequence[Source]) -> tuple[Source, list[SceneGroup]]:
    """Search each source in order; the first that answers is used for the whole job."""
    errors = []
    for src in sources:
        try:
            groups = src.search(fp.bbox_ll, date_from, date_to)
            log.info("%s: %d acquisition day(s) %s..%s", src.name, len(groups), date_from, date_to)
            return src, groups
        except Exception as e:
            log.warning("%s search failed: %s", src.name, e)
            errors.append(f"{src.name}: {e}")
    raise DetailError("search-failed", "All imagery catalogues failed: " + " | ".join(errors))


def process_group(src: Source, group: SceneGroup, fp: Footprint, out_dir: Path, cfg: DetailConfig = CONFIG) -> SceneOutcome:
    out = SceneOutcome(date=group.date, source=src.name, item_ids=group.item_ids, cloud_cover=group.cloud_cover, status="error")
    t0 = time.monotonic()
    try:
        ds = src.load(group, window_geobox(fp, cfg.resolution_m), fp)
    except Exception as e:
        out.error = f"{type(e).__name__}: {e}"
        log.error("%s load failed: %s", group.date, out.error)
        return out
    res = process_scene(ds, fp, cfg)
    out.valid_pct = round(res.valid_pct, 2)
    if res.valid_pct < cfg.min_valid_pct:
        out.status = "cloudy"
        log.info("%s cloudy: %.1f%% valid (scene cloud %s%%)", group.date, res.valid_pct, _fmt(group.cloud_cover))
        return out
    day_dir = out_dir / group.date
    for idx in INDEX_KEYS:
        path = day_dir / f"{idx}.tif"
        info = write_cog(res.indices[idx], path, tags={"date": group.date, "index": idx, "source": src.name, "items": group.item_ids})
        out.assets[idx] = {"path": path, **info}
        out.stats[idx] = zonal_stats(res.indices[idx], res.inside, idx)
    out.status = "valid"
    log.info("%s valid: %.1f%% clear, NDVI mean %.3f (%.1fs)", group.date, res.valid_pct, out.stats["ndvi"]["mean"] or float("nan"), time.monotonic() - t0)
    return out


def run_detail(
    geojson: dict,
    date_from: date,
    date_to: date,
    out_dir: Path,
    *,
    skip_dates: set[str] = frozenset(),
    sources: Sequence[Source] | None = None,
    cfg: DetailConfig = CONFIG,
    on_found: Callable[[str, list[SceneGroup]], None] | None = None,
    on_scene: Callable[[SceneOutcome], None] | None = None,
    should_continue: Callable[[], bool] | None = None,
) -> list[SceneOutcome]:
    """Search, then process acquisition days oldest → newest (an interrupted run leaves a clean prefix)."""
    fp = footprint(geojson, cfg.buffer_m, cfg.resolution_m)
    check_scope(fp, cfg)
    src, groups = search(fp, date_from, date_to, sources or default_sources(cfg))
    todo = [g for g in groups if g.date not in skip_dates]
    log.info("%d new day(s) to process (%d already stored); UTM EPSG:%d, %.1f ha", len(todo), len(groups) - len(todo), fp.epsg, fp.area_ha)
    if on_found:
        on_found(src.name, todo)
    results = []
    for g in todo:
        if should_continue and not should_continue():
            raise Cancelled()
        r = process_group(src, g, fp, out_dir, cfg)
        results.append(r)
        if on_scene:
            on_scene(r)
    return results


def quiet_libraries() -> None:
    """rasterio logs 'boto3 not available' at INFO for every read; keep job logs readable."""
    for name in ("rasterio", "rio_cogeo", "urllib3", "pystac_client"):
        logging.getLogger(name).setLevel(logging.WARNING)


def _fmt(v):
    return "?" if v is None else f"{v:.0f}"


def monthly_counts(results: list[SceneOutcome]) -> dict[str, dict[str, int]]:
    c: dict[str, Counter] = {}
    for r in results:
        c.setdefault(r.date[:7], Counter())[r.status] += 1
    return {m: dict(v) for m, v in sorted(c.items())}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--geojson", required=True, help="Polygon or Feature GeoJSON (EPSG:4326)")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--days", type=int, default=CONFIG.window_days)
    ap.add_argument("--source", choices=["earth-search", "pc"], help="force one catalogue")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    quiet_libraries()
    gj = json.loads(Path(a.geojson).read_text())
    gj = gj.get("geometry", gj) if gj.get("type") == "Feature" else gj
    srcs = default_sources()
    if a.source:
        srcs = [s for s in srcs if s.name == a.source]
    today = date.today()
    res = run_detail(gj, today - timedelta(days=a.days), today, a.out, sources=srcs)
    print(json.dumps({"by_month": monthly_counts(res), "valid": sum(r.status == "valid" for r in res), "total": len(res)}, indent=2))


if __name__ == "__main__":
    main()
