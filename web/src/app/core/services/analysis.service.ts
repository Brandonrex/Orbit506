import { computed, effect, inject, Injectable, isDevMode } from '@angular/core';
import { area, bbox, featureCollection, intersect } from '@turf/turf';

import { classesFor, KPI_THRESHOLDS, VAR_BY_KEY, type VarDef } from '../config/indices';
import type { CellValues, ClassShare, NumericField, Overlap } from '../models';
import { classColor, classIndex } from '../utils/color';
import { DataService } from './data.service';
import { PropertyService } from './property.service';
import { UiStateService } from './ui-state.service';

export interface HistogramBin {
  label: string;
  from: number;
  to: number;
  count: number;
  color: string;
}

export interface ScopeCell {
  pointId: number;
  weight: number;
}

/**
 * Everything the dashboard and map need, as computed signals.
 *
 * The data is a ~5 km grid, so a farm usually falls inside 1–2 cells. Property values are
 * therefore AREA-WEIGHTED: each cell counts by the share of the property area inside it.
 * Without a property, every cell of the region counts equally.
 */
@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private readonly data = inject(DataService);
  private readonly property = inject(PropertyService);
  private readonly ui = inject(UiStateService);

  /** Cells overlapping the property with their area share, or null when there's no property. */
  readonly overlaps = computed<Overlap[] | null>(() => {
    const prop = this.property.feature();
    const cells = this.data.cells();
    if (!prop) {
      return null;
    }
    const [pw, ps, pe, pn] = bbox(prop);
    const out: Overlap[] = [];
    for (const c of cells) {
      const [[s, w], [n, e]] = c.bounds;
      if (e < pw || w > pe || n < ps || s > pn) {
        continue; // bbox prefilter
      }
      const inter = intersect(featureCollection([c.polygon, prop]));
      if (inter) {
        const a = area(inter);
        if (a > 0) {
          out.push({ pointId: c.pointId, areaM2: a, weight: 0, geometry: inter });
        }
      }
    }
    const total = out.reduce((s, o) => s + o.areaM2, 0);
    out.forEach(o => (o.weight = total > 0 ? o.areaM2 / total : 0));
    return out.sort((a, b) => b.weight - a.weight);
  });

  /** Share (0–1) of the property area that lies inside the data cells. */
  readonly coverage = computed(() => {
    const ov = this.overlaps();
    const a = this.property.areaM2();
    if (!ov || a <= 0) {
      return 1;
    }
    return Math.min(1, ov.reduce((s, o) => s + o.areaM2, 0) / a);
  });

  readonly isPropertyScope = computed(() => this.overlaps() !== null);
  /** Property drawn but no data under it. */
  readonly isEmpty = computed(() => {
    const ov = this.overlaps();
    return ov !== null && ov.length === 0;
  });

  /** The cells the dashboard summarises, with weights summing to 1. */
  readonly scope = computed<ScopeCell[]>(() => {
    const ov = this.overlaps();
    if (ov) {
      return ov.map(o => ({ pointId: o.pointId, weight: o.weight }));
    }
    const cells = this.data.cells();
    return cells.map(c => ({ pointId: c.pointId, weight: 1 / (cells.length || 1) }));
  });

  readonly overlapByPoint = computed(() => new Map((this.overlaps() ?? []).map(o => [o.pointId, o])));

  /** Values for the active period / month. */
  readonly activeValues = computed(() => this.data.valuesFor(this.ui.period(), this.ui.month()));

  readonly activeRange = computed(() => {
    const def = this.ui.activeDef();
    return this.data.manifest()?.ranges[this.ui.period()][def.field];
  });

  /** Aggregated value of the active variable over the scope. */
  readonly activeValue = computed(() => aggregate(this.ui.activeDef(), this.activeValues(), this.scope()));

  readonly kpis = computed(() => {
    const values = this.activeValues();
    const scope = this.scope();
    const period = this.ui.period();
    const frostDef = VAR_BY_KEY.frost_risk;
    const coldest = aggregate(frostDef, values, scope);
    const frostIdx = classIndex(coldest, classesFor(frostDef, period));
    return {
      ndvi: weightedMean('ndvi', values, scope),
      tmean: weightedMean('tmean_c', values, scope),
      rain: weightedMean('rain_mm', values, scope),
      balance: weightedMean('balance_mm', values, scope),
      coldest,
      frostClass: frostIdx >= 0 ? classesFor(frostDef, period)[frostIdx] : null,
      stressedPct: shareBelow('ndvi', KPI_THRESHOLDS.ndviStressed, values, scope),
      waterDeficitPct: shareBelow('balance_mm', KPI_THRESHOLDS.waterDeficit, values, scope),
    };
  });

  /** % of the scope area in each class of the active variable (nulls excluded). */
  readonly classShares = computed<ClassShare[]>(() => {
    const def = this.ui.activeDef();
    const classes = classesFor(def, this.ui.period());
    const values = this.activeValues();
    const sums = classes.map(() => 0);
    let total = 0;
    for (const s of this.scope()) {
      const i = classIndex(values.get(s.pointId)?.[def.field], classes);
      if (i >= 0) {
        sums[i] += s.weight;
        total += s.weight;
      }
    }
    return classes.map((c, i) => ({
      index: i,
      label: c.label,
      color: c.color,
      pct: total > 0 ? (sums[i] / total) * 100 : 0,
    }));
  });

  /** Histogram of the active variable over the whole region (context for the property value). */
  readonly histogram = computed<HistogramBin[]>(() => {
    const def = this.ui.activeDef();
    const period = this.ui.period();
    const values = [...this.activeValues().values()]
      .map(v => v[def.field])
      .filter((v): v is number => v !== null);
    if (!values.length) {
      return [];
    }
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const n = 12;
    const step = (hi - lo) / n || 1;
    const bins: HistogramBin[] = Array.from({ length: n }, (_, i) => {
      const from = lo + i * step;
      const to = from + step;
      return {
        label: fmt(from, def.decimals),
        from,
        to,
        count: 0,
        color: classColor((from + to) / 2, def, period) ?? '#9ca3af',
      };
    });
    for (const v of values) {
      bins[Math.min(n - 1, Math.floor((v - lo) / step))].count++;
    }
    return bins;
  });

  /** Bin label that contains the aggregated scope value (for the histogram marker). */
  readonly histogramMarker = computed(() => {
    const v = this.activeValue();
    if (v === null || !this.isPropertyScope()) {
      return null;
    }
    const bins = this.histogram();
    const bin = bins.find((b, i) => v >= b.from && (v < b.to || i === bins.length - 1));
    return bin?.label ?? null;
  });

  /** 12-month typical profile of the active variable over the scope. */
  readonly profile = computed(() => {
    const def = this.ui.activeDef();
    const scope = this.scope();
    return this.data.allMonths().map((values, i) => ({ month: i + 1, value: aggregate(def, values, scope) }));
  });

  /** Rows for the "cells covering the property" table. */
  readonly cellRows = computed(() => {
    const def = this.ui.activeDef();
    const values = this.activeValues();
    return (this.overlaps() ?? []).map(o => {
      const v = values.get(o.pointId);
      return {
        pointId: o.pointId,
        sharePct: o.weight * 100,
        value: v?.[def.field] ?? null,
        ndvi: v?.ndvi ?? null,
        elevation: v?.elevation_m ?? null,
        color: classColor(v?.[def.field], def, this.ui.period()),
      };
    });
  });

  constructor() {
    if (isDevMode()) {
      // Manual check helper: weights and the values they combine.
      effect(() => {
        const ov = this.overlaps();
        if (!ov || !this.data.ready()) {
          return;
        }
        const def = this.ui.activeDef();
        const values = this.activeValues();
        console.groupCollapsed(`[analysis] ${ov.length} overlapping cells · ${def.shortLabel} = ${this.activeValue()}`);
        console.table(
          ov.map(o => ({
            pointId: o.pointId,
            areaHa: +(o.areaM2 / 10000).toFixed(2),
            weight: +o.weight.toFixed(4),
            [def.field]: values.get(o.pointId)?.[def.field] ?? null,
          })),
        );
        console.groupEnd();
      });
    }
  }
}

