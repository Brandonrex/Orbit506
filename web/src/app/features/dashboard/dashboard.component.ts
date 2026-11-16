import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMapPinOff, lucideTriangleAlert } from '@ng-icons/lucide';

import { classesFor, STATUS_COLORS, unitFor, VAR_BY_KEY, type VarDef } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { Period } from '@/core/models';
import { AnalysisService, fmt } from '@/core/services/analysis.service';
import { CropDataService } from '@/core/services/crop-data.service';
import { DataService } from '@/core/services/data.service';
import { PropertyService } from '@/core/services/property.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { classIndex } from '@/core/utils/color';
import { ZardCardImports } from '@/shared/components/card';
import { ZardEmptyComponent } from '@/shared/components/empty';
import { ZardSkeletonComponent } from '@/shared/components/skeleton';
import { ZardTableImports } from '@/shared/components/table';

import { type KpiBadge, KpiCardComponent } from './kpi-card.component';

@Component({
  selector: 'af-dashboard',
  imports: [
    NgIcon,
    ZardCardImports,
    ZardEmptyComponent,
    ZardSkeletonComponent,
    ZardTableImports,
    KpiCardComponent,
  ],
  providers: [provideIcons({ lucideTriangleAlert, lucideMapPinOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @switch (data.status()) {
      @case ('error') {
        @if (section() === 'kpis') {
          <z-empty zIcon="lucideTriangleAlert" [zTitle]="d.loadingError" [zDescription]="data.error() ?? ''" />
        }
      }
      @case ('ready') {
        @switch (section()) {
          @case ('kpis') {
            <div class="space-y-4">
              @if (!analysis.isPropertyScope()) {
                <div class="bg-background text-muted-foreground flex items-center gap-2 rounded-sm border px-4 py-3 text-[13px]">
                  <ng-icon name="fsInfo" size="17" class="text-primary shrink-0" />
                  {{ d.regionBanner }}
                </div>
              }
              @if (analysis.isEmpty()) {
                <z-empty class="bg-card shadow-soft rounded-lg border" zIcon="lucideMapPinOff" [zTitle]="d.emptyTitle" [zDescription]="d.emptyDescription" />
              } @else {
                @if (crop(); as c) {
                  @if (analysis.cropKpis(); as ck) {
                    <p class="text-primary text-xs font-bold tracking-widest uppercase">{{ pl.cropKpis(c.name) }}</p>
                    <div class="grid grid-cols-2 gap-3">
                      <af-kpi-card [label]="pl.kpiFavMonths" [value]="'' + ck.favorableMonths" [sub]="pl.kpiFavMonthsSub" />
                      <af-kpi-card [label]="pl.kpiFavStarts" [value]="'' + ck.favorableStarts" [sub]="pl.kpiFavStartsSub" />
                      <af-kpi-card
                        [label]="pl.kpiNow"
                        [value]="fmt(ck.tempNow, 1)"
                        unit="°C"
                        [sub]="s.monthsLong[ui.month() - 1]"
                        [badge]="statusBadge(ck.thermalNow)"
                      />
                      <af-kpi-card [label]="pl.kpiArea" [value]="fmt(ck.favorableAreaPct, 0)" unit="%" [sub]="s.monthsLong[ui.month() - 1]" />
                      <af-kpi-card
                        class="col-span-2"
                        [label]="pl.kpiAnnualRain"
                        [value]="fmt(ck.annualRain[0], 0)"
                        unit="mm"
                        [sub]="pl.optimal + ': ' + c.rain.optMin + '–' + c.rain.optMax + ' mm'"
                        [badge]="statusBadge(ck.annualRain[1])"
                      />
                    </div>
                    <p class="text-muted-foreground text-xs font-bold tracking-widest uppercase">{{ d.conditions }}</p>
                  }
                }
                <div class="grid grid-cols-2 gap-3">
                  @if (analysis.isPropertyScope()) {
                    <af-kpi-card [label]="d.area" [value]="fmt(property.areaHa(), 2)" [unit]="u.ha" [sub]="fmt(property.areaMz(), 2) + ' ' + u.mz" />
                    <af-kpi-card [label]="d.cells" [value]="'' + scopeCount()" [sub]="d.cellsSub(scopeCount())" />
                  } @else {
                    <af-kpi-card class="col-span-2" [label]="d.cells" [value]="'' + scopeCount()" [sub]="d.regionCellsSub" />
                  }
                  <af-kpi-card [label]="d.meanNdvi" [value]="fmt(k().ndvi, 2)" [badge]="badge(V.ndvi, k().ndvi)" />
                  <af-kpi-card [label]="d.meanTemp" [value]="fmt(k().tmean, 1)" unit="°C" [badge]="badge(V.tmean_c, k().tmean)" />
                  <af-kpi-card [label]="d.rain" [value]="fmt(k().rain, 0)" [unit]="unitOf(V.rain_mm)" [badge]="badge(V.rain_mm, k().rain)" />
                  <af-kpi-card [label]="d.balance" [value]="fmt(k().balance, 0)" [unit]="unitOf(V.balance_mm)" [badge]="badge(V.balance_mm, k().balance)" />
                  <af-kpi-card
                    [label]="d.frost"
                    [value]="k().frostClass?.label ?? '–'"
                    [sub]="'coldest night ' + fmt(k().coldest, 1) + ' °C'"
                    [badge]="k().frostClass ? { label: k().frostClass!.label, color: k().frostClass!.color } : null"
                  />
                  <af-kpi-card [label]="d.stressed" [value]="fmt(k().stressedPct, 0)" unit="%" [sub]="d.stressedSub" />
                  <af-kpi-card class="col-span-2" [label]="d.waterDeficit" [value]="fmt(k().waterDeficitPct, 0)" unit="%" [sub]="d.waterDeficitSub" />
                </div>
              }
            </div>
          }
          @case ('table') {
            @if (analysis.isPropertyScope() && !analysis.isEmpty()) {
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
                  <p class="text-muted-foreground mt-2 text-xs">{{ d.resolutionNote(scopeCount()) }}</p>
                </z-card-content>
              </z-card>
            }
          }
        }
      }
      @default {
        @if (section() === 'kpis') {
          <div class="grid grid-cols-2 gap-3">
            @for (i of [1, 2, 3, 4, 5, 6]; track i) {
              <z-skeleton class="h-24 rounded-lg" />
            }
          </div>
        }
      }
    }
  `,
})
export class DashboardComponent {
  /** Which part to render; the land page places each part in its grid. */
  readonly section = input<'kpis' | 'table'>('kpis');

  protected readonly d = STRINGS.dashboard;
  protected readonly pl = STRINGS.planning;
  protected readonly s = STRINGS;
  protected readonly u = STRINGS.units;
  protected readonly t = STRINGS.tooltip;
  protected readonly V = VAR_BY_KEY;
  protected readonly fmt = fmt;

  protected readonly data = inject(DataService);
  protected readonly analysis = inject(AnalysisService);
  protected readonly property = inject(PropertyService);
  protected readonly ui = inject(UiStateService);
  private readonly crops = inject(CropDataService);

  protected readonly crop = computed(() => this.crops.crop(this.ui.crop()));

  protected readonly k = this.analysis.kpis;
  protected readonly scopeCount = computed(() => this.analysis.scope().length);

  protected statusBadge(code: number): KpiBadge | null {
    const label = code === 2 ? this.pl.favorable : code === 1 ? this.pl.caution : code === 0 ? this.pl.unfavorable : null;
    const color = code === 2 ? STATUS_COLORS.favorable : code === 1 ? STATUS_COLORS.caution : STATUS_COLORS.unfavorable;
    return label ? { label, color } : null;
  }

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
