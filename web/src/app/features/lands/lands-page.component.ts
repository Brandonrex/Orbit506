import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideRefreshCw, lucideServerOff } from '@ng-icons/lucide';

import { STRINGS } from '@/core/i18n/strings';
import type { SavedProperty } from '@/core/models';
import { PropertyService } from '@/core/services/property.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardEmptyComponent } from '@/shared/components/empty';
import { ZardSkeletonComponent } from '@/shared/components/skeleton';
import { ZardSonnerService } from '@/shared/components/sonner';

import { AddLandDialogComponent } from './add-land-dialog.component';
import { DeleteLandDialogComponent } from './delete-land-dialog.component';
import { LandCardComponent } from './land-card.component';

/**
 * Home page, "My lands" (Figma: /mis-terrenos). With no lands it shows the empty state
 * (node 1:463) whose action opens the add-land dialog; otherwise the grid of registered lands.
 */
@Component({
  selector: 'af-lands-page',
  imports: [
    RouterLink,
    NgIcon,
    ZardButtonComponent,
    ZardEmptyComponent,
    ZardSkeletonComponent,
    LandCardComponent,
    AddLandDialogComponent,
    DeleteLandDialogComponent,
  ],
  providers: [provideIcons({ lucideRefreshCw, lucideServerOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <input #fileInput type="file" accept=".geojson,.json,application/geo+json" class="hidden" (change)="onFile($event)" />

    <div class="flex items-end justify-between gap-8 max-sm:flex-col max-sm:items-stretch max-sm:gap-6">
      <div class="max-w-[507px]">
        <h1 class="text-[clamp(34px,4vw,46px)] leading-[1.15] tracking-[-0.04em]">{{ t.title }}</h1>
        <p class="text-muted-foreground mt-3 text-[17px] max-sm:text-[15px]">{{ t.description }}</p>
      </div>
      @if (hasLands()) {
        <div class="flex flex-wrap items-center gap-3 max-sm:flex-col max-sm:items-stretch">
          <a z-button zType="ghost" zSize="xl" routerLink="/region" class="text-primary hover:bg-accent hover:text-primary">{{ t.region }}</a>
          <button z-button zType="outline" zSize="xl" type="button" (click)="fileInput.click()">{{ t.import }}</button>
          <button z-button zSize="xl" type="button" (click)="adding.set(true)">
            <ng-icon name="fsPlus" size="19" />
            {{ t.add }}
          </button>
        </div>
      }
    </div>

    @switch (store.status()) {
      @case ('offline') {
        <section class="flex min-h-[540px] flex-col items-center justify-center px-6 py-16">
          <z-empty zIcon="lucideServerOff" [zTitle]="t.offlineTitle" [zDescription]="offlineDescription()" />
          <button z-button zType="outline" zSize="xl" type="button" (click)="store.retry()">
            <ng-icon name="lucideRefreshCw" />
            {{ t.retry }}
          </button>
        </section>
      }
      @case ('ready') {
        @if (hasLands()) {
          <section class="mt-16" aria-labelledby="lands-title">
            <div class="mb-6 flex items-center justify-between border-b pb-4">
              <h2 id="lands-title" class="text-lg tracking-[-0.015em]">{{ t.listTitle }}</h2>
              <p class="text-muted-foreground text-[13px] font-semibold">{{ t.count(store.properties().length) }}</p>
            </div>
            <div class="grid grid-cols-3 gap-5 max-[960px]:grid-cols-2 max-sm:grid-cols-1">
              @for (land of store.properties(); track land.id) {
                <af-land-card
                  [land]="land"
                  (view)="open(land.id)"
                  (remove)="pendingDelete.set(land)"
                  (rename)="store.rename(land.id, $event)"
                  (exportGeoJson)="exportOne(land.id)"
                />
              }
            </div>
          </section>
        } @else {
          <!-- Empty state (Figma node 1:463 "EmptyLandsScreen") -->
          <section class="flex min-h-[540px] flex-col items-center justify-center px-6 py-16 text-center" aria-labelledby="empty-title">
            <div
              aria-hidden="true"
              class="border-sage-border bg-secondary relative mb-8 flex size-[112px] -rotate-2 items-center justify-center rounded-2xl border"
            >
              <span class="border-sage-dashed absolute size-[78px] rounded-full border border-dashed"></span>
              <img class="relative z-2 rotate-2 dark:brightness-200" src="figma/empty-field.svg" width="42" height="42" alt="" />
              <span
                class="bg-primary border-background absolute -right-2 -bottom-2 z-3 flex size-[34px] rotate-2 items-center justify-center rounded-full border-[3px]"
              >
                <img src="figma/empty-pin.svg" width="18" height="18" alt="" />
              </span>
            </div>
            <div class="max-w-[570px]">
              <h2 id="empty-title" class="text-[clamp(24px,3vw,30px)] leading-[1.25] tracking-[-0.025em]">{{ t.emptyTitle }}</h2>
              <p class="text-muted-foreground mt-3 text-base">{{ t.emptyDescription }}</p>
            </div>
            <button z-button zSize="xl" type="button" class="mt-8" (click)="adding.set(true)">
              <img src="figma/plus.svg" width="19" height="19" alt="" />
              {{ t.addFirst }}
            </button>
            <button z-button zType="link" type="button" class="mt-3 text-[13px] font-semibold" (click)="fileInput.click()">
              {{ t.import }}
            </button>
          </section>
        }
      }
      @default {
        <section class="mt-16">
          <z-skeleton class="mb-6 h-10 rounded-sm" />
          <div class="grid grid-cols-3 gap-5 max-[960px]:grid-cols-2 max-sm:grid-cols-1">
            @for (i of [1, 2, 3]; track i) {
              <z-skeleton class="h-[262px] rounded-lg" />
            }
          </div>
        </section>
      }
    }

    @if (adding()) {
      <af-add-land-dialog (cancel)="adding.set(false)" (created)="onCreated($event)" />
    }
    @if (pendingDelete(); as land) {
      <af-delete-land-dialog [name]="land.name" (cancel)="pendingDelete.set(null)" (confirm)="confirmDelete(land)" />
    }
  `,
})
export class LandsPageComponent {
  protected readonly t = STRINGS.lands;
  protected readonly store = inject(PropertyService);
  private readonly router = inject(Router);
  private readonly toast = inject(ZardSonnerService);

  protected readonly adding = signal(false);
  protected readonly pendingDelete = signal<SavedProperty | null>(null);
  protected readonly hasLands = computed(() => this.store.status() === 'ready' && this.store.properties().length > 0);
  protected readonly offlineDescription = computed(() =>
    this.store.offlineReason() === 'no-proxy' ? STRINGS.properties.noProxyDescription : this.t.offlineDescription,
  );

  protected open(id: number): void {
    void this.router.navigate(['/lands', id]);
  }

  protected onCreated(land: SavedProperty): void {
    this.adding.set(false);
    this.toast.success(STRINGS.toasts.saved, { description: land.name });
    this.open(land.id);
  }

  protected confirmDelete(land: SavedProperty): void {
    this.pendingDelete.set(null);
    void this.store.remove(land.id);
  }

  protected exportOne(id: number): void {
    this.store.select(id);
    this.store.exportGeoJson('active');
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
