"""Detail layer through the API, with a fake catalogue (no network)."""
from datetime import date, timedelta

import pytest

from app import db
from app.detail_api import jobs
from detail.config import detail_root

from .detail_fakes import FakeSource

TODAY = date.today()


def day(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


PLOT = {
    "type": "Polygon",
    "coordinates": [[[-83.817, 9.91], [-83.8141, 9.91], [-83.8141, 9.9129], [-83.817, 9.9129], [-83.817, 9.91]]],
}
MOVED = {"type": "Polygon", "coordinates": [[[x + 0.001, y] for x, y in PLOT["coordinates"][0]]]}
# ~0.5° square ≈ 300,000 ha
HUGE = {"type": "Polygon", "coordinates": [[[-84.0, 9.6], [-83.5, 9.6], [-83.5, 10.1], [-84.0, 10.1], [-84.0, 9.6]]]}


@pytest.fixture
def fake():
    src = FakeSource(days=[day(30), day(20), day(10)], cloudy={day(20)})
    jobs.RUNNER.sources_factory = lambda: [src]
    return src


def create(client, geometry=PLOT):
    r = client.post("/api/properties", json={"name": "Finca", "geometry": geometry})
    assert r.status_code == 201, r.text
    jobs.RUNNER.wait_idle()
    return r.json()


def test_save_runs_full_job(client, fake):
    p = create(client)
    assert p["detailJob"]["status"] == "queued"
    st = client.get(f"/api/properties/{p['id']}/detail/status").json()
    job = st["job"]
    assert job["status"] == "done" and job["kind"] == "full" and job["progress"] == 1
    assert job["dateFrom"] == day(365) and job["dateTo"] == TODAY.isoformat()
    assert (job["scenesFound"], job["scenesDone"], job["scenesValid"]) == (3, 3, 2)
    assert st["scenesValid"] == 2 and st["scenesCloudy"] == 1
    assert st["lastClearDate"] == day(10) and st["daysSinceClear"] == 10
    assert st["attribution"].startswith("Contains modified Copernicus Sentinel data")

    scenes = client.get(f"/api/properties/{p['id']}/detail/scenes").json()
    assert [(s["date"], s["status"]) for s in scenes] == [(day(30), "valid"), (day(20), "cloudy"), (day(10), "valid")]
    assert scenes[1]["validPct"] == 0 and scenes[1]["assets"] == {}
    assert set(scenes[0]["assets"]) == {"ndvi", "ndmi", "ndre"}

    stats = client.get(f"/api/properties/{p['id']}/detail/stats", params={"index": "ndvi"}).json()
    assert [s["date"] for s in stats] == [day(30), day(10)]
    assert stats[0]["mean"] == pytest.approx(0.6, abs=1e-5) and stats[0]["validPct"] == 100
    assert stats[0]["classDist"]["Healthy"] == 100
    only = client.get(f"/api/properties/{p['id']}/detail/stats", params={"index": "ndmi", "from": day(15)}).json()
    assert [s["date"] for s in only] == [day(10)]

    for d in (day(30), day(10)):
        for idx in ("ndvi", "ndmi", "ndre"):
            assert (detail_root() / str(p["id"]) / d / f"{idx}.tif").is_file()
    assert not (detail_root() / str(p["id"]) / day(20)).exists()
    assert (detail_root() / str(p["id"]) / "logs" / f"job_{job['id']}.log").is_file()


def test_refresh_is_incremental(client, fake):
    p = create(client)
    fake.days.append(day(2))
    fake.loads.clear()
    r = client.post(f"/api/properties/{p['id']}/detail/refresh")
    assert r.status_code == 202 and r.json()["kind"] == "incremental"
    jobs.RUNNER.wait_idle()
    assert fake.searches[-1] == (TODAY - timedelta(days=9), TODAY)  # after the last processed day
    assert fake.loads == [day(2)]
    assert len(client.get(f"/api/properties/{p['id']}/detail/scenes").json()) == 4


def test_same_geometry_saved_again_is_incremental(client, fake):
    p = create(client)
    fake.loads.clear()
    r = client.patch(f"/api/properties/{p['id']}", json={"geometry": PLOT})
    assert r.json()["detailJob"] is not None
    jobs.RUNNER.wait_idle()
    assert fake.loads == []  # nothing new
    assert client.get(f"/api/properties/{p['id']}/detail/status").json()["job"]["kind"] == "incremental"


def test_rename_does_not_start_a_job(client, fake):
    p = create(client)
    r = client.patch(f"/api/properties/{p['id']}", json={"name": "Renamed"})
    assert r.json()["detailJob"] is None


def test_geometry_change_reprocesses_and_drops_stale_files(client, fake):
    p = create(client)
    folder = detail_root() / str(p["id"])
    stale = folder / day(30) / "ndvi.tif"
    old_bounds = client.get(f"/api/detail/cog/info?assetId={_asset(client, p['id'], day(30))}").json()["bounds"]
    fake.loads.clear()
    r = client.patch(f"/api/properties/{p['id']}", json={"geometry": MOVED})
    assert r.json()["detailJob"]["status"] == "queued"
    jobs.RUNNER.wait_idle()
    assert sorted(fake.loads) == sorted([day(30), day(20), day(10)])
    assert client.get(f"/api/properties/{p['id']}/detail/status").json()["job"]["kind"] == "full"
    assert stale.is_file()  # rewritten for the new shape
    new_bounds = client.get(f"/api/detail/cog/info?assetId={_asset(client, p['id'], day(30))}").json()["bounds"]
    assert new_bounds != old_bounds


def test_delete_removes_files_and_rows(client, fake):
    p = create(client)
    assert (detail_root() / str(p["id"])).is_dir()
    assert client.delete(f"/api/properties/{p['id']}").status_code == 204
    assert not (detail_root() / str(p["id"])).exists()
    conn = db.connect()
    try:
        for t in ("detail_jobs", "detail_scenes", "detail_assets", "detail_stats"):
            assert conn.execute(f"SELECT COUNT(*) FROM {t} WHERE property_id = ?", (p["id"],)).fetchone()[0] == 0
    finally:
        conn.close()
    assert client.get(f"/api/properties/{p['id']}/detail/status").status_code == 404


def test_area_too_large_fails_job_but_saves_property(client, fake):
    p = create(client, HUGE)
    job = client.get(f"/api/properties/{p['id']}/detail/status").json()["job"]
    assert job["status"] == "failed" and job["errorReason"] == "area-too-large"
    assert "2,000 ha" in job["error"]
    assert fake.searches == []


def test_search_failure_falls_back_then_fails_clearly(client):
    a, b = FakeSource(fail_search=True), FakeSource(days=[day(5)])
    b.name = "fallback"
    jobs.RUNNER.sources_factory = lambda: [a, b]
    p = create(client)
    job = client.get(f"/api/properties/{p['id']}/detail/status").json()["job"]
    assert job["status"] == "done" and job["source"] == "fallback"
    assert client.get(f"/api/properties/{p['id']}/detail/scenes").json()[0]["source"] == "fallback"

    jobs.RUNNER.sources_factory = lambda: [FakeSource(fail_search=True)]
    client.post(f"/api/properties/{p['id']}/detail/refresh")
    jobs.RUNNER.wait_idle()
    job = client.get(f"/api/properties/{p['id']}/detail/status").json()["job"]
    assert job["status"] == "failed" and job["errorReason"] == "search-failed" and "timed out" in job["error"]


def test_failed_load_is_recorded_and_retried(client):
    src = FakeSource(days=[day(30), day(10)], broken={day(30)})
    jobs.RUNNER.sources_factory = lambda: [src]
    p = create(client)
    scenes = client.get(f"/api/properties/{p['id']}/detail/scenes").json()
    assert [(s["date"], s["status"]) for s in scenes] == [(day(30), "error"), (day(10), "valid")]
    src.broken.clear()
    src.loads.clear()
    client.post(f"/api/properties/{p['id']}/detail/refresh")
    jobs.RUNNER.wait_idle()
    assert src.searches[-1][0] == TODAY - timedelta(days=30)  # window reaches back to the failed day
    assert src.loads == [day(30)]
    assert client.get(f"/api/properties/{p['id']}/detail/scenes").json()[0]["status"] == "valid"


def test_job_cancels_when_geometry_changes_mid_run(client):
    conn = db.connect()

    class Mover(FakeSource):
        def load(self, group, geobox, fp):
            conn.execute("UPDATE properties SET geom_hash = 'changed'")
            conn.commit()
            return super().load(group, geobox, fp)

    jobs.RUNNER.sources_factory = lambda: [Mover(days=[day(30), day(10)])]
    try:
        p = create(client)
        job = client.get(f"/api/properties/{p['id']}/detail/status").json()["job"]
        assert job["status"] == "cancelled"
        assert client.get(f"/api/properties/{p['id']}/detail/scenes").json() == []
        assert not (detail_root() / str(p["id"]) / day(30) / "ndvi.tif").exists()
    finally:
        conn.close()


def test_recover_marks_running_jobs_interrupted(client, fake):
    p = create(client)
    conn = db.connect()
    try:
        conn.execute("UPDATE detail_jobs SET status = 'running' WHERE property_id = ?", (p["id"],))
        conn.commit()
    finally:
        conn.close()
    jobs.RUNNER.recover()
    job = client.get(f"/api/properties/{p['id']}/detail/status").json()["job"]
    assert job["status"] == "failed" and job["errorReason"] == "interrupted"


# ---------- tiles ----------
def _asset(client, pid, d, index="ndvi"):
    s = next(s for s in client.get(f"/api/properties/{pid}/detail/scenes").json() if s["date"] == d)
    return s["assets"][index]


def _decode_png(data: bytes):
    from rasterio.io import MemoryFile

    with MemoryFile(data) as mem, mem.open() as src:
        return src.read()  # (4, 256, 256) RGBA


def _tile_of(lon, lat, z):
    import morecantile

    t = morecantile.tms.get("WebMercatorQuad").tile(lon, lat, z)
    return t.z, t.x, t.y


def test_tiles(client, fake):
    p = create(client)
    z, x, y = _tile_of(-83.8155, 9.9115, 17)
    r = client.get(f"/api/properties/{p['id']}/detail/tiles/ndvi/{day(10)}/{z}/{x}/{y}.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
    rgba = _decode_png(r.content)
    opaque = rgba[3] > 0
    assert 0 < opaque.mean() < 1  # the property, transparent around it
    # NDVI 0.6 everywhere → the 'Healthy' class color #16a34a, crisp (no blended colors)
    colors = {tuple(int(c) for c in px) for px in rgba[:3, opaque].T}
    assert colors == {(0x16, 0xA3, 0x4A)}
    r = client.get(f"/api/properties/{p['id']}/detail/tiles/ndvi/{day(10)}/{z}/{x}/{y}.png?style=continuous&rescale=-0.2,1")
    assert r.status_code == 200
    # outside the property: transparent tile, not an error
    z, x, y = _tile_of(-83.5, 9.5, 17)
    assert client.get(f"/api/properties/{p['id']}/detail/tiles/ndvi/{day(10)}/{z}/{x}/{y}.png").status_code == 200
    # cloudy day / unknown index / bad colormap
    assert client.get(f"/api/properties/{p['id']}/detail/tiles/ndvi/{day(20)}/17/1/1.png").status_code == 404
    assert client.get(f"/api/properties/{p['id']}/detail/tiles/evi/{day(10)}/17/1/1.png").status_code == 422
    assert client.get(f"/api/properties/{p['id']}/detail/tiles/ndvi/{day(10)}/17/1/1.png?colormap_name=nope").status_code == 422


def test_titiler_cog_endpoint_is_asset_scoped(client, fake):
    p = create(client)
    aid = _asset(client, p["id"], day(10))
    info = client.get("/api/detail/cog/info", params={"assetId": aid})
    assert info.status_code == 200, info.text
    assert info.json()["crs"].endswith("32617") or "32617" in str(info.json())
    tj = client.get("/api/detail/cog/WebMercatorQuad/tilejson.json", params={"assetId": aid, "rescale": "-1,1", "colormap_name": "rdylgn"})
    assert tj.status_code == 200 and tj.json()["tiles"]
    # no arbitrary paths: `url` is not a parameter, unknown ids 404
    assert client.get("/api/detail/cog/info", params={"url": "C:/Windows/win.ini"}).status_code == 422
    assert client.get("/api/detail/cog/info", params={"assetId": 99999}).status_code == 404


def test_asset_path_cannot_escape_root(client, fake):
    p = create(client)
    conn = db.connect()
    try:
        conn.execute("UPDATE detail_assets SET path = '../../../secret.tif' WHERE property_id = ?", (p["id"],))
        conn.commit()
        aid = conn.execute("SELECT id FROM detail_assets WHERE property_id = ? LIMIT 1", (p["id"],)).fetchone()[0]
    finally:
        conn.close()
    assert client.get("/api/detail/cog/info", params={"assetId": aid}).status_code == 404
    assert client.get(f"/api/properties/{p['id']}/detail/tiles/ndvi/{day(10)}/17/1/1.png").status_code == 404


def test_indices_endpoint(client):
    r = client.get("/api/detail/indices").json()
    assert [i["key"] for i in r] == ["ndvi", "ndmi", "ndre", "days_since_clear"]
    assert r[0]["classes"][0] == {"min": None, "max": 0.0, "label": "Water / non-veg", "meaning": "water, built-up", "color": "#6b7280"}
