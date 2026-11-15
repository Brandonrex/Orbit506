# Data notes: `pipeline/` inspection (Step 0)

These are findings from inspecting `pipeline/` before building the app. The folder is read only and the app never modifies it. `web/scripts/prepare_data.py` copies what the app needs into `web/public/data/`.

## Summary

| Question | Finding |
|---|---|
| Region | **Cartago, Costa Rica.** The brief assumed Guatemala, but the manzana is the same size (6,987 m²). |
| CRS | **WGS84 (EPSG:4326)** lat/lon in decimal degrees. All values are within ±90/±180, so no reprojection is needed. |
| Coordinate columns | `cuadricula.csv`: `Latitude`, `Longitude` (exact, 4 decimals). `app_data*.csv`: `lat`, `lon`, **rounded to 2 decimals** (e.g. −84.055 becomes −84.06), so join by `point_id` and use the grid file for geometry. |
| GeoJSON order | `cartago_area.geojson` uses `[lon, lat]`, as expected. |
| Spatial structure | A **regular grid**: 12 rows × 16 cols = **192 points**, step **0.045°** (≈ 5.0 km N–S, 4.9 km E–W). Built by `src/cuadricula.py`. |
| Grid bbox (point centers) | lat 9.55 – 10.045, lon −84.10 – −83.425. The cell bbox (± half a step) is `[-84.1225, 9.5275, -83.4025, 10.0675]`. |
| GeoJSON vs CSVs | `cartago_area.geojson` is a single **rectangular AOI** (−84.12…−83.38, 9.53…10.07) that encloses the grid. It has no ID join with the CSVs. |
| Time | Monthly data from **2020-01 to 2025-12** (72 months). The app tables also aggregate it to a *typical month* (12) and an *annual normal* (1). |
| Size | Tiny: 13,824 rows in the largest table and 2.2 MB in total. No downsampling, spatial index or web worker is needed. |

## ⚠ Contradictions with the brief, and how the MVP handles them

1. **No NDMI.** The only satellite index is **NDVI** (MODIS MOD13Q1, 250 m, cloud-filtered and averaged by month; ~86% of months have a value). The other variables are climate (NASA POWER, lapse-rate corrected) and elevation (NASADEM). → The NDVI/NDMI toggle became a **variable selector**: NDVI plus all the climate variables in `DATA.md`. "Water-stressed area % (NDMI < 0)" became **"Water-deficit area %" (`balance_mm < 0`)**.
2. **Resolution is ~5 km, not 10–30 m.** A farm of a few hectares almost never contains a grid point. → Each point is drawn as its 0.045° **square cell**, and property stats are **area-weighted** by how much of the polygon overlaps each cell.
3. **192 cells is too few for hexbin.** Aggregating them adds nothing, so the render modes are **Classes | Continuous** only.

## Value columns (from `app_data*.csv`)

| Column | Typical month: min…max | Annual normal: min…max | Notes |
|---|---|---|---|
| `ndvi` | 0.12 … 0.98 | 0.14 … 0.89 | 13 typical-month values are empty (clouds). The raw series min is −0.06. |
| `rain_mm` | 20 … 483 (mm/month) | 2,979 … 3,562 (mm/year) | Sum. Never compare the yearly total with ECOCROP directly (see `DATA.md` §5). |
| `tmax_c` / `tmin_c` | 9.7 … 31.1 / 4.0 … 24.2 | 10.8 … 29.8 / 4.9 … 23.3 | Corrected for elevation (−6.5 °C/km). |
| `tmean_c` | 7.2 … 27.5 (derived) | 7.9 … 26.5 | Not in `app_data.csv`. `prepare_data.py` derives it as (tmax + tmin) / 2, the FAO method. |
| `tmin_extreme_c` | 0.46 … 21.98 | 0.46 … 20.21 | Coldest night. Aggregated with **min**. |
| `eto_mm` | 51 … 137 | 757 … 1,365 | Hargreaves. |
| `balance_mm` | −87 … 426 | 1,690 … 2,788 | rain − ETo. Always positive in the annual normal. |
| `soil_wetness` | 0.49 … 0.99 | 0.76 … 0.88 | GWETROOT, ~50 km. |
| `elevation_m` | 241 … 3,223 | same | NASADEM. |
| `frost_risk` | low / medium / high | — | ≤ 2 °C = high, ≤ 5 °C = medium (provisional). The annual-normal value is derived by `prepare_data.py`. |
| `soil_moisture`, `slope_deg`, `planting_signal` | empty | — | Pending in the pipeline and hidden in the app. |

