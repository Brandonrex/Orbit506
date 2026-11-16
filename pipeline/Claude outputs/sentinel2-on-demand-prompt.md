# Task: On-demand Sentinel-2 detail layer per property (FastAPI + SQLite)

You are joining the **Adaptive Farming** project (Cartago, Costa Rica). The existing pipeline produces a **~5 km regional grid** of climate and NDVI (NASA POWER, MODIS 250 m, NASADEM), and the Angular + Leaflet front end lets a farmer **draw their property polygon**.

Your job: when a property polygon is saved, **fetch Sentinel-2 L2A (10 m) only for that polygon**, compute indices, store compact clipped outputs, and expose them through the existing **FastAPI + SQLite** backend so the map and dashboard can show field-level detail. **Nothing is downloaded for the whole region.**

This brief lists what is needed. **You own the detailed planning**: read the codebase first, then propose a plan and milestones before writing code.

---

## 1. Ground rules
- **Don't modify or move existing data, scripts or outputs** (`pipeline/data/appeears`, `processed`, `crop data`, `Single variables data`, `pipeline/src/*.py`). Only add new code and new folders.
- Put the new detailed data in a **new folder**, e.g. `pipeline/data/property_detail/`, and the new code in e.g. `pipeline/src/detail/`. Add the data folder to `.gitignore`.
- Find the existing FastAPI app and its SQLite DB, and **extend them**. Don't create a parallel server. Add new tables through the project's existing migration/DDL approach, or a small idempotent `CREATE TABLE IF NOT EXISTS` module if there is none.
- If an existing endpoint contract has to change, list the changes and ask first.
- Ask before adding heavy dependencies beyond those in §4.

## 2. Core behaviour (what must happen)
1. **Trigger:** saving or updating a property polygon creates a **fetch job**. Use FastAPI `BackgroundTasks` or a simple in-process worker for now; job state lives in SQLite.
2. **Idempotent and incremental:**
   - Key jobs by `property_id` + a geometry hash. If the same geometry already has data, only fetch **new acquisitions since `last_acquired`**.
   - If the geometry changes, reprocess and drop the stale files.
3. **Scope limits (configurable):**
   - polygon buffered **50 m**
   - max area, e.g. **2,000 ha**; reject above that with a clear error
   - default window **last 12 months** on first fetch
   - optional baseline back to 2019 later (not in the MVP)
4. **Search:** STAC **Element 84 Earth Search** (`https://earth-search.aws.element84.com/v1`, keyless), collection Sentinel-2 L2A, with `eo:cloud_cover < 80` as a loose prefilter only.
   - **Fallback:** Microsoft Planetary Computer STAC (`sentinel-2-l2a`, signed with `planetary-computer`). It has had timeouts in 2026, so add retries with backoff.
5. **Load only the polygon bbox:** `odc-stac`, bands `red, nir, nir08, rededge1, swir16, scl`, at 10 m.
   - Use the CRS = UTM zone from the polygon centroid. Cartago is mostly **EPSG:32617**; its western edge is 32616.
   - Load 20 m bands at their native resolution and resample to 10 m. Use **nearest** resampling for SCL.
6. **Verify reflectance scaling.** Products from processing baseline ≥ 04.00 (2022+) carry a **−1000 BOA offset**. Check whether the chosen collection has already applied it (item properties / collection docs) and apply `(DN − 1000) × 0.0001` where needed. Getting this wrong biases every index.
7. **Cloud mask:**
   - keep SCL ∈ {4 vegetation, 5 bare soil, 6 water, 7 unclassified}
   - dilate the invalid mask by 2–3 px
   - **drop dates with < 60% valid pixels inside the polygon**, but still record them as "cloudy" so the UI can show coverage
8. **Indices:**
   - NDVI = (nir − red)/(nir + red)
   - NDMI = (nir08 − swir16)/(nir08 + swir16)
   - NDRE = (nir08 − rededge1)/(nir08 + rededge1)
   - Clip to the polygon (`rioxarray.clip`), and set nodata outside it.
9. **Outputs per valid date:**
   - one **Cloud-Optimized GeoTIFF** per index: float32 or scaled int16, DEFLATE, internal overviews
   - optional **monthly median composite** COGs, plus a "days since last clear observation" layer
   - layout: `property_detail/{property_id}/{YYYY-MM-DD}/{ndvi|ndmi|ndre}.tif` and `.../composites/{YYYY-MM}/...`
