# pipeline/src/inspeccionar_appeears.py
"""Muestra cómo vienen los archivos de AppEEARS (columnas, filas y valores)."""
from pathlib import Path
import pandas as pd

carpeta = Path("pipeline/data/raw/appeears")
archivos = sorted(carpeta.glob("*-results.csv"))
print("Archivos encontrados:", len(archivos))

for f in archivos:
    df = pd.read_csv(f)
    print("\n" + "=" * 70)
    print("📄", f.name)
    print("Filas:", len(df), "| Puntos distintos:", df["ID"].nunique())
    if "Date" in df.columns:
        print("Fechas: de", df["Date"].min(), "a", df["Date"].max())
    print("\nColumnas:")
    for c in df.columns:
        print("  -", c)
    # Mostrar solo las columnas de datos que nos interesan
    datos = [c for c in df.columns if "NDVI" in c or "HGT" in c or "elev" in c.lower()]
    datos = [c for c in datos if "Quality" not in c and "QA" not in c]
    print("\nColumnas de datos:", datos)
    if datos:
        print(df[datos].describe().round(3))