# Field Shift — Crop Suitability Datasets

## 1. Overview

Field Shift is an agricultural planning prototype that uses environmental data from NASA and crop requirements from ECOCROP to identify potential growing periods in Cartago, Costa Rica.

The suitability calculations are performed offline using Python in Google Colab. Their outputs are exported as static CSV and JSON files for integration into the Angular frontend.

The current implementation includes two independent environmental assessments:

- **Thermal Suitability:** evaluates monthly temperatures against ECOCROP crop requirements.
- **Rainfall Suitability:** evaluates annual rainfall compatibility and potential planting-start periods based on accumulated rainfall.

These assessments are independent. They do not produce a combined suitability score.

### Data sources

| Source | Purpose |
|---|---|
| NASA POWER, processed by ASH | Historical environmental conditions, 2020–2025 |
| ECOCROP | Crop-specific environmental requirements and growing durations |
| Field Shift Python Engine | Suitability classifications, growing windows and estimated cycles |

### Geographic coverage

- **Region:** Cartago, Costa Rica
- **Sampling points:** 192
- **Crops:** 4 — Potato, Carrot, Onion and Sweet Potato
- **Historical period:** 2020–2025
- **Evaluation combinations:** 192 points × 4 crops = 768

The `point_id` and `crop_id` fields connect the datasets.

---

## 2. Exported Files

| Filename | Format | Records | Purpose |
|---|---|---:|---|
| `ecocrop-requirements.csv` | CSV | 4 | Crop requirements and environmental thresholds |
| `thermal-windows.json` | JSON | 768 | Complete thermal evaluations with growing windows and cycles |
| `thermal-windows.csv` | CSV | 9,216 | Monthly thermal suitability classifications |
| `rainfall-windows.json` | JSON | 768 | Seasonal rainfall evaluations with planting-start windows |
| `rainfall-windows.csv` | CSV | 9,216 | Rainfall evaluation for each possible planting month |
| `annual-rainfall.csv` | CSV | 768 | Annual precipitation compatibility with ECOCROP |

## 3. ECOCROP Requirements

**File:** `ecocrop-requirements.csv`

Contains the environmental requirements of the four selected crops. Each minimum and maximum is stored in a separate column.

### Schema

| Field | Type | Description |
|---|---|---|
| `crop_id` | Integer | Unique ECOCROP identifier |
| `crop` | String | Crop name |
| `scientific_name` | String | Scientific species name |
| `optimal_temp_min_c` | Number | Minimum optimal temperature, °C |
| `optimal_temp_max_c` | Number | Maximum optimal temperature, °C |
| `tolerated_temp_min_c` | Number | Minimum tolerated temperature, °C |
| `tolerated_temp_max_c` | Number | Maximum tolerated temperature, °C |
| `optimal_rain_min_mm_year` | Number | Minimum optimal annual rainfall |
| `optimal_rain_max_mm_year` | Number | Maximum optimal annual rainfall |
| `tolerated_rain_min_mm_year` | Number | Minimum tolerated annual rainfall |
| `tolerated_rain_max_mm_year` | Number | Maximum tolerated annual rainfall |
| `growing_days_min` | Number | Minimum growing duration, days |
| `growing_days_max` | Number | Maximum growing duration, days |
| `drainage` | String / Null | ECOCROP drainage requirement |
| `drainage_rating` | String / Null | Additional drainage classification, when available |

### Crop IDs

| Crop | ID | Scientific name |
|---|---:|---|
| Cebolla | 364 | Allium cepa |
| Zanahoria | 871 | Daucus carota |
| Camote | 1265 | Ipomoea batatas |
| Papa | 1971 | Solanum tuberosum |

The rainfall requirements in this source are documented as annual quantities. The seasonal rainfall engine uses a separate, explicitly identified growing-period interpretation.

---

## 4. Thermal Suitability

### 4.1 `thermal-windows.json`

**Records:** 768  
**Granularity:** One object per `point_id` and `crop_id`.

Contains the full thermal evaluation for each crop and geographic point.

#### Root fields

