"""Prepare compact, browser-ready data for the Adaptive Farming web app.

Reads (read-only) from  ../../pipeline/data/
Writes                 to  ../public/data/

Uses only the Python standard library (no pandas), so it runs on any Python 3.9+.

    python web/scripts/prepare_data.py

Outputs:
  typical_month.csv   192 points x 12 months  (from app_data.csv)
  annual_normal.csv   192 points              (from app_data_annual_normal.csv)
  aoi.geojson         Cartago area of interest (copied)
  manifest.json       bbox, grid resolution, variables, min/max per variable per period
"""
from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "pipeline" / "data" / "processed"
AOI_SRC = ROOT / "pipeline" / "data" / "appeears" / "cartago_area.geojson"
OUT = ROOT / "web" / "public" / "data"

RESOLUTION_DEG = 0.045  # grid step used by pipeline/src/cuadricula.py (~5 km)

# Same provisional thresholds as pipeline/src/app_data.py
FROST_HIGH = 2.0
FROST_MEDIUM = 5.0

# Numeric variables exposed to the app (empty pipeline columns are dropped)
NUMERIC_VARS = [
    "ndvi", "rain_mm", "tmean_c", "tmax_c", "tmin_c", "tmin_extreme_c",
    "eto_mm", "balance_mm", "soil_wetness", "elevation_m", "temp_correction_c",
]
OUT_COLS = ["point_id", "lat", "lon"] + NUMERIC_VARS + ["frost_risk"]


def num(value: str) -> float | None:
    value = (value or "").strip()
    return float(value) if value else None


def frost(tmin_extreme: float | None) -> str:
    if tmin_extreme is None:
        return ""
    if tmin_extreme <= FROST_HIGH:
        return "high"
    if tmin_extreme <= FROST_MEDIUM:
        return "medium"
    return "low"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fmt(value: float | None) -> str:
    return "" if value is None else f"{round(value, 3):g}"


def write_csv(path: Path, cols: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: fmt(v) if isinstance(v, float) or v is None else v for k, v in row.items()})


def ranges(rows: list[dict]) -> dict[str, dict[str, float]]:
    out = {}
    for var in NUMERIC_VARS:
        values = [r[var] for r in rows if r.get(var) is not None]
        if values:
            out[var] = {"min": round(min(values), 3), "max": round(max(values), 3)}
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # Exact grid coordinates (app_data*.csv lat/lon are rounded to 2 decimals)
    grid = {int(r["ID"]): r for r in read_csv(SRC / "cuadricula.csv")}
    coords = {pid: (float(r["Latitude"]), float(r["Longitude"])) for pid, r in grid.items()}

    # ---- typical month ----
    typical = []
    temp_corr: dict[int, float] = {}
    for r in read_csv(SRC / "app_data.csv"):
        pid = int(r["point_id"])
        lat, lon = coords[pid]
        row = {"point_id": pid, "lat": lat, "lon": lon, "month": int(r["month"])}
        for var in NUMERIC_VARS:
            if var != "tmean_c":
                row[var] = num(r.get(var, ""))
        tmax, tmin = row["tmax_c"], row["tmin_c"]
        row["tmean_c"] = (tmax + tmin) / 2 if tmax is not None and tmin is not None else None
        row["frost_risk"] = r["frost_risk"] or frost(row["tmin_extreme_c"])
        if row["temp_correction_c"] is not None:
            temp_corr[pid] = row["temp_correction_c"]
        typical.append(row)
    typical.sort(key=lambda r: (r["point_id"], r["month"]))
    month_cols = ["point_id", "lat", "lon", "month"] + NUMERIC_VARS + ["frost_risk"]
    write_csv(OUT / "typical_month.csv", month_cols, typical)

    # ---- annual normal ----
    normal = []
    for r in read_csv(SRC / "app_data_annual_normal.csv"):
        pid = int(r["point_id"])
        lat, lon = coords[pid]
        row = {"point_id": pid, "lat": lat, "lon": lon}
        for var in NUMERIC_VARS:
            row[var] = num(r.get(var, ""))
        row["temp_correction_c"] = temp_corr.get(pid)
        row["frost_risk"] = frost(row["tmin_extreme_c"])
        normal.append(row)
    normal.sort(key=lambda r: r["point_id"])
    write_csv(OUT / "annual_normal.csv", OUT_COLS, normal)

    # ---- AOI ----
    shutil.copyfile(AOI_SRC, OUT / "aoi.geojson")

    # ---- manifest ----
    lats = [c[0] for c in coords.values()]
    lons = [c[1] for c in coords.values()]
    half = RESOLUTION_DEG / 2
    manifest = {
        "version": "v2",
        "region": "Cartago, Costa Rica",
        "crs": "EPSG:4326",
        "source_period": "2020-2025",
        "resolution_deg": RESOLUTION_DEG,
        "grid": {"rows": len(set(lats)), "cols": len(set(lons)), "points": len(coords)},
        # bbox of the cells (point centers +/- half a cell): [west, south, east, north]
        "bbox": [round(min(lons) - half, 4), round(min(lats) - half, 4),
                 round(max(lons) + half, 4), round(max(lats) + half, 4)],
        "files": {
            "typical_month": "typical_month.csv",
            "annual_normal": "annual_normal.csv",
            "aoi": "aoi.geojson",
        },
        "variables": NUMERIC_VARS + ["frost_risk"],
        "ranges": {"month": ranges(typical), "normal": ranges(normal)},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"typical_month.csv: {len(typical)} rows (expected 2304)")
    print(f"annual_normal.csv: {len(normal)} rows (expected 192)")
    print(f"bbox: {manifest['bbox']}  grid: {manifest['grid']}")
    print(f"written to {OUT}")


if __name__ == "__main__":
    main()
