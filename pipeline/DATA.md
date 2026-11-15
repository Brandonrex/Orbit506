# App data 

## Files
- `data/processed/cuadricula.csv`: 192 grid points (every ~5 km). Key: `ID`.
- `data/processed/app_data.csv`: one row per point and per typical month (192 x 12 = 2,304 rows). Key: `point_id` (= `ID` in the grid file). Use it for the planting calendar.
- `data/processed/app_data_series.csv`: one row per point, year and month (2020–2025; 192 x 72 = 13,824 rows). Same columns as app_data.csv plus `year`. Use it for timeline charts.



## Columns
| Column | Unit | Meaning | Status |
|---|---|---|---|
| point_id | – | Point ID (same as `ID` in cuadricula.csv) | ✅ |
| lat, lon | degrees | Coordinates | ✅ |
| year | 2020–2025 | Year (only in app_data_series.csv) | ✅ |
| month, month_name | 1–12 | Month (in app_data.csv: typical month, 2020–2025 average) | ✅ |
| rain_mm | mm/month | Monthly rainfall | ✅ NASA POWER |
| tmax_c, tmin_c | °C | Average maximum and minimum temperature | ⚠️ Not yet corrected for elevation |
| tmin_extreme_c | °C | Coldest night recorded in that month | ⚠️ Not yet corrected for elevation |
| eto_mm | mm/month | Reference evapotranspiration (water lost from soil and plants) | ✅ Calculated (Hargreaves, FAO) |
| balance_mm | mm/month | Rainfall − ETo (+ surplus, − deficit) | ✅ Calculated |
| elevation_m | m | Point elevation | ⏳ Empty (AppEEARS) |
| ndvi | 0–1 | Vegetation greenness | ⏳ Empty (AppEEARS) |
| soil_moisture | m³/m³ | Root-zone soil moisture (SMAP) | ⏳ Empty (AppEEARS) |
| slope_deg | degrees | Terrain slope | ⏳ Empty (AppEEARS) |
| frost_risk | low / medium / high | Frost risk | ⏳ Empty |
| planting_signal | green / yellow / red | Is this a good month to plant? | ⏳ Empty |
| climate_point_id | – | 10 km point the climate comes from (internal use) | ✅ |
| version | – | "preliminary" while data is missing | ✅ |

## Important
- This is a PRELIMINARY VERSION: column names will NOT change; only the empty columns will be filled.
