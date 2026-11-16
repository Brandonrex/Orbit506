"""Cloud-Optimized GeoTIFF writer for clipped index layers."""
from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
import rasterio
import xarray as xr
from rasterio.io import MemoryFile
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles

NODATA = -9999.0


def write_cog(da: xr.DataArray, path: Path, tags: dict | None = None) -> dict:
    """Write a float32 single-band COG (DEFLATE, float predictor, internal overviews). Returns min/max/crs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    arr = da.values.astype(np.float32)
    finite = np.isfinite(arr)
    data = np.where(finite, arr, NODATA).astype(np.float32)
    h, w = data.shape
    profile = {
        "driver": "GTiff",
        "dtype": "float32",
        "count": 1,
        "height": h,
        "width": w,
        "crs": da.rio.crs,
        "transform": da.rio.transform(),
        "nodata": NODATA,
    }
    # Small rasters: at least one overview level so the file really carries internal overviews.
    levels = max(1, math.ceil(math.log2(max(h, w) / 32))) if max(h, w) >= 32 else 0
    dst_profile = cog_profiles.get("deflate") | {"predictor": 3, "blockxsize": 256, "blockysize": 256}
    tmp = path.with_suffix(".tmp.tif")
    with MemoryFile() as mem:
        with mem.open(**profile) as src:
            src.write(data, 1)
            if tags:
                src.update_tags(**{k: str(v) for k, v in tags.items()})
        with mem.open() as src:
            cog_translate(
                src,
                tmp,
                dst_profile,
                nodata=NODATA,
                overview_level=levels,
                overview_resampling="average",
                in_memory=True,
                allow_intermediate_compression=True,  # else GDAL warns that PREDICTOR needs compression
                quiet=True,
            )
    os.replace(tmp, path)
    return {
        "min": float(arr[finite].min()) if finite.any() else None,
        "max": float(arr[finite].max()) if finite.any() else None,
        "crs": str(da.rio.crs),
    }


def read_cog_info(path: Path) -> dict:
    with rasterio.open(path) as src:
        return {"crs": str(src.crs), "bounds": tuple(src.bounds), "overviews": src.overviews(1), "nodata": src.nodata}