| Field | Type | Description |
|---|---|---|
| `point_id` | Integer | Geographic sampling point |
| `crop_id` | Integer | ECOCROP crop identifier |
| `crop` | String | Crop name |
| `scientific_name` | String | Scientific name |
| `variable` | String | Always `temperature` |
| `unit` | String | `°C` |
| `reference` | Object | ECOCROP thermal thresholds |
| `growing_days_min` | Number | Minimum growth duration |
| `growing_days_max` | Number | Maximum growth duration |
| `monthly_evaluation` | Array | Thermal classification for all 12 months |
| `windows` | Array | Consecutive optimal-temperature periods |

#### `reference` object

| Field | Description |
|---|---|
| `source` | `ECOCROP` |
| `optimal_min` | Minimum optimal temperature |
| `optimal_max` | Maximum optimal temperature |
| `tolerated_min` | Minimum tolerated temperature |
| `tolerated_max` | Maximum tolerated temperature |

#### `monthly_evaluation` array

| Field | Description |
|---|---|
| `month` | Calendar month, 1–12 |
| `temperature_c` | Mean monthly temperature |
| `status` | `favorable`, `caution` or `unfavorable` |

#### `windows` array

| Field | Description |
|---|---|
| `start_month` | First month of the optimal period |
| `end_month` | Last month of the optimal period |
| `window_months` | Total consecutive optimal months |
| `cycle_months` | Estimated duration of one growing cycle |
| `max_complete_cycles` | Number of theoretical complete cycles |
| `can_complete_cycle` | Whether the window accommodates at least one cycle |
| `cycles` | Array of estimated cycles and their thermal alerts |

Each cycle includes `cycle_number`, `start_month`, `end_month`, `duration_months` and `alerts`.

#### Calculation methodology

Monthly mean temperature is calculated as:

`Tmean = (Tmax + Tmin) / 2`

Classification:

- `favorable`: temperature within ECOCROP's optimal range.
- `caution`: temperature outside optimal limits but within tolerated limits.
- `unfavorable`: temperature outside tolerated limits.
- `unknown`: missing temperature value, when applicable.

Growing windows group consecutive `favorable` months.

Cycle duration is estimated using:

`cycle_months = ceil(growing_days_min / 30)`

The number of theoretical complete cycles is:

`max_complete_cycles = floor(window_months / cycle_months)`

**Limitations:** This is a temperature-based assessment. Its cycles are planning approximations, not guaranteed harvest dates. Thermal windows are currently grouped within January–December and do not join December to January.

### 4.2 `thermal-windows.csv`

**Records:** 9,216  
**Granularity:** One row per point, crop and calendar month.

| Field | Description |
|---|---|
| `point_id` | Geographic point |
| `crop_id` | ECOCROP crop ID |
| `crop` | Crop name |
| `month` | Calendar month |
| `temperature_c` | Mean monthly temperature, °C |
| `status` | Thermal suitability classification |
| `optimal_min_c` | Minimum optimal temperature |
| `optimal_max_c` | Maximum optimal temperature |
| `tolerated_min_c` | Minimum tolerated temperature |
| `tolerated_max_c` | Maximum tolerated temperature |
| `growing_days_min` | Minimum growth duration, days |
| `growing_days_max` | Maximum growth duration, days |

**Note:** This CSV contains monthly classifications, not the nested growing windows or cycle records. Those are available in the JSON file.

---

## 5. Rainfall Suitability

The rainfall module contains two distinct assessments.

**Annual rainfall assessment:** compares annual climatic precipitation with ECOCROP's documented annual rainfall requirements.

**Seasonal rainfall assessment:** evaluates accumulated precipitation over a representative growing period, following an adaptation of the DIVA-GIS ECOCROP approach.

These results serve different purposes and should not be interpreted interchangeably.

### 5.1 `annual-rainfall.csv`

**Records:** 768  
**Granularity:** One row per point and crop.

| Field | Type | Description |
|---|---|---|
| `point_id` | Integer | Geographic point |
| `crop_id` | Integer | ECOCROP crop ID |
| `crop` | String | Crop name |
| `annual_rain_mm` | Number | Mean annual rainfall, mm/year |
| `optimal_min_mm_year` | Number | Minimum optimal annual rainfall |
| `optimal_max_mm_year` | Number | Maximum optimal annual rainfall |
| `tolerated_min_mm_year` | Number | Minimum tolerated annual rainfall |
| `tolerated_max_mm_year` | Number | Maximum tolerated annual rainfall |
| `status` | String | Annual rainfall compatibility classification |

