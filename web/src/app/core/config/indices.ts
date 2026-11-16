/**
 * Single source of truth for every variable: label, unit, class thresholds and colors.
 *
 * THIS IS DATA, NOT LOGIC. Tune thresholds and colors here; components never hard-code them.
 * All thresholds are PROVISIONAL and must be validated by the team / BA.
 *
 * Class rules: a value v belongs to class i when  classes[i].min <= v < classes[i].max
 * (min undefined = -Infinity, max undefined = +Infinity). Classes are ordered low → high value.
 * Colors go from light (low) to intense (high), except diverging / risk scales noted below.
 *
 * Continuous mode interpolates between the class colors, placed at each class's mid-point
 * (open-ended classes use the data min / max from manifest.json).
 */
import type { NumericField, Period, VarKey } from '../models';

export interface ClassDef {
  min?: number;
  max?: number;
  label: string;
  meaning: string;
  color: string;
}

export interface VarDef {
  key: VarKey;
  /** CSV column the values come from. */
  field: NumericField;
  label: string;
  shortLabel: string;
  unit: string;
  decimals: number;
  description: string;
  /** How cells are combined over a property. 'min' for "coldest night" style variables. */
  aggregate: 'mean' | 'min';
  /** Unit label differs by period for accumulated variables (mm per month vs per year). */
  unitByPeriod?: Partial<Record<Period, string>>;
  /** Classes per period. `all` applies to both unless a period-specific list is given. */
  classes: { all?: ClassDef[]; month?: ClassDef[]; normal?: ClassDef[] };
  provisional: boolean;
}

// ---------- Palettes (only place where hex colors live, together with the classes below) ----------
const BLUES = ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a'];
const WARM = ['#fef3c7', '#fcd34d', '#f59e0b', '#ea580c', '#b91c1c'];
const ORANGES = ['#ffedd5', '#fdba74', '#f97316', '#c2410c'];
const TEALS = ['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e', '#134e4a'];
const STONES = ['#f5f5f4', '#d6d3d1', '#a8a29e', '#78716c', '#44403c'];

