import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { readableTextOn } from '@/core/utils/color';

export interface KpiBadge {
  label: string;
  color: string;
}

/** Dumb KPI card: label, value, unit, sub-text and an optional class badge. */
@Component({
  selector: 'af-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="bg-card text-card-foreground flex h-full flex-col gap-1 rounded-lg border p-3">
      <div class="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        <span>{{ label() }}</span>
        @if (badge(); as b) {
          <span
            class="rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap"
            [style.background]="b.color"
            [style.color]="badgeText()"
            >{{ b.label }}</span
          >
        }
      </div>
      <div class="text-xl font-semibold tabular-nums">
        {{ value() }}
        @if (unit()) {
          <span class="text-muted-foreground text-sm font-normal">{{ unit() }}</span>
        }
      </div>
      @if (sub()) {
        <div class="text-muted-foreground text-xs">{{ sub() }}</div>
      }
    </div>
  `,
})
export class KpiCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly unit = input<string>('');
  readonly sub = input<string>('');
  readonly badge = input<KpiBadge | null>(null);

  protected readonly badgeText = computed(() => {
    const b = this.badge();
    return b ? readableTextOn(b.color) : '';
  });
}
