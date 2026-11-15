import { computed, effect, Injectable, signal } from '@angular/core';
import { area, kinks } from '@turf/turf';
import type { Feature, GeoJsonObject, MultiPolygon, Polygon } from 'geojson';

import { M2_PER_HECTARE, M2_PER_MANZANA } from '../config/basemaps';
import type { PropertyFeature } from '../models';

const STORAGE_KEY = 'adaptive-farming.property.v1';

/** Where a change came from: the map (already drawn there) or outside (import / restore / clear). */
export type PropertySource = 'map' | 'external';

export interface PropertyState {
  feature: PropertyFeature | null;
  source: PropertySource;
}

export type ValidationResult = { ok: true } | { ok: false; reason: 'self-intersection' | 'invalid' };

/** Signal store for the farmer's property (one polygon for the MVP). */
@Injectable({ providedIn: 'root' })
export class PropertyService {
  readonly state = signal<PropertyState>({ feature: loadFromStorage(), source: 'external' });

  readonly feature = computed(() => this.state().feature);
  readonly hasProperty = computed(() => this.feature() !== null);
  readonly areaM2 = computed(() => {
    const f = this.feature();
    return f ? area(f) : 0;
  });
  readonly areaHa = computed(() => this.areaM2() / M2_PER_HECTARE);
  readonly areaMz = computed(() => this.areaM2() / M2_PER_MANZANA);

  constructor() {
    effect(() => {
      const f = this.feature();
      try {
        if (f) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // storage unavailable (private mode); the app still works without persistence
      }
    });
  }

  validate(f: PropertyFeature): ValidationResult {
    const ring = f.geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) {
      return { ok: false, reason: 'invalid' };
    }
    if (kinks(f).features.length > 0) {
      return { ok: false, reason: 'self-intersection' };
    }
    return { ok: true };
  }

  /** Sets the property if valid. Returns the validation result. */
  set(f: PropertyFeature, source: PropertySource): ValidationResult {
    const clean: PropertyFeature = { type: 'Feature', properties: {}, geometry: f.geometry };
    const result = this.validate(clean);
    if (result.ok) {
      this.state.set({ feature: clean, source });
    }
    return result;
  }

  clear(source: PropertySource): void {
    this.state.set({ feature: null, source });
  }

  exportGeoJson(): void {
    const f = this.feature();
    if (!f) {
      return;
    }
    const fc = { type: 'FeatureCollection', features: [{ ...f, properties: { name: 'property', area_ha: round(this.areaHa()) } }] };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'property.geojson';
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Parses a GeoJSON text and returns its first polygon, or null. */
  parseGeoJson(text: string): PropertyFeature | null {
    try {
      return firstPolygon(JSON.parse(text) as GeoJsonObject);
    } catch {
      return null;
    }
  }
}

function firstPolygon(obj: GeoJsonObject | null | undefined): PropertyFeature | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  switch (obj.type) {
    case 'FeatureCollection': {
      for (const f of (obj as unknown as { features?: GeoJsonObject[] }).features ?? []) {
        const p = firstPolygon(f);
        if (p) {
          return p;
        }
      }
      return null;
    }
    case 'Feature':
      return firstPolygon((obj as Feature).geometry);
    case 'Polygon':
      return { type: 'Feature', properties: {}, geometry: obj as Polygon };
    case 'MultiPolygon': {
      const coords = (obj as MultiPolygon).coordinates[0];
      return coords ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } } : null;
    }
    default:
      return null;
  }
}

function loadFromStorage(): PropertyFeature | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const f = firstPolygon(JSON.parse(raw) as GeoJsonObject);
    return f && kinks(f).features.length === 0 ? f : null;
  } catch {
    return null;
  }
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
