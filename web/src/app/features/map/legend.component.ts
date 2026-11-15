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
    <div class="bg-card/95 text-card-foreground rounded-lg border p-3 text-xs shadow-md" (mouseleave)="hoverClass.emit(null)">
      <div class="mb-2 flex items-baseline justify-between gap-2">
        <span class="text-sm font-semibold">{{ title() }}</span>
        <span class="text-muted-foreground">{{ unit() }}</span>
      </div>

      @if (mode() === 'continuous') {
        <div class="mb-1 h-3 w-full rounded" [style.background]="gradient()"></div>
        <div class="text-muted-foreground mb-2 text-right">{{ rangeLabel() }}</div>
      }

      <ul class="space-y-0.5">
        @for (c of classes(); track c.label; let i = $index) {
          <li
            class="hover:bg-accent flex cursor-default items-center gap-2 rounded px-1 py-0.5"
            [class.bg-accent]="hovered() === i"
            (mouseenter)="hoverClass.emit(i)"
          >
            <span class="size-3 shrink-0 rounded-sm border" [style.background]="c.color"></span>
            <span class="font-medium">{{ c.label }}</span>
            <span class="text-muted-foreground truncate">{{ c.meaning }}</span>
          </li>
        }
      </ul>

      <div class="text-muted-foreground mt-2 space-y-0.5 border-t pt-2">
        <div>{{ s.cellNote }}</div>
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

  readonly hoverClass = output<number | null>();
}
