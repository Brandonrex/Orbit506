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
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMove, lucidePencil } from '@ng-icons/lucide';
import type { Polygon } from 'geojson';
import type * as Leaflet from 'leaflet';

import { BASEMAPS, LABELS_OVERLAY } from '@/core/config/basemaps';
import { classesFor, MAP_STYLE, unitFor, VAR_BY_KEY } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { Overlap, PropertyFeature, SavedProperty } from '@/core/models';
import { AnalysisService, fmt } from '@/core/services/analysis.service';
import { DataService } from '@/core/services/data.service';
import { PropertyService } from '@/core/services/property.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { classIndex, cssToken, rampColor, rampStops } from '@/core/utils/color';

import { L } from './leaflet';
import { MAP_HINT_CLASS, MAP_TOOL_CLASS, MAP_TOOLBAR_CLASS } from './map-ui';

const EDIT_DEBOUNCE_MS = 150;
/** Property outlines sit above the cell canvas (overlayPane = 400) and below markers (600). */
const PROPERTY_PANE = 'properties';

interface PropertyLayer {
  layer: Leaflet.Polygon;
  /** The geometry object this layer was drawn from (or last pushed); compared by reference. */
  geometry: Polygon;
  active: boolean;
  name: string;
}

/** Boundary tool in use on the active land (Geoman global edit / drag mode). */
type EditTool = 'edit' | 'move' | null;

/**
 * Analysis map: environmental grid cells, the saved lands and the active land's boundary.
 * Layout follows the Figma land map card: the map, a floating text toolbar (top-right) with the
 * boundary tools, and an instruction strip underneath. Its height comes from the `--map-h` CSS
 * variable set by the parent.
 */
