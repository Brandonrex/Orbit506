# App data – Cartago
.

---

We have the same climate data (2020–2025, 192 points) organized in 4 ways, from the most detailed to the most general. Pick the one that answers your question.

### 1️⃣ `app_data_series.csv` → every month of every year
- **Each row:** one point + one year + one month
- **Example:** "Point 47, March 2023: 18 °C" *(example values)*
- **Rows:** 192 × 72 = 13,824
- **Use it for:** charts that show how the climate changed month by month

### 2️⃣ `app_data.csv` → the typical month
- **Each row:** one point + one month (no year)
- **Example:** "Point 47, in March it is usually 17 °C" (the average of the 6 Marches) *(example values)*
- **Rows:** 192 × 12 = 2,304
- **Use it for:** knowing what each month is normally like, to decide when to plant

### 3️⃣ `app_data_yearly.csv` → each year 🆕
- **Each row:** one point + one year
- **Example:** "Point 47, in 2023 the average temperature was 16.5 °C and it rained 2,800 mm" *(example values)*
- **Rows:** 192 × 6 = 1,152
- **Use it for:** comparing years ("was 2024 warmer than 2021?")

### 4️⃣ `app_data_annual_normal.csv` → the typical year 🆕
- **Each row:** one point (a single number per variable)
- **Example:** "Point 47, the average temperature is usually 16.8 °C and it rains 2,900 mm a year" *(example values)*
- **Rows:** 192 (one per point)
- **Use it for:** comparing the normal climate of each place with what each crop needs

### How they are built from each other



Everything comes from table 1️⃣. The others are summaries, from more detailed to more general.

### Other files

| File | What's inside | Use it for |
|---|---|---|
| `data/processed/cuadricula.csv` | 192 points spread over Cartago, one every ~5 km. Key: `ID` | Drawing points on the map and finding the point closest to a click |
| `data/processed/elevation.csv` | Elevation of each point | Internal (already included in the tables above) |
| `data/processed/ndvi_monthly.csv` | Clean monthly NDVI per point | Internal (already included in the tables above) |

**How to use them:** when the user clicks on the map, find the closest point in `cuadricula.csv`, then filter the table you need by that `point_id` (= `ID` in the grid file).

All files are in `pipeline/data/processed/`.

---

## 2. The datasets (where the data comes from)

### NASA POWER – the weather ✅
- **What it is:** a free NASA service that gives daily weather (rain, temperature, sunlight, soil wetness) for any place on Earth. Think of it as a **virtual weather station**.
- **How NASA makes it:** weather comes from the MERRA-2 model (squares of ~50 km); sunlight comes from satellites (squares of ~110 km). Each value is the **average of its square**. NASA checks its accuracy against ground weather stations.
- **What we take from it:** rainfall, maximum and minimum temperature, solar radiation and root-zone soil wetness (`GWETROOT`).
- **Documentation:** "POWER Data Methodology" (power.larc.nasa.gov/docs/methodology).

### MODIS (NDVI) – how green the land is ✅
- **What it is:** a NASA satellite that photographs the whole planet and measures how green the vegetation is.
- **How NASA makes it:** out of every 16 days of images, it **keeps the best one** (fewest clouds, best angle). Each value covers 250 m.
- **Our cleaning:** we removed the "no data" code (-3000) and values flagged as cloudy, then averaged by month. About 86% of the months have a value.
- **Documentation:** MOD13Q1 User Guide and ATBD (NASA Earthdata).

### NASADEM – the shape of the land ✅ (elevation) · ⏳ (slope)
- **What it is:** a NASA elevation map: how high every spot is above sea level.
- **How NASA made it:** radar from a space shuttle (SRTM mission, year 2000), later improved with satellite laser measurements. Each value covers 30 m.
- **What we take from it:** elevation of each point (241 m to 3,223 m in our grid). Slope is still pending.
- **Documentation:** NASADEM User Guide (LP DAAC).

### SMAP – how wet the soil is ⏳ (optional)
- A NASA satellite that measures soil water, even through clouds (~9 km). If it arrives, we compare it with `soil_wetness`.

### AppEEARS – not a dataset, a tool
- A NASA website where you ask for **only the pieces you need** (these points, these dates, these variables) instead of downloading huge satellite files. We used it to get MODIS and NASADEM.

### ECOCROP – what each crop needs (used by our BA)
- The FAO database of crop requirements (temperature, rainfall, altitude, growing cycle). Fact sheets at ecocrop.apps.fao.org.

---

## 3. The variables, explained simply

### `rain_mm` – Rainfall ✅
- **What it is:** how much it rained. Imagine a straight glass left outside: 1 mm means the water reached 1 millimeter high. 1 mm = 1 liter of water per square meter.
- **Unit:** mm per month (monthly tables) or **mm per year** (yearly tables: the **sum** of the 12 months).
- **Why it matters:** crops need water, but too much rain on steep land washes the soil away.

### `tmax_c` and `tmin_c` – Day and night temperature ✅ (corrected for elevation)
- **What it is:** the average daytime high and nighttime low, **adjusted to the real height of each point**.
- **Unit:** °C.

### `tmean_c` – Average temperature 🆕 (yearly tables)
- **What it is:** the average temperature: **(maximum + minimum) ÷ 2**, then averaged over the 12 months of the year. This is the standard FAO method when only maximum and minimum are available.
- **Unit:** °C. Already corrected for elevation.
- **Why it matters:** it is the value our BA compares with each crop's ideal temperature range (ECOCROP `topmn`–`topmx`).