#### Classification rules

- `favorable`: annual rainfall is inside the optimal range.
- `caution`: annual rainfall is outside the optimal range but inside the tolerated range.
- `unfavorable`: annual rainfall is outside tolerated limits.

**Observed distribution for the 192 points:**

| Crop | Favorable | Caution | Unfavorable |
|---|---:|---:|---:|
| Camote | 0 | 192 | 0 |
| Cebolla | 0 | 0 | 192 |
| Papa | 0 | 0 | 192 |
| Zanahoria | 0 | 192 | 0 |

This uniform classification reflects the rainfall values and ECOCROP thresholds used in the assessment. It does not establish that a crop cannot be cultivated at a location.

### 5.2 `rainfall-windows.json`

**Records:** 768  
**Granularity:** One object per point and crop.

Contains potential planting-start months classified according to accumulated rainfall over a representative crop growing period.

#### Root fields

| Field | Type | Description |
|---|---|---|
| `point_id` | Integer | Geographic point |
| `crop_id` | Integer | ECOCROP crop ID |
| `crop` | String | Crop name |
| `variable` | String | Always `rainfall` |
| `method` | String | `growing_period_accumulation` |
| `duration_days` | Number | Representative growing duration in days |
| `duration_months` | Integer | Representative duration rounded to whole months |
| `candidates` | Array | Twelve planting-start evaluations |
| `windows` | Array | Groups of consecutive favorable planting-start months |

#### `candidates` array

| Field | Type | Description |
|---|---|---|
| `start_month` | Integer | Possible planting month |
| `end_month` | Integer | Estimated final month of the period |
| `months` | Array | Calendar months included in the evaluated period |
| `duration_months` | Integer | Duration of the evaluated period |
| `rain_total_mm` | Number | Accumulated precipitation during that period |
| `status` | String | `favorable`, `caution` or `unfavorable` |

#### `windows` array

| Field | Type | Description |
|---|---|---|
| `window_id` | Integer | Sequential identifier within the evaluation |
| `start_month` | Integer | First favorable planting-start month |
| `end_month` | Integer | Last favorable planting-start month |
| `planting_months` | Array | Individual favorable start months |
| `window_months` | Integer | Number of favorable planting-start months |
| `status` | String | Always `favorable` |
| `candidates` | Array | Corresponding planting-start evaluations |

#### Calculation methodology

Representative growing duration:

`duration_days = (growing_days_min + growing_days_max) / 2`

`duration_months = ceil(duration_days / 30)`

For each possible starting month, the engine accumulates rainfall across the corresponding growing period.

Classification uses ECOCROP's precipitation thresholds:

- `favorable`: accumulated rainfall is within the selected optimal range.
- `caution`: accumulated rainfall is within the tolerated range but outside the optimal range.
- `unfavorable`: accumulated rainfall is outside the tolerated range.

The method supports growing periods crossing December–January using a circular twelve-month climatology.

**Methodological note:** This is an adaptation of the DIVA-GIS growing-period interpretation of ECOCROP rainfall requirements, not a direct comparison of two annual rainfall measurements.

#### Window interpretation

A rainfall window identifies **consecutive favorable planting-start months**, not the entire duration of one growing cycle.

For example, a window with `planting_months = [4, 5, 6]` means April, May and June are three possible starting months. Each start has its own evaluated growing period.

The frontend should not interpret the entire planting window as one crop cycle.

### 5.3 `rainfall-windows.csv`

**Records:** 9,216  
**Granularity:** One row per point, crop and possible planting-start month.

| Field | Type | Description |
|---|---|---|
| `point_id` | Integer | Geographic point |
| `crop_id` | Integer | ECOCROP crop ID |
| `crop` | String | Crop name |
| `start_month` | Integer | Evaluated planting-start month |
| `end_month` | Integer | Final month of the evaluated period |
| `duration_months` | Integer | Evaluated period duration |
| `rain_total_mm` | Number | Accumulated rainfall over the evaluated period |
| `status` | String | Rainfall compatibility classification |
| `duration_days` | Number | Representative duration before conversion to whole months |

