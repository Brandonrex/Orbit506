# Adaptive Farming: map + dashboard MVP

This is a browser-only demo. A farmer draws their property on a satellite map and sees vegetation (NDVI) and climate variables for it, both on the map and in a synced dashboard. The data covers **Cartago, Costa Rica** (2020–2025) and comes from `../pipeline/` (see [DATA_NOTES.md](DATA_NOTES.md)).

**Stack:** Angular 22 (standalone, signals, zoneless, strict TS), Zard UI + Tailwind 4, Leaflet 1.9 + Leaflet-Geoman, Turf.js, PapaParse, and ECharts through Zard's Chart component. Saved properties live in a small **FastAPI + SQLite** backend in [`../api/`](../api/). The map and dashboard still work without it, but nothing gets saved.

## Run it

Two processes: the API (saves properties) and the Angular dev server (proxies `/api` to it, see `proxy.conf.json`).

```bash
# 1. API: http://127.0.0.1:8000 (database: api/data/app.db, created on first start)
cd api
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt     # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest                              # API tests

# 2. Web: http://localhost:4200
cd web
npm install
npm start            # = ng serve
npm run build        # production build to dist/web
```

The prepared data is already committed in `public/data/`, so Python is only needed for the API and to refresh the data. Set `AF_DB_PATH` to use another database file.

## Using the app

1. Pick a **variable** (NDVI, rainfall, temperatures, coldest night, frost risk, ETo, water balance, soil wetness or elevation), a **period** (*Typical month* with a month picker, or *Annual normal*), and the **map colors** (*Classes* or *Continuous* ramp).
2. Click **New property** in the left panel (or use the **polygon tool**, top-left) and draw a polygon. Each drawing becomes a new saved property. Only the **selected** property can be edited: use **edit** to move vertices, **drag** to move it, and **delete** to remove it. Click another outline on the map, or a row in the list, to select it. Choose **Entire region** to clear the selection. Rename, export or delete a property from its row.
3. The dashboard switches from *Entire region* to the selected property's name, and the map colors only the part of each cell inside it (switch on **Show full cells** in the legend to see the whole squares). It shows the area in hectares and manzanas (1 mz = 6,987 m²), the KPIs, the class distribution, a 12-month profile (click a month to select it), the region histogram with your property marked, and the cells under the property.
4. Hovering a class in the legend or in the class bar highlights those cells on the map.
5. **Import** creates one property per polygon in a GeoJSON file (its `name` property is used if present). **Export all** downloads every property. Everything is saved in SQLite, and the selected property is kept in the URL (`?p=<id>`). A polygon saved by the older single-property version (`localStorage`) is moved into the API once, as *My property*.

### How property values are computed

The data is a **~5 km grid** (192 points, from `pipeline/data/processed/cuadricula.csv`). Its real detail is coarser for some variables: climate comes from the nearest point of a 10 km grid (NASA POWER itself is ~50 km), and NDVI and elevation are each sampled at the cell's center pixel. So values do not change *within* a cell yet; see `api/README.md` for the plan to add raster data. Each point is drawn as its square cell, and a farm usually falls inside 1–2 cells. Property values are **area-weighted**: each cell counts by the share of the property area inside it (`turf.intersect` + `turf.area`). "Coldest night" and "Frost risk" use the **minimum** over the cells instead. With no property drawn, every cell in the region counts equally. In dev mode, the console logs the overlapping cells and their weights for manual checking.

## Data

```
pipeline/data/processed/*.csv  ──(web/scripts/prepare_data.py)──►  web/public/data/
        (read-only)                                                typical_month.csv
                                                                   annual_normal.csv
                                                                   aoi.geojson
                                                                   manifest.json
```

To refresh the data after the pipeline changes, run this from the repo root:

```bash
python web/scripts/prepare_data.py
```

It uses only the standard library (no pandas). It never writes into `pipeline/`.

