import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideRefreshCw, lucideSatellite } from '@ng-icons/lucide';
import type { ECElementEvent } from 'echarts';

import { STRINGS } from '@/core/i18n/strings';
import type { DetailLayer } from '@/core/models';
import { DetailService, type DetailView } from '@/core/services/detail.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardChartImports, type ZardChartConfig, type ZardChartOptionOverride, type ZardChartSeries } from '@/shared/components/chart';
import { ZardToggleGroupComponent, type ZardToggleGroupItem } from '@/shared/components/toggle-group';

const D = STRINGS.detail;

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${STRINGS.months[m - 1]}`;
}

function monthLabel(p: string): string {
  if (p === 'latest') {
    return D.latest;
  }
  const [y, m] = p.split('-').map(Number);
  return `${STRINGS.months[m - 1]} ${String(y).slice(2)}`;
}

/**
 * Sentinel-2 10 m detail of the active land (Figma-style card under the land map): fetch status,
 * layer and date pickers that drive the map's detail layer, the legend with each class's share of
 * the land, and the time series of the land's mean (p10–p90 band). Data: DetailService.
 */
@Component({
  selector: 'af-detail-panel',
  imports: [DecimalPipe, NgIcon, ZardButtonComponent, ZardChartImports, ZardToggleGroupComponent],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideRefreshCw, lucideSatellite })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="bg-card shadow-soft overflow-hidden rounded-lg border" aria-labelledby="detail-title">
      <!-- Header -->
      <div class="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <span class="bg-accent text-primary flex size-10 shrink-0 items-center justify-center rounded-sm">
          <ng-icon name="lucideSatellite" size="19" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-primary text-[10px] font-bold tracking-widest uppercase">{{ d.eyebrow }}</p>
          <h2 id="detail-title" class="text-[20px] leading-tight tracking-[-0.02em]">{{ d.title }}</h2>
          <p class="text-muted-foreground mt-1 text-xs">{{ d.description }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <label class="flex cursor-pointer items-center gap-2 text-xs font-semibold">
            <input type="checkbox" class="accent-primary size-3.5" [checked]="detail.onMap()" (change)="detail.onMap.set($any($event.target).checked)" />
            {{ d.showOnMap }}
          </label>
          <button
            z-button
            zType="outline"
            type="button"
            class="size-9 p-0"
            [attr.aria-label]="d.refresh"
            [title]="d.refresh"
            [zDisabled]="detail.running()"
            (click)="detail.refresh()"
          >
            <ng-icon name="lucideRefreshCw" size="16" [class.animate-spin]="detail.running()" />
          </button>
        </div>
      </div>

      <!-- Status -->
      <div class="bg-background border-b px-5 py-3 text-xs" aria-live="polite">
        @if (detail.offline()) {
          <p class="text-status-unfavorable">{{ d.offline }}</p>
        } @else if (detail.running()) {
          <p class="font-semibold">{{ progressText() }}</p>
          <div class="bg-secondary mt-2 h-1.5 overflow-hidden rounded-full" role="progressbar" [attr.aria-valuenow]="progressPct()" aria-valuemin="0" aria-valuemax="100">
            <div class="bg-primary h-full transition-[width] duration-500" [style.width.%]="progressPct()"></div>
          </div>
        } @else if (failure(); as f) {
          <p class="text-status-unfavorable">{{ f }}</p>
        }
        @if (!detail.offline() && detail.status(); as st) {
          @if (st.scenesValid + st.scenesCloudy > 0) {
            <p class="text-muted-foreground" [class.mt-2]="detail.running() || failure()">
              {{ d.summary(st.scenesValid, st.scenesValid + st.scenesCloudy) }}
              @if (st.daysSinceClear !== null) {
                · <strong class="text-card-foreground">{{ d.lastClear(st.daysSinceClear) }}</strong>
              }
            </p>
          } @else if (!detail.running() && !failure()) {
            <p class="text-muted-foreground">{{ d.noneYet }}</p>
          }
        }
      </div>

      @if (detail.hasData()) {
        <!-- Layer + view -->
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 pt-4">
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-bold">{{ d.layer }}</span>
            <z-toggle-group zMode="single" zType="outline" zSize="sm" [zItems]="layerItems()" [zValue]="detail.layer()" (valueChange)="onLayer($event)" />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-bold">{{ d.view }}</span>
            <z-toggle-group zMode="single" zType="outline" zSize="sm" [zItems]="viewItems" [zValue]="detail.view()" (valueChange)="onView($event)" />
          </div>
        </div>

        <!-- Date / month picker: newest on the left, cloudy days greyed out -->
        <div class="flex items-center gap-2 px-5 pt-4">
          <button z-button zType="ghost" type="button" class="size-9 shrink-0 p-0" [attr.aria-label]="d.newer" (click)="detail.step(1)">
            <ng-icon name="lucideChevronLeft" size="16" />
          </button>
          <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="listbox" [attr.aria-label]="d.view">
            @if (detail.view() === 'scene') {
              @for (s of scenesNewestFirst(); track s.date) {
                <button
                  type="button"
                  role="option"
                  [class]="chipClass"
                  [attr.aria-selected]="s.date === detail.day()"
                  [disabled]="s.status !== 'valid'"
                  [title]="s.date + ' · ' + (s.status === 'valid' ? d.clearPct(s.validPct) : d.cloudy(s.validPct))"
                  (click)="detail.day.set(s.date)"
                >
                  {{ short(s.date) }}
                </button>
              }
            } @else {
              @for (c of monthsNewestFirst(); track c.period) {
                <button
                  type="button"
                  role="option"
                  [class]="chipClass"
                  [attr.aria-selected]="c.period === detail.month()"
                  [title]="c.period === 'latest' ? d.latestNote : d.monthDays(c.nDays)"
                  (click)="detail.month.set(c.period)"
                >
                  {{ month(c.period) }}
                </button>
              }
            }
          </div>
          <button z-button zType="ghost" type="button" class="size-9 shrink-0 p-0" [attr.aria-label]="d.older" (click)="detail.step(-1)">
            <ng-icon name="lucideChevronRight" size="16" />
          </button>
        </div>

        <!-- Selected date summary + legend with each class's share of the land -->
        <div class="grid gap-5 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div class="min-w-0 text-xs">
            @if (detail.def(); as def) {
              <div class="mb-2 flex items-baseline justify-between gap-2">
                <span class="text-[15px] font-bold tracking-[-0.015em]">{{ def.label }}</span>
                @if (detail.selectedStat()) {
                  <span class="text-muted-foreground">{{ d.shareOfLand }}</span>
                }
              </div>
              <ul class="space-y-0.5">
                @for (c of def.classes; track c.label) {
                  <li class="flex min-h-7 items-center gap-2 rounded-[6px] px-1.5 py-1">
                    <span class="mt-0.5 size-3 shrink-0 self-start rounded-sm border" [style.background]="c.color"></span>
                    <span class="flex min-w-0 flex-1 flex-col leading-snug">
                      <span class="font-semibold">{{ c.label }}</span>
                      <span class="text-muted-foreground">{{ c.meaning }}</span>
                    </span>
                    @if (share(c.label); as pct) {
                      <span class="flex w-24 shrink-0 items-center gap-1.5">
                        <span class="bg-secondary h-1.5 flex-1 overflow-hidden rounded-full">
                          <span class="block h-full" [style.width.%]="pct" [style.background]="c.color"></span>
                        </span>
                        <span class="w-9 text-right tabular-nums">{{ pct | number: '1.0-0' }}%</span>
                      </span>
                    }
                  </li>
                }
              </ul>
              @if (def.provisional) {
                <p class="text-muted-foreground mt-2 italic">⚠ {{ d.provisional }}</p>
              }
            }
          </div>

          <dl class="bg-background h-fit space-y-2 rounded-sm border p-3 text-xs">
            <div>
              <dt class="text-muted-foreground">{{ d.view }}</dt>
              <dd class="font-bold">{{ periodText() }}</dd>
            </div>
            @if (detail.selectedStat(); as st) {
              <div>
                <dt class="text-muted-foreground">{{ d.mean }}</dt>
                <dd class="text-[18px] font-bold tabular-nums">{{ st.mean | number: '1.2-2' }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">{{ d.range }}</dt>
                <dd class="font-semibold tabular-nums">{{ st.p10 | number: '1.2-2' }} – {{ st.p90 | number: '1.2-2' }}</dd>
              </div>
              <div>
                <dd class="text-muted-foreground">{{ d.clearPct(st.validPct) }}</dd>
              </div>
            } @else if (detail.view() === 'month' && monthInfo(); as info) {
              <div>
                <dd class="text-muted-foreground">{{ info }}</dd>
              </div>
            }
          </dl>
        </div>

        <!-- Time series (index layers) -->
        @if (rows(); as data) {
          <div class="border-t px-5 pt-4">
            <strong class="block text-[15px]">{{ d.series }}</strong>
            <p class="text-muted-foreground mt-1 text-xs">{{ d.seriesNote }}</p>
          </div>
          <z-chart
            class="h-[220px] px-2"
            zType="line"
            [zData]="data"
            zXAxisKey="label"
            [zSeries]="series"
            [zConfig]="config()"
            [zYAxis]="true"
            [zOption]="option()"
            [zAnimation]="false"
            (zChartClick)="onChartClick($event)"
          >
            <z-chart-tooltip />
          </z-chart>
        }
      }

      <p class="text-muted-foreground border-t px-5 py-2.5 text-[10px]">{{ detail.status()?.attribution }}</p>
    </section>
  `,
})
export class DetailPanelComponent {
  protected readonly d = D;
  protected readonly detail = inject(DetailService);
  protected readonly short = shortDate;
  protected readonly month = monthLabel;

