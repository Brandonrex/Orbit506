import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { area, kinks } from '@turf/turf';
import type { Feature, GeoJsonObject, MultiPolygon, Polygon } from 'geojson';

import { ZardSonnerService } from '@/shared/components/sonner';

import { M2_PER_HECTARE, M2_PER_MANZANA } from '../config/basemaps';
import { STRINGS } from '../i18n/strings';
import type { PropertyFeature, SavedProperty } from '../models';
import { ApiError, type ApiErrorReason, PropertyApiService } from './property-api.service';

/** Where the single-property MVP kept its polygon. Migrated to the API once, then removed. */
const LEGACY_STORAGE_KEY = 'adaptive-farming.property.v1';

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'offline';

export type ValidationResult = { ok: true } | { ok: false; reason: 'self-intersection' | 'invalid' };

export interface ParsedFeature {
  feature: PropertyFeature;
  name: string | null;
}

/**
 * Signal store for the farmer's saved properties (persisted by the API in SQLite).
 *
 * `feature()` is the ACTIVE property: AnalysisService and the dashboard only read that, so
 * selecting another property recomputes the whole analysis for it.
 */
@Injectable({ providedIn: 'root' })
export class PropertyService {
  private readonly api = inject(PropertyApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ZardSonnerService);

  readonly properties = signal<SavedProperty[]>([]);
  readonly activeId = signal<number | null>(null);
  readonly status = signal<StoreStatus>('idle');
  /** Why the last load failed (shown in the properties panel while offline). */
  readonly offlineReason = signal<ApiErrorReason | null>(null);

  readonly active = computed(() => this.properties().find(p => p.id === this.activeId()) ?? null);

  /** Only changes when the active geometry changes (renaming does not re-run the analysis). */
  readonly feature = computed<PropertyFeature | null>(
    () => {
      const p = this.active();
      return p ? { type: 'Feature', properties: {}, geometry: p.geometry } : null;
    },
    { equal: (a, b) => a?.geometry === b?.geometry },
  );
  readonly hasProperty = computed(() => this.feature() !== null);
  readonly areaM2 = computed(() => {
    const f = this.feature();
    return f ? area(f) : 0;
  });
  readonly areaHa = computed(() => this.areaM2() / M2_PER_HECTARE);
  readonly areaMz = computed(() => this.areaM2() / M2_PER_MANZANA);

  /** Latest request number per property, so a slow older PATCH can't roll back a newer edit. */
  private readonly seq = new Map<number, number>();

  constructor() {
    // Keep ?p=<id> in the URL in sync with the active property.
    effect(() => {
      const id = this.activeId();
      if (this.status() !== 'ready') {
        return;
      }
      untracked(
        () => void this.router.navigate([], { queryParams: { p: id }, queryParamsHandling: 'merge', replaceUrl: true }),
      );
    });
  }

  async load(): Promise<void> {
    if (this.status() === 'loading' || this.status() === 'ready') {
      return;
    }
    this.status.set('loading');
    try {
      let list = await this.api.list();
      if (!list.length) {
        list = await this.migrateLegacy();
      }
      this.properties.set(list);
      const wanted = Number(new URLSearchParams(location.search).get('p'));
      this.activeId.set(list.find(p => p.id === wanted)?.id ?? list[0]?.id ?? null);
      this.status.set('ready');
    } catch (err) {
      this.offlineReason.set(err instanceof ApiError ? err.reason : 'unknown');
      this.status.set('offline');
      this.report(err);
    }
  }

  async retry(): Promise<void> {
    this.status.set('idle');
    await this.load();
  }

  select(id: number | null): void {
    this.activeId.set(id);
  }

  validate(f: PropertyFeature): ValidationResult {
    const ring = f.geometry?.coordinates?.[0];
    if (f.geometry?.type !== 'Polygon' || !ring || ring.length < 4) {
      return { ok: false, reason: 'invalid' };
    }
    if (kinks(f).features.length > 0) {
      return { ok: false, reason: 'self-intersection' };
    }
    return { ok: true };
  }

  /** Saves a new property and selects it. Returns null (and shows a toast) if it failed. */
  async create(f: PropertyFeature, name?: string): Promise<SavedProperty | null> {
    const v = this.validate(f);
    if (!v.ok) {
      this.toast.error(v.reason === 'self-intersection' ? STRINGS.toasts.selfIntersection : STRINGS.toasts.importError);
      return null;
    }
    try {
      const p = await this.api.create({ name: name?.trim() || this.nextName(), geometry: f.geometry });
      this.properties.update(list => [...list, p]);
      this.activeId.set(p.id);
      return p;
    } catch (err) {
      this.report(err);
      return null;
    }
  }

  /**
   * Optimistic geometry update (map edits). The local geometry object is kept as is, so the map
   * does not redraw the layer that is being edited when the response arrives.
   */
  async updateGeometry(id: number, geometry: Polygon): Promise<boolean> {
    const v = this.validate({ type: 'Feature', properties: {}, geometry });
    if (!v.ok) {
      this.toast.error(STRINGS.toasts.selfIntersection);
      return false;
    }
    const before = this.find(id);
    if (!before) {
      return false;
    }
    const n = this.bump(id);
    this.patchLocal(id, { geometry });
    try {
      const saved = await this.api.update(id, { geometry });
      if (this.seq.get(id) === n) {
        this.patchLocal(id, { areaM2: saved.areaM2, updatedAt: saved.updatedAt });
      }
      return true;
    } catch (err) {
      if (this.seq.get(id) === n) {
        this.patchLocal(id, { geometry: before.geometry });
      }
      this.report(err);
      return false;
    }
  }