export const VARIABLES: VarDef[] = [
  {
    key: 'ndvi',
    field: 'ndvi',
    label: 'NDVI – vegetation vigor',
    shortLabel: 'NDVI',
    unit: '',
    decimals: 2,
    description: 'How green and vigorous the vegetation is (MODIS, 250 m, monthly mean).',
    aggregate: 'mean',
    provisional: true,
    classes: {
      all: [
        { max: 0, label: 'Water / non-veg', meaning: 'water, built-up', color: '#6b7280' },
        { min: 0, max: 0.2, label: 'Bare soil', meaning: 'bare or fallow soil', color: '#a16207' },
        { min: 0.2, max: 0.4, label: 'Severe stress / sparse', meaning: 'weak or sparse canopy, high stress', color: '#eab308' },
        { min: 0.4, max: 0.6, label: 'Moderate', meaning: 'moderate vigor, watch', color: '#84cc16' },
        { min: 0.6, max: 0.8, label: 'Healthy', meaning: 'good vigor', color: '#16a34a' },
        { min: 0.8, label: 'Very dense', meaning: 'dense, vigorous canopy', color: '#14532d' },
      ],
    },
  },
  {
    key: 'rain_mm',
    field: 'rain_mm',
    label: 'Rainfall',
    shortLabel: 'Rain',
    unit: 'mm',
    unitByPeriod: { month: 'mm/month', normal: 'mm/year' },
    decimals: 0,
    description: 'Total rainfall (NASA POWER). Monthly sum, or yearly sum for the annual normal.',
    aggregate: 'mean',
    provisional: true,
    classes: {
      month: [
        { max: 50, label: '< 50', meaning: 'dry month', color: BLUES[0] },
        { min: 50, max: 100, label: '50–100', meaning: 'low rain', color: BLUES[1] },
        { min: 100, max: 200, label: '100–200', meaning: 'moderate rain', color: BLUES[2] },
        { min: 200, max: 300, label: '200–300', meaning: 'wet month', color: BLUES[3] },
        { min: 300, label: '> 300', meaning: 'very wet month', color: BLUES[4] },
      ],
      normal: [
        { max: 3100, label: '< 3,100', meaning: 'drier for Cartago', color: BLUES[1] },
        { min: 3100, max: 3300, label: '3,100–3,300', meaning: 'typical', color: BLUES[2] },
        { min: 3300, max: 3500, label: '3,300–3,500', meaning: 'wet', color: BLUES[3] },
        { min: 3500, label: '> 3,500', meaning: 'very wet', color: BLUES[4] },
      ],
    },
  },
  {
    key: 'tmean_c',
    field: 'tmean_c',
    label: 'Mean temperature',
    shortLabel: 'T mean',
    unit: '°C',
    decimals: 1,
    description: '(max + min) / 2, corrected for elevation (FAO method).',
    aggregate: 'mean',
    provisional: true,
    classes: { all: tempClasses() },
  },
  {
    key: 'tmax_c',
    field: 'tmax_c',
    label: 'Day temperature (max)',
    shortLabel: 'T max',
    unit: '°C',
    decimals: 1,
    description: 'Average daytime high, corrected for elevation.',
    aggregate: 'mean',
    provisional: true,
    classes: { all: tempClasses() },
  },
  {
    key: 'tmin_c',
    field: 'tmin_c',
    label: 'Night temperature (min)',
    shortLabel: 'T min',
    unit: '°C',
    decimals: 1,
    description: 'Average nighttime low, corrected for elevation.',
    aggregate: 'mean',
    provisional: true,
    classes: { all: tempClasses() },
  },
  {
    key: 'tmin_extreme_c',
    field: 'tmin_extreme_c',
    label: 'Coldest night',
    shortLabel: 'Coldest night',
    unit: '°C',
    decimals: 1,
    description: 'Coldest night recorded (2020–2025). Over a property: the coldest cell.',
    aggregate: 'min',
    provisional: true,
    classes: {
      all: [
        { max: 2, label: '≤ 2', meaning: 'frost likely', color: '#e0f2fe' },
        { min: 2, max: 5, label: '2–5', meaning: 'frost possible', color: WARM[0] },
        { min: 5, max: 10, label: '5–10', meaning: 'cool nights', color: WARM[1] },
        { min: 10, max: 15, label: '10–15', meaning: 'mild nights', color: WARM[2] },
        { min: 15, label: '> 15', meaning: 'warm nights', color: WARM[4] },
      ],
    },
  },
  {
    key: 'frost_risk',
    field: 'tmin_extreme_c',
    label: 'Frost risk',
    shortLabel: 'Frost',
    unit: '°C (coldest night)',
    decimals: 1,
    description: 'Risk scale: more intense color = higher risk. From the coldest night.',
    aggregate: 'min',
    provisional: true,
    classes: {
      // Same thresholds as pipeline/src/app_data.py (FROST_HIGH = 2, FROST_MEDIUM = 5)
      all: [
        { max: 2.0001, label: 'High', meaning: 'coldest night ≤ 2 °C', color: '#4c1d95' },
        { min: 2.0001, max: 5.0001, label: 'Medium', meaning: 'coldest night ≤ 5 °C', color: '#8b5cf6' },
        { min: 5.0001, label: 'Low', meaning: 'coldest night > 5 °C', color: '#ede9fe' },
      ],
    },
  },
  {
    key: 'eto_mm',
    field: 'eto_mm',
    label: 'Water lost (ETo)',
    shortLabel: 'ETo',
    unit: 'mm',
    unitByPeriod: { month: 'mm/month', normal: 'mm/year' },
    decimals: 0,
    description: 'Reference evapotranspiration (Hargreaves, FAO).',
    aggregate: 'mean',
    provisional: true,
    classes: {
      month: [
        { max: 70, label: '< 70', meaning: 'low demand', color: ORANGES[0] },
        { min: 70, max: 90, label: '70–90', meaning: 'moderate', color: ORANGES[1] },
        { min: 90, max: 110, label: '90–110', meaning: 'high', color: ORANGES[2] },
        { min: 110, label: '> 110', meaning: 'very high', color: ORANGES[3] },
      ],
      normal: [
        { max: 900, label: '< 900', meaning: 'low demand', color: ORANGES[0] },
        { min: 900, max: 1100, label: '900–1,100', meaning: 'moderate', color: ORANGES[1] },
        { min: 1100, max: 1300, label: '1,100–1,300', meaning: 'high', color: ORANGES[2] },
        { min: 1300, label: '> 1,300', meaning: 'very high', color: ORANGES[3] },
      ],
    },
  },
  {
    key: 'balance_mm',
    field: 'balance_mm',
    label: 'Water balance (rain − ETo)',
    shortLabel: 'Balance',
    unit: 'mm',
    unitByPeriod: { month: 'mm/month', normal: 'mm/year' },
    decimals: 0,
    description: 'Diverging scale: brown = deficit (plants may lack water), blue = surplus.',
    aggregate: 'mean',
    provisional: true,
    classes: {
      month: [
        { max: -50, label: '< −50', meaning: 'strong deficit', color: '#b45309' },
        { min: -50, max: 0, label: '−50–0', meaning: 'deficit', color: '#fcd34d' },
        { min: 0, max: 100, label: '0–100', meaning: 'small surplus', color: '#bae6fd' },
        { min: 100, max: 250, label: '100–250', meaning: 'surplus', color: '#38bdf8' },
        { min: 250, label: '> 250', meaning: 'large surplus', color: '#0369a1' },
      ],
      normal: [
        { max: 0, label: '< 0', meaning: 'yearly deficit', color: '#b45309' },
        { min: 0, max: 2000, label: '0–2,000', meaning: 'surplus', color: '#bae6fd' },
        { min: 2000, max: 2400, label: '2,000–2,400', meaning: 'large surplus', color: '#38bdf8' },
        { min: 2400, label: '> 2,400', meaning: 'very large surplus', color: '#0369a1' },
      ],
    },
  },
  {
    key: 'soil_wetness',
    field: 'soil_wetness',
    label: 'Root-zone soil wetness',
    shortLabel: 'Soil wetness',
    unit: '0–1',
    decimals: 2,
    description: 'How full the soil "sponge" is (NASA POWER GWETROOT, ~50 km).',
    aggregate: 'mean',
    provisional: true,
    classes: {
      all: [
        { max: 0.6, label: '< 0.6', meaning: 'dry', color: TEALS[0] },
        { min: 0.6, max: 0.7, label: '0.6–0.7', meaning: 'moderate', color: TEALS[1] },
        { min: 0.7, max: 0.8, label: '0.7–0.8', meaning: 'moist', color: TEALS[2] },
        { min: 0.8, max: 0.9, label: '0.8–0.9', meaning: 'wet', color: TEALS[3] },
        { min: 0.9, label: '> 0.9', meaning: 'soaked', color: TEALS[4] },
      ],
    },
  },
  {
    key: 'elevation_m',
    field: 'elevation_m',
    label: 'Elevation',
    shortLabel: 'Elevation',
    unit: 'm',
    decimals: 0,
    description: 'Meters above sea level (NASADEM).',
    aggregate: 'mean',
    provisional: false,
    classes: {
      all: [
        { max: 1000, label: '< 1,000', meaning: 'low', color: STONES[0] },
        { min: 1000, max: 1500, label: '1,000–1,500', meaning: 'mid', color: STONES[1] },
        { min: 1500, max: 2000, label: '1,500–2,000', meaning: 'high', color: STONES[2] },
        { min: 2000, max: 2500, label: '2,000–2,500', meaning: 'very high', color: STONES[3] },
        { min: 2500, label: '> 2,500', meaning: 'mountain', color: STONES[4] },
      ],
    },
  },
];

