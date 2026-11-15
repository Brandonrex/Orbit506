# App data – RotaCR Cartago

A plain-language guide to our data. No farming background needed.

**Version:** v2 — NASA POWER + NASADEM (elevation) + MODIS (NDVI).

---

## 1. The files

| File | What's inside | Use it for |
|---|---|---|
| `data/processed/cuadricula.csv` | 192 points spread over Cartago, one every ~5 km. Key: `ID` | Drawing points on the map and finding the point closest to a click |
| `data/processed/app_data.csv` | One row per point and per **typical month** (the 2020–2025 average of each month). 192 x 12 = 2,304 rows | The planting calendar: "what is a normal January like here?" |
| `data/processed/app_data_series.csv` | One row per point, **year** and month (2020–2025). 192 x 72 = 13,824 rows | Timeline charts: "was 2024 drier than usual?" |
| `data/processed/elevation.csv` | Elevation of each of the 192 points | Internal (already included in app_data) |
| `data/processed/ndvi_monthly.csv` | Clean monthly NDVI per point | Internal (already included in app_data) |

**How to use them:** when the user clicks on the map, find the closest point in `cuadricula.csv`, then filter `app_data.csv` (or `app_data_series.csv`) by that `point_id`.

---

## 2. The datasets (where the data comes from)

### NASA POWER – the weather ✅
- **What it is:** a free NASA service that gives daily weather (rain, temperature, sunlight, soil wetness) for any place on Earth. Think of it as a **virtual weather station**: NASA estimates the weather from satellites and climate models.
- **What we take from it:** rainfall, maximum and minimum temperature, solar radiation and root-zone soil wetness (`GWETROOT`).
- **Detail:** coarse. Each value covers a square of about 50 km, so all of Cartago falls in only 4 squares.

### MODIS (NDVI) – how green the land is ✅
- **What it is:** a NASA satellite that photographs the whole planet every day and measures how green the vegetation is.
- **What we take from it:** NDVI, every 16 days, averaged by month.
- **Detail:** fine. Each value covers 250 m.
- **Cleaning:** we removed the "no data" code (-3000) and values flagged as cloudy. About 86% of the months have a value.

### NASADEM – the shape of the land ✅ (elevation) · ⏳ (slope)
- **What it is:** a NASA elevation map: how high every spot is above sea level.
- **What we take from it:** elevation of each point (241 m to 3,223 m in our grid). Slope is still pending.
- **Detail:** very fine. Each value covers 30 m. It doesn't change over time.

### SMAP – how wet the soil is ⏳ (optional)
- **What it is:** a NASA satellite that measures the water stored in the soil, even through clouds.
- **Detail:** ~9 km, finer than NASA POWER. If it arrives, we compare it with `soil_wetness`.

### AppEEARS – not a dataset, a tool
- A NASA website where you ask for **only the pieces you need** ("these points, these dates, these variables") instead of downloading huge satellite files. We used it to get MODIS and NASADEM.

---

## 3. The variables, explained simply

### `rain_mm` – Rainfall ✅
- **What it is:** how much it rained in the month. Imagine a straight glass left outside: 1 mm means the water reached 1 millimeter high. 1 mm = 1 liter of water per square meter.
- **Unit:** mm per month.
- **Why it matters:** crops need water, but too much rain on steep land washes the soil away.

### `tmax_c` and `tmin_c` – Day and night temperature ✅ (corrected for elevation)
- **What it is:** the average daytime high and nighttime low of the month, **adjusted to the real height of each point**.
- **Unit:** °C.
- **Why it matters:** each crop has a temperature range it likes. Potatoes like cool weather; very hot or very cold weather hurts them.

### `tmin_extreme_c` – The coldest night ✅ (corrected for elevation)
- **What it is:** the coldest night recorded in that month (2020–2025).
- **Unit:** °C.
- **Why it matters:** one very cold night can be enough to damage a crop (frost). This is the input for `frost_risk`.

### `temp_correction_c` – How much we adjusted the temperature 🆕
- **What it is:** how many °C we added or subtracted to NASA POWER's temperature because of the point's real height.
- **How:** about 6.5 °C colder for every 1,000 m higher than NASA POWER's square.
- **How to read it:** negative = the point is higher (colder) than the square's average; positive = lower (warmer). In our grid it goes from about −14 °C to +5 °C.
- **Why it matters:** transparency. Anyone can see exactly how much we changed the original data.

