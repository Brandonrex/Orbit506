"""Polygon helpers: stable hash, UTM zone, buffered load window."""
import hashlib
import json
from dataclasses import dataclass

from pyproj import Geod, Transformer
import shapely
from shapely.geometry import Polygon, mapping, shape

GEOD = Geod(ellps="WGS84")


def geom_hash(geojson: dict) -> str:
    """Hash of the polygon rings, coordinates rounded to ~1 cm (7 decimals). Same shape → same hash."""
    rings = [[[round(float(x), 7), round(float(y), 7)] for x, y, *_ in ring] for ring in geojson["coordinates"]]
    return hashlib.sha256(json.dumps(rings, separators=(",", ":")).encode()).hexdigest()[:16]


def utm_epsg(lon: float, lat: float) -> int:
    """UTM zone of a point (Cartago: mostly 32617, the western edge 32616)."""
    zone = min(int((lon + 180) // 6) + 1, 60)
    return (32600 if lat >= 0 else 32700) + zone


def area_ha(geojson: dict) -> float:
    area, _ = GEOD.geometry_area_perimeter(shape(geojson))
    return abs(area) / 1e4


@dataclass(frozen=True)
class Footprint:
    """A property polygon prepared for loading."""

    geojson: dict  # EPSG:4326
    epsg: int  # output UTM CRS
    poly_utm: Polygon  # unbuffered, in the UTM CRS (for clipping and stats)
    window_utm: tuple[float, float, float, float]  # buffered bbox in UTM, snapped to the 10 m grid
    bbox_ll: tuple[float, float, float, float]  # buffered bbox in lon/lat (STAC search)
    area_ha: float
    hash: str


def footprint(geojson: dict, buffer_m: float = 50.0, resolution: float = 10.0) -> Footprint:
    poly = shape(geojson)
    c = poly.centroid
    epsg = utm_epsg(c.x, c.y)
    to_utm = Transformer.from_crs(4326, epsg, always_xy=True).transform
    to_ll = Transformer.from_crs(epsg, 4326, always_xy=True).transform
    poly_utm = shapely.transform(poly, lambda x, y: to_utm(x, y), interleaved=False)
    buf = poly_utm.buffer(buffer_m)
    minx, miny, maxx, maxy = buf.bounds
    r = resolution
    window = (r * (minx // r), r * (miny // r), r * -(-maxx // r), r * -(-maxy // r))
    bbox_ll = shapely.transform(buf, lambda x, y: to_ll(x, y), interleaved=False).bounds
    return Footprint(
        geojson=mapping(poly),
        epsg=epsg,
        poly_utm=poly_utm,
        window_utm=window,
        bbox_ll=bbox_ll,
        area_ha=area_ha(geojson),
        hash=geom_hash(geojson),
    )
