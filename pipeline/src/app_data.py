# pipeline/src/app_data.py
"""Builds app_data.csv: one row per grid point and per month of the year.
PRELIMINARY VERSION: NASA POWER only. NDVI, SMAP, elevation and slope are left empty."""
import numpy as np
import pandas as pd

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Columns filled later, when the AppEEARS data arrives (empty for now)
FUTURE_COLUMNS = ["elevation_m", "ndvi", "soil_moisture", "slope_deg",
                  "frost_risk", "planting_signal"]

# 1. Read the monthly climate of the 48 points (2020-2025 only)
#    and rename the input columns to English
climate = pd.read_csv("pipeline/data/processed/power_10km_mensual.csv", parse_dates=["date"])
climate = climate.rename(columns={"punto_id": "point_id",
                                  "lluvia_mm": "rain_mm",
                                  "tmin_extrema_c": "tmin_extreme_c",
                                  "humedad_raiz": "soil_wetness"})
climate = climate[climate["date"] >= "2020-01-01"].copy()
climate["month"] = climate["date"].dt.month
climate["days"] = climate["date"].dt.days_in_month

# 2. Reference evapotranspiration (ETo) with the Hargreaves equation (FAO)
#    Daily ETo = 0.0023 x Ra x (Tmean + 17.8) x sqrt(Tmax - Tmin)
#    Ra = top-of-atmosphere radiation, converted from MJ/m²/day to mm/day (x 0.408)
tmean = (climate["tmax_c"] + climate["tmin_c"]) / 2
trange = (climate["tmax_c"] - climate["tmin_c"]).clip(lower=0)
eto_daily = 0.0023 * (climate["rad_toa"] * 0.408) * (tmean + 17.8) * np.sqrt(trange)
climate["eto_mm"] = eto_daily * climate["days"]                    # ETo for the whole month
climate["balance_mm"] = climate["rain_mm"] - climate["eto_mm"]     # + water surplus, - deficit

# 3. "Typical month": average of each month across 2020-2025, for each point
normal = (
    climate.groupby(["point_id", "month"])
    .agg(rain_mm=("rain_mm", "mean"),
         tmax_c=("tmax_c", "mean"),
         tmin_c=("tmin_c", "mean"),
         tmin_extreme_c=("tmin_extreme_c", "min"),   # coldest night on record
         eto_mm=("eto_mm", "mean"),
         balance_mm=("balance_mm", "mean"),
         soil_wetness=("soil_wetness", "mean"))
    .reset_index()
    .rename(columns={"point_id": "climate_point_id"})
)

# 4. Each 5 km point takes the climate of the nearest 10 km point
grid = pd.read_csv("pipeline/data/processed/cuadricula.csv")
p10 = climate.groupby("point_id")[["lat", "lon"]].first().reset_index()
dist = ((grid["Latitude"].values[:, None] - p10["lat"].values[None, :]) ** 2 +
        (grid["Longitude"].values[:, None] - p10["lon"].values[None, :]) ** 2)
grid["climate_point_id"] = p10["point_id"].values[dist.argmin(axis=1)]
grid = grid.rename(columns={"ID": "point_id", "Latitude": "lat", "Longitude": "lon"})
grid = grid[["point_id", "lat", "lon", "climate_point_id"]]

# 5. Join: 192 points x 12 months
app = grid.merge(normal, on="climate_point_id")
app["month_name"] = app["month"].map(lambda m: MONTHS[m - 1])

# 6. Future columns (empty for now)
for col in FUTURE_COLUMNS:
    app[col] = pd.NA
app["version"] = "preliminary"

# 7. Sort and save
columns = ["point_id", "lat", "lon", "month", "month_name",
           "rain_mm", "tmax_c", "tmin_c", "tmin_extreme_c", "eto_mm", "balance_mm", "soil_wetness",
           *FUTURE_COLUMNS, "climate_point_id", "version"]
app = app[columns].sort_values(["point_id", "month"]).round(2)
app.to_csv("pipeline/data/processed/app_data.csv", index=False)

print("✅ Rows:", len(app), "(expected 192 x 12 = 2304)")
print("✅ Points:", app["point_id"].nunique())
print("\nExample, point 1:")
print(app[app["point_id"] == 1][["month_name", "rain_mm", "tmin_c", "eto_mm", "balance_mm"]])

# 8. TABLE 2: series by year and month (2020-2025), not averaged
series = climate[["point_id", "date", "month", "rain_mm", "tmax_c", "tmin_c",
                  "tmin_extreme_c", "eto_mm", "balance_mm", "soil_wetness"]].rename(
    columns={"point_id": "climate_point_id"})
series["year"] = series["date"].dt.year

app_series = grid.merge(series, on="climate_point_id")
app_series["month_name"] = app_series["month"].map(lambda m: MONTHS[m - 1])
for col in FUTURE_COLUMNS:
    app_series[col] = pd.NA
app_series["version"] = "preliminary"

series_columns = ["point_id", "lat", "lon", "year", "month", "month_name",
                  "rain_mm", "tmax_c", "tmin_c", "tmin_extreme_c", "eto_mm", "balance_mm", "soil_wetness",
                  *FUTURE_COLUMNS, "climate_point_id", "version"]
app_series = app_series[series_columns].sort_values(["point_id", "year", "month"]).round(2)
app_series.to_csv("pipeline/data/processed/app_data_series.csv", index=False)

print("\n✅ Year x month series - rows:", len(app_series), "(expected 192 x 72 = 13824)")