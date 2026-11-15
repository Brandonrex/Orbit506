# App data 

A plain-language guide to our data. No farming background needed.

---

## 1. The files

| File | What's inside | Use it for |
|---|---|---|
| `data/processed/cuadricula.csv` | 192 points spread over Cartago, one every ~5 km. Key: `ID` | Drawing points on the map and finding the point closest to a click |
| `data/processed/app_data.csv` | One row per point and per **typical month** (the 2020–2025 average of each month). 192 x 12 = 2,304 rows | The planting calendar: "what is a normal January like here?" |
| `data/processed/app_data_series.csv` | One row per point, **year** and month (2020–2025). 192 x 72 = 13,824 rows | Timeline charts: "was 2023 drier than usual?" |

**How to use them:** when the user clicks on the map, find the closest point in `cuadricula.csv`, then filter `app_data.csv` (or `app_data_series.csv`) by that `point_id`.

---

## 2. The datasets (where the data comes from)

### NASA POWER – the weather
- **What it is:** a free NASA service that gives daily weather (rain, temperature, sunlight) for any place on Earth. Think of it as a **virtual weather station**: there is no real station on each farm, so NASA estimates the weather from satellites and climate models.
- **What we take from it:** rainfall, maximum and minimum temperature, and solar radiation.
- **Detail:** coarse. Each value covers a square of about 50 km, so all of Cartago falls in only 4 squares.
- **Status:** ✅ downloaded.

### MODIS (NDVI) – how green the land is
- **What it is:** a NASA satellite that photographs the whole planet every day and measures how green the vegetation is.
- **What we take from it:** NDVI, every 16 days.
- **Detail:** fine. Each value covers 250 m.
- **Status:** ⏳ requested.

### SMAP – how wet the soil is
- **What it is:** a NASA satellite that measures the water stored in the soil. It works through clouds, which matters in Cartago.
- **What we take from it:** moisture in the root zone (the top meter of soil, where plant roots live).
- **Detail:** medium. Each value covers about 9 km.
- **Status:** ⏳ requested.

### NASADEM – the shape of the land
- **What it is:** a NASA elevation map: how high every spot is above sea level.
- **What we take from it:** elevation, and from it the slope (how steep the land is).
- **Detail:** very fine. Each value covers 30 m. It doesn't change over time.
- **Status:** ⏳ requested.

### AppEEARS – not a dataset, a tool
- A NASA website where you ask for **only the pieces you need** ("these points, these dates, these variables") instead of downloading huge satellite files. We use it to get MODIS, SMAP and NASADEM.

---

## 3. The variables, explained simply

### `rain_mm` – Rainfall
- **What it is:** how much it rained in the month. Imagine a straight glass left outside: 1 mm means the water reached 1 millimeter high. 1 mm = 1 liter of water per square meter.
- **Unit:** mm per month.
- **Why it matters:** crops need water, but too much rain on steep land washes the soil away.
- **How to read it:** low in the dry season, high in the rainy season.

### `tmax_c` and `tmin_c` – Day and night temperature
- **What it is:** the average daytime high and nighttime low of the month.
- **Unit:** °C.
- **Why it matters:** each crop has a temperature range it likes. Potatoes like cool weather; very hot or very cold weather hurts them.
- **⚠️ Note:** not yet corrected for elevation, so they come out too warm in the highlands.

### `tmin_extreme_c` – The coldest night
- **What it is:** the coldest night recorded in that month (2020–2025).
- **Unit:** °C.
- **Why it matters:** one very cold night can be enough to damage a crop (frost). This is the input for `frost_risk`.

### `eto_mm` – Water the land loses (evapotranspiration)
- **What it is:** water that goes back into the air: from the soil (like a puddle drying) plus from the plants (like they "sweat"). Hot, sunny days = more water lost.
- **Unit:** mm per month.
- **How we get it:** calculated from temperature and sunlight with a simple, standard formula (Hargreaves, recommended by FAO when data is limited).
- **Why it matters:** it tells us how much water the land "spends" each month.

