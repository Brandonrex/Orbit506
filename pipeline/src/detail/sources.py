"""Imagery sources behind one small interface, so other sensors / catalogues can slot in later.

A Source finds acquisitions over a bbox and loads one acquisition onto a given grid, returning the
CANONICAL bands (config.BANDS): reflectance as float32 (NaN = nodata) and `scl` as uint8 (0 = nodata).
The processing code never sees catalogue-specific band names or scaling.

Reflectance scaling (verified 2026-11 on the same scene, 16PHR 2026-11-10, read from both collections):
  * Earth Search `sentinel-2-c1-l2a` (ESA Collection 1) holds raw DN: reflectance = (DN - 1000) * 1e-4
    for processing baseline >= 04.00.
  * Earth Search legacy `sentinel-2-l2a` has `earthsearch:boa_offset_applied: true`: its DN are already
    1000 lower, yet its raster:bands still say offset -0.1. Trusting raster:bands there applies the
    offset twice. Hence the rule below reads the flag and the baseline, never raster:bands alone.
  * Planetary Computer `sentinel-2-l2a` holds raw DN, same rule as Collection 1.
"""
from __future__ import annotations

import logging
import random
import time
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Protocol, TypeVar

import numpy as np
import xarray as xr
from shapely.geometry import box, shape

from .config import BANDS, CONFIG, REFLECTANCE_BANDS, DetailConfig

log = logging.getLogger("detail")
T = TypeVar("T")

BOA_OFFSET_DN = -1000
REFLECTANCE_SCALE = 1e-4


def retry(fn: Callable[[], T], what: str, cfg: DetailConfig = CONFIG) -> T:
    """Call fn, retrying with exponential backoff + jitter (PC has had timeouts in 2026)."""
    for attempt in range(cfg.retries + 1):
        try:
            return fn()
        except Exception as e:  # network errors come in many types (requests, rasterio, aiohttp…)
            if attempt == cfg.retries:
                raise
            wait = cfg.backoff_s * 2**attempt * (1 + 0.25 * random.random())
            log.warning("%s failed (%s: %s); retry %d/%d in %.1fs", what, type(e).__name__, e, attempt + 1, cfg.retries, wait)
            time.sleep(wait)
    raise AssertionError("unreachable")


def boa_offset_dn(props: dict) -> int:
    """DN offset to add before scaling: -1000 for baseline >= 04.00, unless the provider already applied it."""
    if props.get("earthsearch:boa_offset_applied") is True:
        return 0
    try:
        baseline = float(props.get("s2:processing_baseline", "0"))
    except ValueError:
        baseline = 0.0
    return BOA_OFFSET_DN if baseline >= 4.0 else 0


def dn_to_reflectance(dn: np.ndarray, offset_dn: int) -> np.ndarray:
    """uint16 DN (0 = nodata) → float32 surface reflectance, NaN where nodata."""
    out = (dn.astype(np.float32) + offset_dn) * np.float32(REFLECTANCE_SCALE)
    out[dn == 0] = np.nan
    return out


@dataclass
class SceneGroup:
    """All catalogue items of one acquisition day over the property (overlapping MGRS tiles)."""

    date: str  # YYYY-MM-DD, solar day
    source: str
    items: list = field(default_factory=list)  # pystac.Item

    @property
    def item_ids(self) -> str:
        return ",".join(i.id for i in self.items)

    @property
    def cloud_cover(self) -> float | None:
        cc = [i.properties.get("eo:cloud_cover") for i in self.items]
        cc = [c for c in cc if c is not None]
        return float(np.mean(cc)) if cc else None


class Source(Protocol):
    name: str

    def search(self, bbox_ll: Sequence[float], date_from: date, date_to: date) -> list[SceneGroup]: ...

    def load(self, group: SceneGroup, geobox, fp) -> xr.Dataset: ...


def solar_day(item) -> str:
    dt: datetime = item.datetime
    lon = shape(item.geometry).centroid.x
    return (dt + timedelta(hours=lon / 15)).date().isoformat()


_rio_configured = False


def _configure_rio(cfg: DetailConfig) -> None:
    global _rio_configured
    if _rio_configured:
        return
    import odc.stac

    odc.stac.configure_rio(
        cloud_defaults=True,
        aws={"aws_unsigned": True},
        GDAL_HTTP_TIMEOUT=cfg.cog_timeout_s,
        GDAL_HTTP_CONNECTTIMEOUT=min(10, cfg.cog_timeout_s),
        GDAL_HTTP_MAX_RETRY=3,
        GDAL_HTTP_RETRY_DELAY=2,
    )
    _rio_configured = True


