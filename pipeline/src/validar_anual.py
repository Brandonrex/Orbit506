# pipeline/src/validar_anual.py
"""Checks that the yearly tables are correct."""
import pandas as pd

P = "pipeline/data/processed/"
series = pd.read_csv(P + "app_data_series.csv")
yearly = pd.read_csv(P + "app_data_yearly.csv")
normal = pd.read_csv(P + "app_data_annual_normal.csv")

def check(name, ok, detail=""):
    print(("✅" if ok else "❌"), name, detail)

# ---------- TEST 1: Do the numbers add up? ----------
print("===== TEST 1: Do the numbers add up? =====")
check("Yearly table has 1152 rows", len(yearly) == 1152, f"({len(yearly)})")
check("Annual normal table has 192 rows", len(normal) == 192, f"({len(normal)})")

# Recalculate from the monthly series, independently
series["tmean_c"] = (series["tmax_c"] + series["tmin_c"]) / 2
redo = (series.groupby(["point_id", "year"])
        .agg(rain_redo=("rain_mm", "sum"), tmean_redo=("tmean_c", "mean"))
        .reset_index())
comp = yearly.merge(redo, on=["point_id", "year"])
check("Yearly rain = sum of its 12 months",
      (comp["rain_mm"] - comp["rain_redo"]).abs().max() < 1)
check("Yearly temperature = average of its 12 months",
      (comp["tmean_c"] - comp["tmean_redo"]).abs().max() < 0.05)

redo_normal = yearly.groupby("point_id")["tmean_c"].mean().reset_index(name="tmean_redo")
comp2 = normal.merge(redo_normal, on="point_id")
check("Typical year = average of the 6 years",
      (comp2["tmean_c"] - comp2["tmean_redo"]).abs().max() < 0.05)

# ---------- TEST 2: By hand, one point ----------
print("\n===== TEST 2: By hand, point 47, year 2023 =====")
m = series[(series["point_id"] == 47) & (series["year"] == 2023)]
print(m[["month_name", "tmax_c", "tmin_c", "tmean_c"]].round(2).to_string(index=False))
print(f"\nAverage of the 12 months, calculated here: {m['tmean_c'].mean():.2f} °C")
print(f"Value in app_data_yearly.csv:              "
      f"{yearly[(yearly['point_id'] == 47) & (yearly['year'] == 2023)]['tmean_c'].iloc[0]:.2f} °C")

# ---------- TEST 3: Does it make sense? ----------
print("\n===== TEST 3: Does it make sense? =====")
check("Temperatures between 0 and 35 °C", normal["tmean_c"].between(0, 35).all(),
      f"(from {normal['tmean_c'].min():.1f} to {normal['tmean_c'].max():.1f} °C)")
corr = normal["elevation_m"].corr(normal["tmean_c"])
check("Higher = colder (negative relationship)", corr < -0.8, f"(correlation {corr:.2f})")
low = normal.nsmallest(5, "elevation_m")
high = normal.nlargest(5, "elevation_m")
print(f"   5 lowest points  (~{low['elevation_m'].mean():.0f} m): {low['tmean_c'].mean():.1f} °C")
print(f"   5 highest points (~{high['elevation_m'].mean():.0f} m): {high['tmean_c'].mean():.1f} °C")