"""M5: monthly composites, days since clear, point lookup, TTL purge (fake catalogue, no network)."""
from datetime import date, timedelta

import numpy as np
import pytest
import rasterio

from app import db
from app.detail_api import jobs, store
from detail.composites import build_composites, month_end
from detail.config import detail_root

from .detail_fakes import FakeSource
from .test_detail_api import PLOT, _decode_png, _tile_of, create

TODAY = date.today()
CENTER = (-83.81555, 9.91145)


def first_of_month(months_back: int) -> date:
    d = TODAY.replace(day=1)
    for _ in range(months_back):
        d = (d - timedelta(days=1)).replace(day=1)
    return d


# Two days in an earlier month (NDVI 0.4 and 0.8 → median 0.6), one in the month after.
M1 = first_of_month(3)
M2 = first_of_month(2)
DAYS = [(M1 + timedelta(days=4)).isoformat(), (M1 + timedelta(days=14)).isoformat(), (M2 + timedelta(days=9)).isoformat()]


class TwoLevels(FakeSource):
    """NDVI 0.4 on the first day, 0.8 afterwards."""

    def load(self, group, geobox, fp):
        self.ndvi = 0.4 if group.date == self.days[0] else 0.8
        return super().load(group, geobox, fp)


@pytest.fixture
def fake():
    src = TwoLevels(days=DAYS)
    jobs.RUNNER.sources_factory = lambda: [src]
    return src


def test_month_end():
    assert month_end("2026-02") == date(2026, 2, 28)
    assert month_end("2025-12") == date(2025, 12, 31)


def test_composites_endpoint_and_files(client, fake):
    p = create(client)
    comps = client.get(f"/api/properties/{p['id']}/detail/composites").json()
    assert [c["period"] for c in comps] == [DAYS[0][:7], DAYS[2][:7], "latest"]
    assert [c["nDays"] for c in comps] == [2, 1, 3]
    assert set(comps[0]["assets"]) == {"ndvi", "ndmi", "ndre", "days_since_clear"}
    assert set(comps[2]["assets"]) == {"days_since_clear"}

    folder = detail_root() / str(p["id"]) / "composites"
    with rasterio.open(folder / DAYS[0][:7] / "ndvi.tif") as src:
        a = src.read(1, masked=True)
        assert a.count() > 0 and np.allclose(a.compressed(), 0.6, atol=1e-4)  # median of 0.4 and 0.8
    with rasterio.open(folder / DAYS[0][:7] / "days_since_clear.tif") as src:
        dsc = src.read(1, masked=True).compressed()
        assert np.all(dsc == (month_end(DAYS[0][:7]) - date.fromisoformat(DAYS[1])).days)
    with rasterio.open(folder / "latest" / "days_since_clear.tif") as src:
        assert np.all(src.read(1, masked=True).compressed() == (TODAY - date.fromisoformat(DAYS[2])).days)


def test_composite_tiles_and_point(client, fake):
    p = create(client)
    z, x, y = _tile_of(*CENTER, 17)
    month = DAYS[0][:7]
    for layer, period in (("ndvi", month), ("days_since_clear", month), ("days_since_clear", "latest")):
        r = client.get(f"/api/properties/{p['id']}/detail/tiles/{layer}/{period}/{z}/{x}/{y}.png")
        assert r.status_code == 200, (layer, period, r.text)
        assert (_decode_png(r.content)[3] > 0).any()
    # days_since_clear exists for composites only
    assert client.get(f"/api/properties/{p['id']}/detail/tiles/days_since_clear/{DAYS[0]}/{z}/{x}/{y}.png").status_code == 404

    pt = client.get(f"/api/properties/{p['id']}/detail/point", params={"lon": CENTER[0], "lat": CENTER[1], "date": DAYS[1]}).json()
    assert pt["inside"] is True
    assert list(pt["values"]) == ["ndvi", "ndmi", "ndre"]
    assert pt["values"]["ndvi"]["value"] == pytest.approx(0.8, abs=1e-3)
    assert pt["values"]["ndvi"]["classLabel"] == "Very dense"
    pt = client.get(f"/api/properties/{p['id']}/detail/point", params={"lon": CENTER[0], "lat": CENTER[1], "date": month}).json()
    assert list(pt["values"]) == ["ndvi", "ndmi", "ndre", "days_since_clear"]
    assert pt["values"]["ndvi"]["classLabel"] == "Healthy"  # 0.6
    out = client.get(f"/api/properties/{p['id']}/detail/point", params={"lon": -83.5, "lat": 9.5, "date": DAYS[1]}).json()
    assert out["inside"] is False and all(v["value"] is None for v in out["values"].values())
    assert client.get(f"/api/properties/{p['id']}/detail/point", params={"lon": 0, "lat": 0, "date": "1999-01-01"}).status_code == 404


def test_incremental_job_rebuilds_composites(client, fake):
    p = create(client)
    new_day = (TODAY - timedelta(days=1)).isoformat()
    fake.days.append(new_day)
    client.post(f"/api/properties/{p['id']}/detail/refresh")
    jobs.RUNNER.wait_idle()
    periods = [c["period"] for c in client.get(f"/api/properties/{p['id']}/detail/composites").json()]
    assert new_day[:7] in periods
    latest = detail_root() / str(p["id"]) / "composites" / "latest" / "days_since_clear.tif"
    with rasterio.open(latest) as src:
        assert np.all(src.read(1, masked=True).compressed() == 1)


def test_build_composites_empty(tmp_path):
    assert build_composites(tmp_path, []) == []


def test_ttl_purge(client, fake, monkeypatch):
    p = create(client)
    folder = detail_root() / str(p["id"])
    assert folder.is_dir()
    conn = db.connect()
    try:
        assert store.purge_untouched(conn, 30) == 0  # just saved
        conn.execute("UPDATE properties SET detail_touched_at = '2000-01-01T00:00:00.000+00:00'")
        conn.commit()
        assert store.purge_untouched(conn, 30) == 1
        assert conn.execute("SELECT COUNT(*) FROM detail_assets").fetchone()[0] == 0
    finally:
        conn.close()
    assert not folder.exists()
    assert client.get(f"/api/properties/{p['id']}").status_code == 200  # the property itself stays


def test_indices_include_days_since_clear(client):
    keys = [i["key"] for i in client.get("/api/detail/indices").json()]
    assert keys == ["ndvi", "ndmi", "ndre", "days_since_clear"]


def test_plot_constant():
    assert PLOT["type"] == "Polygon"