function tempClasses(): ClassDef[] {
  return [
    { max: 10, label: '< 10', meaning: 'cold', color: WARM[0] },
    { min: 10, max: 15, label: '10–15', meaning: 'cool', color: WARM[1] },
    { min: 15, max: 20, label: '15–20', meaning: 'mild', color: WARM[2] },
    { min: 20, max: 25, label: '20–25', meaning: 'warm', color: WARM[3] },
    { min: 25, label: '> 25', meaning: 'hot', color: WARM[4] },
  ];
}

// ---------- ECOCROP crop fit (values are status codes merged in by AnalysisService) ----------
/** Same colors as the --status-* CSS tokens. */
export const STATUS_COLORS = { favorable: '#245c43', caution: '#657a32', unfavorable: '#a12b2b' } as const;

const statusClasses = (meaning: [string, string, string]): ClassDef[] => [
  { max: 0.5, label: 'Unfavorable', meaning: meaning[0], color: STATUS_COLORS.unfavorable },
  { min: 0.5, max: 1.5, label: 'Caution', meaning: meaning[1], color: STATUS_COLORS.caution },
  { min: 1.5, label: 'Favorable', meaning: meaning[2], color: STATUS_COLORS.favorable },
];

/** Shown as map tabs only once a crop is selected in the planning section. */
export const CROP_VARIABLES: VarDef[] = [
  {
    key: 'crop_thermal',
    field: 'crop_thermal',
    label: 'Crop fit · temperature',
    shortLabel: 'Crop · temperature',
    unit: '',
    decimals: 1,
    description:
      'ECOCROP thermal suitability of the selected crop: mean monthly temperature vs. its optimal and tolerated range (2020–2025 climatology).',
    aggregate: 'mean',
    provisional: true,
    classes: {
      month: statusClasses(['outside tolerated range', 'tolerated, not optimal', 'within optimal range']),
      normal: [
        { max: 3.5, label: '0–3 months', meaning: 'few optimal months', color: STATUS_COLORS.unfavorable },
        { min: 3.5, max: 8.5, label: '4–8 months', meaning: 'part of the year optimal', color: STATUS_COLORS.caution },
        { min: 8.5, label: '9–12 months', meaning: 'most of the year optimal', color: STATUS_COLORS.favorable },
      ],
    },
  },
  {
    key: 'crop_rain',
    field: 'crop_rain',
    label: 'Crop fit · rainfall',
    shortLabel: 'Crop · rainfall',
    unit: '',
    decimals: 1,
    description:
      'ECOCROP rainfall suitability of the selected crop. Typical month: rain accumulated over a growing period started that month. Annual normal: annual rain vs. its range.',
    aggregate: 'mean',
    provisional: true,
    classes: {
      month: statusClasses(['planting start outside tolerated rain', 'tolerated rain, not optimal', 'optimal rain for this start']),
      normal: statusClasses(['annual rain outside tolerated range', 'annual rain tolerated', 'annual rain optimal']),
    },
  },
];

