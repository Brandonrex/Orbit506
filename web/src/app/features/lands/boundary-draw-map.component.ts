import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type * as Leaflet from 'leaflet';

import { BASEMAPS, LABELS_OVERLAY } from '@/core/config/basemaps';
import { classesFor, MAP_STYLE, VAR_BY_KEY } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import { fmt } from '@/core/services/analysis.service';
import { DataService } from '@/core/services/data.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { classIndex, cssToken } from '@/core/utils/color';
import { ZardButtonComponent } from '@/shared/components/button';

import { L } from '../map/leaflet';
import { MAP_HINT_CLASS, MAP_TOOL_CLASS, MAP_TOOLBAR_CLASS } from '../map/map-ui';

export interface LatLng {
  lat: number;
  lng: number;
}

type DrawTool = 'point' | 'polygon' | null;

/** Data grid sits under the drawing (overlayPane = 400, markers = 600). */
const GRID_PANE = 'dataGrid';

/**
 * Map used to place and outline a new land (Figma: InteractiveMap inside AddLandModal).
 * Shows the same data grid as the land map (cells colored by the active variable, point centers,
 * data-area outline) and only accepts points inside the grid, so a land always has data.
 * Floating toolbar: mark a reference point, draw the boundary by clicking, reset. The polygon is
 * closed by clicking its first point or "Finish drawing"; once closed, its points can be dragged.
 */
