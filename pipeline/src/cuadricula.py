# pipeline/src/cuadricula.py
"""Genera una cuadrícula de puntos sobre la provincia de Cartago."""
import numpy as np
import pandas as pd
from pathlib import Path

# 1. Rectángulo que cubre Cartago (aproximado: norte, sur, este y oeste)
LAT_MIN, LAT_MAX = 9.55, 10.05      # sur → norte
LON_MIN, LON_MAX = -84.10, -83.40   # oeste → este
PASO = 0.045                        # 0.045 grados ≈ 5 km

# 2. Crear las filas (latitudes) y las columnas (longitudes)
lats = np.arange(LAT_MIN, LAT_MAX + 1e-9, PASO)
lons = np.arange(LON_MIN, LON_MAX + 1e-9, PASO)

# 3. Poner un punto en cada cruce de fila y columna
puntos = []
for i, lat in enumerate(lats):
    for j, lon in enumerate(lons):
        puntos.append({"fila": i, "col": j,
                       "Latitude": round(lat, 4), "Longitude": round(lon, 4)})

df = pd.DataFrame(puntos)
df.insert(0, "ID", range(1, len(df) + 1))
df.insert(1, "Category", "p" + df["ID"].astype(str))

# 4. Guardar la cuadrícula completa (para la app)
proc = Path("pipeline/data/processed")
proc.mkdir(parents=True, exist_ok=True)
df.to_csv(proc / "cuadricula.csv", index=False)

# 5. Guardar las versiones para AppEEARS (solo las 4 columnas que pide)
appe = Path("pipeline/data/appeears")
appe.mkdir(parents=True, exist_ok=True)
cols = ["ID", "Category", "Latitude", "Longitude"]

# 5 km: todos los puntos (para NDVI y elevación)
df[cols].to_csv(appe / "puntos_5km.csv", index=False)

# 10 km: uno de cada dos puntos (para SMAP, que es más pesado y más grueso)
df_10 = df[(df["fila"] % 2 == 0) & (df["col"] % 2 == 0)]
df_10[cols].to_csv(appe / "puntos_10km.csv", index=False)

print("✅ Puntos cada 5 km:", len(df))
print("✅ Puntos cada 10 km:", len(df_10))
print(df.head())