### `balance_mm` – Is there enough water? (water balance)
- **What it is:** rainfall minus water lost (`rain_mm − eto_mm`). Like a bank account: rain is income, ETo is spending.
- **Unit:** mm per month.
- **How to read it:**
  - **Positive (+):** more rain than the land needs → surplus water (and on steep land, risk of erosion).
  - **Negative (−):** the land loses more than it gets → plants may lack water.
- **Why it matters:** it is the simplest way to show a farmer when water is short or too much.

### `elevation_m` – How high the place is
- **What it is:** meters above sea level.
- **Why it matters:** the higher you go, the colder it gets (about 6.5 °C colder per 1,000 m). We use it to correct the temperatures and to estimate frost risk.
- **Status:** ⏳ empty for now.

### `ndvi` – How green the land is
- **What it is:** a number that says how much healthy, green vegetation there is. The satellite "sees" light that healthy plants reflect.
- **Unit:** from -1 to 1.
- **How to read it (rough guide):**
  - Below 0.2: bare soil, roads, buildings or water.
  - 0.2 to 0.5: young crops, dry grass or stressed plants.
  - Above 0.5: healthy, dense crops or forest.
- **Why it matters:** low NDVI on farmland means **bare soil**, which is easily washed away by rain. A good crop rotation keeps the soil covered more of the year.
- **Status:** ⏳ empty for now.

### `soil_moisture` – How wet the soil is
- **What it is:** how much water the soil holds around the roots. Think of the soil as a **sponge**.
- **Unit:** m³ of water per m³ of soil (for example, 0.30 = 30% of the soil volume is water).
- **Why it matters:** rainfall tells us how much water **fell**; soil moisture tells us how much **stayed** for the plants.
- **Status:** ⏳ empty for now.

### `slope_deg` – How steep the land is
- **What it is:** the tilt of the ground. 0° is flat; the higher the number, the steeper.
- **Unit:** degrees.
- **Why it matters:** on steep land, heavy rain carries away the fertile topsoil (erosion). Steep, bare land is the biggest risk in Cartago's potato areas.
- **Status:** ⏳ empty for now.

### `frost_risk` – Risk of frost
- **What it is:** our own indicator: how likely it is that nights get cold enough to damage crops.
- **Values:** low / medium / high.
- **Based on:** `tmin_extreme_c` corrected with `elevation_m`.
- **Status:** ⏳ empty for now.

### `planting_signal` – Is this a good month to plant?
- **What it is:** our own traffic light, combining water, temperature and frost risk with each crop's needs.
- **Values:** green (good) / yellow (careful) / red (avoid).
- **Status:** ⏳ empty for now (waiting for the crop requirements from our BA).

### Other columns
- `point_id`: the ID of the point (same as `ID` in `cuadricula.csv`).
- `lat`, `lon`: the point's coordinates.
- `year`: the year (only in `app_data_series.csv`).
- `month`, `month_name`: the month (1–12, Jan–Dec).
- `climate_point_id`: the 10 km point the weather comes from (internal use).
- `version`: "preliminary" while some columns are still empty.

---

## 4. How it all fits together

> 🌧️ **Rain** = how much water falls
> 💨 **ETo** = how much water the land loses
> ⚖️ **Balance** = is there enough? (rain − ETo)
> 🧽 **Soil moisture** = how much water actually stays for the plants
> 🌱 **NDVI** = how the plants respond, or whether the soil is bare
> ⛰️ **Elevation and slope** = how cold and how steep the land is

Together they answer: **"When should I plant, and which rotation protects my soil?"**

---

## 5. Important notes

- **Preliminary version:** column names will NOT change; only the empty columns will be filled.
- Column names are in English. The old Spanish names (`punto_id`, `lluvia_mm`, etc.) are no longer used.
- **Temperatures are not yet corrected for elevation:** in the highlands they come out warmer than reality. Do not show them as final values.
- **Satellite vs. ground stations:** satellites cover the whole province; ground stations are more precise but only where they exist. As a next step, we propose validating our data against IMN weather stations.
- **Period:** 2020–2025 (6 years). It matches the SMAP data, but a "typical month" from 6 years is less solid than one from 30 years.