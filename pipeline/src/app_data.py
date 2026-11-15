# pipeline/src/app_data.py
"""Builds app_data.csv (typical month) and app_data_series.csv (year x month).
Version 2: NASA POWER + elevation (NASADEM) + NDVI (MODIS).
SMAP soil moisture, slope and planting signal are still empty."""
import numpy as np
import pandas as pd

P = "pipeline/data/processed/"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
LAPSE_RATE = 6.5        # °C colder per 1,000 m higher
FROST_HIGH = 2.0        # coldest night <= 2 °C  -> high frost risk  (PROVISIONAL: BA must validate)
FROST_MEDIUM = 5.0      # coldest night <= 5 °C  -> medium frost risk (PROVISIONAL: BA must validate)


def tidy(df):
    """2 decimals for values, 4 for lat/lon (the exact grid coordinates, as in cuadricula.csv)."""
    return df.round({c: 4 if c in ("lat", "lon") else 2 for c in df.columns})

# 1. Monthly climate of the 48 points (NASA POWER), 2020-2025
climate = pd.read_csv(P + "power_10km_mensual.csv", parse_dates=["date"])
climate = climate.rename(columns={"punto_id": "climate_point_id",
                                  "lluvia_mm": "rain_mm",
                                  "tmin_extrema_c": "tmin_extreme_c",
                                  "humedad_raiz": "soil_wetness"})
climate = climate[climate["date"] >= "2020-01-01"].copy()
climate["year"] = climate["date"].dt.year
climate["month"] = climate["date"].dt.month
climate["days"] = climate["date"].dt.days_in_month

# 2. Grid points: nearest climate point + real elevation
grid = pd.read_csv(P + "cuadricula.csv")
p10 = climate.groupby("climate_point_id")[["lat", "lon"]].first().reset_index()
dist = ((grid["Latitude"].values[:, None] - p10["lat"].values[None, :]) ** 2 +
        (grid["Longitude"].values[:, None] - p10["lon"].values[None, :]) ** 2)
grid["climate_point_id"] = p10["climate_point_id"].values[dist.argmin(axis=1)]
grid = grid.rename(columns={"ID": "point_id", "Latitude": "lat", "Longitude": "lon"})
grid = grid[["point_id", "lat", "lon", "climate_point_id"]]
grid = grid.merge(pd.read_csv(P + "elevation.csv"), on="point_id", how="left")

# 3. Series: each grid point gets its climate point's 72 months
cols = ["climate_point_id", "elev_power", "date", "year", "month", "days", "rain_mm",
        "tmax_c", "tmin_c", "tmin_extreme_c", "rad_toa", "soil_wetness"]
series = grid.merge(climate[cols], on="climate_point_id")

# 4. Correct temperatures for elevation (NASA POWER averages a ~50 km square)
series["temp_correction_c"] = -LAPSE_RATE * (series["elevation_m"] - series["elev_power"]) / 1000
for c in ["tmax_c", "tmin_c", "tmin_extreme_c"]:
    series[c] = series[c] + series["temp_correction_c"]

# 5. ETo (Hargreaves, FAO) with the CORRECTED temperatures, and water balance
tmean = (series["tmax_c"] + series["tmin_c"]) / 2
trange = (series["tmax_c"] - series["tmin_c"]).clip(lower=0)
series["eto_mm"] = (0.0023 * (series["rad_toa"] * 0.408) * (tmean + 17.8)
                    * np.sqrt(trange) * series["days"])
series["balance_mm"] = series["rain_mm"] - series["eto_mm"]

# 6. NDVI (MODIS), monthly average per point
ndvi = pd.read_csv(P + "ndvi_monthly.csv")[["point_id", "year", "month", "ndvi"]]
series = series.merge(ndvi, on=["point_id", "year", "month"], how="left")

# 7. Frost risk from the coldest night (corrected)
def frost(t):
    return np.select([t <= FROST_HIGH, t <= FROST_MEDIUM], ["high", "medium"], "low")
series["frost_risk"] = frost(series["tmin_extreme_c"])

# 8. Columns still waiting for data
for c in ["soil_moisture", "slope_deg", "planting_signal"]:
    series[c] = pd.NA
series["month_name"] = series["month"].map(lambda m: MONTHS[m - 1])
series["version"] = "v2"