/** Derived KPI thresholds (provisional). */
export const KPI_THRESHOLDS = {
  /** "Stressed area %": NDVI below this value. */
  ndviStressed: 0.4,
  /** "Water-deficit area %": water balance below this value (mm). Replaces NDMI < 0. */
  waterDeficit: 0,
};

/** Map styling for cells (opacities only; colors come from the classes above or CSS tokens). */
export const MAP_STYLE = {
  cellOpacity: 0.65,
  /** Opacity when zoomed in to farm level (zoom >= closeZoom), so the imagery shows through. */
  cellOpacityClose: 0.3,
  closeZoom: 14,
  cellDimmedOpacity: 0.12,
  cellHighlightOpacity: 0.9,
  /** Fill of the part of each cell inside the selected property (farm zoom, over imagery). */
  clipOpacity: 0.6,
  propertyFillOpacity: 0.06,
};

export const VAR_BY_KEY: Record<VarKey, VarDef> = Object.fromEntries([...VARIABLES, ...CROP_VARIABLES].map(v => [v.key, v])) as Record<
  VarKey,
  VarDef
>;

export function classesFor(def: VarDef, period: Period): ClassDef[] {
  return def.classes[period] ?? def.classes.all ?? [];
}

export function unitFor(def: VarDef, period: Period): string {
  return def.unitByPeriod?.[period] ?? def.unit;
}
