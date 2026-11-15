# pipeline/src/procesar_appeears.py
"""Cleans the AppEEARS files: elevation (NASADEM) and NDVI (MODIS MOD13Q1)."""
from pathlib import Path
import pandas as pd

folder = Path("pipeline/data/raw/appeears")
out = Path("pipeline/data/processed")
out.mkdir(parents=True, exist_ok=True)

def find_col(df, ending):
    """Returns the column whose name ends with this text."""
    found = [c for c in df.columns if c.replace(" ", "").endswith(ending)]
    if not found:
        raise KeyError(f"No column ends with: {ending}")
    return found[0]

# ---------- 1. ELEVATION ----------
dem = pd.read_csv(next(folder.glob("*NASADEM*-results.csv")))
c_hgt = find_col(dem, "NASADEM_HGT")
elev = dem[["ID", c_hgt]].rename(columns={"ID": "point_id", c_hgt: "elevation_m"})
elev.to_csv(out / "elevation.csv", index=False)
print("⛰️ Elevation:", len(elev), "points, from", elev["elevation_m"].min(),
      "to", elev["elevation_m"].max(), "m")

# ---------- 2. NDVI ----------
nd = pd.read_csv(next(folder.glob("*MOD13Q1*-results.csv")), parse_dates=["Date"])
c_ndvi = find_col(nd, "250m_16_days_NDVI")
c_modland = find_col(nd, "VI_Quality_MODLAND")
c_clouds = find_col(nd, "VI_Quality_Mixed_Clouds")

print("\nQuality values (MODLAND):")
print(nd[c_modland].value_counts())
print("\nMixed clouds values:")
print(nd[c_clouds].value_counts())

nd = nd.rename(columns={"ID": "point_id", c_ndvi: "ndvi"})
total = len(nd)

# a) Remove the "no data" code (-3000): a real NDVI is always between -1 and 1
nd = nd[nd["ndvi"].between(-1, 1)]
# b) Remove values marked as cloudy or not produced
nd = nd[~nd[c_modland].astype(str).isin(["0b10", "0b11"])]
nd = nd[nd[c_clouds].astype(str) != "0b1"]
print(f"\n🧹 NDVI kept: {len(nd)} of {total} ({len(nd) / total:.0%})")

# c) 2020-2025 only, averaged by month
nd = nd[nd["Date"] >= "2020-01-01"].copy()
nd["year"] = nd["Date"].dt.year
nd["month"] = nd["Date"].dt.month
monthly = (nd.groupby(["point_id", "year", "month"])
             .agg(ndvi=("ndvi", "mean"), ndvi_obs=("ndvi", "size"))
             .round(3).reset_index())
monthly.to_csv(out / "ndvi_monthly.csv", index=False)

print("🌱 NDVI monthly rows:", len(monthly), "(max possible 192 x 72 = 13824)")
print(monthly["ndvi"].describe().round(3))