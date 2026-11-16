"""API side of the Sentinel-2 property detail layer (storage, jobs, routes, tiles).

The processing itself lives in pipeline/src/detail (no FastAPI dependency); it is put on sys.path here,
the only place that does so.
"""
import sys
from pathlib import Path

_PIPELINE_SRC = Path(__file__).resolve().parents[3] / "pipeline" / "src"
if str(_PIPELINE_SRC) not in sys.path:
    sys.path.insert(0, str(_PIPELINE_SRC))
