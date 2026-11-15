import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { lucideMapPinOff, lucideTriangleAlert } from '@ng-icons/lucide';

import { classesFor, unitFor, VAR_BY_KEY, type VarDef } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { Period } from '@/core/models';
import { AnalysisService, fmt } from '@/core/services/analysis.service';
import { DataService } from '@/core/services/data.service';
import { PropertyService } from '@/core/services/property.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { classIndex } from '@/core/utils/color';
import { ZardCardImports } from '@/shared/components/card';
import { ZardEmptyComponent } from '@/shared/components/empty';
import { ZardSkeletonComponent } from '@/shared/components/skeleton';
import { ZardTableImports } from '@/shared/components/table';

import { ClassDistributionComponent } from './class-distribution.component';
import { HistogramComponent } from './histogram.component';
import { type KpiBadge, KpiCardComponent } from './kpi-card.component';
import { type ProfilePoint, ProfileChartComponent } from './profile-chart.component';

@Component({
  selector: 'af-dashboard',
  imports: [
    ZardCardImports,
    ZardEmptyComponent,
    ZardSkeletonComponent,
    ZardTableImports,
    KpiCardComponent,
    ClassDistributionComponent,
    HistogramComponent,
    ProfileChartComponent,
  ],
  providers: [provideIcons({ lucideTriangleAlert, lucideMapPinOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto bg-muted/40' },
  template: `
    <div class="space-y-3 p-3">
      @switch (data.status()) {
        @case ('error') {
          <z-empty zIcon="lucideTriangleAlert" [zTitle]="d.loadingError" [zDescription]="data.error() ?? ''" />
        }
        @case ('ready') {
          <!-- Scope banner -->
          @if (!analysis.isPropertyScope()) {
            <div class="bg-card text-card-foreground rounded-lg border border-dashed px-3 py-2 text-sm">
              {{ d.regionBanner }}
            </div>
          }

          <div class="flex items-baseline justify-between">
            <h2 class="text-base font-semibold">
              {{ analysis.isPropertyScope() ? d.propertyTitle : d.regionTitle }}
            </h2>
            <span class="text-muted-foreground text-xs">{{ periodLabel() }}</span>
          </div>

          @if (analysis.isEmpty()) {
            <z-empty class="bg-card rounded-lg border" zIcon="lucideMapPinOff" [zTitle]="d.emptyTitle" [zDescription]="d.emptyDescription" />
          } @else {
            <!-- KPIs -->
            <div class="grid grid-cols-2 gap-2 xl:grid-cols-3">
              @if (analysis.isPropertyScope()) {
                <af-kpi-card [label]="d.area" [value]="fmt(property.areaHa(), 2)" [unit]="u.ha" [sub]="fmt(property.areaMz(), 2) + ' ' + u.mz" />
                <af-kpi-card [label]="d.cells" [value]="'' + scopeCount()" [sub]="d.cellsSub(scopeCount())" />
              } @else {
                <af-kpi-card [label]="d.cells" [value]="'' + scopeCount()" [sub]="d.regionCellsSub" />
              }
              <af-kpi-card [label]="d.meanNdvi" [value]="fmt(k().ndvi, 2)" [badge]="badge(V.ndvi, k().ndvi)" />
              <af-kpi-card [label]="d.meanTemp" [value]="fmt(k().tmean, 1)" unit="°C" [badge]="badge(V.tmean_c, k().tmean)" />
              <af-kpi-card [label]="d.rain" [value]="fmt(k().rain, 0)" [unit]="unitOf(V.rain_mm)" [badge]="badge(V.rain_mm, k().rain)" />
              <af-kpi-card
                [label]="d.balance"
                [value]="fmt(k().balance, 0)"
                [unit]="unitOf(V.balance_mm)"
                [badge]="badge(V.balance_mm, k().balance)"
              />
              <af-kpi-card
                [label]="d.frost"
                [value]="k().frostClass?.label ?? '–'"
                [sub]="'coldest night ' + fmt(k().coldest, 1) + ' °C'"
                [badge]="k().frostClass ? { label: k().frostClass!.label, color: k().frostClass!.color } : null"
              />
              <af-kpi-card [label]="d.stressed" [value]="fmt(k().stressedPct, 0)" unit="%" [sub]="d.stressedSub" />
              <af-kpi-card [label]="d.waterDeficit" [value]="fmt(k().waterDeficitPct, 0)" unit="%" [sub]="d.waterDeficitSub" />
            </div>

            <!-- Class distribution -->
            <z-card>
              <z-card-header>
                <z-card-title [zTitle]="d.distribution + ' · ' + ui.activeDef().shortLabel" />
                <z-card-description [zDescription]="d.distributionSub" />
              </z-card-header>
              <z-card-content>
                <af-class-distribution
                  [shares]="analysis.classShares()"
                  [hovered]="ui.hoveredClass()"
                  (hoverClass)="ui.hoveredClass.set($event)"
                />
              </z-card-content>
            </z-card>

            <!-- Monthly profile -->
            <z-card>
              <z-card-header>
                <z-card-title [zTitle]="d.profile + ' · ' + ui.activeDef().shortLabel + unitSuffix()" />
                <z-card-description [zDescription]="d.profileSub" />
              </z-card-header>
              <z-card-content>
                <af-profile-chart
                  [points]="profile()"
                  [activeIndex]="ui.period() === 'month' ? ui.month() - 1 : null"
                  [seriesLabel]="ui.activeDef().shortLabel"
                  [decimals]="ui.activeDef().decimals"
                  (selectIndex)="ui.setMonth($event + 1)"
                />
              </z-card-content>
            </z-card>

            <!-- Histogram -->
            <z-card>
              <z-card-header>
                <z-card-title [zTitle]="d.histogram + ' · ' + ui.activeDef().shortLabel + unitSuffix()" />
                <z-card-description [zDescription]="d.histogramSub" />
              </z-card-header>
              <z-card-content>
                <af-histogram [bins]="analysis.histogram()" [marker]="analysis.histogramMarker()" [markerLabel]="d.propertyMarker" />
              </z-card-content>
            </z-card>

            <!-- Cells table -->
            @if (analysis.isPropertyScope()) {
              <z-card>
                <z-card-header>
                  <z-card-title [zTitle]="d.cellsTable" />
                  <z-card-description [zDescription]="d.weightingNote" />
                </z-card-header>
                <z-card-content>
                  <table z-table zSize="compact">
                    <thead z-table-header>
                      <tr z-table-row>
                        <th z-table-head>{{ t.point }}</th>
                        <th z-table-head class="text-right">{{ d.share }}</th>
                        <th z-table-head class="text-right">{{ ui.activeDef().shortLabel }}</th>
                        @if (ui.activeVar() !== 'ndvi') {
                          <th z-table-head class="text-right">NDVI</th>
                        }
                        <th z-table-head class="text-right">{{ t.elevation }}</th>
                      </tr>
                    </thead>
                    <tbody z-table-body>
                      @for (r of analysis.cellRows(); track r.pointId) {
                        <tr z-table-row>
                          <td z-table-cell>
                            <span class="mr-1.5 inline-block size-2.5 rounded-sm" [style.background]="r.color ?? 'transparent'"></span>
                            {{ r.pointId }}
                          </td>
                          <td z-table-cell class="text-right tabular-nums">{{ fmt(r.sharePct, 1) }}%</td>
                          <td z-table-cell class="text-right tabular-nums">{{ fmt(r.value, ui.activeDef().decimals) }}</td>
                          @if (ui.activeVar() !== 'ndvi') {
                            <td z-table-cell class="text-right tabular-nums">{{ fmt(r.ndvi, 2) }}</td>
                          }
                          <td z-table-cell class="text-right tabular-nums">{{ fmt(r.elevation, 0) }} m</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </z-card-content>
              </z-card>
            }
          }
        }
        @default {
          <div class="grid grid-cols-2 gap-2">
            @for (i of [1, 2, 3, 4, 5, 6]; track i) {
              <z-skeleton class="h-20 rounded-lg" />
            }
          </div>
          <z-skeleton class="h-32 rounded-lg" />
          <z-skeleton class="h-48 rounded-lg" />
          <z-skeleton class="h-48 rounded-lg" />
        }
      }
    </div>
  `,
})
export class DashboardComponent {
  protected readonly d = STRINGS.dashboard;
  protected readonly u = STRINGS.units;
  protected readonly t = STRINGS.tooltip;
  protected readonly V = VAR_BY_KEY;
  protected readonly fmt = fmt;

  protected readonly data = inject(DataService);
  protected readonly analysis = inject(AnalysisService);
  protected readonly property = inject(PropertyService);
  protected readonly ui = inject(UiStateService);

  protected readonly k = this.analysis.kpis;
  protected readonly scopeCount = computed(() => this.analysis.scope().length);

  protected readonly periodLabel = computed(() =>
    this.ui.period() === 'normal'
      ? STRINGS.header.annualNormal
      : `${STRINGS.monthsLong[this.ui.month() - 1]} · ${STRINGS.header.typicalMonth.toLowerCase()}`,
  );

  protected readonly unitSuffix = computed(() => {
    // The profile is always monthly, so show the monthly unit there.
    const unit = unitFor(this.ui.activeDef(), 'month');
    return unit ? ` (${unit})` : '';
  });

  protected readonly profile = computed<ProfilePoint[]>(() =>
    this.analysis.profile().map(p => ({ label: STRINGS.months[p.month - 1], value: p.value })),
  );

  protected unitOf(def: VarDef): string {
    return unitFor(def, this.ui.period());
  }

  protected badge(def: VarDef, value: number | null): KpiBadge | null {
    const period: Period = this.ui.period();
    const classes = classesFor(def, period);
    const i = classIndex(value, classes);
    if (i < 0) {
      return null;
    }
    // Numeric labels ("50–100") read worse than their meaning ("low rain") in a badge.
    const c = classes[i];
    return { label: /\d/.test(c.label) ? capitalize(c.meaning) : c.label, color: c.color };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
