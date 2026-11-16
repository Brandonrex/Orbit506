import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideCloudRain, lucideSun } from '@ng-icons/lucide';
import type { ECElementEvent } from 'echarts';

import { CROP_VARIABLES, VARIABLES } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { SeriesMonth, VarKey } from '@/core/models';
import { AnalysisService, weightedMean } from '@/core/services/analysis.service';
import { CropDataService } from '@/core/services/crop-data.service';
import { DataService } from '@/core/services/data.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { ZardButtonComponent } from '@/shared/components/button';
import {
  ZardChartImports,
  type ZardChartConfig,
  type ZardChartOptionOverride,
  type ZardChartSeries,
} from '@/shared/components/chart';
import { ZardSelectImports } from '@/shared/components/select';

import { PlanningStateService } from './planning-state.service';

const H = STRINGS.history;
const LABELS = STRINGS.months;
/** Fixed seasons for Cartago: Época Seca = December–April, Época Lluviosa = May–November. */
const DRY_MONTHS = new Set([12, 1, 2, 3, 4]);

type Key = 'ndvi' | 'rain_mm' | 'tmin_c' | 'tmax_c' | 'tmean_c' | 'tmin_extreme_c' | 'eto_mm' | 'balance_mm' | 'soil_wetness' | 'elevation_m';

interface ChartSpec {
  title: string;
  subtitle: string;
  unit: string;
  decimals: number;
  keys: { key: Key; label: string; type: 'line' | 'bar'; dashed?: boolean }[];
  /** Crop overlay this chart supports. */
  overlay?: 'temperature' | 'rain';
  /** Horizontal reference lines. */
  marks?: { value: number; label: string }[];
}

/** One chart per map tab, so every environmental variable has its history. */
function specFor(key: VarKey): ChartSpec {
  const def = [...VARIABLES, ...CROP_VARIABLES].find(v => v.key === key)!;
  const line = (k: Key, label = def.shortLabel) => [{ key: k, label, type: 'line' as const }];
  switch (key) {
    case 'tmean_c':
    case 'tmax_c':
    case 'tmin_c':
    case 'crop_thermal':
      return {
        title: STRINGS.planning.temperature,
        subtitle: H.minMax,
        unit: '°C',
        decimals: 1,
        overlay: 'temperature',
        keys: [
          { key: 'tmin_c', label: H.minimum, type: 'line' },
          { key: 'tmax_c', label: H.maximum, type: 'line', dashed: true },
        ],
      };
    case 'rain_mm':
    case 'crop_rain':
      return { title: 'Rainfall', subtitle: H.monthly, unit: 'mm', decimals: 0, overlay: 'rain', keys: [{ key: 'rain_mm', label: 'Rainfall', type: 'bar' }] };
    case 'tmin_extreme_c':
    case 'frost_risk':
      return {
        title: 'Coldest night',
        subtitle: H.minimum,
        unit: '°C',
        decimals: 1,
        keys: line('tmin_extreme_c', 'Coldest night'),
        marks: [
          { value: 2, label: H.frostLikely },
          { value: 5, label: H.frostPossible },
        ],
      };
    case 'balance_mm':
      return {
        title: def.label,
        subtitle: H.monthly,
        unit: 'mm',
        decimals: 0,
        keys: [{ key: 'balance_mm', label: def.shortLabel, type: 'bar' }],
        marks: [{ value: 0, label: H.zero }],
      };
    case 'eto_mm':
      return { title: def.label, subtitle: H.monthly, unit: 'mm', decimals: 0, keys: line('eto_mm') };
    case 'soil_wetness':
      return { title: def.label, subtitle: H.mean, unit: '0–1', decimals: 2, keys: line('soil_wetness') };
    case 'elevation_m':
      return { title: def.label, subtitle: H.staticNote, unit: 'm', decimals: 0, keys: line('elevation_m') };
    default:
      return { title: def.label, subtitle: H.mean, unit: def.unit, decimals: def.decimals, keys: line('ndvi') };
  }
}

/**
 * The environmental-variables chart: the single visualization of the land's data next to the map.
 * Follows the map's variable tab (also selectable here), with a year navigator and the fixed
 * Época Seca / Época Lluviosa. With a crop selected, temperature and rainfall show both its ECOCROP
 * optimal range (green band) and its windows (amber, click one to open it).
 */
