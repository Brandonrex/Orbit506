import pytest

from app.detail_api import jobs

from .detail_fakes import FakeSource


def pytest_addoption(parser):
    parser.addoption("--network", action="store_true", help="run tests that call the real STAC catalogues")


def pytest_configure(config):
    config.addinivalue_line("markers", "network: calls real imagery catalogues (run with --network)")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--network"):
        return
    skip = pytest.mark.skip(reason="needs --network")
    for item in items:
        if "network" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def offline_detail(tmp_path, monkeypatch):
    """Every test: detail files go to a temp folder and the catalogue is an empty fake (no network).

    Tests that want imagery set `jobs.RUNNER.sources_factory` themselves (see `fake_source`).
    """
    monkeypatch.setenv("AF_DETAIL_ROOT", str(tmp_path / "property_detail"))
    previous = jobs.RUNNER.sources_factory
    jobs.RUNNER.sources_factory = lambda: [FakeSource()]
    yield
    jobs.RUNNER.wait_idle()  # before the temp DB / env go away
    jobs.RUNNER.sources_factory = previous


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AF_DB_PATH", str(tmp_path / "test.db"))
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