  async rename(id: number, name: string): Promise<void> {
    const clean = name.trim();
    const before = this.find(id);
    if (!before || !clean || clean === before.name) {
      return;
    }
    this.patchLocal(id, { name: clean });
    try {
      const saved = await this.api.update(id, { name: clean });
      this.patchLocal(id, { updatedAt: saved.updatedAt });
    } catch (err) {
      this.patchLocal(id, { name: before.name });
      this.report(err);
    }
  }

  async remove(id: number): Promise<void> {
    const list = this.properties();
    const index = list.findIndex(p => p.id === id);
    if (index < 0) {
      return;
    }
    const wasActive = this.activeId() === id;
    const rest = list.filter(p => p.id !== id);
    this.properties.set(rest);
    if (wasActive) {
      this.activeId.set(rest[Math.min(index, rest.length - 1)]?.id ?? null);
    }
    try {
      await this.api.remove(id);
      this.toast.show(STRINGS.toasts.deleted(list[index].name));
    } catch (err) {
      if (err instanceof ApiError && err.reason === 'not-found') {
        return; // already gone
      }
      this.properties.set(list);
      if (wasActive) {
        this.activeId.set(id);
      }
      this.report(err);
    }
  }

  /** Creates one property per polygon in a GeoJSON text. Returns how many were saved. */
  async importGeoJson(text: string): Promise<number> {
    const parsed = this.parseGeoJson(text);
    if (!parsed.length) {
      this.toast.error(STRINGS.toasts.importError);
      return 0;
    }
    let saved = 0;
    for (const { feature, name } of parsed) {
      if (await this.create(feature, name ?? undefined)) {
        saved++;
      }
    }
    if (saved) {
      this.toast.success(saved === 1 ? STRINGS.toasts.imported : STRINGS.toasts.importedMany(saved));
    }
    return saved;
  }

  /** Downloads the active property, or all of them, as a GeoJSON FeatureCollection. */
  exportGeoJson(which: 'active' | 'all'): void {
    const list = which === 'all' ? this.properties() : [this.active()].filter((p): p is SavedProperty => !!p);
    if (!list.length) {
      return;
    }
    const fc = {
      type: 'FeatureCollection',
      features: list.map(p => ({
        type: 'Feature',
        properties: { id: p.id, name: p.name, notes: p.notes, area_ha: round(p.areaM2 / M2_PER_HECTARE) },
        geometry: p.geometry,
      })),
    };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = which === 'all' ? 'properties.geojson' : `${slug(list[0].name)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Every polygon in a GeoJSON text (MultiPolygons are split), with its name if it has one. */
  parseGeoJson(text: string): ParsedFeature[] {
    try {
      return collectPolygons(JSON.parse(text) as GeoJsonObject, null);
    } catch {
      return [];
    }
  }

  private find(id: number): SavedProperty | undefined {
    return this.properties().find(p => p.id === id);
  }

  private patchLocal(id: number, patch: Partial<SavedProperty>): void {
    this.properties.update(list => list.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }

  private bump(id: number): number {
    const n = (this.seq.get(id) ?? 0) + 1;
    this.seq.set(id, n);
    return n;
  }

  private nextName(): string {
    const names = new Set(this.properties().map(p => p.name));
    let n = this.properties().length + 1;
    while (names.has(STRINGS.properties.defaultName(n))) {
      n++;
    }
    return STRINGS.properties.defaultName(n);
  }

  private report(err: unknown): void {
    const reason = err instanceof ApiError ? err.reason : 'unknown';
    const t = STRINGS.toasts;
    const message =
      reason === 'offline'
        ? t.apiOffline
        : reason === 'no-proxy'
          ? t.apiNoProxy
          : reason === 'self-intersection'
            ? t.selfIntersection
            : t.saveError;
    this.toast.error(message);
    console.error('[properties]', err);
  }

  /** One-time move of the old localStorage polygon into the API. */
  private async migrateLegacy(): Promise<SavedProperty[]> {
    let legacy: PropertyFeature | null = null;
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      legacy = raw ? (collectPolygons(JSON.parse(raw) as GeoJsonObject, null)[0]?.feature ?? null) : null;
    } catch {
      return [];
    }
    if (!legacy || !this.validate(legacy).ok) {
      return [];
    }
    const p = await this.api.create({ name: STRINGS.properties.legacyName, geometry: legacy.geometry });
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // storage unavailable; the next load sees a non-empty list and skips the migration anyway
    }
    return [p];
  }
}

function collectPolygons(obj: GeoJsonObject | null | undefined, name: string | null): ParsedFeature[] {
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  const polygon = (geometry: Polygon): ParsedFeature => ({ feature: { type: 'Feature', properties: {}, geometry }, name });
  switch (obj.type) {
    case 'FeatureCollection':
      return ((obj as unknown as { features?: GeoJsonObject[] }).features ?? []).flatMap(f => collectPolygons(f, null));
    case 'Feature': {
      const f = obj as Feature;
      return collectPolygons(f.geometry, featureName(f.properties));
    }
    case 'Polygon':
      return [polygon(obj as Polygon)];
    case 'MultiPolygon': {
      const parts = (obj as MultiPolygon).coordinates;
      return parts.map((coordinates, i) => ({
        ...polygon({ type: 'Polygon', coordinates }),
        name: name && parts.length > 1 ? `${name} (${i + 1})` : name,
      }));
    }
    default:
      return [];
  }
}

function featureName(props: Feature['properties']): string | null {
  for (const key of ['name', 'Name', 'NAME', 'nombre', 'Nombre']) {
    const v = props?.[key];
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return null;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property';
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