  protected readonly chipClass =
    'border-border bg-background hover:bg-accent shrink-0 cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap tabular-nums ' +
    'aria-selected:border-primary aria-selected:bg-primary aria-selected:text-primary-foreground ' +
    'disabled:text-muted-foreground disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-50 disabled:hover:bg-background ' +
    'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none';

  protected readonly viewItems: ZardToggleGroupItem[] = [
    { value: 'scene', label: D.singleDate },
    { value: 'month', label: D.monthly },
  ];
  protected readonly layerItems = computed<ZardToggleGroupItem[]>(() => [
    { value: 'ndvi', label: 'NDVI' },
    { value: 'ndmi', label: 'NDMI' },
    { value: 'ndre', label: 'NDRE' },
    { value: 'days_since_clear', label: D.days },
  ]);

  /** Newest first, so the latest images are visible without scrolling. */
  protected readonly scenesNewestFirst = computed(() => [...this.detail.scenes()].reverse());
  protected readonly monthsNewestFirst = computed(() => [...this.detail.months()].reverse());

  protected readonly progressPct = computed(() => Math.round((this.detail.job()?.progress ?? 0) * 100));
  protected readonly progressText = computed(() => {
    const j = this.detail.job();
    if (!j || j.status === 'queued') {
      return D.queued;
    }
    return j.scenesFound ? D.fetching(j.scenesDone, j.scenesFound) : D.searching;
  });
  protected readonly failure = computed(() => {
    const j = this.detail.job();
    if (j?.status !== 'failed') {
      return null;
    }
    return j.errorReason === 'area-too-large' ? D.tooLarge : j.errorReason === 'interrupted' ? D.interrupted : `${D.failed} ${j.error ?? ''}`;
  });

