"""On-demand Sentinel-2 L2A (10 m) detail for one property polygon.

config.py    settings, index definitions and classes
geometry.py  hash, UTM zone, buffered window
sources.py   STAC catalogues (Earth Search, Planetary Computer fallback) behind one interface
process.py   cloud mask, indices, clip, zonal stats (source-agnostic)
outputs.py   COG writer
run.py       orchestration + CLI
"""