class StacSource:
    """A STAC API serving Sentinel-2 L2A COGs. Subclasses set the catalogue details."""

    name = "stac"
    url = ""
    collection = ""
    band_map: dict[str, str] = {b: b for b in BANDS}  # canonical → asset key

    def __init__(self, cfg: DetailConfig = CONFIG):
        self.cfg = cfg

    def sign_url(self, href: str) -> str:
        return href

    def modifier(self):
        return None

    def search(self, bbox_ll, date_from, date_to):
        from pystac_client import Client

        def go():
            client = Client.open(self.url, timeout=self.cfg.stac_timeout_s, modifier=self.modifier())
            s = client.search(
                collections=[self.collection],
                bbox=list(bbox_ll),
                datetime=f"{date_from.isoformat()}T00:00:00Z/{date_to.isoformat()}T23:59:59Z",
                query={"eo:cloud_cover": {"lt": self.cfg.max_scene_cloud}},
                limit=200,
            )
            return list(s.items())

        items = retry(go, f"{self.name} search")
        groups: dict[str, SceneGroup] = defaultdict(lambda: SceneGroup(date="", source=self.name))
        for it in items:
            g = groups[solar_day(it)]
            g.date = solar_day(it)
            g.items.append(it)
        return sorted(groups.values(), key=lambda g: g.date)

    def _pick_items(self, group: SceneGroup, epsg: int, bbox_ll) -> list:
        """Prefer one item in the output UTM zone that covers the whole window (no reprojection)."""
        win = box(*bbox_ll)
        for it in group.items:
            code = it.properties.get("proj:code") or f"EPSG:{it.properties.get('proj:epsg')}"
            if code == f"EPSG:{epsg}" and shape(it.geometry).contains(win):
                return [it]
        return list(group.items)

    def load(self, group: SceneGroup, geobox, fp) -> xr.Dataset:
        """Load one day onto `geobox` (the buffered window of footprint `fp`)."""
        import odc.stac

        _configure_rio(self.cfg)
        items = self._pick_items(group, fp.epsg, fp.bbox_ll)

        offsets = {boa_offset_dn(i.properties) for i in items}
        if len(offsets) > 1:  # never seen in practice; keep the items that match the first one
            first = boa_offset_dn(items[0].properties)
            items = [i for i in items if boa_offset_dn(i.properties) == first]
            log.warning("%s: mixed BOA offsets in one day; kept %d item(s)", group.date, len(items))
        offset = boa_offset_dn(items[0].properties)

        assets = [self.band_map[b] for b in BANDS]
        scl_key = self.band_map["scl"]

        def go():
            return odc.stac.load(
                items,
                bands=assets,
                geobox=geobox,
                groupby="solar_day",
                resampling={"*": "bilinear", scl_key: "nearest"},  # 20 m bands → 10 m; SCL stays categorical
                chunks=None,
                pool=4,
                patch_url=self.sign_url,
                fail_on_error=True,
            )

        raw = retry(go, f"{self.name} load {group.date}")
        raw = raw.isel(time=0) if "time" in raw.dims else raw
        out = {}
        for b in REFLECTANCE_BANDS:
            dn = raw[self.band_map[b]].values
            if dn.dtype.kind == "f":  # a catalogue that pre-scales would break the offset rule
                raise ValueError(f"{self.name}: band {b} came back as float; expected integer DN")
            out[b] = (("y", "x"), dn_to_reflectance(dn, offset))
        out["scl"] = (("y", "x"), raw[scl_key].values.astype(np.uint8))
        ds = xr.Dataset(out, coords={"y": raw.y.values, "x": raw.x.values})
        ds.attrs.update(offset_dn=offset, items=",".join(i.id for i in items), source=self.name)
        return ds


class EarthSearch(StacSource):
    name = "earth-search"
    url = "https://earth-search.aws.element84.com/v1"
    collection = "sentinel-2-c1-l2a"


class PlanetaryComputer(StacSource):
    name = "pc"
    url = "https://planetarycomputer.microsoft.com/api/stac/v1"
    collection = "sentinel-2-l2a"
    band_map = {"red": "B04", "nir": "B08", "nir08": "B8A", "rededge1": "B05", "swir16": "B11", "scl": "SCL"}

    def modifier(self):
        import planetary_computer

        return planetary_computer.sign_inplace

    def sign_url(self, href: str) -> str:
        import planetary_computer

        return planetary_computer.sign(href)


def default_sources(cfg: DetailConfig = CONFIG) -> list[Source]:
    return [EarthSearch(cfg), PlanetaryComputer(cfg)]
