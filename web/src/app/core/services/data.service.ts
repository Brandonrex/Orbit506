import { computed, Injectable, isDevMode, signal } from '@angular/core';
import type { FeatureCollection } from 'geojson';
import Papa from 'papaparse';

import {
  type Cell,
  type CellValues,
  type FrostRisk,
  type LoadStatus,
  type Manifest,
  NUMERIC_FIELDS,
  type Period,
} from '../models';

export const DATA_URL = 'data/';

export type Row = Record<string, string | number | null>;

/**
 * Loads the prepared data from public/data/ (see web/scripts/prepare_data.py).
 * Later this can be swapped for an API without changing the consumers: they only read signals.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly manifest = signal<Manifest | null>(null);
  readonly aoi = signal<FeatureCollection | null>(null);
  readonly cells = signal<Cell[]>([]);

  /** monthly[m - 1] = Map<pointId, values> for typical month m. */
  private readonly monthly = signal<Map<number, CellValues>[]>([]);
  private readonly normal = signal<Map<number, CellValues>>(new Map());

  readonly ready = computed(() => this.status() === 'ready');

  async load(): Promise<void> {
    if (this.status() === 'loading' || this.status() === 'ready') {
      return;
    }
    this.status.set('loading');
    try {
      const manifest = await fetchJson<Manifest>(DATA_URL + 'manifest.json');
      const [monthRows, normalRows, aoi] = await Promise.all([
        parseCsv(DATA_URL + manifest.files.typical_month),
        parseCsv(DATA_URL + manifest.files.annual_normal),
        fetchJson<FeatureCollection>(DATA_URL + manifest.files.aoi),
      ]);

      const half = manifest.resolution_deg / 2;
      const cells: Cell[] = normalRows.map(r => {
        const lat = Number(r['lat']);
        const lon = Number(r['lon']);
        const [s, w, n, e] = [lat - half, lon - half, lat + half, lon + half];
        return {
          pointId: Number(r['point_id']),
          lat,
          lon,
          bounds: [
            [s, w],
            [n, e],
          ],
          polygon: {
            type: 'Feature',
            properties: { pointId: Number(r['point_id']) },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [w, s],
                  [e, s],
                  [e, n],
                  [w, n],
                  [w, s],
                ],
              ],
            },
          },
        };
      });

      const monthly = Array.from({ length: 12 }, () => new Map<number, CellValues>());
      for (const r of monthRows) {
        const m = Number(r['month']);
        if (m >= 1 && m <= 12) {
          monthly[m - 1].set(Number(r['point_id']), toValues(r));
        }
      }
      const normal = new Map<number, CellValues>();
      for (const r of normalRows) {
        normal.set(Number(r['point_id']), toValues(r));
      }

      this.manifest.set(manifest);
      this.aoi.set(aoi);
      this.cells.set(cells);
      this.monthly.set(monthly);
      this.normal.set(normal);
      this.status.set('ready');

      if (isDevMode()) {
        console.info(
          `[data] ${cells.length} cells, ${monthRows.length} typical-month rows, ${normalRows.length} normal rows`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.error.set(message);
      this.status.set('error');
      console.error('[data] load failed', err);
    }
  }

  /** Values for every point for the given period (month 1–12 ignored for 'normal'). */
  valuesFor(period: Period, month: number): Map<number, CellValues> {
    return period === 'normal' ? this.normal() : (this.monthly()[month - 1] ?? new Map());
  }

  /** The 12 typical months for each point. */
  allMonths(): Map<number, CellValues>[] {
    return this.monthly();
  }
}

function toValues(r: Row): CellValues {
  const v = {} as CellValues;
  for (const f of NUMERIC_FIELDS) {
    const x = r[f];
    v[f] = typeof x === 'number' && Number.isFinite(x) ? x : null;
  }
  v.frost_risk = (r['frost_risk'] ?? '') as FrostRisk;
  return v;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * The files are small (< 300 KB), so they are parsed on the main thread. For much larger
 * files switch to `worker: true` (PapaParse then needs its standalone script URL).
 */
export function parseCsv(url: string): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(url, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: result => {
        if (result.errors.length && !result.data.length) {
          reject(new Error(`${url}: ${result.errors[0].message}`));
        } else {
          resolve(result.data);
        }
      },
      error: (err: Error) => reject(new Error(`${url}: ${err.message}`)),
    });
  });
}