@Component({
  selector: 'af-environment-history',
  imports: [NgIcon, ZardButtonComponent, ZardChartImports, ZardSelectImports],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideSun, lucideCloudRain })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <h2 class="text-[26px] leading-tight tracking-[-0.025em]">{{ h.title }}</h2>
    <p class="text-muted-foreground mt-2 text-[13px]">{{ h.description }}</p>

    <label class="mt-5 block">
      <span class="mb-2 block text-[13px] font-bold">{{ h.variable }}</span>
      <z-select class="w-full" [zValue]="ui.activeVar()" (zSelectionChange)="onVar($event)">
        @for (v of options(); track v.key) {
          <z-select-item [zValue]="v.key">{{ v.label }}</z-select-item>
        }
      </z-select>
    </label>

    <div class="bg-card shadow-soft mt-4 overflow-hidden rounded-lg border">
      <div class="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div class="min-w-0">
          <strong class="block text-[15px]">{{ spec().title }}</strong>
          <div class="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span>{{ spec().subtitle }}</span>
            @if (overlay()) {
              <span class="bg-accent text-sage-text rounded-full px-2.5 py-0.5 text-[10px] font-bold">{{ crop()?.name }}</span>
            } @else if (spec().overlay) {
              <span class="text-muted-foreground rounded-full border px-2.5 py-0.5 text-[10px] font-semibold">{{ h.noCrop }}</span>
            }
          </div>
        </div>
        <div class="bg-background flex shrink-0 items-center rounded-sm border">
          <button z-button zType="ghost" type="button" class="size-9 p-0" [attr.aria-label]="h.prevYear" [zDisabled]="!canStep(-1)" (click)="state.stepYear(-1)">
            <ng-icon name="lucideChevronLeft" size="16" />
          </button>
          <span class="min-w-12 text-center text-sm font-bold tabular-nums">{{ state.activeYear() }}</span>
          <button z-button zType="ghost" type="button" class="size-9 p-0" [attr.aria-label]="h.nextYear" [zDisabled]="!canStep(1)" (click)="state.stepYear(1)">
            <ng-icon name="lucideChevronRight" size="16" />
          </button>
        </div>
      </div>

      <div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-2.5 text-[11px]" aria-hidden="true">
        @for (k of spec().keys; track k.key; let i = $index) {
          <span class="flex items-center gap-1.5">
            @if (k.type === 'bar') {
              <i class="size-2.5 rounded-[2px]" [style.background]="colors[i]"></i>
            } @else {
              <i class="w-5 border-t-2" [style.border-color]="colors[i]" [style.border-top-style]="k.dashed ? 'dashed' : 'solid'"></i>
            }
            {{ k.label }}
          </span>
        }
        @for (m of spec().marks ?? []; track m.value) {
          <span class="flex items-center gap-1.5"><i class="border-muted-foreground w-5 border-t border-dashed"></i>{{ m.label }}</span>
        }
        @if (overlay(); as o) {
          @if (o === 'rain') {
            <span class="flex items-center gap-1.5"><i class="w-5 border-t-2 border-dotted" [style.border-color]="colors[2]"></i>{{ h.accumulated }}</span>
          }
          <span class="flex items-center gap-1.5"><i class="border-status-favorable/60 bg-status-favorable/20 size-2.5 border border-dashed"></i>{{ h.optimalRange }}</span>
          <span class="flex items-center gap-1.5"><i class="bg-season-dry border-season-dry-border size-2.5 border"></i>{{ h.window }}</span>
        }
      </div>

      @if (rows(); as data) {
        <z-chart
          class="h-[280px]"
          zType="line"
          [zData]="data"
          zXAxisKey="label"
          [zSeries]="series()"
          [zConfig]="config()"
          [zYAxis]="true"
          [zOption]="option()"
          [zAnimation]="false"
          (zChartClick)="onChartClick($event)"
        >
          <z-chart-tooltip [zValueFormatter]="formatter()" />
        </z-chart>
      } @else {
        <p class="text-muted-foreground grid h-[280px] place-items-center text-sm">{{ crops.seriesReady() ? h.noData : h.loading }}</p>
      }

      <!-- Época Seca / Época Lluviosa (fixed) -->
      <div class="bg-background border-t px-5 py-4">
        <div class="grid grid-cols-12 gap-0.5" aria-hidden="true">
          @for (m of monthNumbers; track m) {
            <span class="flex flex-col items-center gap-1">
              <span class="h-2 w-full rounded-[2px] border" [class]="dry(m) ? 'bg-season-dry border-season-dry-border' : 'bg-season-rainy border-season-rainy-border'"></span>
              <span class="text-muted-foreground text-[9px]">{{ labels[m - 1] }}</span>
            </span>
          }
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <div class="bg-season-dry border-season-dry-border text-season-dry-text flex items-center gap-2 rounded-sm border px-3 py-2">
            <ng-icon name="lucideSun" size="20" class="shrink-0" />
            <span class="min-w-0">
              <strong class="block text-xs">{{ h.drySeason }}</strong>
              <small class="block text-[11px]">{{ h.drySeasonMonths }}</small>
            </span>
          </div>
          <div class="bg-season-rainy border-season-rainy-border text-season-rainy-text flex items-center gap-2 rounded-sm border px-3 py-2">
            <ng-icon name="lucideCloudRain" size="20" class="shrink-0" />
            <span class="min-w-0">
              <strong class="block text-xs">{{ h.rainySeason }}</strong>
              <small class="block text-[11px]">{{ h.rainySeasonMonths }}</small>
            </span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class EnvironmentHistoryComponent {
  protected readonly h = H;
  protected readonly labels = LABELS;
  protected readonly monthNumbers = Array.from({ length: 12 }, (_, i) => i + 1);
  protected readonly colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-4)'];

  protected readonly state = inject(PlanningStateService);
  protected readonly crops = inject(CropDataService);
  protected readonly ui = inject(UiStateService);
  private readonly data = inject(DataService);
  private readonly analysis = inject(AnalysisService);

  protected readonly options = computed(() => (this.ui.crop() === null ? VARIABLES : [...VARIABLES, ...CROP_VARIABLES]));
  protected readonly spec = computed(() => specFor(this.ui.activeVar()));
  protected readonly crop = this.state.crop;
  /** Crop overlay drawn on this chart, if any. */
  protected readonly overlay = computed(() => (this.state.suitability() ? (this.spec().overlay ?? null) : null));
  protected readonly formatter = computed(() => {
    const d = this.spec().decimals;
    return (v: number) => (typeof v === 'number' ? v.toFixed(d) : String(v));
  });

  /** 12 months for the land's dominant point, or the mean of every point in the region view. */
  private readonly months = computed<SeriesMonth[] | null>(() => {
    const year = this.state.activeYear();
    if (year === null || !this.crops.seriesReady()) {
      return null;
    }
    const pid = this.state.point();
    return pid !== null ? this.crops.seriesFor(pid, year) : this.regionMean(year);
  });

  /** Elevation is static: area-weighted over the land (or the region). */
  private readonly elevation = computed(() => weightedMean('elevation_m', this.data.valuesFor('normal', 1), this.analysis.scope()));

  protected readonly rows = computed(() => {
    const months = this.months();
    if (!months?.length) {
      return null;
    }
    const s = this.state.suitability();
    return months.map((m, i) => {
      const row: Record<string, string | number | null> = { label: LABELS[i] };
      for (const k of this.spec().keys) {
        row[k.key] = this.value(m, k.key);
      }
      if (this.overlay() === 'rain' && s) {
        row['acc'] = s.r[i]?.[0] ?? null;
      }
      return row;
    });
  });

  protected readonly series = computed<ZardChartSeries[]>(() => {
    const base: ZardChartSeries[] = this.spec().keys.map(k => ({
      dataKey: k.key,
      type: k.type,
      showSymbol: k.type === 'line',
      symbolSize: 7,
      strokeWidth: 2.5,
    }));
    return this.overlay() === 'rain' ? [...base, { dataKey: 'acc', type: 'line', showSymbol: false, strokeWidth: 2 }] : base;
  });

  protected readonly config = computed<ZardChartConfig>(() => {
    const spec = this.spec();
    const cfg: ZardChartConfig = {};
    spec.keys.forEach((k, i) => (cfg[k.key] = { label: `${k.label} (${spec.unit})`, color: this.colors[i] }));
    if (this.overlay() === 'rain') {
      cfg['acc'] = { label: H.accumulated, color: this.colors[2] };
    }
    return cfg;
  });

  protected readonly option = computed<ZardChartOptionOverride>(() => {
    const spec = this.spec();
    const crop = this.crop();
    const overlay = this.overlay();
    const openKey = this.state.openWindowKey();
    const series: Record<string, unknown>[] = spec.keys.map(k => ({
      type: k.type,
      symbol: k.dashed ? 'diamond' : 'emptyCircle',
      lineStyle: k.dashed ? { type: 'dashed' } : undefined,
      barMaxWidth: 18,
    }));

    // Reference lines (frost thresholds, zero balance).
    if (spec.marks?.length) {
      series[0] = {
        ...series[0],
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: 'var(--muted-foreground)', type: 'dashed', width: 1 },
          label: { show: true, position: 'insideEndTop', fontSize: 10, color: 'var(--muted-foreground)', formatter: '{b}' },
          data: spec.marks.map(m => ({ yAxis: m.value, name: m.label })),
        },
      };
    }

    // y range that always shows the data, the reference lines and the whole crop band.
    const values: number[] = [];
    for (const r of this.rows() ?? []) {
      for (const [k, v] of Object.entries(r)) {
        if (k !== 'label' && typeof v === 'number') {
          values.push(v);
        }
      }
    }
    spec.marks?.forEach(m => values.push(m.value));

    if (overlay && crop) {
      const band = overlay === 'temperature' ? crop.temp : crop.rain;
      values.push(band.optMin, band.optMax);
      const windows = this.state.windows().filter(w => w.source === (overlay === 'temperature' ? 'thermal' : 'rainfall'));
      // Windows (amber) first; the optimal band (green, dashed edges) sits on a later series so it draws on top.
      series[0] = {
        ...series[0],
        markArea: {
          silent: false,
          label: { show: false },
          data: windows.map(w => [
            {
              name: w.key,
              xAxis: LABELS[w.startMonth - 1],
              itemStyle: {
                color: w.key === openKey ? 'rgba(232, 201, 141, 0.45)' : 'rgba(232, 201, 141, 0.22)',
                borderColor: '#c9a25a',
                borderWidth: w.key === openKey ? 2 : 1,
              },
            },
            { xAxis: LABELS[w.endMonth - 1] },
          ]),
        },
      };
      const bandIndex = overlay === 'temperature' ? 1 : spec.keys.length; // rain: the accumulated line
      while (series.length <= bandIndex) {
        series.push({});
      }
      series[bandIndex] = {
        ...series[bandIndex],
        ...(overlay === 'rain' ? { lineStyle: { type: 'dotted' } } : {}),
        markArea: {
          silent: true,
          label: { show: false },
          itemStyle: { color: 'rgba(36, 92, 67, 0.14)', borderColor: 'rgba(36, 92, 67, 0.6)', borderWidth: 1.5, borderType: 'dashed' },
          data: [[{ yAxis: band.optMin }, { yAxis: band.optMax }]],
        },
      };
    }

    // Snap the ends to a "nice" step so the axis labels stay round (e.g. 12 / 27 °C, 0 / 900 mm).
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 1;
    const span = hi - lo || Math.abs(hi) || 1;
    const raw = span / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) ?? 10 * mag;
    const floorTo = (v: number) => Math.floor(v / step) * step;
    const ceilTo = (v: number) => Math.ceil(v / step) * step;
    const min = spec.keys.some(k => k.type === 'bar') && lo >= 0 ? 0 : floorTo(lo - span * 0.04);
    const max = ceilTo(hi + span * 0.04);

    return {
      grid: { left: 8, right: 16, top: 28, bottom: 4 },
      yAxis: { min, max, interval: step, name: spec.unit, nameTextStyle: { align: 'left', padding: [0, 0, 0, -4] } },
      series: series as ZardChartOptionOverride['series'],
    };
  });

  constructor() {
    // series.csv is listed in the manifest, so wait for it.
    effect(() => {
      if (this.data.manifest()) {
        void this.crops.loadSeries();
      }
    });
  }

  protected dry(month: number): boolean {
    return DRY_MONTHS.has(month);
  }

  protected canStep(delta: number): boolean {
    const years = this.crops.years();
    const i = years.indexOf(this.state.activeYear() ?? -1);
    return i >= 0 && years[i + delta] !== undefined;
  }

  protected onVar(v: string | string[]): void {
    if (typeof v === 'string' && v) {
      this.ui.setVar(v as VarKey);
    }
  }

  protected onChartClick(e: ECElementEvent): void {
    if (e.componentType === 'markArea' && typeof e.name === 'string' && e.name) {
      this.state.openWindowFor(e.name);
    }
  }

  private value(m: SeriesMonth, key: Key): number | null {
    if (key === 'tmean_c') {
      return m.tmin_c !== null && m.tmax_c !== null ? (m.tmin_c + m.tmax_c) / 2 : null;
    }
    if (key === 'elevation_m') {
      return this.elevation();
    }
    return m[key];
  }

  private regionMean(year: number): SeriesMonth[] | null {
    const keys = ['ndvi', 'rain_mm', 'tmin_c', 'tmax_c', 'tmin_extreme_c', 'eto_mm', 'balance_mm', 'soil_wetness'] as const;
    const sums = Array.from({ length: 12 }, () => ({ n: 0, v: {} as Record<string, number> }));
    for (const c of this.data.cells()) {
      this.crops.seriesFor(c.pointId, year)?.forEach((m, i) => {
        sums[i].n++;
        for (const k of keys) {
          sums[i].v[k] = (sums[i].v[k] ?? 0) + (m[k] ?? 0);
        }
      });
    }
    if (!sums[0].n) {
      return null;
    }
    return sums.map((s, i) => {
      const out = { month: i + 1 } as SeriesMonth;
      for (const k of keys) {
        out[k] = s.v[k] / s.n;
      }
      return out;
    });
  }
}