@Component({
  selector: 'af-boundary-draw-map',
  imports: [NgIcon, ZardButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bg-card shadow-soft relative isolate mt-3 block overflow-hidden rounded-lg border' },
  template: `
    <div
      #mapEl
      class="bg-secondary relative z-1 h-[380px] w-full"
      role="application"
      [class.af-crosshair]="tool() === 'polygon'"
      [attr.aria-label]="t.mapLabel"
    ></div>

    <div class="bg-card/95 shadow-lift pointer-events-none absolute bottom-[44px] left-2 z-1000 rounded-sm border px-2.5 py-1.5 text-[10px] leading-snug">
      <strong class="block">{{ t.gridTitle }}</strong>
      <span class="text-muted-foreground">{{ t.gridNote(gridVar().shortLabel) }}</span>
    </div>

    <div role="toolbar" [class]="toolbarClass" [attr.aria-label]="t.toolbar">
      <button type="button" [class]="toolClass" [attr.aria-pressed]="tool() === 'point'" [title]="t.markPoint" (click)="togglePoint()">
        <ng-icon name="fsPin" size="18" />
        <span>{{ t.markPoint }}</span>
      </button>
      <button type="button" [class]="toolClass" [attr.aria-pressed]="tool() === 'polygon'" [title]="t.drawLand" (click)="startPolygon()">
        <ng-icon name="fsPolygon" size="18" />
        <span>{{ t.drawLand }}</span>
      </button>
      <button type="button" [class]="toolClass" [disabled]="!polygon().length" [title]="t.reset" (click)="resetPolygon()">
        <ng-icon name="fsReset" size="18" />
        <span>{{ t.reset }}</span>
      </button>
    </div>

    <div [class]="hintClass" aria-live="polite">
      @if (outside()) {
        <ng-icon name="fsAlert" size="16" class="text-destructive-text shrink-0" />
        <span class="text-destructive-text font-semibold" role="alert">{{ t.outside }}</span>
      } @else {
        <ng-icon [name]="tool() === 'polygon' || complete() ? 'fsPolygon' : 'fsPin'" size="16" class="text-primary shrink-0" />
        <span>{{ instruction() }}</span>
      }
      @if (tool() === 'polygon' && polygon().length >= 3 && !complete()) {
        <button z-button type="button" class="ml-auto min-h-9 shrink-0 rounded-[6px] px-3 text-[11px] font-bold" (click)="finish()">
          {{ t.finish }}
        </button>
      }
    </div>
  `,
})
export class BoundaryDrawMapComponent {
  protected readonly t = STRINGS.draw;
  protected readonly toolbarClass = MAP_TOOLBAR_CLASS;
  protected readonly toolClass = MAP_TOOL_CLASS;
  protected readonly hintClass = MAP_HINT_CLASS;

  /** Reference point (marker). */
  readonly point = model.required<LatLng>();
  /** Boundary points, in drawing order (not closed). */
  readonly polygon = model<LatLng[]>([]);
  /** True once the boundary is closed. */
  readonly complete = model(false);

  protected readonly tool = signal<DrawTool>(null);
  /** Set when the last click / drag fell outside the data grid. */
  protected readonly outside = signal(false);

  private readonly data = inject(DataService);
  private readonly ui = inject(UiStateService);
  /** Crop-fit tabs have no raw values, so the grid falls back to NDVI for them. */
  protected readonly gridVar = computed(() => {
    const def = this.ui.activeDef();
    return def.key === 'crop_thermal' || def.key === 'crop_rain' ? VAR_BY_KEY.ndvi : def;
  });
  private grid?: Leaflet.LayerGroup;
  private outsideTimer?: ReturnType<typeof setTimeout>;
  protected readonly instruction = computed(() => {
    if (this.complete()) {
      return this.t.hintDone;
    }
    if (this.tool() === 'polygon') {
      return this.polygon().length ? this.t.hintContinue : this.t.hintStart;
    }
    return this.t.hintIdle;
  });

  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  private map?: Leaflet.Map;
  private marker?: Leaflet.Marker;
  private shape?: Leaflet.Polygon | Leaflet.Polyline;
  private vertices?: Leaflet.LayerGroup;
  private preview?: Leaflet.Polyline;
  private resizeObserver?: ResizeObserver;
  private readonly ready = signal(false);

  constructor() {
    afterNextRender(() => this.init());
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.outsideTimer);
      this.resizeObserver?.disconnect();
      this.map?.remove();
    });

    // Data grid: one square per data point, colored like the land map.
    effect(() => {
      const cells = this.data.cells();
      const def = this.gridVar();
      const period = this.ui.period();
      const values = this.data.valuesFor(period, this.ui.month());
      const aoi = this.data.aoi();
      if (!this.ready() || !this.map) {
        return;
      }
      untracked(() => {
        this.grid?.remove();
        const grid = L.layerGroup();
        const renderer = L.canvas({ padding: 0.5, pane: GRID_PANE });
        const classes = classesFor(def, period);
        for (const c of cells) {
          const v = values.get(c.pointId)?.[def.field] ?? null;
          const i = classIndex(v, classes);
          L.rectangle(c.bounds, {
            renderer,
            pane: GRID_PANE,
            pmIgnore: true,
            color: '#ffffff',
            weight: 0.6,
            opacity: 0.7,
            fillColor: i >= 0 ? classes[i].color : 'transparent',
            fillOpacity: i >= 0 ? MAP_STYLE.cellOpacityClose + 0.1 : 0,
          } as Leaflet.PolylineOptions)
            .bindTooltip(`${STRINGS.tooltip.point} ${c.pointId} · ${def.shortLabel}: ${fmt(v, def.decimals)}`, { sticky: true, direction: 'top' })
            .addTo(grid);
          L.circleMarker([c.lat, c.lon], { renderer, pane: GRID_PANE, radius: 2.5, color: '#ffffff', weight: 1, fillColor: '#24352c', fillOpacity: 0.9, interactive: false }).addTo(grid);
        }
        if (aoi) {
          L.geoJSON(aoi, { pane: GRID_PANE, interactive: false, style: { color: '#ffffff', weight: 1.5, dashArray: '6 4', fill: false } } as Leaflet.GeoJSONOptions).addTo(grid);
        }
        grid.addTo(this.map!);
        this.grid = grid;
      });
    });

    effect(() => {
      const p = this.point();
      if (this.ready()) {
        this.marker?.setLatLng([p.lat, p.lng]);
      }
    });

    effect(() => {
      const points = this.polygon();
      const complete = this.complete();
      if (this.ready()) {
        untracked(() => this.renderBoundary(points, complete));
      }
    });
  }

  /** Pans to a searched location (Figma: focusRequest). */
  flyTo(p: LatLng): void {
    this.map?.flyTo([p.lat, p.lng], 15, { duration: 0.65 });
  }

  protected togglePoint(): void {
    this.tool.update(t => (t === 'point' ? null : 'point'));
  }

  protected startPolygon(): void {
    if (this.complete()) {
      if (!confirm(this.t.confirmReplace)) {
        return;
      }
      this.setBoundary([], false);
    }
    this.tool.set('polygon');
  }

  protected resetPolygon(): void {
    if (!this.polygon().length) {
      return;
    }
    if (this.complete() && !confirm(this.t.confirmReset)) {
      return;
    }
    this.setBoundary([], false);
    this.tool.set(null);
  }

  protected finish(): void {
    this.setBoundary(this.polygon(), true);
    this.tool.set(null);
  }

  private setBoundary(points: LatLng[], complete: boolean): void {
    this.polygon.set(points);
    this.complete.set(complete);
  }

  private init(): void {
    const start = this.point();
    const map = L.map(this.mapEl().nativeElement, { center: [start.lat, start.lng], zoom: 12, minZoom: 9, zoomControl: false });
    L.control.zoom({ zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(map);
    map.createPane(GRID_PANE).style.zIndex = '350';
    const base = BASEMAPS[0];
    L.tileLayer(base.url, { attribution: base.attribution, maxZoom: base.maxZoom }).addTo(map);
    L.tileLayer(LABELS_OVERLAY.url, { attribution: LABELS_OVERLAY.attribution, maxZoom: LABELS_OVERLAY.maxZoom }).addTo(map);

    const marker = L.marker([start.lat, start.lng], {
      draggable: true,
      title: this.t.marker,
      icon: L.divIcon({
        className: 'af-marker',
        html: '<span aria-hidden="true"><span></span></span>',
        iconAnchor: [18, 40],
        iconSize: [36, 40],
      }),
    }).addTo(map);
    marker.on('dragend', () => {
      const ll = marker.getLatLng();
      if (!this.inside(ll.lat, ll.lng)) {
        const p = this.point();
        marker.setLatLng([p.lat, p.lng]);
        return;
      }
      this.point.set({ lat: ll.lat, lng: ll.lng });
    });

    this.vertices = L.layerGroup().addTo(map);
    this.preview = L.polyline([], { color: this.boundaryColor(), dashArray: '5 5', opacity: 0.8, weight: 2, interactive: false }).addTo(map);

    map.on('click', (e: Leaflet.LeafletMouseEvent) => {
      const next = { lat: e.latlng.lat, lng: e.latlng.lng };
      const placing = this.tool() === 'point' || (this.tool() === 'polygon' && !this.complete());
      if (placing && !this.inside(next.lat, next.lng)) {
        return;
      }
      if (this.tool() === 'point') {
        this.point.set(next);
        this.tool.set(null);
        return;
      }
      if (this.tool() !== 'polygon' || this.complete()) {
        return;
      }
      const points = this.polygon();
      const duplicate = points.some(p => Math.abs(p.lat - next.lat) < 1e-7 && Math.abs(p.lng - next.lng) < 1e-7);
      if (!duplicate) {
        this.setBoundary([...points, next], false);
      }
    });

    map.on('mousemove', (e: Leaflet.LeafletMouseEvent) => {
      const points = this.polygon();
      if (this.tool() === 'polygon' && !this.complete() && points.length) {
        const last = points[points.length - 1];
        this.preview?.setLatLngs([
          [last.lat, last.lng],
          [e.latlng.lat, e.latlng.lng],
        ]);
      } else {
        this.preview?.setLatLngs([]);
      }
    });

    this.resizeObserver = new ResizeObserver(() => map.invalidateSize());
    this.resizeObserver.observe(this.mapEl().nativeElement);

    this.map = map;
    this.marker = marker;
    this.ready.set(true);
  }

  private renderBoundary(points: LatLng[], complete: boolean): void {
    const map = this.map;
    const vertices = this.vertices;
    if (!map || !vertices) {
      return;
    }
    this.shape?.remove();
    this.shape = undefined;
    vertices.clearLayers();
    this.preview?.setLatLngs([]);

    const color = this.boundaryColor();
    const latLngs = points.map(p => [p.lat, p.lng] as Leaflet.LatLngTuple);
    if (complete && points.length >= 3) {
      this.shape = L.polygon(latLngs, { color, fillColor: color, fillOpacity: 0.15, opacity: 0.95, weight: 3 }).addTo(map);
    } else if (points.length) {
      this.shape = L.polyline(latLngs, { color, opacity: 0.95, weight: 3 }).addTo(map);
    }

    const icon = L.divIcon({ className: 'af-vertex', html: '<span aria-hidden="true"></span>', iconAnchor: [8, 8], iconSize: [16, 16] });
    points.forEach((p, index) => {
      const vertex = L.marker([p.lat, p.lng], {
        draggable: complete,
        icon,
        keyboard: true,
        title: index === 0 && !complete && points.length >= 3 ? this.t.firstPoint : this.t.vertex(index + 1),
      }).addTo(vertices);
      vertex.on('click', () => {
        if (index === 0 && this.tool() === 'polygon' && this.polygon().length >= 3) {
          this.finish();
        }
      });
      vertex.on('dragend', () => {
        const ll = vertex.getLatLng();
        if (!this.inside(ll.lat, ll.lng)) {
          vertex.setLatLng([p.lat, p.lng]);
          return;
        }
        this.setBoundary(
          this.polygon().map((item, i) => (i === index ? { lat: ll.lat, lng: ll.lng } : item)),
          true,
        );
      });
    });
  }

  /** True when the point is inside a data cell; otherwise flags it for a few seconds. */
  private inside(lat: number, lng: number): boolean {
    const ok = this.data.cells().some(({ bounds: [[s, w], [n, e]] }) => lat >= s && lat <= n && lng >= w && lng <= e);
    if (!ok) {
      this.outside.set(true);
      clearTimeout(this.outsideTimer);
      this.outsideTimer = setTimeout(() => this.outside.set(false), 3500);
    } else {
      this.outside.set(false);
    }
    return ok;
  }

  private boundaryColor(): string {
    return cssToken('--map-boundary', '#245c43');
  }
}