### `eto_mm` – Water the land loses (evapotranspiration) ✅
- **What it is:** water that goes back into the air: from the soil (like a puddle drying) plus from the plants (like they "sweat"). Hot, sunny days = more water lost.
- **Unit:** mm per month.
- **How we get it:** Hargreaves formula (recommended by FAO when data is limited), using the **corrected** temperatures.

### `balance_mm` – Is there enough water? (water balance) ✅
- **What it is:** rainfall minus water lost (`rain_mm − eto_mm`). Like a bank account: rain is income, ETo is spending.
- **How to read it:** positive (+) = surplus water (on steep land, erosion risk); negative (−) = plants may lack water.

### `soil_wetness` – How full the soil "sponge" is ✅
- **What it is:** how much water the root zone (top ~1 m of soil) holds compared to its maximum. 0 = completely dry, 1 = completely soaked.
- **Source:** NASA POWER (`GWETROOT`). Coarse (~50 km).
- **Why it matters:** very low = plants may suffer; close to 1 = soaked soil (on steep land, more erosion risk).

### `elevation_m` – How high the place is ✅
- **What it is:** meters above sea level (NASADEM).
- **Why it matters:** higher = colder. We use it to correct temperatures and estimate frost risk.

### `ndvi` – How green the land is ✅
- **What it is:** how much healthy, green vegetation there is (from -1 to 1).
- **How to read it (rough guide):** below 0.2 = bare soil, roads or water; 0.2–0.5 = young crops or stressed plants; above 0.5 = healthy crops or forest.
- **Why it matters:** low NDVI on farmland means **bare soil**, which rain washes away easily. Points with high NDVI all year are probably forest or protected areas, not farms.
- **Note:** some months are empty because of clouds.

### `frost_risk` – Risk of frost ✅ (provisional thresholds)
- **What it is:** our own indicator, based on the coldest corrected night of the month.
- **Values:** high (≤ 2 °C) / medium (≤ 5 °C) / low.
- **⚠️ The thresholds are provisional** and must be validated by our BA with a source for each crop.

### `soil_moisture` – Soil moisture from SMAP ⏳ (optional)
- **Unit:** m³/m³. Empty unless SMAP data arrives.

### `slope_deg` – How steep the land is ⏳
- **What it is:** the tilt of the ground (0° = flat).
- **Why it matters:** on steep land, heavy rain carries away the fertile topsoil (erosion).

### `planting_signal` – Is this a good month to plant? ⏳
- **What it is:** our traffic light: green (good) / yellow (careful) / red (avoid).
- **Waiting for:** the crop requirements (`crops.csv`) from our BA.

### Other columns
- `point_id`: the ID of the point (same as `ID` in `cuadricula.csv`).
- `lat`, `lon`: the point's coordinates.
- `year`: the year (only in `app_data_series.csv`).
- `month`, `month_name`: the month (1–12, Jan–Dec).
- `climate_point_id`: the 10 km point the weather comes from (internal use).
- `version`: "v2".

---

## 4. How it all fits together

> 🌧️ **Rain** = how much water falls
> 💨 **ETo** = how much water the land loses
> ⚖️ **Balance** = is there enough? (rain − ETo)
> 🧽 **Soil wetness** = how much water actually stays for the plants
> 🌱 **NDVI** = how the plants respond, or whether the soil is bare
> ⛰️ **Elevation** = how high (and how cold) the land is
> ❄️ **Frost risk** = will the nights get too cold?

Together they answer: **"When should I plant, and which rotation protects my soil?"**

---

## 5. Important notes

- **Column names will NOT change**; only the empty columns will be filled.
- **Temperatures are corrected for elevation** using NASADEM (`temp_correction_c` shows the adjustment). Because of this, temperatures will NOT match raw NASA POWER values; rainfall and soil wetness still match exactly.
- **Validation:** we re-downloaded NASA POWER data independently and confirmed our rainfall, ETo and soil wetness match the original source.
- **Satellite vs. ground stations:** satellites cover the whole province; ground stations are more precise but only where they exist. Next step: validate against IMN weather stations.
- **Period:** 2020–2025 (6 years). A "typical month" from 6 years is less solid than one from 30 years.
- **Frost thresholds are provisional** until our BA validates them.