@Component({
  selector: 'af-map',
  imports: [NgIcon],
  providers: [provideIcons({ lucideMove, lucidePencil })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="relative isolate h-(--map-h,380px) w-full">
      <div #mapEl class="bg-secondary absolute inset-0 z-1" role="application" [attr.aria-label]="mapLabel()"></div>

      @if (data.status() === 'loading') {
        <div class="bg-background/40 absolute inset-0 z-1000 grid place-items-center">
          <span class="bg-card text-card-foreground shadow-lift rounded-sm border px-3 py-2 text-sm">{{ s.map.loading }}</span>
        </div>
      }

      @if (property.hasProperty()) {
        <div role="toolbar" [class]="toolbarClass" [attr.aria-label]="e.toolbar">
          <button type="button" [class]="toolClass" [attr.aria-pressed]="tool() === 'edit'" (click)="setTool('edit')">
            <ng-icon name="lucidePencil" size="18" />
            <span>{{ tool() === 'edit' ? e.done : e.edit }}</span>
          </button>
          <button type="button" [class]="toolClass" [attr.aria-pressed]="tool() === 'move'" (click)="setTool('move')">
            <ng-icon name="lucideMove" size="18" />
            <span>{{ tool() === 'move' ? e.done : e.move }}</span>
          </button>
        </div>
      }
    </div>
    <div [class]="hintClass" aria-live="polite">
      <ng-icon [name]="tool() ? 'fsPolygon' : 'fsPin'" size="16" class="text-primary shrink-0" />
      <span>{{ hint() }}</span>
    </div>
  `,
})
export class MapComponent {
  protected readonly s = STRINGS;
  protected readonly e = STRINGS.edit;
  protected readonly toolbarClass = MAP_TOOLBAR_CLASS;
  protected readonly toolClass = MAP_TOOL_CLASS;
  protected readonly hintClass = MAP_HINT_CLASS;
  protected readonly data = inject(DataService);
  protected readonly property = inject(PropertyService);
  protected readonly ui = inject(UiStateService);
  private readonly analysis = inject(AnalysisService);
  private readonly router = inject(Router);

  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');

  private map?: Leaflet.Map;
  private readonly renderer = L.canvas({ padding: 0.5 });
  private cellGroup?: Leaflet.LayerGroup;
  private clipGroup?: Leaflet.LayerGroup;
  private propertyGroup?: Leaflet.LayerGroup;
  private aoiLayer?: Leaflet.GeoJSON;
  private rects = new Map<number, Leaflet.Rectangle>();
  /** Part of the active property inside each cell, keyed by pointId. */
  private clips = new Map<number, Leaflet.GeoJSON>();
  private propertyLayers = new Map<number, PropertyLayer>();
  /** Active id the layers were last drawn for (undefined = never drawn). */
  private renderedActiveId: number | null | undefined = undefined;
  private editTimer?: ReturnType<typeof setTimeout>;
  private resizeObserver?: ResizeObserver;
  private fittedToData = false;

  private readonly mapReady = signal(false);
  private readonly zoom = signal(10);
  /** Bumped whenever the rectangles / clip pieces are rebuilt so the style effect re-runs. */
  private readonly cellsVersion = signal(0);
  private readonly clipsVersion = signal(0);

  protected readonly tool = signal<EditTool>(null);
  protected readonly hint = computed(() => {
    if (!this.property.hasProperty()) {
      return this.e.hintRegion;
    }
    const t = this.tool();
    return t === 'edit' ? this.e.hintEdit : t === 'move' ? this.e.hintMove : this.e.hintIdle;
  });
  protected readonly mapLabel = computed(() => {
    const name = this.property.active()?.name;
    return name ? STRINGS.land.mapLabel(name) : STRINGS.land.regionTitle;
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

    // Pieces of the active property inside each cell (recomputed when the property changes).
    effect(() => {
      const overlaps = this.analysis.overlaps();
      if (!this.mapReady()) {
        return;
      }
      untracked(() => this.buildClips(overlaps ?? []));
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
        if (!this.fittedToData && this.property.activeId() === null) {
          this.fitToData();
        }
        this.fittedToData = true;
      });
    });

    // Re-color cells whenever variable, period, month, mode, hover or property changes.
    effect(() => {
      this.cellsVersion();
      this.clipsVersion();
      const values = this.analysis.activeValues();
      const field = this.ui.activeDef().field;
      const color = this.colorFn();
      const classes = this.ui.activeClasses();
      const hovered = this.ui.hoveredClass();
      const overlaps = this.analysis.overlapByPoint();
      const hasProperty = this.property.hasProperty();
      const clipped = hasProperty && !this.ui.fullCells();
      // Zoomed in on a farm, one 5 km cell fills the screen: fade it so the imagery stays visible.
      const baseOpacity = this.zoom() >= MAP_STYLE.closeZoom ? MAP_STYLE.cellOpacityClose : MAP_STYLE.cellOpacity;
      const stroke = cssToken('--map-cell-stroke', '#ffffff');
      const activeStroke = cssToken('--map-cell-active-stroke', '#ffffff');
      const hoverOpacity = (v: number | null, normal: number) =>
        hovered === null ? normal : classIndex(v, classes) === hovered ? MAP_STYLE.cellHighlightOpacity : MAP_STYLE.cellDimmedOpacity;

      for (const [pointId, rect] of this.rects) {
        const v = values.get(pointId)?.[field] ?? null;
        const fill = color(v);
        const inProperty = overlaps.has(pointId);
        if (clipped) {
          // Only the cell outlines remain, for context; the clip pieces carry the color.
          rect.setStyle({
            fillOpacity: 0,
            color: inProperty ? activeStroke : stroke,
            weight: inProperty ? 1.5 : 0.5,
            opacity: inProperty ? 0.8 : 0.3,
            dashArray: inProperty ? '5 4' : undefined,
          });
          continue;
        }
        let opacity = hoverOpacity(v, baseOpacity);
        if (hovered === null && hasProperty && !inProperty) {
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

      if (this.map && this.clipGroup) {
        if (clipped && !this.map.hasLayer(this.clipGroup)) {
          this.clipGroup.addTo(this.map);
        } else if (!clipped && this.map.hasLayer(this.clipGroup)) {
          this.clipGroup.remove();
        }
      }
      if (clipped) {
        for (const [pointId, piece] of this.clips) {
          const v = values.get(pointId)?.[field] ?? null;
          const fill = color(v);
          piece.setStyle({
            stroke: false,
            fillColor: fill ?? 'transparent',
            fillOpacity: fill ? hoverOpacity(v, MAP_STYLE.clipOpacity) : 0,
          });
        }
      }
    });

    // Draw / redraw the saved properties (only the active one is editable).
    effect(() => {
      const list = this.property.properties();
      const activeId = this.property.activeId();
      if (!this.mapReady()) {
        return;
      }
      untracked(() => this.renderProperties(list, activeId));
    });
  }

  private init(): void {
    const el = this.mapEl().nativeElement;
    const map = L.map(el, { zoomControl: false, minZoom: 8, maxZoom: 19 });
    L.control.zoom({ position: 'topleft' }).addTo(map);

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
    L.control.layers(bases, { [LABELS_OVERLAY.label]: labels }, { position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    map.setView([9.8, -83.76], 10);

    map.createPane(PROPERTY_PANE).style.zIndex = '450';

    map.on('zoomend', () => this.zoom.set(map.getZoom()));
    this.cellGroup = L.layerGroup().addTo(map);
    this.clipGroup = L.layerGroup().addTo(map);
    this.propertyGroup = L.layerGroup().addTo(map);
    map.pm.setGlobalOptions({ snappable: false, allowSelfIntersection: false });

    this.resizeObserver = new ResizeObserver(() => map.invalidateSize());
    this.resizeObserver.observe(el);

    this.map = map;
    this.mapReady.set(true);
  }

  /** Toolbar: toggles Geoman's edit (vertices) or drag mode on the active land; the two are exclusive. */
  protected setTool(next: Exclude<EditTool, null>): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const target: EditTool = this.tool() === next ? null : next;
    this.disableTools();
    if (target === 'edit') {
      map.pm.enableGlobalEditMode();
    } else if (target === 'move') {
      map.pm.enableGlobalDragMode();
    }
    this.tool.set(target);
  }

  private disableTools(): void {
    const map = this.map;
    if (map?.pm.globalEditModeEnabled()) {
      map.pm.disableGlobalEditMode();
    }
    if (map?.pm.globalDragModeEnabled()) {
      map.pm.disableGlobalDragMode();
    }
    this.tool.set(null);
  }

  private renderProperties(list: SavedProperty[], activeId: number | null): void {
    if (!this.map || !this.propertyGroup) {
      return;
    }
    const activeChanged = this.renderedActiveId !== activeId;
    if (activeChanged) {
      // Edit / drag mode would otherwise stay bound to the previous property's layer.
      this.disableTools();
    }

    const ids = new Set(list.map(p => p.id));
    for (const [id, entry] of this.propertyLayers) {
      if (!ids.has(id)) {
        entry.layer.remove();
        this.propertyLayers.delete(id);
      }
    }
    for (const p of list) {
      const active = p.id === activeId;
      const entry = this.propertyLayers.get(p.id);
      if (entry && entry.geometry === p.geometry && entry.active === active) {
        if (entry.name !== p.name) {
          entry.name = p.name;
          entry.layer.setTooltipContent(p.name);
        }
        continue;
      }
      entry?.layer.remove();
      this.propertyLayers.set(p.id, { layer: this.makePropertyLayer(p, active), geometry: p.geometry, active, name: p.name });
    }

    const firstRender = this.renderedActiveId === undefined;
    this.renderedActiveId = activeId;
    if (activeChanged) {
      const layer = activeId !== null ? this.propertyLayers.get(activeId)?.layer : undefined;
      if (layer) {
        this.map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 16 });
      } else if (!firstRender) {
        this.fitToData();
      }
    }
  }

  private makePropertyLayer(p: SavedProperty, active: boolean): Leaflet.Polygon {
    const rings = p.geometry.coordinates.map(ring => ring.map(([lon, lat]) => L.latLng(lat, lon)));
    const color = cssToken('--map-property-stroke', '#ffffff');
    const layer = L.polygon(rings, {
      pane: PROPERTY_PANE,
      pmIgnore: !active,
      color,
      weight: active ? 3 : 2,
      opacity: active ? 1 : 0.85,
      dashArray: active ? undefined : '6 5',
      // A faint fill keeps the polygon clickable; the clip pieces underneath show the values.
      fillColor: color,
      fillOpacity: active ? MAP_STYLE.propertyFillOpacity : MAP_STYLE.propertyFillOpacity / 2,
      bubblingMouseEvents: false,
    } as Leaflet.PolylineOptions);
    layer.bindTooltip(p.name, { sticky: true, direction: 'top' });
    if (active) {
      const schedule = () => {
        clearTimeout(this.editTimer);
        this.editTimer = setTimeout(() => this.pushGeometry(p.id, layer), EDIT_DEBOUNCE_MS);
      };
      layer.on('pm:markerdrag pm:drag pm:edit pm:vertexadded pm:vertexremoved', schedule);
    } else {
      layer.on('click', () => void this.router.navigate(['/lands', p.id]));
    }
    layer.addTo(this.propertyGroup!);
    return layer;
  }

  /** Sends an edited geometry to the store. Records it first so the redraw effect skips this layer. */
  private pushGeometry(id: number, layer: Leaflet.Polygon): void {
    const f = layer.toGeoJSON() as PropertyFeature;
    const entry = this.propertyLayers.get(id);
    if (f.geometry.type !== 'Polygon' || !entry || entry.layer !== layer) {
      return;
    }
    entry.geometry = f.geometry;
    void this.property.updateGeometry(id, f.geometry);
  }

  private idOf(layer: Leaflet.Layer): number | null {
    for (const [id, entry] of this.propertyLayers) {
      if (entry.layer === layer) {
        return id;
      }
    }
    return null;
  }

  private fitToData(): void {
    const bbox = this.data.manifest()?.bbox;
    if (this.map && bbox) {
      const [w, s, e, n] = bbox;
      this.map.fitBounds([
        [s, w],
        [n, e],
      ]);
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

  private buildClips(overlaps: Overlap[]): void {
    if (!this.clipGroup) {
      return;
    }
    this.clipGroup.clearLayers();
    this.clips.clear();
    for (const o of overlaps) {
      const piece = L.geoJSON(o.geometry, {
        renderer: this.renderer,
        pmIgnore: true,
        interactive: false,
      } as Leaflet.GeoJSONOptions);
      piece.addTo(this.clipGroup);
      this.clips.set(o.pointId, piece);
    }
    this.clipsVersion.update(v => v + 1);
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
    const share = this.analysis.overlapByPoint().get(pointId);
    return [
      `<div style="font-weight:600">${t.point} ${pointId}</div>`,
      `<div style="font-weight:600">${show(active.key)}</div>`,
      ...keys.map(show),
      row(t.elevation, `${fmt(values?.elevation_m, 0)} m`),
      row(t.coords, `${lat.toFixed(4)}, ${lon.toFixed(4)}`),
      row(t.period, periodLabel),
      share ? row(t.propertyShare, `${fmt(share.weight * 100, 1)} %`) : '',
    ].join('');
  }
}
