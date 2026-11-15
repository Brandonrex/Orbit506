import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { ClassShare } from '@/core/models';

/** Dumb stacked bar of % area per class. Hover emits the class index (synced with the map). */
@Component({
  selector: 'af-class-distribution',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div (mouseleave)="hoverClass.emit(null)">
      <div class="bg-muted flex h-6 w-full overflow-hidden rounded">
        @for (c of shares(); track c.index) {
          @if (c.pct > 0) {
            <div
              class="h-full transition-opacity"
              [style.width.%]="c.pct"
              [style.background]="c.color"
              [style.opacity]="hovered() === null || hovered() === c.index ? 1 : 0.25"
              [title]="c.label + ': ' + c.pct.toFixed(1) + '%'"
              (mouseenter)="hoverClass.emit(c.index)"
            ></div>
          }
        }
      </div>
      <ul class="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        @for (c of shares(); track c.index) {
          <li
            class="hover:bg-accent flex items-center gap-2 rounded px-1"
            [class.bg-accent]="hovered() === c.index"
            [class.opacity-50]="c.pct === 0"
            (mouseenter)="hoverClass.emit(c.index)"
          >
            <span class="size-2.5 shrink-0 rounded-sm" [style.background]="c.color"></span>
            <span class="truncate">{{ c.label }}</span>
            <span class="ml-auto tabular-nums">{{ c.pct.toFixed(0) }}%</span>
          </li>
        }
      </ul>
    </div>
  `,
})
export class ClassDistributionComponent {
  readonly shares = input.required<ClassShare[]>();
  readonly hovered = input<number | null>(null);
  readonly hoverClass = output<number | null>();
}
