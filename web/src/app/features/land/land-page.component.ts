import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMapPinOff, lucideServerOff } from '@ng-icons/lucide';

import { unitFor } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import { AnalysisService, fmt } from '@/core/services/analysis.service';
import { CropDataService } from '@/core/services/crop-data.service';
import { PropertyService } from '@/core/services/property.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { rampGradient } from '@/core/utils/color';
import { landArea, landLocation } from '@/core/utils/land';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardEmptyComponent } from '@/shared/components/empty';
import { ZardSkeletonComponent } from '@/shared/components/skeleton';

import { DashboardComponent } from '../dashboard/dashboard.component';
import { DetailPanelComponent } from '../detail/detail-panel.component';
import { LegendComponent } from '../map/legend.component';
import { MapComponent } from '../map/map.component';
import { AnnualPlanComponent } from '../planning/annual-plan.component';
import { EnvironmentHistoryComponent } from '../planning/environment-history.component';
import { PlanningSectionComponent } from '../planning/planning-section.component';
import { ConditionsControlsComponent } from './conditions-controls.component';

/**
 * One land's analysis (Figma: PlanningWorkspace). `/lands/:id` focuses a land; `/region` shows the
 * whole data area. Layout: back link → title → conditions tabs → map with crop planning right below
 * (left) and the environmental chart, legend and KPIs (right) → annual plan → cells table.
 */
