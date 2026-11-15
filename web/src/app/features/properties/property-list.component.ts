import { ChangeDetectionStrategy, Component, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideMap,
  lucidePencil,
  lucidePlus,
  lucideRefreshCw,
  lucideServerOff,
  lucideTrash2,
  lucideUpload,
} from '@ng-icons/lucide';
import { area } from '@turf/turf';

import { M2_PER_HECTARE, M2_PER_MANZANA } from '@/core/config/basemaps';
import { STRINGS } from '@/core/i18n/strings';
import type { SavedProperty } from '@/core/models';
import { fmt } from '@/core/services/analysis.service';
import { PropertyService } from '@/core/services/property.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardEmptyComponent } from '@/shared/components/empty';
import { ZardSkeletonComponent } from '@/shared/components/skeleton';

/** Left panel: the saved properties. Selecting one makes it the scope of the map and dashboard. */
@Component({
  selector: 'af-property-list',
  imports: [NgIcon, ZardButtonComponent, ZardEmptyComponent, ZardSkeletonComponent],
  providers: [
    provideIcons({
      lucideDownload,
      lucideMap,
      lucidePencil,
      lucidePlus,
      lucideRefreshCw,
      lucideServerOff,
      lucideTrash2,
      lucideUpload,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col bg-card text-card-foreground' },
  template: `
    <div class="flex items-baseline justify-between border-b px-3 py-2">
      <h2 class="text-sm font-semibold">{{ p.title }}</h2>
      @if (store.status() === 'ready') {
        <span class="text-muted-foreground text-xs tabular-nums">{{ store.properties().length }}</span>
      }
    </div>

    <div class="flex flex-wrap gap-1.5 border-b px-3 py-2">
      <button z-button zSize="sm" [zDisabled]="store.status() !== 'ready'" (click)="newProperty()">
        <ng-icon name="lucidePlus" />
        {{ p.newProperty }}
      </button>
      <input #fileInput type="file" accept=".geojson,.json,application/geo+json" class="hidden" (change)="onFile($event)" />
      <button z-button zType="outline" zSize="sm" [zDisabled]="store.status() !== 'ready'" (click)="fileInput.click()">
        <ng-icon name="lucideUpload" />
        {{ p.import }}
      </button>
      <button z-button zType="outline" zSize="sm" [zDisabled]="!store.properties().length" (click)="store.exportGeoJson('all')">
        <ng-icon name="lucideDownload" />
        {{ p.exportAll }}
      </button>
    </div>

    <div class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
      @switch (store.status()) {
        @case ('offline') {
          <z-empty zIcon="lucideServerOff" [zTitle]="p.offlineTitle" [zDescription]="store.offlineReason() === 'no-proxy' ? p.noProxyDescription : p.offlineDescription" />
          <div class="flex justify-center">
            <button z-button zType="outline" zSize="sm" (click)="store.retry()">
              <ng-icon name="lucideRefreshCw" />
              {{ p.retry }}
            </button>
          </div>
        }
        @case ('ready') {
          <button
            type="button"
            class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
            [class.bg-accent]="store.activeId() === null"
            [attr.aria-pressed]="store.activeId() === null"
            (click)="store.select(null)"
          >
            <ng-icon name="lucideMap" class="text-muted-foreground shrink-0" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ p.region }}</span>
              <span class="text-muted-foreground block text-xs">{{ p.regionSub }}</span>
            </span>
          </button>

          @for (item of store.properties(); track item.id) {
            <div
              role="button"
              tabindex="0"
              class="group hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5"
              [class.bg-accent]="store.activeId() === item.id"
              [class.ring-1]="store.activeId() === item.id"
              [class.ring-primary]="store.activeId() === item.id"
              [attr.aria-pressed]="store.activeId() === item.id"
              (click)="store.select(item.id)"
              (keydown.enter)="store.select(item.id)"
            >
              @if (editingId() === item.id) {
                <input
                  #renameInput
                  class="border-input bg-background min-w-0 flex-1 rounded border px-1.5 py-0.5 text-sm"
                  maxlength="120"
                  [value]="item.name"
                  [attr.aria-label]="p.rename"
                  (click)="$event.stopPropagation()"
                  (keydown.enter)="commitRename(item.id, renameInput.value)"
                  (keydown.escape)="editingId.set(null)"
                  (blur)="commitRename(item.id, renameInput.value)"
                />
              } @else {
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium" [title]="item.name">{{ item.name }}</span>
                  <span class="text-muted-foreground block text-xs tabular-nums">{{ areaLabel(item) }}</span>
                </span>
                <span class="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                  <button z-button zType="ghost" zSize="icon-xs" [title]="p.rename" (click)="startRename(item.id, $event)">
                    <ng-icon name="lucidePencil" />
                  </button>
                  <button z-button zType="ghost" zSize="icon-xs" [title]="p.exportOne" (click)="exportOne(item.id, $event)">
                    <ng-icon name="lucideDownload" />
                  </button>
                  <button z-button zType="ghost" zSize="icon-xs" [title]="p.delete" (click)="remove(item, $event)">
                    <ng-icon name="lucideTrash2" class="text-destructive" />
                  </button>
                </span>
              }
            </div>
          } @empty {
            <z-empty class="mt-4" zIcon="lucideMapPin" [zTitle]="p.emptyTitle" [zDescription]="p.emptyDescription" />
          }
        }
        @default {
          @for (i of [1, 2, 3]; track i) {
            <z-skeleton class="h-11 rounded-md" />
          }
        }
      }
    </div>
  `,
})
export class PropertyListComponent {
  protected readonly p = STRINGS.properties;
  protected readonly store = inject(PropertyService);
  private readonly ui = inject(UiStateService);

  protected readonly editingId = signal<number | null>(null);
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  /** Same Turf area as the dashboard (the API's ellipsoidal area differs by ~0.4 %), and live while editing. */
  protected areaLabel(item: SavedProperty): string {
    const m2 = area({ type: 'Feature', properties: {}, geometry: item.geometry });
    return `${fmt(m2 / M2_PER_HECTARE, 2)} ${STRINGS.units.ha} · ${fmt(m2 / M2_PER_MANZANA, 2)} ${STRINGS.units.mz}`;
  }

  protected newProperty(): void {
    this.ui.drawRequest.update(n => n + 1);
  }

  protected startRename(id: number, event: Event): void {
    event.stopPropagation();
    this.editingId.set(id);
    setTimeout(() => this.renameInput()?.nativeElement.select());
  }

  protected commitRename(id: number, value: string): void {
    if (this.editingId() !== id) {
      return; // Enter already committed; this is the blur that follows
    }
    this.editingId.set(null);
    void this.store.rename(id, value);
  }

  protected exportOne(id: number, event: Event): void {
    event.stopPropagation();
    this.store.select(id);
    this.store.exportGeoJson('active');
  }

  protected remove(item: SavedProperty, event: Event): void {
    event.stopPropagation();
    if (confirm(STRINGS.properties.confirmDelete(item.name))) {
      void this.store.remove(item.id);
    }
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      await this.store.importGeoJson(await file.text());
    }
  }
}
