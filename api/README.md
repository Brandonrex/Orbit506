# Adaptive Farming API

A small FastAPI service that saves the farmer's properties in **SQLite**. The Angular app in `../web/` calls it through the dev-server proxy (`/api` → `http://127.0.0.1:8000`).

```bash
cd api
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt      # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest
```

The database is `api/data/app.db` (gitignored). It is created and migrated on startup. Set `AF_DB_PATH` to use another file.

## Endpoints

| Method | Path | Body / result |
|---|---|---|
| GET | `/api/properties` | list, oldest first |
| POST | `/api/properties` | `{ name, notes?, geometry }` → 201 + property |
| GET | `/api/properties/{id}` | property |
| PATCH | `/api/properties/{id}` | any of `{ name, notes, geometry }` |
| DELETE | `/api/properties/{id}` | 204 |
| GET | `/api/health` | `{ ok: true }` |

`geometry` is a GeoJSON **Polygon** in EPSG:4326 (lon, lat). The API closes open rings and rejects invalid shapes with **422** `{"detail": {"reason": "self-intersection" | "invalid"}}`. `areaM2` is geodesic on the WGS84 ellipsoid (`pyproj.Geod`). The web app displays `turf.area` (spherical), which differs by ~0.4 % at Cartago's latitude. JSON fields are camelCase.

## Schema (`app/db.py`)

- `properties`: id, name, notes, geometry (GeoJSON text), area_m2, bbox (min/max lon/lat), created_at, updated_at
- `property_stats`: per-property results keyed by `data_version`, as JSON. The table is empty for now (see below). Rows are deleted when the property's geometry changes, and when the property is deleted (cascade).

Migrations are an append-only list in `db.py`, tracked with `PRAGMA user_version`.

The analysis itself (KPIs, class shares, profile) is **not** stored. It is computed in the browser from the geometry and the static grid data, so every saved property gets its own analysis as soon as it is selected.

## Next: real detail inside a property (phase 2)

Today every value comes from the ~5 km grid (`pipeline/data/processed/cuadricula.csv`). Climate is from the nearest 10 km point (NASA POWER, ~50 km), and NDVI and elevation are **one pixel at each cell's center**. Detail *inside* a farm needs rasters:

1. `pipeline/src/rasters.py`: AppEEARS **area** requests over `pipeline/data/appeears/cartago_area.geojson`.
   - NASADEM 30 m: elevation, and slope derived from it.
   - MOD13Q1 NDVI 250 m: monthly, with the same cleaning as `procesar_appeears.py`.
   - Save them as Cloud-Optimized GeoTIFFs in `pipeline/data/rasters/`.
2. `app/stats.py`: zonal stats with `rasterio.mask` on create/update, stored in `property_stats`.
   - Mean/min/max elevation and slope, monthly NDVI.
   - Temperature re-corrected with the property's own mean elevation (−6.5 °C/km, as in `app_data.py`).
3. Later: Sentinel-2 (10 m) for NDVI and NDMI.

**QGIS** is useful for checking these layers by eye: load `cuadricula.csv` as points, the AOI, the GeoTIFFs and an exported `properties.geojson`. Keep the processing itself in Python (rasterio/GDAL, the same engine QGIS uses) so it can be rerun.
