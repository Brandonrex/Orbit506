import { A11yModule } from '@angular/cdk/a11y';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { CARTAGO_CENTER, nearestPlace, type Place, PLACES, searchPlaces } from '@/core/config/places';
import { STRINGS } from '@/core/i18n/strings';
import type { PropertyFeature, SavedProperty } from '@/core/models';
import { PropertyService } from '@/core/services/property.service';
import { ZardButtonComponent } from '@/shared/components/button';

import { BoundaryDrawMapComponent, type LatLng } from './boundary-draw-map.component';

/**
 * "Add land" dialog (Figma: AddLandModal, integrated variant): name, location search, a map to
 * outline the land, the selected location, then Cancel / Continue. Saves the land and emits it.
 */
@Component({
  selector: 'af-add-land-dialog',
  imports: [A11yModule, NgIcon, ZardButtonComponent, BoundaryDrawMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fixed inset-0 z-1000 flex items-center justify-center bg-white/72 p-6 max-sm:p-0 dark:bg-black/60',
    '(mousedown)': 'onBackdrop($event)',
    '(document:keydown.escape)': 'onEscape()',
    '(document:mousedown)': 'onDocumentDown($event)',
  },
  template: `
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-land-title"
      aria-describedby="add-land-description"
      cdkTrapFocus
      class="bg-card shadow-modal flex max-h-[calc(100dvh-48px)] w-full max-w-[780px] flex-col overflow-hidden rounded-2xl border max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none"
    >
      <div class="flex items-start justify-between gap-6 border-b px-8 py-5 max-sm:px-4">
        <div>
          <p class="text-primary text-xs font-bold tracking-widest uppercase">{{ t.eyebrow }}</p>
          <h2 id="add-land-title" class="mt-1 text-[28px] leading-tight tracking-[-0.03em]">{{ t.title }}</h2>
          <p id="add-land-description" class="text-muted-foreground mt-2 max-w-[600px] text-sm">{{ t.description }}</p>
        </div>
        <button z-button zType="outline" type="button" class="size-11 shrink-0 p-0" [attr.aria-label]="t.close" (click)="cancel.emit()">
          <ng-icon name="fsClose" size="20" />
        </button>
      </div>

      <form class="flex min-h-0 flex-1 flex-col" novalidate (submit)="submit($event)">
        <div class="overflow-y-auto px-8 pt-5 pb-6 max-sm:px-4">
          <label class="flex flex-col gap-2" for="land-name">
            <span class="text-[13px] font-bold">{{ t.nameLabel }}</span>
            <input
              #nameInput
              id="land-name"
              type="text"
              required
              maxlength="120"
              autocomplete="off"
              [class]="inputClass"
              [class.border-destructive]="nameError()"
              [placeholder]="t.namePlaceholder"
              [value]="name()"
              [attr.aria-invalid]="!!nameError()"
              [attr.aria-describedby]="nameError() ? 'land-name-error' : null"
              (input)="onName($any($event.target).value)"
            />
            @if (nameError()) {
              <span id="land-name-error" class="text-destructive text-xs font-semibold">{{ nameError() }}</span>
            }
          </label>

          <div class="mt-5 border-t pt-5">
            <h3 class="text-[17px] tracking-[-0.015em]">{{ t.locationTitle }}</h3>
            <p class="text-muted-foreground mt-1 text-[13px]">{{ t.locationDescription }}</p>

            <div #searchField class="relative z-600 mt-4">
              <label class="mb-2 block text-[13px] font-bold" for="location-search">{{ t.searchLabel }}</label>
              <div
                class="border-input bg-card focus-within:border-primary focus-within:ring-primary/14 flex min-h-12 items-center rounded-sm border px-3 transition-[border-color,box-shadow] focus-within:ring-3"
              >
                <ng-icon name="fsSearch" size="19" class="text-muted-foreground shrink-0" />
                <input
                  id="location-search"
                  type="search"
                  role="combobox"
                  autocomplete="off"
                  aria-controls="location-suggestions"
                  aria-haspopup="listbox"
                  class="text-foreground placeholder:text-muted-foreground/80 min-h-[46px] w-full border-0 bg-transparent px-3 outline-none"
                  [attr.aria-expanded]="searchOpen()"
                  [placeholder]="t.searchPlaceholder"
                  [value]="search()"
                  (input)="onSearch($any($event.target).value)"
                  (focus)="searchOpen.set(true)"
                />
              </div>
              @if (searchOpen()) {
                <ul
                  id="location-suggestions"
                  role="listbox"
                  class="bg-card shadow-lift absolute inset-x-0 top-full mt-1 max-h-64 overflow-y-auto rounded-sm border p-1"
                >
                  @for (place of suggestions(); track place.label) {
                    <li>
                      <button
                        type="button"
                        role="option"
                        class="hover:bg-accent focus-visible:bg-accent flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2 text-left text-[13px] outline-none"
                        (click)="selectPlace(place)"
                      >
                        <ng-icon name="fsPin" size="18" class="text-primary shrink-0" />
                        <span>{{ place.label }}</span>
                      </button>
                    </li>
                  } @empty {
                    <li class="text-muted-foreground p-3 text-[13px]">{{ t.noResults }}</li>
                  }
                </ul>
              }
            </div>

            <af-boundary-draw-map
              #drawMap
              [point]="point()"
              (pointChange)="movePoint($event)"
              [(polygon)]="polygon"
              [(complete)]="complete"
            />

            <div class="bg-accent text-sage-text mt-3 flex items-center gap-3 rounded-sm px-4 py-3" aria-live="polite">
              <ng-icon name="fsPin" size="18" class="shrink-0" />
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-[10px] font-bold tracking-[0.04em] uppercase">{{ t.selected }}</span>
                <strong class="truncate text-[13px]">{{ locationLabel() }}</strong>
                @if (complete()) {
                  <small class="text-primary text-[10px] font-bold">{{ t.bounded }}</small>
                }
              </div>
              <code class="text-muted-foreground text-[10px]">{{ point().lat.toFixed(5) }}, {{ point().lng.toFixed(5) }}</code>
            </div>

            @if (boundaryError()) {
              <div role="alert" class="bg-destructive-subtle text-destructive-text mt-3 flex items-center gap-2 rounded-sm p-3 text-xs font-semibold">
                <ng-icon name="fsAlert" size="17" class="shrink-0" />
                {{ boundaryError() }}
              </div>
            }
          </div>
        </div>

        <div class="bg-card flex items-center justify-end gap-3 border-t px-8 py-4 max-sm:px-4">
          <button z-button zType="outline" zSize="xl" type="button" (click)="cancel.emit()">{{ t.cancel }}</button>
          <button z-button zSize="xl" type="submit" [zLoading]="saving()">
            {{ t.continue }}
            <ng-icon name="fsArrowRight" size="18" />
          </button>
        </div>
      </form>
    </section>
  `,
})
export class AddLandDialogComponent {
  protected readonly t = STRINGS.addLand;
  protected readonly inputClass =
    'border-input bg-card text-foreground placeholder:text-muted-foreground/80 focus:border-primary focus:ring-primary/14 min-h-12 rounded-sm border px-4 outline-none transition-[border-color,box-shadow] focus:ring-3';

