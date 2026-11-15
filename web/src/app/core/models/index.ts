import type { Feature, Polygon } from 'geojson';

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
  | 'frost_risk';

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
  files: { typical_month: string; annual_normal: string; aoi: string };
  variables: string[];
  ranges: Record<Period, Partial<Record<NumericField, Range>>>;
}

/** How much of the property falls in one cell. */
export interface Overlap {
  pointId: number;
  areaM2: number;
  /** Share of the property area inside this cell (sums to 1 over the overlaps). */
  weight: number;
}

export type PropertyFeature = Feature<Polygon>;

export interface ClassShare {
  index: number;
  label: string;
  color: string;
  /** 0–100 */
  pct: number;
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
