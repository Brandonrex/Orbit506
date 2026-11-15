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
import { STRINGS } from '@/core/i18n/strings';
import { cssToken } from '@/core/utils/color';
import { ZardButtonComponent } from '@/shared/components/button';

import { L } from '../map/leaflet';
import { MAP_HINT_CLASS, MAP_TOOL_CLASS, MAP_TOOLBAR_CLASS } from '../map/map-ui';

export interface LatLng {
  lat: number;
  lng: number;
}

type DrawTool = 'point' | 'polygon' | null;

/**
 * Map used to place and outline a new land (Figma: InteractiveMap inside AddLandModal).
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
      class="bg-secondary relative z-1 h-[330px] w-full"
      role="application"
      [class.af-crosshair]="tool() === 'polygon'"
      [attr.aria-label]="t.mapLabel"
    ></div>

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
      <ng-icon [name]="tool() === 'polygon' || complete() ? 'fsPolygon' : 'fsPin'" size="16" class="text-primary shrink-0" />
      <span>{{ instruction() }}</span>
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
      this.resizeObserver?.disconnect();
      this.map?.remove();
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
    const map = L.map(this.mapEl().nativeElement, { center: [start.lat, start.lng], zoom: 14, zoomControl: false });
    L.control.zoom({ zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(map);
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
      this.point.set({ lat: ll.lat, lng: ll.lng });
    });

    this.vertices = L.layerGroup().addTo(map);
    this.preview = L.polyline([], { color: this.boundaryColor(), dashArray: '5 5', opacity: 0.8, weight: 2, interactive: false }).addTo(map);

    map.on('click', (e: Leaflet.LeafletMouseEvent) => {
      const next = { lat: e.latlng.lat, lng: e.latlng.lng };
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
        this.setBoundary(
          this.polygon().map((item, i) => (i === index ? { lat: ll.lat, lng: ll.lng } : item)),
          true,
        );
      });
    });
  }

  private boundaryColor(): string {
    return cssToken('--map-boundary', '#245c43');
  }
}
