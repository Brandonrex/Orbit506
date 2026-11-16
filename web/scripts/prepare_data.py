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
  crops/*             ECOCROP crops, per-point suitability and yearly history (see prepare_crops)
"""
from __future__ import annotations

import csv
import json
import math
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "pipeline" / "data" / "processed"
AOI_SRC = ROOT / "pipeline" / "data" / "appeears" / "cartago_area.geojson"
CROP_SRC = ROOT / "pipeline" / "data" / "crop data"
VARS_SRC = ROOT / "pipeline" / "data" / "Single variables data"
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
    with path.open(newline="", encoding="utf-8-sig") as f:
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


STATUS_CODE = {"unfavorable": 0, "caution": 1, "favorable": 2}
CROP_FILES = {"crops": "crops/crops.json", "suitability": "crops/suitability.json", "series": "crops/series.csv"}
SERIES_VARS = ["ndvi", "rain_mm", "tmin_c", "tmax_c", "tmin_extreme_c", "eto_mm", "balance_mm", "soil_wetness"]


def status(value: str | None) -> int:
    """favorable=2, caution=1, unfavorable=0, missing/unknown=-1."""
    return STATUS_CODE.get((value or "").strip(), -1)


def short_name(name: str) -> str:
    return name[:2].upper()


def prepare_crops() -> dict:
    """ECOCROP requirements + offline suitability results -> compact files for the web app.

    crops/crops.json        the 4 crops and their ECOCROP thresholds
    crops/suitability.json  {crop_id: {point_id: {t, tw, r, rw, a}}}
        t   12 x [mean temperature C, status]           (thermal-windows.json monthly_evaluation)
        tw  thermal windows [start, end, cycle_months, [[cycle_start, cycle_end], ...]]
        r   12 x [accumulated rain mm, status] per planting-start month (rainfall-windows.json)
        rw  rainfall windows: lists of consecutive favorable planting-start months
        a   [annual rain mm, status]                    (annual-rainfall.csv)
        status: 2 favorable, 1 caution, 0 unfavorable, -1 unknown
    crops/series.csv        point x year x month history (rain, tmin, tmax, ...) for the year chart
    """
    out = OUT / "crops"
    out.mkdir(parents=True, exist_ok=True)

    crops = []
    rain_months: dict[int, int] = {}
    for r in read_csv(CROP_SRC / "ecocrop-requirements.csv"):
        cid = int(r["crop_id"])
        gmin, gmax = float(r["growing_days_min"]), float(r["growing_days_max"])
        rain_months[cid] = math.ceil((gmin + gmax) / 2 / 30)
        crops.append({
            "id": cid,
            "name": r["crop"].strip(),
            "shortName": short_name(r["crop"].strip()),
            "scientificName": r["scientific_name"].strip(),
            "temp": {"optMin": num(r["optimal_temp_min_c"]), "optMax": num(r["optimal_temp_max_c"]),
                     "tolMin": num(r["tolerated_temp_min_c"]), "tolMax": num(r["tolerated_temp_max_c"])},
            "rain": {"optMin": num(r["optimal_rain_min_mm_year"]), "optMax": num(r["optimal_rain_max_mm_year"]),
                     "tolMin": num(r["tolerated_rain_min_mm_year"]), "tolMax": num(r["tolerated_rain_max_mm_year"])},
            "growingDays": [gmin, gmax],
            "cycleMonths": math.ceil(gmin / 30),
            "rainDurationMonths": rain_months[cid],
            "drainage": r["drainage"].strip().strip("[]'") or None,
        })
    crops.sort(key=lambda c: ["Papa", "Zanahoria", "Cebolla", "Camote"].index(c["name"])
               if c["name"] in ("Papa", "Zanahoria", "Cebolla", "Camote") else 99)
    (out / "crops.json").write_text(json.dumps(crops, ensure_ascii=False, indent=1), encoding="utf-8")

    suit: dict[str, dict[str, dict]] = {}

    def slot(cid: int, pid: int) -> dict:
        return suit.setdefault(str(cid), {}).setdefault(str(pid), {})

    for e in json.loads((VARS_SRC / "thermal-windows.json").read_text(encoding="utf-8")):
        s = slot(e["crop_id"], e["point_id"])
        months = sorted(e["monthly_evaluation"], key=lambda m: m["month"])
        s["t"] = [[m["temperature_c"], status(m["status"])] for m in months]
        s["tw"] = [[w["start_month"], w["end_month"], w["cycle_months"],
                    [[c["start_month"], c["end_month"]] for c in w["cycles"]]] for w in e["windows"]]

    for e in json.loads((VARS_SRC / "rainfall-windows.json").read_text(encoding="utf-8")):
        s = slot(e["crop_id"], e["point_id"])
        cands = sorted(e["candidates"], key=lambda c: c["start_month"])
        s["r"] = [[c["rain_total_mm"], status(c["status"])] for c in cands]
        s["rw"] = [w["planting_months"] for w in e["windows"]]

    for r in read_csv(VARS_SRC / "annual-rainfall.csv"):
        slot(int(r["crop_id"]), int(r["point_id"]))["a"] = [num(r["annual_rain_mm"]), status(r["status"])]

    (out / "suitability.json").write_text(json.dumps(suit, separators=(",", ":")), encoding="utf-8")

    series = []
    for r in read_csv(SRC / "app_data_series.csv"):
        row = {"point_id": int(r["point_id"]), "year": int(r["year"]), "month": int(r["month"])}
        for var in SERIES_VARS:
            row[var] = num(r.get(var, ""))
        series.append(row)
    series.sort(key=lambda r: (r["point_id"], r["year"], r["month"]))
    write_csv(out / "series.csv", ["point_id", "year", "month"] + SERIES_VARS, series)
    years = sorted({r["year"] for r in series})

    pairs = sum(len(v) for v in suit.values())
    print(f"crops.json: {len(crops)} crops; suitability.json: {pairs} point-crop pairs (expected 768)")
    print(f"series.csv: {len(series)} rows, years {years[0]}-{years[-1]}")
    return {"years": years}


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

    crops_info = prepare_crops()
    manifest["files"].update(CROP_FILES)
    manifest["years"] = crops_info["years"]
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"typical_month.csv: {len(typical)} rows (expected 2304)")
    print(f"annual_normal.csv: {len(normal)} rows (expected 192)")
    print(f"bbox: {manifest['bbox']}  grid: {manifest['grid']}")
    print(f"written to {OUT}")


if __name__ == "__main__":
    main()
