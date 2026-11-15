# pipeline/src/power_cuadricula.py
"""Baja el clima de NASA POWER para los puntos de 10 km y lo resume por mes."""
import time
import pandas as pd
from pathlib import Path

from power import fetch_power

# 1. Leer los 49 puntos de 10 km
puntos = pd.read_csv("pipeline/data/appeears/puntos_10km.csv")

tablas = []
fallidos = []

# 2. Pedir el clima de cada punto (con un reintento si falla)
for _, p in puntos.iterrows():
    print(f"⬇️  Punto {p['ID']} ({p['Latitude']}, {p['Longitude']})...")
    for intento in range(2):
        try:
            df = fetch_power(p["Latitude"], p["Longitude"], "20200101", "20251231")
            break                               # funcionó: salir del reintento
        except Exception as e:
            print("   ⚠️ Error, reintentando:", e)
            time.sleep(5)
    else:                                       # falló las 2 veces
        fallidos.append(p["ID"])
        continue

    elev = df.attrs.get("elev_power")
    df["punto_id"] = p["ID"]
    df["lat"] = p["Latitude"]
    df["lon"] = p["Longitude"]
    df["elev_power"] = elev
    tablas.append(df)
    time.sleep(1)                               # pausa para no saturar la API

# 3. Guardar los datos diarios (crudos)
diario = pd.concat(tablas).reset_index()
Path("pipeline/data/raw").mkdir(parents=True, exist_ok=True)
diario.to_csv("pipeline/data/raw/power_10km_diario.csv", index=False)

# 4. Resumir por mes: una fila por punto y por mes
mensual = (
    diario.groupby(["punto_id", "lat", "lon", "elev_power",
                    pd.Grouper(key="date", freq="MS")], dropna=False)
    .agg(
        lluvia_mm=("PRECTOTCORR", "sum"),        # lluvia total del mes
        tmax_c=("T2M_MAX", "mean"),              # promedio de las máximas
        tmin_c=("T2M_MIN", "mean"),              # promedio de las mínimas
        tmin_extrema_c=("T2M_MIN", "min"),       # la noche más fría del mes
        rad_toa=("TOA_SW_DWN", "mean"),          # radiación en el tope de la atmósfera
        rad_suelo=("ALLSKY_SFC_SW_DWN", "mean"), # radiación que llega al suelo
        humedad_raiz=("GWETROOT", "mean"),       # humedad del suelo (0 a 1)
    )
    .round(2)
    .reset_index()
)
Path("pipeline/data/processed").mkdir(parents=True, exist_ok=True)
mensual.to_csv("pipeline/data/processed/power_10km_mensual.csv", index=False)

# 5. Resumen
print("\n✅ Puntos descargados:", diario["punto_id"].nunique())
print("❌ Puntos que fallaron:", fallidos)
print("Filas diarias:", len(diario))
print("Filas mensuales:", len(mensual))
print("Cuadros distintos de NASA POWER (por altura):",
      diario.groupby("punto_id")["elev_power"].first().nunique())
print(mensual.head())