@Component({
  selector: 'af-land-page',
  imports: [
    RouterLink,
    NgIcon,
    ZardButtonComponent,
    ZardEmptyComponent,
    ZardSkeletonComponent,
    ConditionsControlsComponent,
    MapComponent,
    DetailPanelComponent,
    LegendComponent,
    DashboardComponent,
    EnvironmentHistoryComponent,
    PlanningSectionComponent,
    AnnualPlanComponent,
  ],
  providers: [provideIcons({ lucideMapPinOff, lucideServerOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block pt-1' },
  template: `
    <a
      z-button
      zType="ghost"
      routerLink="/"
      class="text-primary hover:bg-accent hover:text-primary -ml-2 min-h-11 gap-2 px-2 text-sm font-bold"
    >
      <ng-icon name="fsArrowLeft" size="18" />
      {{ t.back }}
    </a>

    @if (store.status() === 'offline' && !isRegion()) {
      <z-empty class="mt-16" zIcon="lucideServerOff" [zTitle]="l.offlineTitle" [zDescription]="l.offlineDescription" />
      <div class="flex justify-center">
        <button z-button zType="outline" zSize="xl" (click)="store.retry()">{{ l.retry }}</button>
      </div>
    } @else if (loading()) {
      <z-skeleton class="mt-8 h-24 w-2/3 rounded-lg" />
      <z-skeleton class="mt-12 h-[480px] rounded-lg" />
    } @else if (notFound()) {
      <z-empty class="mt-16" zIcon="lucideMapPinOff" [zTitle]="t.notFoundTitle" [zDescription]="t.notFoundDescription" />
    } @else {
      <header class="mt-8">
        <p class="text-primary text-xs font-bold tracking-widest uppercase">{{ isRegion() ? t.regionEyebrow : t.eyebrow }}</p>
        <h1 class="mt-2 text-[clamp(34px,4vw,48px)] leading-[1.12] tracking-[-0.04em] break-words">{{ title() }}</h1>
        <p class="text-muted-foreground mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <ng-icon name="fsPin" size="17" class="text-primary" />
          {{ location() }}
          @if (area(); as a) {
            <span>· {{ a }}</span>
          }
        </p>
      </header>

      <section class="mt-12" aria-labelledby="conditions-title">
        <h2 id="conditions-title" class="mt-1 text-[26px] leading-tight tracking-[-0.025em]">{{ t.conditionsTitle }}</h2>
        <p class="text-muted-foreground mt-1 text-[13px]">{{ t.conditionsDescription }} · {{ periodLabel() }}</p>

        <af-conditions-controls />

        <!-- Left: map, then crop planning right below it. Right: the environmental chart, legend, KPIs. -->
        <div class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_480px]">
          <div class="min-w-0 space-y-8">
            <div class="bg-card shadow-soft overflow-hidden rounded-lg border">
              <div class="flex min-h-[76px] items-center gap-3 px-5 py-4">
                <span class="bg-accent text-primary flex size-10 shrink-0 items-center justify-center rounded-sm">
                  <ng-icon name="fsPin" size="19" />
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                  <strong class="truncate text-sm">{{ title() }}</strong>
                  <small class="text-muted-foreground truncate text-[11px]">{{ location() }}</small>
                </div>
                @if (!isRegion()) {
                  <span class="bg-accent text-sage-text shrink-0 rounded-full px-3 py-1 text-[10px] font-bold">{{ t.boundarySaved }}</span>
                }
              </div>
              <af-map class="border-t [--map-h:520px]" />
            </div>
            @if (!isRegion()) {
              <af-detail-panel />
            }
            <af-planning-section [landId]="land()?.id ?? null" />
          </div>

          <aside class="min-w-0 space-y-5" [attr.aria-label]="t.summaryTitle">
            <af-environment-history />
            <div class="bg-card shadow-soft rounded-lg border p-5">
              <p class="text-primary mb-3 text-xs font-bold tracking-widest uppercase">{{ t.legendEyebrow }}</p>
              <af-legend
                [title]="legendTitle()"
                [unit]="unit()"
                [classes]="ui.activeClasses()"
                [mode]="ui.renderMode()"
                [gradient]="gradient()"
                [rangeLabel]="rangeLabel()"
                [hovered]="ui.hoveredClass()"
                [provisional]="ui.activeDef().provisional"
                [clipToggle]="store.hasProperty()"
                [fullCells]="ui.fullCells()"
                (hoverClass)="ui.hoveredClass.set($event)"
                (fullCellsChange)="ui.fullCells.set($event)"
              />
            </div>
            <af-dashboard section="kpis" />
          </aside>
        </div>

        @if (land()) {
          <af-annual-plan class="mt-10" />
        }
        <af-dashboard class="mt-6 block" section="table" />
      </section>
    }
  `,
})
export class LandPageComponent {
  protected readonly t = STRINGS.land;
  protected readonly l = STRINGS.lands;
  protected readonly store = inject(PropertyService);
  protected readonly ui = inject(UiStateService);
  private readonly analysis = inject(AnalysisService);
  private readonly crops = inject(CropDataService);

  /** Route param (`/lands/:id`); undefined on `/region`. */
  readonly id = input<string>();

  protected readonly isRegion = computed(() => this.id() === undefined);
  protected readonly land = computed(() => this.store.properties().find(p => p.id === Number(this.id())) ?? null);
  protected readonly loading = computed(() => !this.isRegion() && this.store.status() !== 'ready');
  protected readonly notFound = computed(() => !this.isRegion() && this.store.status() === 'ready' && !this.land());

  protected readonly title = computed(() => (this.isRegion() ? this.t.regionTitle : (this.land()?.name ?? '')));
  protected readonly location = computed(() => {
    const land = this.land();
    return this.isRegion() || !land ? this.t.regionLocation : landLocation(land.geometry);
  });
  protected readonly area = computed(() => {
    const land = this.land();
    return land ? landArea(land.geometry) : '';
  });

  protected readonly legendTitle = computed(() => {
    const crop = this.crops.crop(this.ui.crop());
    const def = this.ui.activeDef();
    return crop && (def.key === 'crop_thermal' || def.key === 'crop_rain') ? `${def.label} · ${crop.name}` : def.label;
  });
  protected readonly unit = computed(() => unitFor(this.ui.activeDef(), this.ui.period()));
  protected readonly gradient = computed(() => rampGradient(this.ui.activeDef(), this.ui.period()));
  protected readonly rangeLabel = computed(() => {
    const r = this.analysis.activeRange();
    const d = this.ui.activeDef().decimals;
    return r ? `${fmt(r.min, d)} – ${fmt(r.max, d)}` : '';
  });
  protected readonly periodLabel = computed(() =>
    this.ui.period() === 'normal'
      ? STRINGS.header.annualNormal
      : `${STRINGS.monthsLong[this.ui.month() - 1]} · ${STRINGS.header.typicalMonth.toLowerCase()}`,
  );

  constructor() {
    // The route decides the active land (the analysis, map and dashboard all follow it).
    effect(() => {
      const ready = this.store.status() === 'ready';
      if (this.isRegion()) {
        this.store.select(null);
      } else if (ready && this.land()) {
        this.store.select(this.land()!.id);
      }
    });
  }
}
