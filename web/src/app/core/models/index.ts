import type { Feature, MultiPolygon, Polygon } from 'geojson';

/** Time view: a typical month (1–12, 2020–2025 average) or the annual normal. */
export type Period = 'month' | 'normal';

export type RenderMode = 'classes' | 'continuous';

/** Numeric columns present in the prepared CSVs (see web/scripts/prepare_data.py). */
export const NUMERIC_FIELDS = [
  'ndvi',
  'rain_mm',
  'tmean_c',
  'tmax_c',
  'tmin_c',
  'tmin_extreme_c',
  'eto_mm',
  'balance_mm',
  'soil_wetness',
  'elevation_m',
  'temp_correction_c',
  // ECOCROP suitability codes for the selected crop (2 favorable, 1 caution, 0 unfavorable),
  // merged in by AnalysisService; not present in the CSVs.
  'crop_thermal',
  'crop_rain',
] as const;
export type NumericField = (typeof NUMERIC_FIELDS)[number];

/** Variables the user can pick. `frost_risk` is a classed view of `tmin_extreme_c`. */
export type VarKey =
  | 'ndvi'
  | 'rain_mm'
  | 'tmean_c'
  | 'tmax_c'
  | 'tmin_c'
  | 'tmin_extreme_c'
  | 'eto_mm'
  | 'balance_mm'
  | 'soil_wetness'
  | 'elevation_m'
  | 'frost_risk'
  | 'crop_thermal'
  | 'crop_rain';

export type FrostRisk = 'low' | 'medium' | 'high' | '';

/** All values of one grid point for one period (one month, or the annual normal). */
export type CellValues = Record<NumericField, number | null> & { frost_risk: FrostRisk };

/** One grid point and the square cell it represents. */
export interface Cell {
  pointId: number;
  lat: number;
  lon: number;
  /** [[south, west], [north, east]] */
  bounds: [[number, number], [number, number]];
  polygon: Feature<Polygon>;
}

export interface Range {
  min: number;
  max: number;
}

export interface Manifest {
  version: string;
  region: string;
  crs: string;
  source_period: string;
  resolution_deg: number;
  grid: { rows: number; cols: number; points: number };
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  files: {
    typical_month: string;
    annual_normal: string;
    aoi: string;
    crops?: string;
    suitability?: string;
    series?: string;
  };
  /** Years in crops/series.csv (historical chart). */
  years?: number[];
  variables: string[];
  ranges: Record<Period, Partial<Record<NumericField, Range>>>;
}

/** How much of the property falls in one cell. */
export interface Overlap {
  pointId: number;
  areaM2: number;
  /** Share of the property area inside this cell (sums to 1 over the overlaps). */
  weight: number;
  /** The part of the property inside this cell (drawn on the map instead of the whole cell). */
  geometry: Feature<Polygon | MultiPolygon>;
}

export type PropertyFeature = Feature<Polygon>;

/** A property saved in the API (SQLite). Analysis is recomputed client-side from `geometry`. */
export interface SavedProperty {
  id: number;
  name: string;
  notes: string;
  geometry: Polygon;
  /** Geodesic area computed by the API (WGS84). */
  areaM2: number;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyPatch {
  name?: string;
  notes?: string;
  geometry?: Polygon;
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

// ---------- ECOCROP crops, suitability and annual plans ----------

/** 2 favorable, 1 caution, 0 unfavorable, -1 unknown (see prepare_data.py). */
export type StatusCode = 2 | 1 | 0 | -1;
export type SuitabilityStatus = 'favorable' | 'caution' | 'unfavorable' | 'unknown';

export interface Range4 {
  optMin: number;
  optMax: number;
  tolMin: number;
  tolMax: number;
}

export interface Crop {
  id: number;
  name: string;
  shortName: string;
  scientificName: string;
  temp: Range4;
  /** Rain thresholds (mm). Compared to annual rain, and to rain accumulated over a growing period. */
  rain: Range4;
  growingDays: [number, number];
  /** Thermal cycle length: ceil(growing_days_min / 30). */
  cycleMonths: number;
  /** Rainfall growing period: ceil(mean growing days / 30). */
  rainDurationMonths: number;
  drainage: string | null;
}

/** Compact per point / crop record from crops/suitability.json. */
export interface CropPointSuitability {
  /** 12 × [mean temperature °C, status]. */
  t: [number, StatusCode][];
  /** Thermal windows: [start, end, cycleMonths, cycles [[start, end], …]]. */
  tw: [number, number, number, [number, number][]][];
  /** 12 planting-start months × [rain accumulated over the growing period mm, status]. */
  r: [number, StatusCode][];
  /** Rainfall windows: consecutive favorable planting-start months. */
  rw: number[][];
  /** Annual rain [mm, status]. */
  a: [number, StatusCode];
}

export type PlanSource = 'thermal' | 'rainfall';

export interface PlanCycle {
  id: string;
  cropId: number;
  cropName: string;
  shortName: string;
  source: PlanSource;
  /** 1–12; endMonth < startMonth wraps past December. */
  startMonth: number;
  endMonth: number;
  durationMonths: number;
  notes: string[];
}

export interface LandPlan {
  propertyId: number;
  status: 'draft' | 'saved';
  cycles: PlanCycle[];
  savedAt?: string | null;
  updatedAt?: string | null;
}

/** One month of the historical series (crops/series.csv). */
export interface SeriesMonth {
  month: number;
  ndvi: number | null;
  tmin_extreme_c: number | null;
  rain_mm: number | null;
  tmin_c: number | null;
  tmax_c: number | null;
  eto_mm: number | null;
  balance_mm: number | null;
  soil_wetness: number | null;
}