## Python scripts (`pipeline/src/`)

| Script | What it does / produces |
|---|---|
| `cuadricula.py` | Builds the 0.045° grid over Cartago and writes `processed/cuadricula.csv`, `appeears/puntos_5km.csv` (192 points) and `appeears/puntos_10km.csv` (48 points, every other row and col). |
| `power.py` | Helper that fetches daily NASA POWER data for one lat/lon. |
| `power_cuadricula.py` | Fetches POWER for the 48 points at 10 km, writes `raw/power_10km_diario.csv` (gitignored) and aggregates it to `processed/power_10km_mensual.csv`, monthly from 2020-01 to 2025-12. |
| `inspeccionar_appeears.py` | Quick look at AppEEARS result CSVs. |
| `procesar_appeears.py` | NASADEM gives `processed/elevation.csv`. MODIS NDVI gives `processed/ndvi_monthly.csv` (drops −3000, cloudy and low-quality values, then averages by month). |
| `app_data.py` | Joins climate (nearest 10 km point), elevation and NDVI onto the 5 km grid, applies the lapse-rate correction, computes ETo, balance and frost risk, and writes the 4 `app_data*.csv` tables. |
| `validar_anual.py` | Recomputes yearly tables from monthly data and sanity-checks them. |

## What the app uses

`web/scripts/prepare_data.py` reads `app_data.csv`, `app_data_annual_normal.csv`, `cuadricula.csv` and `cartago_area.geojson`, and writes:

- `public/data/typical_month.csv`: 2,304 rows, exact grid coordinates, with `tmean_c` added and empty columns dropped
- `public/data/annual_normal.csv`: 192 rows, with `frost_risk` and `temp_correction_c` added
- `public/data/aoi.geojson`
- `public/data/manifest.json`: bbox, resolution, grid shape, variables, and min/max per variable per period

---

## File inventory (generated)

The GeoJSON (`appeears/cartago_area.geojson`, 1 KB) has 1 feature, a Polygon with `properties.name = "cartago"`.

### `processed/app_data.csv`

214 KB · 2,304 rows · 21 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `point_id` | int | 1 | 192 | 0 |
| `lat` | float | 9.55 | 10.04 | 0 |
| `lon` | float | -84.1 | -83.42 | 0 |
| `month` | int | 1 | 12 | 0 |
| `month_name` | str | Apr | Sep | 0 |
| `rain_mm` | float | 20 | 483.13 | 0 |
| `tmax_c` | float | 9.67 | 31.14 | 0 |
| `tmin_c` | float | 4.03 | 24.17 | 0 |
| `tmin_extreme_c` | float | 0.46 | 21.98 | 0 |
| `eto_mm` | float | 50.77 | 136.98 | 0 |
| `balance_mm` | float | -87.46 | 426.3 | 0 |
| `soil_wetness` | float | 0.49 | 0.99 | 0 |
| `elevation_m` | float | 241 | 3223 | 0 |
| `ndvi` | float | 0.12 | 0.98 | 13 |
| `soil_moisture` | empty |  |  | 2304 |
| `slope_deg` | empty |  |  | 2304 |
| `frost_risk` | str | high, low, medium |  | 0 |
| `planting_signal` | empty |  |  | 2304 |
| `temp_correction_c` | float | -14.33 | 5.36 | 0 |
| `climate_point_id` | int | 1 | 175 | 0 |
| `version` | str | v2 |  | 0 |

Sample rows:

