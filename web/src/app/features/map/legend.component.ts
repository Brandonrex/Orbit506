import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { ClassDef } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { RenderMode } from '@/core/models';

/** Dumb legend: everything comes in through inputs (driven by core/config/indices.ts). */
@Component({
  selector: 'af-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="text-xs" (mouseleave)="hoverClass.emit(null)">
      <div class="mb-2 flex items-baseline justify-between gap-2">
        <span class="text-[15px] font-bold tracking-[-0.015em]">{{ title() }}</span>
        <span class="text-muted-foreground">{{ unit() }}</span>
      </div>

      @if (mode() === 'continuous') {
        <div class="mb-1 h-3 w-full rounded" [style.background]="gradient()"></div>
        <div class="text-muted-foreground mb-2 text-right">{{ rangeLabel() }}</div>
      }

      <ul class="space-y-0.5">
        @for (c of classes(); track c.label; let i = $index) {
          <li
            class="hover:bg-accent flex min-h-7 cursor-default items-center gap-2 rounded-[6px] px-1.5 py-1"
            [class.bg-accent]="hovered() === i"
            (mouseenter)="hoverClass.emit(i)"
          >
            <span class="mt-0.5 size-3 shrink-0 self-start rounded-sm border" [style.background]="c.color"></span>
            <span class="flex min-w-0 flex-col leading-snug">
              <span class="font-semibold">{{ c.label }}</span>
              <span class="text-muted-foreground">{{ c.meaning }}</span>
            </span>
          </li>
        }
      </ul>

      <div class="text-muted-foreground mt-2 space-y-0.5 border-t pt-2">
        @if (clipToggle()) {
          <label class="text-card-foreground mb-1 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              class="accent-primary size-3.5"
              [checked]="fullCells()"
              (change)="fullCellsChange.emit($any($event.target).checked)"
            />
            {{ s.fullCells }}
          </label>
        }
        <div>{{ clipToggle() && !fullCells() ? s.clipNote : s.cellNote }}</div>
        @if (provisional()) {
          <div class="italic">⚠ {{ s.provisional }}</div>
        }
      </div>
    </div>
  `,
})
export class LegendComponent {
  protected readonly s = STRINGS.legend;

  readonly title = input.required<string>();
  readonly unit = input<string>('');
  readonly classes = input.required<ClassDef[]>();
  readonly mode = input<RenderMode>('classes');
  readonly gradient = input<string>('');
  readonly rangeLabel = input<string>('');
  readonly hovered = input<number | null>(null);
  readonly provisional = input<boolean>(true);
  /** Show the "full cells vs clipped to property" switch (only when a property is selected). */
  readonly clipToggle = input<boolean>(false);
  readonly fullCells = input<boolean>(false);

  readonly hoverClass = output<number | null>();
  readonly fullCellsChange = output<boolean>();
}