export function weightedMean(field: NumericField, values: Map<number, CellValues>, scope: ScopeCell[]): number | null {
  let sum = 0;
  let w = 0;
  for (const s of scope) {
    const v = values.get(s.pointId)?.[field];
    if (v !== null && v !== undefined) {
      sum += v * s.weight;
      w += s.weight;
    }
  }
  return w > 0 ? sum / w : null;
}

export function aggregate(def: VarDef, values: Map<number, CellValues>, scope: ScopeCell[]): number | null {
  if (def.aggregate === 'min') {
    let min: number | null = null;
    for (const s of scope) {
      const v = values.get(s.pointId)?.[def.field];
      if (v !== null && v !== undefined && (min === null || v < min)) {
        min = v;
      }
    }
    return min;
  }
  return weightedMean(def.field, values, scope);
}

/** % (0–100) of the scope area whose value is below the threshold (nulls excluded). */
function shareBelow(field: NumericField, threshold: number, values: Map<number, CellValues>, scope: ScopeCell[]): number | null {
  let below = 0;
  let w = 0;
  for (const s of scope) {
    const v = values.get(s.pointId)?.[field];
    if (v !== null && v !== undefined) {
      w += s.weight;
      if (v < threshold) {
        below += s.weight;
      }
    }
  }
  return w > 0 ? (below / w) * 100 : null;
}

export function fmt(v: number | null | undefined, decimals: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) {
    return '–';
  }
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
