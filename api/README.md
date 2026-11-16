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
| POST | `/api/properties` | `{ name, notes?, geometry }` → 201 + property (+ `detailJob`) |
| GET | `/api/properties/{id}` | property |
| PATCH | `/api/properties/{id}` | any of `{ name, notes, geometry }` (+ `detailJob` when geometry is sent) |
| DELETE | `/api/properties/{id}` | 204 (its plan and 10 m detail files are deleted too) |
| GET | `/api/properties/{id}/plan` | annual crop plan; `{ status: 'draft', cycles: [] }` if none yet |
| PUT | `/api/properties/{id}/plan` | `{ status: 'draft' \| 'saved', cycles }` → stored plan |
| GET | `/api/plans` | every stored plan (the lands page counts planned crops) |
| GET | `/api/health` | `{ ok: true }` |
| | `/api/properties/{id}/detail/*`, `/api/detail/*` | Sentinel-2 10 m detail, see [below](#sentinel-2-detail-layer-10-m) |

`geometry` is a GeoJSON **Polygon** in EPSG:4326 (lon, lat). The API closes open rings and rejects invalid shapes with **422** `{"detail": {"reason": "self-intersection" | "invalid"}}`. `areaM2` is geodesic on the WGS84 ellipsoid (`pyproj.Geod`). The web app displays `turf.area` (spherical), which differs by ~0.4 % at Cartago's latitude. JSON fields are camelCase.

## Schema (`app/db.py`)

- `properties`: id, name, notes, geometry (GeoJSON text), area_m2, bbox (min/max lon/lat), created_at, updated_at
- `plans` (v2): one row per property: status, cycles (JSON list of `{ id, cropId, cropName, shortName, source: 'thermal' | 'rainfall', startMonth, endMonth, durationMonths, notes }`; `endMonth < startMonth` wraps past December), saved_at, updated_at. Deleted with the property.
- `detail_jobs`, `detail_scenes`, `detail_assets`, `detail_stats` (v3) and `properties.geom_hash / utm_epsg / detail_touched_at`: the Sentinel-2 detail layer, see below.
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
3. ~~Later: Sentinel-2 (10 m) for NDVI and NDMI.~~ Done: see the next section.

**QGIS** is useful for checking these layers by eye: load `cuadricula.csv` as points, the AOI, the GeoTIFFs and an exported `properties.geojson`. Keep the processing itself in Python (rasterio/GDAL, the same engine QGIS uses) so it can be rerun.

## Sentinel-2 detail layer (10 m)

Saving a property fetches **Sentinel-2 L2A for that polygon only** (+50 m buffer, last 12 months), computes NDVI, NDMI and NDRE at 10 m, and stores clipped COGs plus per-date zonal stats. Nothing is downloaded for the whole region.

```
pipeline/src/detail/        processing, no FastAPI (CLI: python -m detail.run --geojson f.geojson --out dir)
  config.py                 limits, mask settings, index classes (overridable with AF_DETAIL_* env vars)
  sources.py                Earth Search (primary) and Planetary Computer (fallback) behind one Source interface
  process.py / outputs.py   cloud mask, indices, clip, zonal stats / COG writer
api/app/detail_api/         jobs (in-process worker), SQLite storage, routes, TiTiler tiles
pipeline/data/property_detail/{property_id}/{YYYY-MM-DD}/{ndvi|ndmi|ndre}.tif   (+ logs/job_{id}.log; gitignored)
```

### How a job works

1. `POST /api/properties`, or `PATCH` with a `geometry`, queues a job. The response carries `detailJob: { id, status }`. One worker thread runs jobs one at a time; job state is in `detail_jobs`.
2. **Idempotent and incremental.** Jobs are keyed by `property_id` + `geom_hash` (coordinates rounded to 7 decimals).
   - New shape: the old files and rows are deleted, then the last 12 months are fetched.
   - Same shape saved again, or `POST …/detail/refresh`: only days after the last processed one, plus any day that failed to load. Already-processed days are never refetched.
3. **Limits.** Properties over 2,000 ha are still saved, but their job fails with `errorReason: "area-too-large"`.
4. **Search.** The primary catalogue is Earth Search `sentinel-2-c1-l2a` (keyless), with `eo:cloud_cover < 80` as a loose prefilter. If its search fails after retries with backoff, the job uses Planetary Computer `sentinel-2-l2a` (signed URLs). `source` is recorded on every row.
5. **Load.** `odc-stac` reads only the window, in the UTM zone of the centroid (EPSG:32617 for most of Cartago). The 20 m bands are resampled to 10 m bilinearly, and SCL with nearest neighbour. Overlapping MGRS tiles of the same day are fused, preferring a tile already in the output zone.
6. **Reflectance.** `(DN − 1000) × 0.0001` for processing baseline ≥ 04.00, unless the item says `earthsearch:boa_offset_applied: true`. Checked on real pixels: the legacy Earth Search collection already has the offset applied, but its `raster:bands` still say `offset −0.1`, so trusting `raster:bands` would subtract it twice. See `sources.py`.
7. **Cloud mask.** SCL ∈ {4, 5, 6, 7} and all bands present, with the invalid mask dilated by 2 px. Days with < 60 % clear pixels in the polygon are stored as `cloudy`: no files, but listed for the date picker.
8. **Outputs.** Per valid day and index: a float32 COG (DEFLATE, nodata −9999, internal overviews, ~6 KB for 10 ha), clipped to the polygon; and a `detail_stats` row with mean, median, p10, p90, std, valid %, pixel count and class distribution.
9. **Monthly composites.** After each job that adds clear days, `composites/{YYYY-MM}/` is rebuilt from the stored day COGs, with no downloads. It holds the per-pixel median NDVI, NDMI and NDRE of the month, plus `days_since_clear`: days from each pixel's last clear observation to the month's end. `composites/latest/days_since_clear.tif` counts to today.
10. **Delete and purge.** Deleting the property removes its folder and rows. A geometry change cancels a running job at its next day. Set `AF_DETAIL_TTL_DAYS=N` to drop the detail data of properties not saved or viewed for N days. The check runs at startup and hourly when the worker is idle; the property stays, and opening it fetches again.

The NDVI classes are the same as `web/src/app/core/config/indices.ts`. **NDMI and NDRE classes are provisional** (team / BA to validate). They live in `pipeline/src/detail/config.py` and are served by `GET /api/detail/indices`.

### Endpoints

| Method | Path | Result |
|---|---|---|
| GET | `/api/properties/{id}/detail/status` | latest job (`status`, `progress` 0–1, `scenesFound/Done/Valid`, `errorReason`, `error`), `scenesValid`, `scenesCloudy`, `lastClearDate`, `daysSinceClear`, `attribution` |
| POST | `/api/properties/{id}/detail/refresh` | 202 + job (incremental; returns the pending job if one exists) |
| GET | `/api/properties/{id}/detail/scenes` | `[{ date, status: valid\|cloudy\|error, validPct, cloudCoverScene, source, stacItemId, assets: { ndvi: id, … } }]` |
| GET | `/api/properties/{id}/detail/stats?index=ndvi&from=&to=` | `[{ date, mean, median, p10, p90, std, validPct, nPixels, classDist: { label: % } }]` |
| GET | `/api/properties/{id}/detail/composites` | `[{ period: 'YYYY-MM' \| 'latest', nDays, assets: { ndvi, ndmi, ndre, days_since_clear: id } }]` |
| GET | `/api/properties/{id}/detail/point?lon=&lat=&date=` | every layer's value + class at one pixel of a day, month or `latest` (map click) |
| GET | `/api/properties/{id}/detail/tiles/{layer}/{date\|YYYY-MM\|latest}/{z}/{x}/{y}.png` | XYZ tile, class colors (`?style=continuous&rescale=-0.2,1&colormap_name=rdylgn` for a stretch); transparent outside the polygon |
| GET | `/api/detail/indices` | index definitions, display range and classes (legend) |
| GET | `/api/detail/cog/…?assetId=` | TiTiler (`info`, `statistics`, `tiles`, `tilejson.json`, `preview`) for one stored asset. It takes an asset id, never a path or URL |

`job.errorReason` is one of `area-too-large`, `search-failed`, `interrupted` (server restarted mid-job), `internal`. The job's log is in `property_detail/{id}/logs/job_{jobId}.log`.

### Tests

```bash
cd api
.venv/Scripts/python -m pytest                                        # offline: fake catalogue, synthetic scenes
.venv/Scripts/python -m pytest tests/test_detail_e2e.py --network -s   # real catalogues, ~5 min
```

The end-to-end test saves a ~10 ha plot near Pacayas and checks COGs (valid COG, EPSG:32617, bounds, values in [−1, 1]), stats rows and a tile. It writes `pipeline/data/property_detail/_e2e/report.json`, with valid days per month and a comparison with MODIS NDVI at the nearest grid point. The files stay there for a look in QGIS.

### Front end (`web/`)

- **State:** `core/services/detail.service.ts` follows the active land. It reloads when the land is opened or saved, polls `/detail/status` every 3 s while a job runs, and asks for a first fetch automatically for lands saved before this feature existed. It holds the selected layer, view (single date / monthly) and date.
- **Map:** `features/map/map.component.ts` draws the selected layer as a tile layer in its own pane, above the 5 km cells and below the land outline. Pixels are drawn square (nearest resampling, `image-rendering: pixelated`). The coarse clip colors inside the land are hidden while it shows, and the cells stay as context outside. **Clicking inside the land** opens a popup with every layer's value and class at that 10 m pixel.
- **Panel:** `features/detail/detail-panel.component.ts`, under the map on a land page, holds:
  - the fetch progress and errors, with a refresh button and a "Show on map" switch;
  - the NDVI / NDMI / NDRE / Days-since-clear toggle and the single-date / monthly view;
  - a date strip, newest first, with cloudy days greyed out;
  - the legend, with each class's share of the land on the selected date;
  - the land's mean over time with its p10–p90 spread (click a point to show that date);
  - "last clear image: N days ago" and the Copernicus attribution.