final_cols = ["point_id", "lat", "lon", "month", "month_name",
              "rain_mm", "tmax_c", "tmin_c", "tmin_extreme_c", "eto_mm", "balance_mm",
              "soil_wetness", "elevation_m", "ndvi", "soil_moisture", "slope_deg",
              "frost_risk", "planting_signal", "temp_correction_c",
              "climate_point_id", "version"]

# 9. TABLE 2: year x month
series_out = series[final_cols[:3] + ["year"] + final_cols[3:]]
series_out = tidy(series_out.sort_values(["point_id", "year", "month"]))
series_out.to_csv(P + "app_data_series.csv", index=False)

# 10. TABLE 1: typical month (2020-2025 average)
typical = (series.groupby(["point_id", "month"])
           .agg(lat=("lat", "first"), lon=("lon", "first"),
                rain_mm=("rain_mm", "mean"), tmax_c=("tmax_c", "mean"),
                tmin_c=("tmin_c", "mean"), tmin_extreme_c=("tmin_extreme_c", "min"),
                eto_mm=("eto_mm", "mean"), balance_mm=("balance_mm", "mean"),
                soil_wetness=("soil_wetness", "mean"), elevation_m=("elevation_m", "first"),
                ndvi=("ndvi", "mean"), temp_correction_c=("temp_correction_c", "mean"),
                climate_point_id=("climate_point_id", "first"))
           .reset_index())
typical["frost_risk"] = frost(typical["tmin_extreme_c"])
for c in ["soil_moisture", "slope_deg", "planting_signal"]:
    typical[c] = pd.NA
typical["month_name"] = typical["month"].map(lambda m: MONTHS[m - 1])
typical["version"] = "v2"
typical = tidy(typical[final_cols].sort_values(["point_id", "month"]))
typical.to_csv(P + "app_data.csv", index=False)

# 11. Summary
print("✅ Typical month rows:", len(typical), "(expected 2304)")
print("✅ Series rows:", len(series_out), "(expected 13824)")
print("🌡️ Temperature correction: from", series["temp_correction_c"].min().round(1),
      "to", series["temp_correction_c"].max().round(1), "°C")
print("❄️ Coldest corrected night:", series["tmin_extreme_c"].min().round(1), "°C")
print("🌱 Months with NDVI:", f"{series['ndvi'].notna().mean():.0%}")
print("\nFrost risk (typical months):")
print(typical["frost_risk"].value_counts())

# 12. TABLE 3: one row per point and YEAR
series["tmean_c"] = (series["tmax_c"] + series["tmin_c"]) / 2
yearly = (series.groupby(["point_id", "year"])
          .agg(lat=("lat", "first"), lon=("lon", "first"),
               elevation_m=("elevation_m", "first"),
               rain_mm=("rain_mm", "sum"),              # total of the year
               tmean_c=("tmean_c", "mean"),             # average temperature of the year
               tmax_c=("tmax_c", "mean"),
               tmin_c=("tmin_c", "mean"),
               tmin_extreme_c=("tmin_extreme_c", "min"), # coldest night of the year
               eto_mm=("eto_mm", "sum"),
               balance_mm=("balance_mm", "sum"),
               soil_wetness=("soil_wetness", "mean"),
               ndvi=("ndvi", "mean"))
          .reset_index().pipe(tidy))
yearly.to_csv(P + "app_data_yearly.csv", index=False)

# 13. TABLE 4: the TYPICAL YEAR per point (average of 2020-2025)
annual_normal = (yearly.groupby("point_id")
                 .agg(lat=("lat", "first"), lon=("lon", "first"),
                      elevation_m=("elevation_m", "first"),
                      rain_mm=("rain_mm", "mean"),
                      tmean_c=("tmean_c", "mean"),
                      tmax_c=("tmax_c", "mean"),
                      tmin_c=("tmin_c", "mean"),
                      tmin_extreme_c=("tmin_extreme_c", "min"),
                      eto_mm=("eto_mm", "mean"),
                      balance_mm=("balance_mm", "mean"),
                      soil_wetness=("soil_wetness", "mean"),
                      ndvi=("ndvi", "mean"))
                 .reset_index().pipe(tidy))
annual_normal.to_csv(P + "app_data_annual_normal.csv", index=False)

print("\n✅ Yearly rows:", len(yearly), "(expected 192 x 6 = 1152)")
print("✅ Annual normal rows:", len(annual_normal), "(expected 192)")
print(annual_normal[["elevation_m", "tmean_c", "rain_mm"]].describe().round(1))