The CSV contains individual planting-start evaluations. Grouped windows are provided in the JSON.

### Observed seasonal results

| Crop | Favorable starts | Caution starts | Unfavorable starts |
|---|---:|---:|---:|
| Camote | 2,040 | 264 | 0 |
| Cebolla | 24 | 2,280 | 0 |
| Papa | 300 | 1,968 | 36 |
| Zanahoria | 924 | 1,344 | 36 |

Across the 768 point–crop combinations, the window-building algorithm identified **900 favorable planting-start windows**.

---

## 6. Angular Integration

The frontend can consume the JSON files as static assets.

Suggested structure:

```text
public/
└── data/
    ├── ecocrop-requirements.csv
    ├── thermal-windows.json
    ├── thermal-windows.csv
    ├── rainfall-windows.json
    ├── rainfall-windows.csv
    └── annual-rainfall.csv
```

### Data lookup

The main lookup keys are:

- `point_id`: selected geographic sampling point.
- `crop_id`: selected crop.
- `variable`: environmental analysis selected by the user.

For temperature, Angular reads `monthly_evaluation` and `windows`.

For rainfall, Angular reads `candidates` and `windows`. The annual CSV provides a separate annual compatibility classification.

### Frontend behavior

1. The user registers or selects a terrain.
2. The map associates the terrain with a `point_id`.
3. The user selects a crop using its `crop_id`.
4. Angular retrieves the corresponding evaluation.
5. The environmental explorer displays historical values and the calculated windows.
6. The user selects available planning options and adds them to the annual calendar.

No backend is required to recalculate these assessments, since the results are generated offline.

### Important implementation distinctions

- Thermal windows describe consecutive months with optimal average temperatures.
- Rainfall windows describe consecutive **possible planting-start months**.
- Rainfall candidate periods may overlap.
- Thermal and rainfall results are independent; they must not be combined automatically.
- The `status` field describes compatibility with the selected analytical rule, not an overall agricultural recommendation.
- Climatological windows are derived from 2020–2025 typical conditions, not from real-time forecasts.
- Changing the historical year shown in the graph should not implicitly modify these precalculated climatological windows.

---

## 7. Validation and Limitations

### Completed data validation

The NASA-derived tables were checked for:

- Expected row counts and geographic coverage.
- Duplicate composite keys.
- Historical monthly coverage for 2020–2025.
- Consistency of monthly averages against the historical series.
- Consistency of yearly aggregates.
- Consistency of annual climate normals.

All tested aggregations passed within the defined numerical tolerances.

This confirms **internal consistency**, not meteorological accuracy against ground observations.

### Model limitations

1. **Climate resolution:** the 192 sampling locations do not represent 192 independent meteorological stations. NASA POWER estimates can share underlying climate-grid values.
2. **Historical climatology:** windows describe typical conditions across 2020–2025, not future weather predictions.
3. **Cycle duration:** the conversion from days to whole calendar months is an implementation approximation.
4. **Thermal suitability:** monthly mean temperatures do not fully capture short-term extremes.
5. **Rainfall suitability:** accumulated precipitation alone does not establish effective soil water availability, drainage adequacy or irrigation requirements.
6. **Independent assessments:** current modules do not represent a validated combined crop suitability model.
7. **Geographic and agronomic scope:** other determinants, including soil properties, management practices and pests, are not fully incorporated.

## 8. Current Development Status

| Environmental variable | Status |
|---|---|
| Temperature | Implemented and exported |
| Rainfall | Implemented and exported |
| Soil wetness | Pending methodology and implementation |
| Evapotranspiration | Pending methodology and implementation |
| Climatic water balance | Pending methodology and implementation |

Additional modules should preserve the shared identifiers and clearly document their independent evaluation methods.

---

**Project:** Field Shift  
**Processing environment:** Python / Google Colab  
**Frontend:** Angular / Leaflet  
**Primary environmental source:** NASA POWER  
**Crop requirements source:** ECOCROP  
**Purpose:** Exploratory, climate-informed agricultural planning.