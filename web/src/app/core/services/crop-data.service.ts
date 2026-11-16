import { computed, effect, inject, Injectable, signal } from '@angular/core';

import type { Crop, CropPointSuitability, Period, SeriesMonth, StatusCode } from '../models';
import { DATA_URL, DataService, fetchJson, parseCsv } from './data.service';

type SuitabilityFile = Record<string, Record<string, CropPointSuitability>>;

/**
 * ECOCROP crops and the offline suitability results (thermal + rainfall), plus the yearly history
 * used by the environmental chart. Files come from web/scripts/prepare_data.py (public/data/crops/).
 *
 * Thermal and rainfall results are independent assessments and are never combined into one score.
 */
@Injectable({ providedIn: 'root' })
export class CropDataService {
  private readonly data = inject(DataService);

  readonly crops = signal<Crop[]>([]);
  private readonly suitabilityFile = signal<SuitabilityFile | null>(null);
  /** series[pointId][year] = 12 months. Loaded on demand. */
  private readonly series = signal<Map<number, Map<number, SeriesMonth[]>> | null>(null);
  private seriesLoading = false;

  readonly ready = computed(() => this.crops().length > 0 && this.suitabilityFile() !== null);
  readonly years = computed(() => this.data.manifest()?.years ?? []);
  readonly seriesReady = computed(() => this.series() !== null);

  constructor() {
    // Load once the manifest is known (it lists the file names).
    effect(() => {
      const files = this.data.manifest()?.files;
      if (files?.crops && files.suitability && !this.crops().length) {
        void this.load(files.crops, files.suitability);
      }
    });
  }

  crop(id: number | null): Crop | null {
    return this.crops().find(c => c.id === id) ?? null;
  }

  suitability(cropId: number, pointId: number): CropPointSuitability | null {
    return this.suitabilityFile()?.[cropId]?.[pointId] ?? null;
  }

  /**
   * Status code per point for the map layer / class distribution:
   * - thermal, typical month: that month's thermal status;
   *   annual normal: number of favorable months (0–12).
   * - rainfall, typical month: status of a planting started that month;
   *   annual normal: annual rainfall status.
   */
  statusCodes(cropId: number, kind: 'thermal' | 'rain', period: Period, month: number): Map<number, number> {
    const out = new Map<number, number>();
    const byPoint = this.suitabilityFile()?.[cropId];
    if (!byPoint) {
      return out;
    }
    for (const [pid, s] of Object.entries(byPoint)) {
      const code = statusCode(s, kind, period, month);
      if (code !== null) {
        out.set(Number(pid), code);
      }
    }
    return out;
  }

  /** 12 months of history for one point and year (null until series.csv is loaded). */
  seriesFor(pointId: number, year: number): SeriesMonth[] | null {
    return this.series()?.get(pointId)?.get(year) ?? null;
  }

  async loadSeries(): Promise<void> {
    const file = this.data.manifest()?.files.series;
    if (!file || this.series() || this.seriesLoading) {
      return;
    }
    this.seriesLoading = true;
    try {
      const rows = await parseCsv(DATA_URL + file);
      const map = new Map<number, Map<number, SeriesMonth[]>>();
      for (const r of rows) {
        const pid = Number(r['point_id']);
        const year = Number(r['year']);
        const byYear = map.get(pid) ?? new Map<number, SeriesMonth[]>();
        map.set(pid, byYear);
        const months = byYear.get(year) ?? [];
        byYear.set(year, months);
        months.push({
          month: Number(r['month']),
          ndvi: numOrNull(r['ndvi']),
          tmin_extreme_c: numOrNull(r['tmin_extreme_c']),
          rain_mm: numOrNull(r['rain_mm']),
          tmin_c: numOrNull(r['tmin_c']),
          tmax_c: numOrNull(r['tmax_c']),
          eto_mm: numOrNull(r['eto_mm']),
          balance_mm: numOrNull(r['balance_mm']),
          soil_wetness: numOrNull(r['soil_wetness']),
        });
      }
      for (const byYear of map.values()) {
        for (const months of byYear.values()) {
          months.sort((a, b) => a.month - b.month);
        }
      }
      this.series.set(map);
    } catch (err) {
      console.error('[crops] series load failed', err);
    } finally {
      this.seriesLoading = false;
    }
  }

  private async load(cropsFile: string, suitabilityFile: string): Promise<void> {
    try {
      const [crops, suitability] = await Promise.all([
        fetchJson<Crop[]>(DATA_URL + cropsFile),
        fetchJson<SuitabilityFile>(DATA_URL + suitabilityFile),
      ]);
      this.suitabilityFile.set(suitability);
      this.crops.set(crops);
    } catch (err) {
      console.error('[crops] load failed', err);
    }
  }
}

/** See CropDataService.statusCodes. Exported for tests. */
export function statusCode(
  s: CropPointSuitability,
  kind: 'thermal' | 'rain',
  period: Period,
  month: number,
): number | null {
  if (kind === 'thermal') {
    if (period === 'normal') {
      return s.t.filter(([, st]) => st === 2).length;
    }
    return known(s.t[month - 1]?.[1]);
  }
  return known(period === 'normal' ? s.a[1] : s.r[month - 1]?.[1]);
}

function known(code: StatusCode | undefined): number | null {
  return code === undefined || code < 0 ? null : code;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
