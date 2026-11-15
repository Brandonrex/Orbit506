import pytest
from fastapi.testclient import TestClient

# ~1 ha square near Cartago (0.0009° ≈ 100 m)
SQUARE = {
    "type": "Polygon",
    "coordinates": [[[-83.92, 9.86], [-83.9191, 9.86], [-83.9191, 9.8609], [-83.92, 9.8609], [-83.92, 9.86]]],
}
BOWTIE = {
    "type": "Polygon",
    "coordinates": [[[-83.92, 9.86], [-83.91, 9.87], [-83.91, 9.86], [-83.92, 9.87], [-83.92, 9.86]]],
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AF_DB_PATH", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_crud_round_trip(client):
    assert client.get("/api/properties").json() == []

    r = client.post("/api/properties", json={"name": " Finca A ", "geometry": SQUARE})
    assert r.status_code == 201
    p = r.json()
    assert p["name"] == "Finca A"
    assert set(p) >= {"id", "name", "notes", "geometry", "areaM2", "createdAt", "updatedAt"}

    client.post("/api/properties", json={"name": "Finca B", "geometry": SQUARE})
    assert [x["name"] for x in client.get("/api/properties").json()] == ["Finca A", "Finca B"]

    r = client.patch(f"/api/properties/{p['id']}", json={"name": "Renamed", "notes": "coffee"})
    assert r.json()["name"] == "Renamed" and r.json()["notes"] == "coffee"
    assert r.json()["geometry"] == p["geometry"]

    assert client.delete(f"/api/properties/{p['id']}").status_code == 204
    assert client.get(f"/api/properties/{p['id']}").status_code == 404
    assert len(client.get("/api/properties").json()) == 1


def test_area_is_geodesic(client):
    p = client.post("/api/properties", json={"name": "A", "geometry": SQUARE}).json()
    # 0.0009° lon × 0.0009° lat at 9.86° N ≈ 98.8 m × 99.5 m
    assert p["areaM2"] == pytest.approx(9_834, rel=0.005)


def test_geometry_update_recomputes_area(client):
    p = client.post("/api/properties", json={"name": "A", "geometry": SQUARE}).json()
    bigger = {
        "type": "Polygon",
        "coordinates": [[[-83.92, 9.86], [-83.9182, 9.86], [-83.9182, 9.8609], [-83.92, 9.8609], [-83.92, 9.86]]],
    }
    r = client.patch(f"/api/properties/{p['id']}", json={"geometry": bigger})
    assert r.json()["areaM2"] == pytest.approx(2 * p["areaM2"], rel=0.001)


def test_unclosed_ring_is_closed(client):
    open_ring = {"type": "Polygon", "coordinates": [SQUARE["coordinates"][0][:-1]]}
    r = client.post("/api/properties", json={"name": "A", "geometry": open_ring})
    assert r.status_code == 201
    ring = r.json()["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1]


@pytest.mark.parametrize(
    ("geometry", "reason"),
    [
        (BOWTIE, "self-intersection"),
        ({"type": "Polygon", "coordinates": [[[-83.9, 9.8], [-83.8, 9.8], [-83.9, 9.8]]]}, "invalid"),
        ({"type": "Polygon", "coordinates": [[[200, 9.8], [201, 9.8], [201, 9.9], [200, 9.8]]]}, "invalid"),
    ],
)
def test_invalid_geometry(client, geometry, reason):
    r = client.post("/api/properties", json={"name": "A", "geometry": geometry})
    assert r.status_code == 422
    assert r.json()["detail"]["reason"] == reason


def test_rejects_non_polygon_and_empty_name(client):
    point = {"type": "Point", "coordinates": [-83.9, 9.8]}
    assert client.post("/api/properties", json={"name": "A", "geometry": point}).status_code == 422
    assert client.post("/api/properties", json={"name": "", "geometry": SQUARE}).status_code == 422


def test_delete_cascades_stats(client):
    from app.db import connect

    p = client.post("/api/properties", json={"name": "A", "geometry": SQUARE}).json()
    conn = connect()
    with conn:
        conn.execute(
            "INSERT INTO property_stats VALUES (?, 'v2', '2026-01-01', '{}')", (p["id"],)
        )
    client.delete(f"/api/properties/{p['id']}")
    assert conn.execute("SELECT COUNT(*) FROM property_stats").fetchone()[0] == 0
    conn.close()