  protected readonly periodText = computed(() => {
    const p = this.detail.period();
    return p ? D.periodLabel(p) : '–';
  });
  protected readonly monthInfo = computed(() => {
    const c = this.detail.composites().find(x => x.period === this.detail.month());
    return c ? (c.period === 'latest' ? D.latestNote : D.monthDays(c.nDays)) : null;
  });

  protected share(label: string): number | null {
    const v = this.detail.selectedStat()?.classDist[label];
    return v === undefined ? null : v;
  }

  // ---- time series ----
  protected readonly series: ZardChartSeries[] = [
    { dataKey: 'p10', type: 'line', showSymbol: false, strokeWidth: 1 },
    { dataKey: 'mean', type: 'line', showSymbol: true, symbolSize: 7, strokeWidth: 2.5 },
    { dataKey: 'p90', type: 'line', showSymbol: false, strokeWidth: 1 },
  ];

  protected readonly rows = computed(() => {
    if (this.detail.layer() === 'days_since_clear') {
      return null;
    }
    const stats = this.detail.stats();
    if (stats.length < 2) {
      return null;
    }
    return stats.map(s => ({ label: s.date, mean: round(s.mean), p10: round(s.p10), p90: round(s.p90) }));
  });

  protected readonly config = computed<ZardChartConfig>(() => {
    const name = this.detail.def()?.label.split(' – ')[0] ?? '';
    return {
      p10: { label: `${name} ${D.p10}`, color: 'var(--chart-3)' },
      mean: { label: `${name} ${D.mean.toLowerCase()}`, color: 'var(--chart-1)' },
      p90: { label: `${name} ${D.p90}`, color: 'var(--chart-3)' },
    };
  });

  protected readonly option = computed<ZardChartOptionOverride>(() => {
    const day = this.detail.view() === 'scene' ? this.detail.day() : null;
    return {
      xAxis: { axisLabel: { formatter: (v: string) => shortDate(v) } },
      series: [
        { lineStyle: { type: 'dashed' } },
        {
          markLine: day
            ? { silent: true, symbol: 'none', lineStyle: { color: 'var(--primary)', width: 1.5 }, label: { show: false }, data: [{ xAxis: day }] }
            : undefined,
        },
        { lineStyle: { type: 'dashed' } },
      ],
    } as ZardChartOptionOverride;
  });

  protected onChartClick(e: ECElementEvent): void {
    if (typeof e.name === 'string' && this.detail.validScenes().some(s => s.date === e.name)) {
      this.detail.view.set('scene');
      this.detail.day.set(e.name);
    }
  }

  protected onLayer(v: string | string[]): void {
    if (typeof v === 'string' && v) {
      this.detail.setLayer(v as DetailLayer);
    }
  }

  protected onView(v: string | string[]): void {
    if (v === 'scene' || v === 'month') {
      this.detail.setView(v as DetailView);
    }
  }
}

function round(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1000) / 1000;
}
