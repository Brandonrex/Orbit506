import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ECElementEvent, EChartsType } from 'echarts';

import { ZardChartImports } from '@/shared/components/chart';
import type { ZardChartConfig, ZardChartOptionOverride } from '@/shared/components/chart';

export interface ProfilePoint {
  label: string;
  value: number | null;
}

/** Dumb 12-month line chart. Clicking a month (point or plot area) emits its index (0–11). */
@Component({
  selector: 'af-profile-chart',
  imports: [ZardChartImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <z-chart
      class="h-44 cursor-pointer"
      zType="line"
      [zData]="rows()"
      zXAxisKey="label"
      [zSeries]="series"
      [zConfig]="config()"
      [zYAxis]="true"
      [zOption]="option()"
      [zAnimation]="false"
      (zChartClick)="onPointClick($event)"
      (zChartInit)="onInit($event)"
    >
      <z-chart-tooltip [zValueFormatter]="valueFormatter()" />
    </z-chart>
  `,
})
export class ProfileChartComponent {
  readonly points = input.required<ProfilePoint[]>();
  /** Index (0–11) of the active month to mark, or null. */
  readonly activeIndex = input<number | null>(null);
  readonly seriesLabel = input<string>('');
  readonly decimals = input<number>(1);
  readonly selectIndex = output<number>();

  protected readonly series = [{ dataKey: 'value', showSymbol: true, symbolSize: 7, smooth: true }];
  protected readonly rows = computed(() => this.points().map(p => ({ label: p.label, value: p.value })));
  protected readonly config = computed<ZardChartConfig>(() => ({
    value: { label: this.seriesLabel(), color: 'var(--chart-3)' },
  }));
  protected readonly valueFormatter = computed(() => {
    const d = this.decimals();
    return (v: number) => (typeof v === 'number' ? v.toFixed(d) : String(v));
  });
  protected readonly option = computed<ZardChartOptionOverride>(() => {
    const i = this.activeIndex();
    const label = i === null ? null : this.points()[i]?.label;
    return {
      grid: { left: 8, right: 12, top: 16, bottom: 4 },
      yAxis: { scale: true },
      series: [
        {
          type: 'line',
          markLine: label
            ? {
                symbol: 'none',
                silent: true,
                data: [{ xAxis: label }],
                lineStyle: { color: 'var(--foreground)', type: 'dashed', width: 2 },
                label: { show: false },
              }
            : { data: [] },
        },
      ],
    };
  });

  protected onPointClick(e: ECElementEvent): void {
    if (typeof e.dataIndex === 'number') {
      this.selectIndex.emit(e.dataIndex);
    }
  }

  /** Clicking anywhere in the plot area selects the nearest month. */
  protected onInit(chart: EChartsType): void {
    chart.getZr().on('click', ev => {
      const pt = [ev.offsetX, ev.offsetY];
      if (!ev.target && chart.containPixel('grid', pt)) {
        const [x] = chart.convertFromPixel({ seriesIndex: 0 }, pt) as number[];
        const idx = Math.round(x);
        if (idx >= 0 && idx < this.points().length) {
          this.selectIndex.emit(idx);
        }
      }
    });
  }
}