**To replace the data**, put files with the same columns in `public/data/` and update `manifest.json`: `bbox` `[w, s, e, n]`, `resolution_deg` (cell size), `files` and `ranges` (min/max per variable per period, used by the continuous ramp). The app only reads `public/data/`. `DataService` is the only place that knows about files, so it can later be swapped for an API.

## Tuning thresholds and colors

All class thresholds, labels and colors live in **`src/app/core/config/indices.ts`**. They are data, not logic, and **provisional**, so the UI says so. Each variable can have different classes per period (e.g. rain in mm/month vs mm/year). The KPI thresholds (`NDVI < 0.4` stressed, `balance < 0` water deficit) and map opacities are in the same file.

## Architecture

```
src/app/
  core/
    models/              types: CellValues, VarKey, Period, Manifest, Overlap…
    config/indices.ts    variables, classes, colors, KPI thresholds   ← tune here
    config/basemaps.ts   Esri World Imagery (default), OSM, labels overlay
    i18n/strings.ts      all UI copy (English; add es-CR with the same shape)
    utils/color.ts       classify, continuous ramp, CSS-token reader
    services/
      data.service.ts      loads manifest + CSVs, builds cell polygons
      property.service.ts  saved properties + active one (signals), validation (turf.kinks), import/export
      property-api.service.ts  HTTP calls to the API (api/app/main.py)
      analysis.service.ts  computed: overlaps & weights, KPIs, class shares, histogram, monthly profile
      ui-state.service.ts  active variable, period, month, render mode, hovered class
  features/
    layout/    shell (header + resizable properties | map | dashboard), header controls
    properties/ property-list (saved properties: select, new, rename, import/export, delete)
    map/       map.component (Leaflet, canvas renderer, Geoman; all properties, clipped cells), legend.component
    dashboard/ dashboard container + dumb kpi-card, class-distribution, histogram, profile-chart
  shared/      Zard UI components (generated by zard-cli; restyle via tokens)
```

State flows one way. Services hold signals, components read `computed()` values, and the map and dashboard never talk to each other directly. Both react to `UiStateService` and `AnalysisService`, which is what keeps them in sync.

**Design handoff (Figma):**
- Theme colors are the Zard/Tailwind CSS variables in `src/styles.css`, including the `--map-*` tokens for map strokes.
- Index palettes live only in `indices.ts`.
- Presentational components (`kpi-card`, `legend`, `class-distribution`, `histogram`, `profile-chart`) take inputs and emit outputs only.

### Leaflet + Geoman note

Geoman's bundle patches a global `L`. `features/map/leaflet-global.ts` exposes the bundled Leaflet as `globalThis.L` before Geoman loads, so both share the same classes. Always import Leaflet in the app through `features/map/leaflet.ts`.

## Deviations from the original brief (forced by the data)

| Brief | MVP | Why |
|---|---|---|
| NDVI / NDMI toggle | Variable selector (NDVI + climate) | The pipeline has no NDMI. |
| Water-stressed % = NDMI < 0 | Water-deficit % = rain − ETo < 0 | Closest available water-stress proxy. |
| Points inside the polygon | Area-weighted 5 km cells | A farm rarely contains a grid point. |
| Hexbin render mode | Dropped | Aggregating 192 cells adds nothing. |
| Date slider over many dates | Typical month (12) + annual normal | The team chose these two views. The monthly series (72) and yearly tables exist in `pipeline/` and can be added later. |
| PapaParse `worker: true` | Main-thread parsing | The files are < 300 KB. Switch on if the data grows. |
| Guatemala / UTM | Costa Rica, WGS84 | Matches the data. No reprojection needed. |

## Known limitations

- The data is coarse (~5 km). Values describe the area around a farm, not the farm itself.
- A "typical" month or year comes from only 6 years (2020–2025).
- Thresholds are provisional and need validation by the BA (see `../pipeline/DATA.md` §5 for ECOCROP comparisons).
- ECharts logs a harmless "chart instance already initialized" warning from inside Zard's chart wrapper.