  readonly cancel = output<void>();
  readonly created = output<SavedProperty>();

  private readonly store = inject(PropertyService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
  private readonly searchField = viewChild.required<ElementRef<HTMLDivElement>>('searchField');
  private readonly drawMap = viewChild.required(BoundaryDrawMapComponent);

  protected readonly name = signal('');
  protected readonly nameError = signal('');
  protected readonly search = signal('');
  protected readonly searchOpen = signal(false);
  protected readonly point = signal<LatLng>(CARTAGO_CENTER);
  /** Label picked from the search; cleared when the point is moved on the map. */
  private readonly pickedLabel = signal<string | null>(PLACES[0].label);
  protected readonly polygon = signal<LatLng[]>([]);
  protected readonly complete = signal(false);
  protected readonly boundaryError = signal('');
  protected readonly saving = signal(false);

  protected readonly suggestions = computed(() => searchPlaces(this.search()));
  protected readonly locationLabel = computed(() => {
    const picked = this.pickedLabel();
    if (picked) {
      return picked;
    }
    const p = this.point();
    return nearestPlace(p.lat, p.lng)?.label ?? this.t.pointOnMap;
  });

  constructor() {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => (document.body.style.overflow = previousOverflow));
    afterNextRender(() => this.nameInput().nativeElement.focus());
  }

  protected onName(value: string): void {
    this.name.set(value);
    if (value.trim()) {
      this.nameError.set('');
    }
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    this.searchOpen.set(true);
  }

  protected selectPlace(place: Place): void {
    const p = { lat: place.lat, lng: place.lng };
    this.point.set(p);
    this.pickedLabel.set(place.label);
    this.search.set(place.label);
    this.searchOpen.set(false);
    this.drawMap().flyTo(p);
  }

  protected movePoint(p: LatLng): void {
    this.point.set(p);
    this.pickedLabel.set(null);
    this.searchOpen.set(false);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    const name = this.name().trim();
    if (!name) {
      this.nameError.set(this.t.nameError);
      this.nameInput().nativeElement.focus();
      return;
    }
    const points = this.polygon();
    if (!this.complete() || points.length < 3) {
      this.boundaryError.set(this.t.boundaryError);
      return;
    }
    this.boundaryError.set('');

    const ring = points.map(p => [p.lng, p.lat]);
    ring.push(ring[0]);
    const feature: PropertyFeature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };

    this.saving.set(true);
    const saved = await this.store.create(feature, name);
    this.saving.set(false);
    if (saved) {
      this.created.emit(saved);
    }
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.host.nativeElement) {
      this.cancel.emit();
    }
  }

  protected onEscape(): void {
    if (this.searchOpen()) {
      this.searchOpen.set(false);
    } else {
      this.cancel.emit();
    }
  }

  protected onDocumentDown(event: MouseEvent): void {
    if (this.searchOpen() && !this.searchField().nativeElement.contains(event.target as Node)) {
      this.searchOpen.set(false);
    }
  }
}
