import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { HistogramBin } from '@/core/services/analysis.service';
import { ZardChartImports } from '@/shared/components/chart';
import type { ZardChartConfig, ZardChartOptionOverride } from '@/shared/components/chart';

/** Dumb histogram (Zard Chart / ECharts). Bars use the class colors; an optional marker line. */
@Component({
  selector: 'af-histogram',
  imports: [ZardChartImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <z-chart
      class="h-44"
      zType="bar"
      [zData]="rows()"
      zXAxisKey="label"
      [zSeries]="['count']"
      [zConfig]="config()"
      [zYAxis]="true"
      [zOption]="option()"
      [zAnimation]="false"
    >
      <z-chart-tooltip />
    </z-chart>
  `,
})
export class HistogramComponent {
  readonly bins = input.required<HistogramBin[]>();
  /** Category label of the bin to mark (e.g. the property value), or null. */
  readonly marker = input<string | null>(null);
  readonly markerLabel = input<string>('');
  readonly seriesLabel = input<string>('Cells');

  protected readonly rows = computed(() => this.bins().map(b => ({ label: b.label, count: b.count, fill: b.color })));
  protected readonly config = computed<ZardChartConfig>(() => ({
    count: { label: this.seriesLabel(), color: 'var(--chart-2)' },
  }));
  protected readonly option = computed<ZardChartOptionOverride>(() => {
    const marker = this.marker();
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 4 },
      series: [
        {
          type: 'bar',
          barCategoryGap: '8%',
          markLine: marker
            ? {
                symbol: 'none',
                silent: true,
                data: [{ xAxis: marker }],
                lineStyle: { color: 'var(--foreground)', type: 'dashed', width: 2 },
                label: { formatter: this.markerLabel(), color: 'var(--foreground)', position: 'end' },
              }
            : { data: [] },
        },
      ],
    };
  });
}
