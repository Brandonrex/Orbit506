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