### `tmin_extreme_c` – The coldest night ✅ (corrected for elevation)
- **What it is:** the coldest night recorded in that month (monthly tables) or year (yearly tables).
- **Unit:** °C.
- **Why it matters:** one very cold night can be enough to damage a crop (frost).

### `temp_correction_c` – How much we adjusted the temperature
- **What it is:** how many °C we added or subtracted to NASA POWER's temperature because of the point's real height (about 6.5 °C colder for every 1,000 m higher).
- **How to read it:** negative = the point is higher (colder) than the NASA square's average; positive = lower (warmer). In our grid it goes from about −14 °C to +5 °C.

### `eto_mm` – Water the land loses (evapotranspiration) ✅
- **What it is:** water that goes back into the air from the soil and the plants. Hot, sunny days = more water lost.
- **Unit:** mm per month, or mm per year (sum) in the yearly tables.
- **How we get it:** Hargreaves formula (FAO), using the corrected temperatures.

### `balance_mm` – Is there enough water? ✅
- **What it is:** rainfall minus water lost (`rain_mm − eto_mm`). Like a bank account: rain is income, ETo is spending.
- **How to read it:** positive (+) = surplus water; negative (−) = plants may lack water.

### `soil_wetness` – How full the soil "sponge" is ✅
- **What it is:** how much water the root zone (top ~1 m of soil) holds. 0 = completely dry, 1 = completely soaked.
- **Source:** NASA POWER (`GWETROOT`). Coarse (~50 km).

### `elevation_m` – How high the place is ✅
- **What it is:** meters above sea level (NASADEM). Higher = colder.

### `ndvi` – How green the land is ✅
- **What it is:** healthy green vegetation, from -1 to 1. Below 0.2 = bare soil, roads or water; 0.2–0.5 = young crops or stressed plants; above 0.5 = healthy crops or forest.
- **Note:** some months are empty because of clouds.

### `frost_risk` – Risk of frost ✅ (provisional thresholds)
- **Values:** high (coldest night ≤ 2 °C) / medium (≤ 5 °C) / low. Thresholds must be validated by our BA.

### Still pending
- `soil_moisture` (SMAP, optional), `slope_deg` (slope), `planting_signal` (planting traffic light).

### Other columns
- `point_id`: the ID of the point (same as `ID` in `cuadricula.csv`).
- `lat`, `lon`: coordinates.
- `year`: the year (series and yearly tables).
- `month`, `month_name`: the month (monthly tables).
- `climate_point_id`: the 10 km point the weather comes from (internal).
- `version`: "v2".

---

## 4. How each value is calculated (our statistics)

| Step | Statistic | Variables |
|---|---|---|
| Daily → monthly | **Sum** | Rainfall, ETo |
| Daily → monthly | **Average** | Max/min temperature, soil wetness, radiation |
| Daily → monthly | **Minimum** | Coldest night |
| 16 days → monthly | **Average** of cloud-free values | NDVI |
| Monthly → yearly | **Sum** | Rainfall, ETo, balance |
| Monthly → yearly | **Average** | Temperatures (`tmean_c`, `tmax_c`, `tmin_c`), soil wetness, NDVI |
| Monthly → yearly | **Minimum** | Coldest night |
| 6 years → typical month / typical year | **Average** (coldest night: minimum) | All |
| Elevation correction | −6.5 °C per 1,000 m | Temperatures |

**Rain is added up; temperature is averaged** (adding temperatures makes no sense).

---

## 5. Guide for our BA: comparing with ECOCROP

Use **`app_data_annual_normal.csv`** (one row per point):

| ECOCROP field | Our column | Question |
|---|---|---|
| `topmn`, `topmx` (ideal temperature) | `tmean_c` | Is the average temperature in the ideal range? |
| `tmin`, `tmax` (temperature limits) | `tmean_c` | Is it within the limits where the crop can grow? |
| `altmx` (maximum altitude) | `elevation_m` | Is the point too high for the crop? |
| `ktmp` (killing temperature) | `tmin_extreme_c` | Does the coldest night drop below it? |
| `dra` (soil **drainage**, not humidity) | `soil_wetness` | Qualitative risk only: crop needs good drainage + soil often soaked |

⚠️ **Rainfall:** `rain_mm` in the yearly tables is the **total of the year** (about 2,900 mm in Cartago). Do **not** compare it directly with ECOCROP rainfall, or potatoes would look "unsuitable" all over Cartago. Rainfall is compared over the **crop's growing cycle** (about 4 months for potatoes), using `app_data.csv`.

---

## 6. Validation

- **Against NASA:** we re-downloaded NASA POWER data independently and confirmed our rainfall, ETo and soil wetness match the original source exactly.
- **Yearly tables:** `validar_anual.py` recalculates the yearly values from the monthly data, checks one point by hand, and confirms that higher points are colder.
- **Satellite vs. ground stations:** satellites cover the whole province; ground stations are more precise but only where they exist. Next step: validate against IMN weather stations.

---

## 7. Important notes

- **Column names will NOT change**; only the empty columns will be filled.
- **Temperatures are corrected for elevation** (`temp_correction_c` shows the adjustment), so they will NOT match raw NASA POWER values. Rainfall and soil wetness still match exactly.
- **Period:** 2020–2025 (6 years). A "typical" month or year from 6 years is less solid than one from 30 years.