import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';

import { BASEMAPS, LABELS_OVERLAY } from '@/core/config/basemaps';
import { classesFor, MAP_STYLE, unitFor, VAR_BY_KEY } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { PropertyFeature } from '@/core/models';
import { AnalysisService, fmt } from '@/core/services/analysis.service';
import { DataService } from '@/core/services/data.service';
import { PropertyService } from '@/core/services/property.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { classIndex, cssToken, rampColor, rampGradient, rampStops } from '@/core/utils/color';
import { ZardSonnerService } from '@/shared/components/sonner';

import { LegendComponent } from './legend.component';
import { L } from './leaflet';

const EDIT_DEBOUNCE_MS = 150;

@Component({
  selector: 'af-map',
  imports: [LegendComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block relative h-full w-full' },
  template: `
    <div #mapEl class="absolute inset-0"></div>

    @if (data.status() === 'loading') {
      <div class="bg-background/40 absolute inset-0 z-1000 grid place-items-center">
        <span class="bg-card text-card-foreground rounded-md px-3 py-2 text-sm shadow">{{ s.map.loading }}</span>
      </div>
    }

    @if (data.ready() && !property.hasProperty()) {
      <div
        class="bg-card/95 text-card-foreground pointer-events-none absolute top-3 left-1/2 z-1000 -translate-x-1/2 rounded-full px-4 py-1.5 text-sm shadow"
      >
        {{ s.map.drawHint }}
      </div>
    }

    @if (data.ready()) {
      <af-legend
        class="absolute right-3 bottom-8 z-1000 w-64"
        [title]="ui.activeDef().label"
        [unit]="unit()"
        [classes]="ui.activeClasses()"
        [mode]="ui.renderMode()"
        [gradient]="gradient()"
        [rangeLabel]="rangeLabel()"
        [hovered]="ui.hoveredClass()"
        [provisional]="ui.activeDef().provisional"
        (hoverClass)="ui.hoveredClass.set($event)"
      />
    }
  `,
})
export class MapComponent {
  protected readonly s = STRINGS;
  protected readonly data = inject(DataService);
  protected readonly property = inject(PropertyService);
  protected readonly ui = inject(UiStateService);
  private readonly analysis = inject(AnalysisService);
  private readonly toast = inject(ZardSonnerService);

  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');

  private map?: Leaflet.Map;
  private readonly renderer = L.canvas({ padding: 0.5 });
  private cellGroup?: Leaflet.LayerGroup;
  private aoiLayer?: Leaflet.GeoJSON;
  private rects = new Map<number, Leaflet.Rectangle>();
  private propertyLayer: Leaflet.Polygon | null = null;
  private editTimer?: ReturnType<typeof setTimeout>;
  private resizeObserver?: ResizeObserver;
  private fittedToData = false;

  private readonly mapReady = signal(false);
  /** Bumped whenever the rectangles are rebuilt so the style effect re-runs. */
  private readonly cellsVersion = signal(0);

  protected readonly unit = computed(() => unitFor(this.ui.activeDef(), this.ui.period()));
  protected readonly gradient = computed(() => rampGradient(this.ui.activeDef(), this.ui.period()));
  protected readonly rangeLabel = computed(() => {
    const r = this.analysis.activeRange();
    const d = this.ui.activeDef().decimals;
    return r ? `${fmt(r.min, d)} – ${fmt(r.max, d)}` : '';
  });

  /** Returns a color for a value under the current variable / period / render mode. */
  private readonly colorFn = computed(() => {
    const def = this.ui.activeDef();
    const period = this.ui.period();
    const classes = classesFor(def, period);
    if (this.ui.renderMode() === 'continuous') {
      const stops = rampStops(def, period, this.analysis.activeRange());
      return (v: number | null | undefined) => rampColor(v, stops);
    }
    return (v: number | null | undefined) => {
      const i = classIndex(v, classes);
      return i < 0 ? null : classes[i].color;
    };
  });

  constructor() {
    afterNextRender(() => this.init());

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.editTimer);
      this.resizeObserver?.disconnect();
      this.map?.remove();
      this.map = undefined;
    });

    // Build one rectangle per grid cell (on the shared canvas renderer).
    effect(() => {
      const cells = this.data.cells();
      if (!this.mapReady() || !cells.length) {
        return;
      }
      untracked(() => this.buildCells());
    });

    // AOI outline + initial fit to the data bbox.
    effect(() => {
      const aoi = this.data.aoi();
      const manifest = this.data.manifest();
      if (!this.mapReady() || !aoi || !manifest || !this.map) {
        return;
      }
      untracked(() => {
        this.aoiLayer?.remove();
        this.aoiLayer = L.geoJSON(aoi, {
          interactive: false,
          pmIgnore: true,
          style: { color: cssToken('--map-aoi-stroke', '#ffffff'), weight: 1.5, dashArray: '6 4', fill: false },
        } as Leaflet.GeoJSONOptions).addTo(this.map!);
        if (!this.fittedToData && !this.propertyLayer) {
          const [w, s, e, n] = manifest.bbox;
          this.map!.fitBounds([
            [s, w],
            [n, e],
          ]);
        }
        this.fittedToData = true;
      });
    });

    // Re-color cells whenever variable, period, month, mode, hover or property changes.
    effect(() => {
      this.cellsVersion();
      const values = this.analysis.activeValues();
      const field = this.ui.activeDef().field;
      const color = this.colorFn();
      const classes = this.ui.activeClasses();
      const hovered = this.ui.hoveredClass();
      const overlaps = this.analysis.overlapByPoint();
      const hasProperty = this.property.hasProperty();
      const stroke = cssToken('--map-cell-stroke', '#ffffff');
      const activeStroke = cssToken('--map-cell-active-stroke', '#ffffff');

      for (const [pointId, rect] of this.rects) {
        const v = values.get(pointId)?.[field] ?? null;
        const fill = color(v);
        const inProperty = overlaps.has(pointId);
        let opacity = MAP_STYLE.cellOpacity;
        if (hovered !== null) {
          opacity = classIndex(v, classes) === hovered ? MAP_STYLE.cellHighlightOpacity : MAP_STYLE.cellDimmedOpacity;
        } else if (hasProperty && !inProperty) {
          opacity = MAP_STYLE.cellDimmedOpacity;
        }
        rect.setStyle({
          fillColor: fill ?? 'transparent',
          fillOpacity: fill ? opacity : 0,
          color: inProperty ? activeStroke : stroke,
          weight: inProperty ? 2 : 0.5,
          opacity: inProperty ? 1 : 0.35,
          dashArray: fill ? undefined : '3 3',
        });
      }
    });

    // Sync the property from outside the map (restore on load, import, clear).
    effect(() => {
      const state = this.property.state();
      if (!this.mapReady() || state.source !== 'external') {
        return;
      }
      untracked(() => this.renderExternalProperty(state.feature));
    });
  }

  private init(): void {
    const el = this.mapEl().nativeElement;
    const map = L.map(el, { zoomControl: true, minZoom: 8, maxZoom: 19 });

    const bases: Record<string, Leaflet.TileLayer> = {};
    for (const b of BASEMAPS) {
      bases[b.label] = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom });
    }
    bases[BASEMAPS[0].label].addTo(map);
    const labels = L.tileLayer(LABELS_OVERLAY.url, {
      attribution: LABELS_OVERLAY.attribution,
      maxZoom: LABELS_OVERLAY.maxZoom,
      pane: 'overlayPane',
    });
    L.control.layers(bases, { [LABELS_OVERLAY.label]: labels }, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    map.setView([9.8, -83.76], 10);

    this.cellGroup = L.layerGroup().addTo(map);
    this.setupGeoman(map);

    this.resizeObserver = new ResizeObserver(() => map.invalidateSize());
    this.resizeObserver.observe(el);

    this.map = map;
    this.mapReady.set(true);
  }

  private setupGeoman(map: Leaflet.Map): void {
    map.pm.setGlobalOptions({ snappable: false, allowSelfIntersection: false });
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawCircle: false,
      drawText: false,
      drawPolygon: true,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true,
      rotateMode: false,
    });

    map.on('pm:create', e => {
      const layer = (e as unknown as { layer: Leaflet.Polygon }).layer;
      const ok = this.pushFromLayer(layer, true);
      if (!ok) {
        layer.remove();
        return;
      }
      if (this.propertyLayer && this.propertyLayer !== layer) {
        this.propertyLayer.remove(); // one property for the MVP: the new one replaces the old
      }
      this.attach(layer);
      this.afterPropertyPlaced();
    });

    map.on('pm:remove', e => {
      const layer = (e as unknown as { layer: Leaflet.Layer }).layer;
      if (layer === this.propertyLayer) {
        this.propertyLayer = null;
        this.property.clear('map');
        this.toast.show(STRINGS.toasts.cleared);
      }
    });
  }

  /** Wire edit / drag events of the property polygon (debounced). */
  private attach(layer: Leaflet.Polygon): void {
    this.propertyLayer = layer;
    const schedule = () => {
      clearTimeout(this.editTimer);
      this.editTimer = setTimeout(() => this.pushFromLayer(layer, false), EDIT_DEBOUNCE_MS);
    };
    layer.on('pm:markerdrag pm:drag pm:edit pm:vertexadded pm:vertexremoved', schedule);
    // Outline only (with a faint fill so it stays clickable): the cells underneath show the values.
    layer.setStyle({
      color: cssToken('--map-property-stroke', '#ffffff'),
      weight: 3,
      fillColor: cssToken('--map-property-stroke', '#ffffff'),
      fillOpacity: MAP_STYLE.propertyFillOpacity,
    });
  }

  private pushFromLayer(layer: Leaflet.Polygon, notify: boolean): boolean {
    const f = layer.toGeoJSON() as PropertyFeature;
    if (f.geometry.type !== 'Polygon') {
      return false;
    }
    const result = this.property.set(f, 'map');
    if (!result.ok) {
      this.toast.error(STRINGS.toasts.selfIntersection);
      return false;
    }
    if (notify) {
      this.toast.success(STRINGS.toasts.saved);
    }
    return true;
  }

  private renderExternalProperty(feature: PropertyFeature | null): void {
    if (!this.map) {
      return;
    }
    this.propertyLayer?.remove();
    this.propertyLayer = null;
    if (!feature) {
      return;
    }
    const ring = feature.geometry.coordinates[0].map(([lon, lat]) => L.latLng(lat, lon));
    const layer = L.polygon(ring).addTo(this.map);
    this.attach(layer);
    this.afterPropertyPlaced();
  }

  private afterPropertyPlaced(): void {
    if (!this.map || !this.propertyLayer) {
      return;
    }
    this.map.fitBounds(this.propertyLayer.getBounds(), { padding: [60, 60], maxZoom: 16 });
    if (this.data.ready() && this.analysis.coverage() < 0.999) {
      this.toast.warning(STRINGS.toasts.outsideBbox);
    }
  }

  private buildCells(): void {
    if (!this.cellGroup) {
      return;
    }
    this.cellGroup.clearLayers();
    this.rects.clear();
    for (const c of this.data.cells()) {
      const rect = L.rectangle(c.bounds, {
        renderer: this.renderer,
        pmIgnore: true,
        weight: 0.5,
        fillOpacity: MAP_STYLE.cellOpacity,
      } as Leaflet.PolylineOptions);
      rect.bindTooltip(() => this.tooltipHtml(c.pointId, c.lat, c.lon), { sticky: true, direction: 'top' });
      rect.addTo(this.cellGroup);
      this.rects.set(c.pointId, rect);
    }
    this.cellsVersion.update(v => v + 1);
  }

  private tooltipHtml(pointId: number, lat: number, lon: number): string {
    const values = this.analysis.activeValues().get(pointId);
    const period = this.ui.period();
    const active = this.ui.activeDef();
    const t = STRINGS.tooltip;
    const row = (label: string, value: string) => `<div><span style="opacity:.7">${label}:</span> ${value}</div>`;
    const show = (key: keyof typeof VAR_BY_KEY) => {
      const d = VAR_BY_KEY[key];
      return row(d.shortLabel, `${fmt(values?.[d.field], d.decimals)} ${unitFor(d, period)}`);
    };
    const periodLabel =
      period === 'normal' ? STRINGS.header.annualNormal : `${STRINGS.monthsLong[this.ui.month() - 1]} (typical)`;
    const keys = (['ndvi', 'rain_mm', 'tmean_c', 'balance_mm'] as const).filter(k => k !== active.key);
    return [
      `<div style="font-weight:600">${t.point} ${pointId}</div>`,
      `<div style="font-weight:600">${show(active.key)}</div>`,
      ...keys.map(show),
      row(t.elevation, `${fmt(values?.elevation_m, 0)} m`),
      row(t.coords, `${lat.toFixed(4)}, ${lon.toFixed(4)}`),
      row(t.period, periodLabel),
    ].join('');
  }
}