```
point_id,lat,lon,month,month_name,rain_mm,tmax_c,tmin_c,tmin_extreme_c,eto_mm,balance_mm,soil_wetness,elevation_m,ndvi,soil_moisture,slope_deg,frost_risk,planting_signal,temp_correction_c,climate_point_id,version
1,9.55,-84.1,1,Jan,58.86,25.19,20.83,18.58,79.86,-21.0,0.8,798.0,0.83,,,low,,-3.47,1,v2
1,9.55,-84.1,2,Feb,32.04,26.14,21.27,18.56,84.62,-52.58,0.64,798.0,0.88,,,low,,-3.47,1,v2
1,9.55,-84.1,3,Mar,93.53,26.86,21.67,19.23,103.08,-9.55,0.56,798.0,0.86,,,low,,-3.47,1,v2
1,9.55,-84.1,4,Apr,230.86,26.4,22.05,20.29,93.03,137.82,0.61,798.0,0.86,,,low,,-3.47,1,v2
1,9.55,-84.1,5,May,387.66,25.31,22.09,20.33,80.65,307.01,0.78,798.0,0.69,,,low,,-3.47,1,v2
```

### `processed/app_data_annual_normal.csv`

15 KB · 192 rows · 13 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `point_id` | int | 1 | 192 | 0 |
| `lat` | float | 9.55 | 10.04 | 0 |
| `lon` | float | -84.1 | -83.42 | 0 |
| `elevation_m` | float | 241 | 3223 | 0 |
| `rain_mm` | float | 2979.17 | 3562.29 | 0 |
| `tmean_c` | float | 7.86 | 26.52 | 0 |
| `tmax_c` | float | 10.82 | 29.75 | 0 |
| `tmin_c` | float | 4.9 | 23.29 | 0 |
| `tmin_extreme_c` | float | 0.46 | 20.21 | 0 |
| `eto_mm` | float | 757.06 | 1364.87 | 0 |
| `balance_mm` | float | 1690.06 | 2787.68 | 0 |
| `soil_wetness` | float | 0.76 | 0.88 | 0 |
| `ndvi` | float | 0.14 | 0.89 | 0 |

Sample rows:

```
point_id,lat,lon,elevation_m,rain_mm,tmean_c,tmax_c,tmin_c,tmin_extreme_c,eto_mm,balance_mm,soil_wetness,ndvi
1,9.55,-84.1,798.0,3562.29,23.15,24.92,21.38,18.56,929.63,2632.66,0.84,0.82
2,9.55,-84.06,544.0,3562.29,24.8,26.58,23.03,20.21,967.03,2595.27,0.84,0.88
3,9.55,-84.01,739.0,3182.34,24.0,26.96,21.04,16.6,1232.32,1950.02,0.88,0.87
4,9.55,-83.96,1619.0,3182.34,18.28,21.24,15.32,10.88,1063.95,2118.39,0.88,0.82
5,9.55,-83.92,2336.0,3182.34,13.62,16.58,10.66,6.22,926.77,2255.57,0.88,0.86
```

### `processed/app_data_series.csv`

1346 KB · 13,824 rows · 22 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `point_id` | int | 1 | 192 | 0 |
| `lat` | float | 9.55 | 10.04 | 0 |
| `lon` | float | -84.1 | -83.42 | 0 |
| `year` | int | 2020 | 2025 | 0 |
| `month` | int | 1 | 12 | 0 |
| `month_name` | str | Apr | Sep | 0 |
| `rain_mm` | float | 8.83 | 875.35 | 0 |
| `tmax_c` | float | 8.8 | 32.62 | 0 |
| `tmin_c` | float | 3.1 | 25.12 | 0 |
| `tmin_extreme_c` | float | 0.46 | 23.54 | 0 |
| `eto_mm` | float | 45.83 | 151.01 | 0 |
| `balance_mm` | float | -135.23 | 806.16 | 0 |
| `soil_wetness` | float | 0.44 | 1 | 0 |
| `elevation_m` | float | 241 | 3223 | 0 |
| `ndvi` | float | -0.06 | 1 | 1985 |
| `soil_moisture` | empty |  |  | 13824 |
| `slope_deg` | empty |  |  | 13824 |
| `frost_risk` | str | high, low, medium |  | 0 |
| `planting_signal` | empty |  |  | 13824 |
| `temp_correction_c` | float | -14.33 | 5.36 | 0 |
| `climate_point_id` | int | 1 | 175 | 0 |
| `version` | str | v2 |  | 0 |