10. **Zonal stats per date and index → SQLite:** mean, median, p10, p90, std, valid_pct, pixel count, and **class distribution (%)** using the thresholds in `indices` config.
    - Reuse the NDVI/NDMI classes the front end already uses. Add NDRE classes as provisional.
11. **Cleanup:** deleting a property deletes its folder and rows. Add an optional TTL purge for properties untouched for N days.

## 3. Data model (SQLite, minimum)
| Table | Columns (indicative) |
|---|---|
| `properties` | id, name, geojson (text, EPSG:4326), geom_hash, area_ha, bbox (minx, miny, maxx, maxy), utm_epsg, created_at, updated_at. Extend the existing table if there is one. |
| `detail_jobs` | id, property_id, status (queued/running/done/failed), started_at, finished_at, date_from, date_to, scenes_found, scenes_valid, error |
| `detail_scenes` | property_id, stac_item_id, acquired_at, cloud_cover_scene, valid_pct_polygon, status (valid/cloudy), source (earth-search/pc) |
| `detail_assets` | property_id, date or period, index, kind (scene/composite), path, min, max, crs, created_at |
| `detail_stats` | property_id, date, index, mean, median, p10, p90, std, valid_pct, n_pixels, class_dist_json |

Plain bbox columns are enough; SpatiaLite isn't needed for now.

## 4. Dependencies
`pystac-client`, `odc-stac`, `xarray`, `rioxarray`, `rasterio`, `numpy`, `shapely`, `pyproj`, `rio-cogeo`, `planetary-computer` (fallback), `scipy` (mask dilation; or use `skimage`).

**Tiles:** mount **`titiler.core`** (`TilerFactory`) into the existing FastAPI app to serve the local COGs as XYZ tiles, with `rescale` and `colormap`.
- Restrict the `url` parameter to files under `property_detail/`, or map an asset id to its path server-side. Never accept arbitrary paths.
- If TiTiler is too heavy, a fallback is to render a colored PNG and return its bounds for `L.imageOverlay`.

## 5. API (minimum)
- `POST /properties` / `PUT /properties/{id}` → saves the polygon and enqueues a detail job (returns `job_id`)
- `GET /properties/{id}/detail/status` → latest job and its progress
- `POST /properties/{id}/detail/refresh` → incremental fetch of new dates
- `GET /properties/{id}/detail/scenes` → list of dates with valid_pct and status (feeds a date picker that greys out cloudy dates)
- `GET /properties/{id}/detail/stats?index=ndvi&from=&to=` → time series for charts
- `GET /properties/{id}/detail/tiles/{index}/{date}/{z}/{x}/{y}.png` (or the TiTiler route) → map layer
- `DELETE /properties/{id}` → removes the data
- CORS for the Angular dev origin

## 6. Front-end integration (hand-off notes; the front end may be another agent's job)
- After the polygon is saved, call POST, poll status, then show a **"Detail (10 m)"** layer group: index toggle (NDVI/NDMI/NDRE), date picker from `/scenes`, and a legend.
- Render the tiles crisp (nearest neighbour, no smoothing). The 5 km regional grid stays as context outside the property.
- The dashboard reads `/stats` for time series and class bars. Show "last clear image: N days ago".
- Attribution: **"Contains modified Copernicus Sentinel data {year}"**.

## 7. Quality and verification
- An end-to-end test on a small real polygon in Cartago, e.g. a ~5–20 ha farm plot near Pacayas or Tierra Blanca. Assert that COGs exist, the CRS and bounds are right, values lie in [−1, 1], and stats rows exist.
- Sanity-check one date against the Copernicus Browser visually, and compare the property's mean NDVI with the existing MODIS value for the nearest grid point (expect the same trend, not identical values).
- Logs per job, timeouts for STAC and COG reads, and a clear failed-job error in the API.
- Expect frequent cloudy dates in Cartago. Report how many valid dates per month the test polygon actually gets.

## 8. Out of scope now (design so these can plug in as new "sources")
- Sentinel-1 RTC (SAR cloud-gap filling)
- SEN2SR 2.5 m super-resolution (visual only)
- Fields of the World boundary suggestions
- drone COG uploads
- Celery/Redis queues and cloud object storage

Keep a `source` column and a source-agnostic processing interface so these slot in later.

**Deliverable:** drawing and saving a property results, within minutes, in browsable 10 m environmental variables layers and time-series stats for that property only. All of it is stored in `pipeline/data/property_detail/` plus the SQLite tables and served by the existing FastAPI app, with a short README section explaining how it works and how to run the test.
