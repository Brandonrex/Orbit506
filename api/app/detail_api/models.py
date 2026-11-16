"""Response models for the detail endpoints (camelCase JSON, like the rest of the API)."""
from typing import Literal

from ..models import CamelModel, DetailJobRef

IndexName = Literal["ndvi", "ndmi", "ndre"]
# What the map can draw: the indices, plus days since clear (composites only)
LayerName = Literal["ndvi", "ndmi", "ndre", "days_since_clear"]


class DetailJobOut(DetailJobRef):
    kind: Literal["full", "incremental"]
    created_at: str
    started_at: str | None
    finished_at: str | None
    date_from: str
    date_to: str
    source: str | None
    scenes_found: int
    scenes_done: int
    scenes_valid: int
    progress: float  # 0–1 (days processed / days found)
    error_reason: str | None  # 'area-too-large' | 'search-failed' | 'interrupted' | 'internal' | None
    error: str | None


class DetailStatusOut(CamelModel):
    job: DetailJobOut | None
    scenes_valid: int
    scenes_cloudy: int
    last_acquired: str | None  # newest processed day (valid or cloudy)
    last_clear_date: str | None  # newest valid day
    days_since_clear: int | None
    attribution: str


class SceneOut(CamelModel):
    date: str
    status: Literal["valid", "cloudy", "error"]
    valid_pct: float | None
    cloud_cover_scene: float | None
    source: str
    stac_item_id: str
    assets: dict[str, int]  # index → asset id (valid days only), for /api/detail/cog?assetId=


class StatOut(CamelModel):
    date: str
    mean: float | None
    median: float | None
    p10: float | None
    p90: float | None
    std: float | None
    valid_pct: float
    n_pixels: int
    class_dist: dict[str, float]


class IndexClassOut(CamelModel):
    min: float | None
    max: float | None
    label: str
    meaning: str
    color: str


class CompositeOut(CamelModel):
    period: str  # 'YYYY-MM', or 'latest' (days since clear counted to today)
    n_days: int  # valid days in the month
    assets: dict[str, int]  # layer -> asset id


class PointValue(CamelModel):
    value: float | None
    class_label: str | None
    color: str | None


class PointOut(CamelModel):
    """Values of every layer at one pixel, for the map's click-to-inspect popup."""

    date: str  # 'YYYY-MM-DD', 'YYYY-MM' or 'latest'
    lon: float
    lat: float
    inside: bool  # the point falls on a clear pixel of the property
    values: dict[str, PointValue]


class IndexDefOut(CamelModel):
    key: LayerName
    label: str
    formula: str
    provisional: bool
    range: tuple[float, float]
    classes: list[IndexClassOut]
