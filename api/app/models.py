"""Request / response models. JSON uses camelCase to match the Angular app."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class PolygonGeometry(BaseModel):
    type: Literal["Polygon"]
    coordinates: list[list[list[float]]]


class PropertyIn(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    notes: str = Field(default="", max_length=2000)
    geometry: PolygonGeometry


class PropertyPatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)
    geometry: PolygonGeometry | None = None


class PropertyOut(CamelModel):
    id: int
    name: str
    notes: str
    geometry: PolygonGeometry
    area_m2: float
    created_at: str
    updated_at: str


class PlanCycle(CamelModel):
    """One planned crop cycle. Months are 1-12; end < start means the cycle wraps past December."""

    id: str = Field(min_length=1, max_length=80)
    crop_id: int
    crop_name: str = Field(min_length=1, max_length=60)
    short_name: str = Field(min_length=1, max_length=4)
    source: Literal["thermal", "rainfall"]
    start_month: int = Field(ge=1, le=12)
    end_month: int = Field(ge=1, le=12)
    duration_months: int = Field(ge=1, le=12)
    notes: list[str] = Field(default_factory=list, max_length=24)


class PlanIn(CamelModel):
    status: Literal["draft", "saved"]
    cycles: list[PlanCycle] = Field(default_factory=list, max_length=48)


class PlanOut(PlanIn):
    property_id: int
    saved_at: str | None = None
    updated_at: str | None = None
