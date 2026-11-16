import { computed, effect, inject, Injectable, isDevMode } from '@angular/core';
import { area, bbox, featureCollection, intersect } from '@turf/turf';

import { classesFor, KPI_THRESHOLDS, VAR_BY_KEY, type VarDef } from '../config/indices';
import type { CellValues, NumericField, Overlap, Period, StatusCode } from '../models';
import { classColor, classIndex } from '../utils/color';
import { CropDataService } from './crop-data.service';
import { DataService } from './data.service';
import { PropertyService } from './property.service';
import { UiStateService } from './ui-state.service';

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
  private readonly crops = inject(CropDataService);
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

  /** Values for the active period / month (with the crop-fit codes when a crop tab is active). */
  readonly activeValues = computed(() =>
    this.withCrop(this.data.valuesFor(this.ui.period(), this.ui.month()), this.ui.period(), this.ui.month()),
  );

  /**
   * The grid point whose ECOCROP results drive crop planning for the active land: the cell holding
   * the largest share of the land (suitability is precomputed per point, not per area).
   */
  readonly dominantPoint = computed(() => this.overlaps()?.[0]?.pointId ?? null);

  /** ECOCROP summary for the selected crop at the dominant point, plus the land's area by thermal status. */
  readonly cropKpis = computed(() => {
    const cropId = this.ui.crop();
    const pid = this.dominantPoint();
    if (cropId === null || pid === null) {
      return null;
    }
    const s = this.crops.suitability(cropId, pid);
    if (!s) {
      return null;
    }
    const month = this.ui.month();
    const thermalNow = this.crops.statusCodes(cropId, 'thermal', 'month', month);
    let favorableArea = 0;
    for (const sc of this.scope()) {
      if (thermalNow.get(sc.pointId) === 2) {
        favorableArea += sc.weight;
      }
    }
    return {
      favorableMonths: s.t.filter(([, st]) => st === 2).length,
      favorableStarts: s.r.filter(([, st]) => st === 2).length,
      thermalNow: s.t[month - 1]?.[1] ?? (-1 as StatusCode),
      tempNow: s.t[month - 1]?.[0] ?? null,
      rainStartNow: s.r[month - 1] ?? null,
      annualRain: s.a,
      favorableAreaPct: favorableArea * 100,
    };
  });

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

  /** Copies `values` with the selected crop's status code in crop_thermal / crop_rain (only for crop tabs). */
  private withCrop(values: Map<number, CellValues>, period: Period, month: number): Map<number, CellValues> {
    const key = this.ui.activeVar();
    const cropId = this.ui.crop();
    if ((key !== 'crop_thermal' && key !== 'crop_rain') || cropId === null) {
      return values;
    }
    const codes = this.crops.statusCodes(cropId, key === 'crop_thermal' ? 'thermal' : 'rain', period, month);
    const out = new Map<number, CellValues>();
    for (const [pid, v] of values) {
      out.set(pid, { ...v, [key]: codes.get(pid) ?? null });
    }
    return out;
  }

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
