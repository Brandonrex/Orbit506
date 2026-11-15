# pipeline/src/power.py
"""Funciones para descargar clima diario de NASA POWER para un punto."""
import requests
import pandas as pd
from pathlib import Path

BASE_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"

# Variables que pedimos a NASA POWER
PARAMS = [
    "T2M",                # temperatura promedio (°C)
    "T2M_MAX",            # temperatura máxima (°C)
    "T2M_MIN",            # temperatura mínima (°C)
    "PRECTOTCORR",        # lluvia (mm/día)
    "RH2M",               # humedad del aire (%)
    "ALLSKY_SFC_SW_DWN",  # radiación solar que llega al suelo
    "TOA_SW_DWN",         # radiación en el tope de la atmósfera (para calcular ETo)
    "GWETROOT",           # humedad del suelo en las raíces (0 = seco, 1 = saturado)
]

def fetch_power(lat, lon, start, end, mostrar_unidades=False):
    """Pide los datos a la API. start/end en formato AAAAMMDD."""
    query = {
        "parameters": ",".join(PARAMS),
        "community": "AG",
        "latitude": lat,
        "longitude": lon,
        "start": start,
        "end": end,
        "format": "JSON",
    }
    r = requests.get(BASE_URL, params=query, timeout=120)
    r.raise_for_status()                      # si la API falla, muestra el error
    js = r.json()

    if mostrar_unidades:                      # imprime la unidad de cada variable
        print("\n📏 Unidades:")
        for p in PARAMS:
            print(f"  {p}: {js['parameters'][p]['units']}")

    df = pd.DataFrame(js["properties"]["parameter"])
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df.index.name = "date"
    df = df.replace(-999, float("nan"))       # -999 = dato faltante en POWER
    # Altura del cuadro de NASA POWER (para corregir la temperatura después)
    coords = js.get("geometry", {}).get("coordinates", [])
    df.attrs["elev_power"] = coords[2] if len(coords) > 2 else None
    return df

if __name__ == "__main__":
    # Prueba con un punto en Tierra Blanca, Cartago
    df = fetch_power(lat=9.92, lon=-83.89, start="20150101", end="20251231",
                     mostrar_unidades=True)
    out = Path("pipeline/data/raw/power_prueba_cartago.csv")
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out)
    print("\nFilas:", len(df))
    print(df.describe().round(1))