Sample rows:

```
point_id,lat,lon,year,month,month_name,rain_mm,tmax_c,tmin_c,tmin_extreme_c,eto_mm,balance_mm,soil_wetness,elevation_m,ndvi,soil_moisture,slope_deg,frost_risk,planting_signal,temp_correction_c,climate_point_id,version
1,9.55,-84.1,2020,1,Jan,118.55,25.3,21.29,20.26,77.08,41.47,0.84,798.0,0.91,,,low,,-3.47,1,v2
1,9.55,-84.1,2020,2,Feb,21.28,26.28,21.54,19.6,85.84,-64.56,0.72,798.0,0.86,,,low,,-3.47,1,v2
1,9.55,-84.1,2020,3,Mar,18.08,27.51,21.65,20.3,110.32,-92.24,0.53,798.0,0.86,,,low,,-3.47,1,v2
1,9.55,-84.1,2020,4,Apr,284.63,26.5,21.84,20.98,96.25,188.38,0.59,798.0,0.91,,,low,,-3.47,1,v2
1,9.55,-84.1,2020,5,May,288.34,25.26,22.06,20.65,80.38,207.96,0.75,798.0,,,,low,,-3.47,1,v2
```

### `processed/app_data_yearly.csv`

95 KB · 1,152 rows · 14 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `point_id` | int | 1 | 192 | 0 |
| `year` | int | 2020 | 2025 | 0 |
| `lat` | float | 9.55 | 10.04 | 0 |
| `lon` | float | -84.1 | -83.42 | 0 |
| `elevation_m` | float | 241 | 3223 | 0 |
| `rain_mm` | float | 2075.03 | 4483.54 | 0 |
| `tmean_c` | float | 7.45 | 27.1 | 0 |
| `tmax_c` | float | 10.4 | 30.39 | 0 |
| `tmin_c` | float | 4.5 | 23.8 | 0 |
| `tmin_extreme_c` | float | 0.46 | 21.37 | 0 |
| `eto_mm` | float | 738.1 | 1397.71 | 0 |
| `balance_mm` | float | 777.1 | 3599.47 | 0 |
| `soil_wetness` | float | 0.68 | 0.91 | 0 |
| `ndvi` | float | 0.13 | 0.91 | 0 |

Sample rows:

```
point_id,year,lat,lon,elevation_m,rain_mm,tmean_c,tmax_c,tmin_c,tmin_extreme_c,eto_mm,balance_mm,soil_wetness,ndvi
1,2020,9.55,-84.1,798.0,4066.72,23.0,24.76,21.24,18.96,925.07,3141.65,0.85,0.8
1,2021,9.55,-84.1,798.0,3888.11,22.74,24.46,21.02,18.58,904.88,2983.23,0.88,0.86
1,2022,9.55,-84.1,798.0,3075.08,22.65,24.43,20.86,18.56,915.6,2159.48,0.82,0.76
1,2023,9.55,-84.1,798.0,2695.41,23.76,25.62,21.89,19.31,969.15,1726.26,0.8,0.8
1,2024,9.55,-84.1,798.0,4225.94,23.6,25.36,21.84,19.72,937.95,3287.99,0.83,0.85
```

### `processed/cuadricula.csv`

5 KB · 192 rows · 6 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `ID` | int | 1 | 192 | 0 |
| `Category` | str | p1 | p99 | 0 |
| `fila` | int | 0 | 11 | 0 |
| `col` | int | 0 | 15 | 0 |
| `Latitude` | float | 9.55 | 10.045 | 0 |
| `Longitude` | float | -84.1 | -83.425 | 0 |

Sample rows:

```
ID,Category,fila,col,Latitude,Longitude
1,p1,0,0,9.55,-84.1
2,p2,0,1,9.55,-84.055
3,p3,0,2,9.55,-84.01
4,p4,0,3,9.55,-83.965
5,p5,0,4,9.55,-83.92
```

### `processed/elevation.csv`

2 KB · 192 rows · 2 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `point_id` | int | 1 | 192 | 0 |
| `elevation_m` | float | 241 | 3223 | 0 |

Sample rows:

```
point_id,elevation_m
1,798.0
10,2729.0
100,1561.0
101,1555.0
102,1303.0
```

### `processed/ndvi_monthly.csv`

226 KB · 11,839 rows · 5 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `point_id` | int | 1 | 192 | 0 |
| `year` | int | 2020 | 2025 | 0 |
| `month` | int | 1 | 12 | 0 |
| `ndvi` | float | -0.055 | 0.998 | 0 |
| `ndvi_obs` | int | 1 | 2 | 0 |

Sample rows:

```
point_id,year,month,ndvi,ndvi_obs
1,2020,1,0.909,2
1,2020,2,0.858,2
1,2020,3,0.855,2
1,2020,4,0.911,2
1,2020,11,0.374,1
```

### `processed/power_10km_mensual.csv`

257 KB · 3,456 rows · 12 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `punto_id` | int | 1 | 175 | 0 |
| `lat` | float | 9.55 | 10 | 0 |
| `lon` | float | -84.1 | -83.47 | 0 |
| `elev_power` | float | 263.52 | 1064.94 | 0 |
| `date` | str | 2020-01-01 | 2025-12-01 | 0 |
| `lluvia_mm` | float | 8.83 | 875.35 | 0 |
| `tmax_c` | float | 22.89 | 32.46 | 0 |
| `tmin_c` | float | 15.86 | 26.28 | 0 |
| `tmin_extrema_c` | float | 12.54 | 25.36 | 0 |
| `rad_toa` | float | 30.75 | 37.84 | 0 |
| `rad_suelo` | float | 11.09 | 25.7 | 0 |
| `humedad_raiz` | float | 0.44 | 1 | 0 |

Sample rows:

```
punto_id,lat,lon,elev_power,date,lluvia_mm,tmax_c,tmin_c,tmin_extrema_c,rad_toa,rad_suelo,humedad_raiz
1,9.55,-84.1,263.52,2020-01-01,118.55,28.77,24.76,23.73,32.2,19.34,0.84
1,9.55,-84.1,263.52,2020-02-01,21.28,29.75,25.01,23.07,34.74,23.49,0.72
1,9.55,-84.1,263.52,2020-03-01,18.08,30.98,25.12,23.77,36.97,25.7,0.53
1,9.55,-84.1,263.52,2020-04-01,284.63,29.97,25.31,24.45,37.74,21.35,0.59
1,9.55,-84.1,263.52,2020-05-01,288.34,28.73,25.53,24.12,37.26,16.25,0.75
```

### `appeears/puntos_10km.csv`

1 KB · 48 rows · 4 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `ID` | int | 1 | 175 | 0 |
| `Category` | str | p1 | p99 | 0 |
| `Latitude` | float | 9.55 | 10 | 0 |
| `Longitude` | float | -84.1 | -83.47 | 0 |

Sample rows:

```
ID,Category,Latitude,Longitude
1,p1,9.55,-84.1
3,p3,9.55,-84.01
5,p5,9.55,-83.92
7,p7,9.55,-83.83
9,p9,9.55,-83.74
```

### `appeears/puntos_5km.csv`

4 KB · 192 rows · 4 columns

| column | type | min | max | empty |
|---|---|---|---|---|
| `ID` | int | 1 | 192 | 0 |
| `Category` | str | p1 | p99 | 0 |
| `Latitude` | float | 9.55 | 10.045 | 0 |
| `Longitude` | float | -84.1 | -83.425 | 0 |

Sample rows:

```
ID,Category,Latitude,Longitude
1,p1,9.55,-84.1
2,p2,9.55,-84.055
3,p3,9.55,-84.01
4,p4,9.55,-83.965
5,p5,9.55,-83.92
```

