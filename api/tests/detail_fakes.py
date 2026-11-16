"""Offline stand-ins for the imagery catalogues: synthetic Sentinel-2 scenes on the real load grid."""
from types import SimpleNamespace

import numpy as np
import xarray as xr

import app.detail_api  # noqa: F401  (puts pipeline/src on sys.path)
from detail.sources import SceneGroup


def synthetic_scene(geobox, *, ndvi: float = 0.6, cloud_rows: int = 0, scl: int = 4) -> xr.Dataset:
    """Uniform field with NDVI = `ndvi`; the top `cloud_rows` rows are cloud (SCL 9)."""
    h, w = geobox.shape
    a = geobox.affine
    x = a.c + (np.arange(w) + 0.5) * a.a
    y = a.f + (np.arange(h) + 0.5) * a.e
    red = 0.05
    nir = red * (1 + ndvi) / (1 - ndvi)
    full = lambda v: np.full((h, w), v, np.float32)  # noqa: E731
    s = np.full((h, w), scl, np.uint8)
    s[:cloud_rows] = 9
    return xr.Dataset(
        {
            "red": (("y", "x"), full(red)),
            "nir": (("y", "x"), full(nir)),
            "nir08": (("y", "x"), full(nir)),
            "rededge1": (("y", "x"), full(0.15)),
            "swir16": (("y", "x"), full(0.1)),
            "scl": (("y", "x"), s),
        },
        coords={"y": y, "x": x},
    )


class FakeSource:
    """Returns the given days. `cloudy` days are fully clouded; `broken` days raise on load."""

    name = "fake"

    def __init__(self, days=(), cloudy=(), broken=(), ndvi=0.6, fail_search=False):
        self.days, self.cloudy, self.broken, self.ndvi, self.fail_search = list(days), set(cloudy), set(broken), ndvi, fail_search
        self.searches, self.loads = [], []

    def search(self, bbox_ll, date_from, date_to):
        self.searches.append((date_from, date_to))
        if self.fail_search:
            raise TimeoutError("catalogue timed out")
        out = []
        for d in self.days:
            if date_from.isoformat() <= d <= date_to.isoformat():
                item = SimpleNamespace(id=f"FAKE_{d}", properties={"eo:cloud_cover": 50.0 if d in self.cloudy else 5.0})
                out.append(SceneGroup(date=d, source=self.name, items=[item]))
        return out

    def load(self, group, geobox, fp):
        self.loads.append(group.date)
        if group.date in self.broken:
            raise OSError("COG read timed out")
        h = geobox.shape[0]
        return synthetic_scene(geobox, ndvi=self.ndvi, cloud_rows=h if group.date in self.cloudy else 0)
