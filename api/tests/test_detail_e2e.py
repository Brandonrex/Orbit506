"""End-to-end against the real catalogues: a ~10 ha plot near Pacayas, last 12 months.

    cd api && .venv/Scripts/python -m pytest tests/test_detail_e2e.py --network -s

Outputs are kept in pipeline/data/property_detail/_e2e/ (gitignored) for a visual check in QGIS,
and a report (valid days per month, MODIS comparison) is written to _e2e/report.json.
"""
import csv
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rio_cogeo.cogeo import cog_validate

from app.detail_api import jobs
from detail.config import REPO, detail_root
from detail.geometry import footprint
from detail.sources import default_sources

pytestmark = pytest.mark.network

# Potrero near Pacayas (Alvarado, Cartago), ~10 ha
PLOT = {
    "type": "Polygon",
    "coordinates": [[[-83.817, 9.91], [-83.8141, 9.91], [-83.8141, 9.9129], [-83.817, 9.9129], [-83.817, 9.91]]],
}
PROCESSED = REPO / "pipeline" / "data" / "processed"
E2E_ROOT = REPO / "pipeline" / "data" / "property_detail" / "_e2e"


def nearest_grid_point(lon: float, lat: float) -> int:
    with open(PROCESSED / "cuadricula.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    return int(min(rows, key=lambda r: (float(r["Longitude"]) - lon) ** 2 + (float(r["Latitude"]) - lat) ** 2)["ID"])


def modis_monthly(point_id: int) -> tuple[dict[int, float], dict[str, float]]:
    """(climatology by month 2020–2025, value by 'YYYY-MM') for one grid point."""
    by_month, by_ym = defaultdict(list), {}
    with open(PROCESSED / "ndvi_monthly.csv", newline="") as f:
        for r in csv.DictReader(f):
            if int(r["point_id"]) == point_id and r["ndvi"]:
                by_month[int(r["month"])].append(float(r["ndvi"]))
                by_ym[f"{int(r['year']):04d}-{int(r['month']):02d}"] = float(r["ndvi"])
    return {m: float(np.mean(v)) for m, v in by_month.items()}, by_ym


@pytest.fixture
def real_sources(monkeypatch):
    monkeypatch.setenv("AF_DETAIL_ROOT", str(E2E_ROOT))
    jobs.RUNNER.sources_factory = default_sources


def test_pacayas_plot_end_to_end(client, real_sources):
    r = client.post("/api/properties", json={"name": "E2E Pacayas", "geometry": PLOT})
    assert r.status_code == 201
    pid = r.json()["id"]
    jobs.RUNNER.wait_idle()

    st = client.get(f"/api/properties/{pid}/detail/status").json()
    job = st["job"]
    assert job["status"] == "done", job
    assert job["source"] in ("earth-search", "pc")
    assert job["scenesFound"] > 20  # ~5-day revisit, cloud prefilter < 80 %
    assert st["scenesValid"] >= 3

    fp = footprint(PLOT)
    assert fp.epsg == 32617
    scenes = client.get(f"/api/properties/{pid}/detail/scenes").json()
    valid = [s for s in scenes if s["status"] == "valid"]
    errors = [s for s in scenes if s["status"] == "error"]
    assert len(errors) <= 2, errors

    # COGs: exist, valid, right CRS and bounds, values in [-1, 1]
    pminx, pminy, pmaxx, pmaxy = fp.poly_utm.bounds
    for s in valid:
        for idx in ("ndvi", "ndmi", "ndre"):
            path = detail_root() / str(pid) / s["date"] / f"{idx}.tif"
            assert path.is_file()
            ok, errs, _ = cog_validate(str(path), quiet=True)
            assert ok, errs
            with rasterio.open(path) as src:
                assert src.crs.to_epsg() == 32617
                b = src.bounds
                assert abs(b.left - pminx) <= 10 and abs(b.right - pmaxx) <= 10
                assert abs(b.bottom - pminy) <= 10 and abs(b.top - pmaxy) <= 10
                a = src.read(1, masked=True)
                assert a.count() > 0 and -1 <= a.min() <= a.max() <= 1

    # Stats rows for every valid day and index
    for idx in ("ndvi", "ndmi", "ndre"):
        stats = client.get(f"/api/properties/{pid}/detail/stats", params={"index": idx}).json()
        assert [x["date"] for x in stats] == [s["date"] for s in valid]
        assert all(x["validPct"] >= 60 and abs(sum(x["classDist"].values()) - 100) < 0.5 for x in stats)

    # A tile over the plot renders
    import morecantile

    c = fp.poly_utm.centroid
    lon, lat = Transformer.from_crs(32617, 4326, always_xy=True).transform(c.x, c.y)
    t = morecantile.tms.get("WebMercatorQuad").tile(lon, lat, 16)
    tile = client.get(f"/api/properties/{pid}/detail/tiles/ndvi/{valid[-1]['date']}/{t.z}/{t.x}/{t.y}.png")
    assert tile.status_code == 200 and tile.headers["content-type"] == "image/png"

    # ---- report: valid days per month, MODIS comparison ----
    ndvi = {x["date"]: x["mean"] for x in client.get(f"/api/properties/{pid}/detail/stats", params={"index": "ndvi"}).json()}
    by_month: dict[str, dict] = defaultdict(lambda: {"valid": 0, "cloudy": 0, "error": 0})
    for s in scenes:
        by_month[s["date"][:7]][s["status"]] += 1
    s2_month: dict[str, list] = defaultdict(list)
    for d, m in ndvi.items():
        s2_month[d[:7]].append(m)
    s2_month_mean = {k: float(np.mean(v)) for k, v in s2_month.items()}

    point = nearest_grid_point(lon, lat)
    clim, modis_ym = modis_monthly(point)
    pairs = [(v, clim[int(k[5:])]) for k, v in s2_month_mean.items() if int(k[5:]) in clim]
    corr = float(np.corrcoef(*zip(*pairs))[0, 1]) if len(pairs) >= 4 else math.nan
    report = {
        "property_id": pid,
        "source": job["source"],
        "window": [job["dateFrom"], job["dateTo"]],
        "days_found": job["scenesFound"],
        "days_valid": st["scenesValid"],
        "days_cloudy": st["scenesCloudy"],
        "days_error": len(errors),
        "valid_days_by_month": dict(sorted(by_month.items())),
        "modis_point_id": point,
        "s2_ndvi_monthly_mean": {k: round(v, 3) for k, v in sorted(s2_month_mean.items())},
        "modis_ndvi_climatology_2020_2025": {f"{m:02d}": round(v, 3) for m, v in sorted(clim.items())},
        "modis_same_month_overlap": {k: modis_ym[k] for k in s2_month_mean if k in modis_ym},
        "s2_vs_modis_climatology_corr": None if math.isnan(corr) else round(corr, 2),
        "s2_mean_ndvi": round(float(np.mean(list(ndvi.values()))), 3),
        "modis_mean_ndvi_climatology": round(float(np.mean(list(clim.values()))), 3),
        "last_clear": st["lastClearDate"],
        "days_since_clear": st["daysSinceClear"],
        "folder": str(detail_root() / str(pid)),
    }
    Path(E2E_ROOT).mkdir(parents=True, exist_ok=True)
    (E2E_ROOT / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    # Same broad level as MODIS for a vegetated plot (not identical: 10 m vs 250 m, different dates)
    assert abs(report["s2_mean_ndvi"] - report["modis_mean_ndvi_climatology"]) < 0.25
