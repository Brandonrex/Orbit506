"""Geometry checks and geodesic area (WGS84), matching what the web app computes with Turf."""
from dataclasses import dataclass

from pyproj import Geod
from shapely.geometry import Polygon, shape
from shapely.validation import explain_validity

GEOD = Geod(ellps="WGS84")


class GeometryError(ValueError):
    def __init__(self, reason: str, detail: str = ""):
        super().__init__(detail or reason)
        self.reason = reason  # 'invalid' | 'self-intersection'


@dataclass
class CheckedPolygon:
    geometry: dict  # cleaned GeoJSON: 2D, rings closed
    area_m2: float
    bbox: tuple[float, float, float, float]  # min_lon, min_lat, max_lon, max_lat


def check_polygon(geojson: dict) -> CheckedPolygon:
    rings = []
    for ring in geojson.get("coordinates") or []:
        pts = [(float(p[0]), float(p[1])) for p in ring if len(p) >= 2]
        if pts and pts[0] != pts[-1]:
            pts.append(pts[0])
        rings.append(pts)
    if not rings or len(rings[0]) < 4:
        raise GeometryError("invalid", "A polygon needs at least 3 distinct points")
    for lon, lat in rings[0]:
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise GeometryError("invalid", "Coordinates must be lon/lat degrees (EPSG:4326)")

    clean = {"type": "Polygon", "coordinates": [[list(p) for p in r] for r in rings]}
    poly = shape(clean)
    if not isinstance(poly, Polygon) or poly.is_empty:
        raise GeometryError("invalid")
    if not poly.is_valid:
        why = explain_validity(poly)
        reason = "self-intersection" if "intersection" in why.lower() else "invalid"
        raise GeometryError(reason, why)

    area, _ = GEOD.geometry_area_perimeter(poly)
    return CheckedPolygon(geometry=clean, area_m2=abs(area), bbox=poly.bounds)
