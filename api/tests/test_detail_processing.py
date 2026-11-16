"""Offline unit tests for pipeline/src/detail (no network)."""
import numpy as np
import pytest
import rasterio
from rio_cogeo.cogeo import cog_validate

import app.detail_api  # noqa: F401
from detail.config import CONFIG, INDICES
from detail.geometry import footprint, geom_hash, utm_epsg
from detail.outputs import NODATA, write_cog
from detail.process import class_distribution, clear_mask, normalized_difference, process_scene, window_geobox, zonal_stats
from detail.sources import boa_offset_dn, dn_to_reflectance

from .detail_fakes import synthetic_scene

# ~10 ha plot near Pacayas (0.0029° ≈ 320 m)
PLOT = {
    "type": "Polygon",
    "coordinates": [[[-83.817, 9.91], [-83.8141, 9.91], [-83.8141, 9.9129], [-83.817, 9.9129], [-83.817, 9.91]]],
}


# ---------- reflectance scaling ----------
@pytest.mark.parametrize(
    ("props", "offset"),
    [
        ({"s2:processing_baseline": "05.13"}, -1000),  # Earth Search C1 / Planetary Computer, 2022+
        ({"s2:processing_baseline": "05.13", "earthsearch:boa_offset_applied": True}, 0),  # legacy ES: already applied
        ({"s2:processing_baseline": "03.01"}, 0),  # before 2022-01-25
        ({"s2:processing_baseline": "04.00"}, -1000),
        ({}, 0),
    ],
)
def test_boa_offset_rule(props, offset):
    assert boa_offset_dn(props) == offset


def test_dn_to_reflectance():
    dn = np.array([[0, 1000, 1572, 5699]], np.uint16)
    r = dn_to_reflectance(dn, -1000)
    assert np.isnan(r[0, 0])
    assert r[0, 1:] == pytest.approx([0.0, 0.0572, 0.4699], abs=1e-6)
    # The legacy collection stores DN already 1000 lower: same reflectance with offset 0.
    assert dn_to_reflectance(np.array([[572]], np.uint16), 0)[0, 0] == pytest.approx(0.0572, abs=1e-6)


# ---------- geometry ----------
def test_utm_zone():
    assert utm_epsg(-83.85, 9.9) == 32617
    assert utm_epsg(-84.05, 9.9) == 32616


def test_geom_hash_stable():
    same = {"type": "Polygon", "coordinates": [[[x + 1e-9, y] for x, y in PLOT["coordinates"][0]]]}
    moved = {"type": "Polygon", "coordinates": [[[x + 1e-4, y] for x, y in PLOT["coordinates"][0]]]}
    assert geom_hash(PLOT) == geom_hash(same) != geom_hash(moved)


def test_footprint_window():
    fp = footprint(PLOT, buffer_m=50)
    assert fp.epsg == 32617
    assert fp.area_ha == pytest.approx(10.1, rel=0.03)
    minx, miny, maxx, maxy = fp.window_utm
    assert all(v % 10 == 0 for v in fp.window_utm)
    pminx, pminy, pmaxx, pmaxy = fp.poly_utm.bounds
    assert minx <= pminx - 50 and maxx >= pmaxx + 50 and miny <= pminy - 50 and maxy >= pmaxy + 50


# ---------- mask and indices ----------
def test_mask_dilation():
    gb = window_geobox(footprint(PLOT))
    ds = synthetic_scene(gb)
    ds["scl"].values[20, 20] = 9  # one cloud pixel
    clear = clear_mask(ds)
    d = CONFIG.dilate_px
    assert (~clear).sum() == (2 * d + 1) ** 2
    assert not clear[20 - d : 21 + d, 20 - d : 21 + d].any()


def test_mask_rejects_missing_band():
    gb = window_geobox(footprint(PLOT))
    ds = synthetic_scene(gb)
    ds["swir16"].values[5, 5] = np.nan
    assert not clear_mask(ds)[5, 5]


def test_normalized_difference():
    a = np.array([0.5, 0.0, 0.3], np.float32)
    b = np.array([0.1, 0.0, 0.3], np.float32)
    out = normalized_difference(a, b)
    assert out[0] == pytest.approx(0.4 / 0.6)
    assert np.isnan(out[1])
    assert out[2] == 0


def test_process_scene_clear_and_clipped():
    fp = footprint(PLOT)
    gb = window_geobox(fp)
    res = process_scene(synthetic_scene(gb, ndvi=0.6), fp)
    assert res.valid_pct == 100
    ndvi = res.indices["ndvi"]
    vals = ndvi.values[np.isfinite(ndvi.values)]
    assert vals == pytest.approx(0.6, abs=1e-5)
    assert vals.size == res.n_polygon  # every polygon pixel valid, nothing outside it
    # Clipped extent is the polygon's bbox (± one pixel), not the 50 m buffered window
    b = ndvi.rio.bounds()
    pb = fp.poly_utm.bounds
    assert all(abs(x - y) <= 10 for x, y in zip(b, pb))
    assert str(ndvi.rio.crs) == "EPSG:32617"
    # nir08 = 0.2, swir16 = 0.1, rededge1 = 0.15 in the synthetic scene
    assert np.nanmean(res.indices["ndmi"].values) == pytest.approx(0.1 / 0.3, abs=1e-5)
    assert np.nanmean(res.indices["ndre"].values) == pytest.approx(0.05 / 0.35, abs=1e-5)


def test_process_scene_partly_cloudy():
    fp = footprint(PLOT)
    gb = window_geobox(fp)
    h = gb.shape[0]
    res = process_scene(synthetic_scene(gb, cloud_rows=h // 2), fp)
    assert 10 < res.valid_pct < 60  # below the threshold → would be recorded as cloudy


def test_class_distribution_boundaries():
    classes = INDICES["ndvi"]["classes"]
    v = np.array([-0.1, 0.0, 0.2, 0.39, 0.4, 0.6, 0.8, 0.95])
    d = class_distribution(v, classes)
    assert list(d) == [c["label"] for c in classes]
    assert d == {
        "Water / non-veg": 12.5,
        "Bare soil": 12.5,
        "Severe stress / sparse": 25.0,
        "Moderate": 12.5,
        "Healthy": 12.5,
        "Very dense": 25.0,
    }
    assert sum(d.values()) == pytest.approx(100)


def test_zonal_stats():
    fp = footprint(PLOT)
    res = process_scene(synthetic_scene(window_geobox(fp), ndvi=0.7), fp)
    s = zonal_stats(res.indices["ndvi"], res.inside, "ndvi")
    assert s["mean"] == pytest.approx(0.7, abs=1e-5) and s["p10"] == pytest.approx(0.7, abs=1e-5)
    assert s["valid_pct"] == 100 and s["n_pixels"] == res.n_polygon
    assert s["class_dist"]["Healthy"] == 100


def test_write_cog(tmp_path):
    fp = footprint(PLOT)
    res = process_scene(synthetic_scene(window_geobox(fp)), fp)
    path = tmp_path / "2026-01-01" / "ndvi.tif"
    info = write_cog(res.indices["ndvi"], path)
    ok, errors, _ = cog_validate(str(path), quiet=True)
    assert ok, errors
    with rasterio.open(path) as src:
        assert src.crs.to_epsg() == 32617
        assert src.dtypes[0] == "float32" and src.nodata == NODATA
        assert src.compression.name == "deflate"
        assert src.overviews(1)
        a = src.read(1, masked=True)
        assert -1 <= a.min() <= a.max() <= 1
    assert info["min"] == pytest.approx(0.6, abs=1e-5)
