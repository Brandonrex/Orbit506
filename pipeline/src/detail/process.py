"""Source-agnostic processing of one acquisition: cloud mask, indices, clip, zonal stats.

Input: an xr.Dataset with the canonical bands on the buffered window grid (see sources.py).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import rioxarray  # noqa: F401  (registers the .rio accessor)
import xarray as xr
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy.ndimage import binary_dilation
from shapely.geometry import mapping

from .config import CONFIG, INDEX_KEYS, INDICES, REFLECTANCE_BANDS, DetailConfig
from .geometry import Footprint



def window_geobox(fp: Footprint, resolution: float = 10.0):
    from odc.geo.geobox import GeoBox

    return GeoBox.from_bbox(fp.window_utm, crs=f"EPSG:{fp.epsg}", resolution=resolution, tight=True)


def grid_transform(ds: xr.Dataset, resolution: float):
    """Affine transform of a dataset whose x/y coords are pixel centres (north-up)."""
    x0 = float(ds.x.values[0]) - resolution / 2
    y0 = float(ds.y.values[0]) + resolution / 2
    return from_origin(x0, y0, resolution, resolution)


def clear_mask(ds: xr.Dataset, cfg: DetailConfig = CONFIG) -> np.ndarray:
    """True where the pixel is clear: SCL in the keep-set, all bands present, after dilating the invalid mask."""
    clear = np.isin(ds["scl"].values, cfg.scl_keep)
    for b in REFLECTANCE_BANDS:
        clear &= np.isfinite(ds[b].values)
    if cfg.dilate_px > 0:
        invalid = binary_dilation(~clear, structure=np.ones((3, 3), bool), iterations=cfg.dilate_px)
        clear = ~invalid
    return clear


def normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        out = (a - b) / (a + b)
    out = np.where(np.isfinite(out), out, np.nan)
    return np.clip(out, -1.0, 1.0).astype(np.float32)


def compute_indices(ds: xr.Dataset) -> dict[str, np.ndarray]:
    v = {b: ds[b].values for b in REFLECTANCE_BANDS}
    return {
        "ndvi": normalized_difference(v["nir"], v["red"]),
        "ndmi": normalized_difference(v["nir08"], v["swir16"]),
        "ndre": normalized_difference(v["nir08"], v["rededge1"]),
    }


@dataclass
class SceneResult:
    valid_pct: float  # % of polygon pixels that are clear
    n_polygon: int  # pixels inside the polygon
    indices: dict[str, xr.DataArray]  # clipped to the polygon (NaN outside / where not clear)
    inside: xr.DataArray  # 1 inside the polygon, NaN outside (same grid as indices)


def process_scene(ds: xr.Dataset, fp: Footprint, cfg: DetailConfig = CONFIG) -> SceneResult:
    res = cfg.resolution_m
    transform = grid_transform(ds, res)
    shape = (ds.sizes["y"], ds.sizes["x"])
    poly = rasterize([(mapping(fp.poly_utm), 1)], out_shape=shape, transform=transform, fill=0, dtype="uint8").astype(bool)
    n_poly = int(poly.sum())
    clear = clear_mask(ds, cfg)
    valid_pct = 100.0 * float((clear & poly).sum()) / n_poly if n_poly else 0.0

    def as_da(arr: np.ndarray) -> xr.DataArray:
        da = xr.DataArray(arr.astype(np.float32), dims=("y", "x"), coords={"y": ds.y, "x": ds.x})
        return da.rio.write_crs(f"EPSG:{fp.epsg}").rio.write_nodata(np.nan, encoded=False)

    geoms = [mapping(fp.poly_utm)]

    def clip(da: xr.DataArray) -> xr.DataArray:
        return da.rio.clip(geoms, crs=f"EPSG:{fp.epsg}", drop=True, all_touched=False, from_disk=False)

    indices = {k: clip(as_da(np.where(clear, v, np.nan))) for k, v in compute_indices(ds).items()}
    inside = clip(as_da(np.ones(shape, np.float32)))
    return SceneResult(valid_pct=valid_pct, n_polygon=n_poly, indices=indices, inside=inside)


def class_distribution(values: np.ndarray, classes: list[dict]) -> dict[str, float]:
    """% of values per class (min <= v < max, None = open end). Keys are the class labels, ordered low → high."""
    n = values.size
    out = {}
    for c in classes:
        sel = np.ones(n, bool)
        if c["min"] is not None:
            sel &= values >= c["min"]
        if c["max"] is not None:
            sel &= values < c["max"]
        out[c["label"]] = round(100.0 * float(sel.sum()) / n, 2) if n else 0.0
    return out


def zonal_stats(da: xr.DataArray, inside: xr.DataArray, index: str) -> dict:
    n_poly = int(np.isfinite(inside.values).sum())
    vals = da.values[np.isfinite(da.values)]
    n = int(vals.size)
    base = {"n_pixels": n, "valid_pct": round(100.0 * n / n_poly, 2) if n_poly else 0.0}
    if n == 0:
        return base | {"mean": None, "median": None, "p10": None, "p90": None, "std": None, "class_dist": {}}
    p10, med, p90 = np.percentile(vals, [10, 50, 90])
    return base | {
        "mean": float(vals.mean()),
        "median": float(med),
        "p10": float(p10),
        "p90": float(p90),
        "std": float(vals.std()),
        "class_dist": class_distribution(vals, INDICES[index]["classes"]),
    }


assert set(INDEX_KEYS) == set(INDICES)
