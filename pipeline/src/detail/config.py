"""Settings for the on-demand Sentinel-2 detail layer. Data, not logic: tune values here.

Every value can be overridden with an environment variable (AF_DETAIL_*), read once at import.
"""
import os
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def _env(name: str, default, cast=str):
    raw = os.environ.get(name)
    return default if raw in (None, "") else cast(raw)


@dataclass(frozen=True)
class DetailConfig:
    # Scope limits
    buffer_m: float = _env("AF_DETAIL_BUFFER_M", 50.0, float)  # load window = polygon + buffer (helps mask dilation)
    max_area_ha: float = _env("AF_DETAIL_MAX_HA", 2000.0, float)
    window_days: int = _env("AF_DETAIL_WINDOW_DAYS", 365, int)  # first fetch: last 12 months

    # Search
    max_scene_cloud: float = _env("AF_DETAIL_MAX_SCENE_CLOUD", 80.0, float)  # loose prefilter only
    stac_timeout_s: float = _env("AF_DETAIL_STAC_TIMEOUT", 30.0, float)
    retries: int = _env("AF_DETAIL_RETRIES", 4, int)
    backoff_s: float = _env("AF_DETAIL_BACKOFF", 2.0, float)  # 2, 4, 8 … seconds
    cog_timeout_s: int = _env("AF_DETAIL_COG_TIMEOUT", 30, int)  # GDAL HTTP timeout per request

    # Processing
    resolution_m: float = 10.0
    # SCL classes kept as clear: 4 vegetation, 5 bare soil, 6 water, 7 unclassified
    scl_keep: tuple[int, ...] = (4, 5, 6, 7)
    dilate_px: int = _env("AF_DETAIL_DILATE_PX", 2, int)
    min_valid_pct: float = _env("AF_DETAIL_MIN_VALID_PCT", 60.0, float)

    # Optional purge of properties untouched for N days (0 = off)
    ttl_days: int = _env("AF_DETAIL_TTL_DAYS", 0, int)


CONFIG = DetailConfig()


def detail_root() -> Path:
    """Where COGs and job logs go: {root}/{property_id}/{YYYY-MM-DD}/{index}.tif (read at call time)."""
    return Path(os.environ.get("AF_DETAIL_ROOT") or REPO / "pipeline" / "data" / "property_detail").resolve()

# Canonical band names used by every source (Earth Search names; other sources map to these).
BANDS = ("red", "nir", "nir08", "rededge1", "swir16", "scl")
REFLECTANCE_BANDS = BANDS[:-1]

INDEX_KEYS = ("ndvi", "ndmi", "ndre")

# ---------------------------------------------------------------------------------------------
# Index definitions and classes. A value v is in class i when min <= v < max (None = open end).
# NDVI: same thresholds and colors as web/src/app/core/config/indices.ts (keep them in sync).
# NDMI / NDRE: PROVISIONAL, to be validated by the team / BA.
# ---------------------------------------------------------------------------------------------
INDICES: dict[str, dict] = {
    "ndvi": {
        "label": "NDVI – vegetation vigor",
        "formula": "(nir − red) / (nir + red)",
        "provisional": True,
        "range": (-0.2, 1.0),  # default display stretch for continuous tiles
        "classes": [
            {"min": None, "max": 0.0, "label": "Water / non-veg", "meaning": "water, built-up", "color": "#6b7280"},
            {"min": 0.0, "max": 0.2, "label": "Bare soil", "meaning": "bare or fallow soil", "color": "#a16207"},
            {"min": 0.2, "max": 0.4, "label": "Severe stress / sparse", "meaning": "weak or sparse canopy, high stress", "color": "#eab308"},
            {"min": 0.4, "max": 0.6, "label": "Moderate", "meaning": "moderate vigor, watch", "color": "#84cc16"},
            {"min": 0.6, "max": 0.8, "label": "Healthy", "meaning": "good vigor", "color": "#16a34a"},
            {"min": 0.8, "max": None, "label": "Very dense", "meaning": "dense, vigorous canopy", "color": "#14532d"},
        ],
    },
    "ndmi": {
        "label": "NDMI – canopy moisture",
        "formula": "(nir08 − swir16) / (nir08 + swir16)",
        "provisional": True,
        "range": (-0.4, 0.6),
        "classes": [
            {"min": None, "max": -0.2, "label": "Very dry / bare", "meaning": "bare soil or very dry canopy", "color": "#8c510a"},
            {"min": -0.2, "max": 0.0, "label": "Water stress", "meaning": "low canopy water, possible stress", "color": "#d8b365"},
            {"min": 0.0, "max": 0.2, "label": "Moderate", "meaning": "moderate canopy water", "color": "#f6e8c3"},
            {"min": 0.2, "max": 0.4, "label": "Moist", "meaning": "good canopy water", "color": "#5ab4ac"},
            {"min": 0.4, "max": None, "label": "Very moist", "meaning": "high canopy water / dense canopy", "color": "#01665e"},
        ],
    },
    "ndre": {
        "label": "NDRE – chlorophyll (red edge)",
        "formula": "(nir08 − rededge1) / (nir08 + rededge1)",
        "provisional": True,
        "range": (0.0, 0.7),
        "classes": [
            {"min": None, "max": 0.2, "label": "Bare / very low", "meaning": "bare soil or very little chlorophyll", "color": "#a16207"},
            {"min": 0.2, "max": 0.3, "label": "Low chlorophyll", "meaning": "possible nitrogen or vigor deficit", "color": "#eab308"},
            {"min": 0.3, "max": 0.4, "label": "Moderate", "meaning": "moderate chlorophyll", "color": "#a3e635"},
            {"min": 0.4, "max": 0.5, "label": "Good", "meaning": "good chlorophyll content", "color": "#22c55e"},
            {"min": 0.5, "max": None, "label": "High", "meaning": "high chlorophyll, dense canopy", "color": "#166534"},
        ],
    },
}

# Composite-only layer: days from the pixel's last clear observation to the month end (or today).
DAYS_SINCE_CLEAR_DEF = {
    "label": "Days since last clear image",
    "formula": "reference date − last date the pixel was clear",
    "provisional": True,
    "range": (0.0, 90.0),
    "classes": [
        {"min": None, "max": 6, "label": "0–5 days", "meaning": "fresh: seen clear this week", "color": "#0f766e"},
        {"min": 6, "max": 16, "label": "6–15 days", "meaning": "recent", "color": "#5eead4"},
        {"min": 16, "max": 31, "label": "16–30 days", "meaning": "getting old", "color": "#fde68a"},
        {"min": 31, "max": 61, "label": "31–60 days", "meaning": "old: clouds hid it for weeks", "color": "#f59e0b"},
        {"min": 61, "max": None, "label": "> 60 days", "meaning": "stale: no clear view for months", "color": "#b91c1c"},
    ],
}

# Everything the map can draw: the three indices (scenes and monthly medians) + days since clear.
LAYERS: dict[str, dict] = INDICES | {"days_since_clear": DAYS_SINCE_CLEAR_DEF}

ATTRIBUTION ="Contains modified Copernicus Sentinel data {year}"
