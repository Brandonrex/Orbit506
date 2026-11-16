import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';

import { STRINGS } from '@/core/i18n/strings';
import { PlanService } from '@/core/services/plan.service';

import { CropPanelComponent } from './crop-panel.component';
import { PlanningStateService } from './planning-state.service';
import { WindowsPanelComponent } from './windows-panel.component';

/**
 * Crop planning for one land (Figma "/planificacion"): reference crop + potential windows, right under
 * the map. The environmental chart beside it shows the selected crop's range and windows; the annual
 * plan (loaded here) is placed by the land page.
 */
@Component({
  selector: 'af-planning-section',
  imports: [CropPanelComponent, WindowsPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section aria-labelledby="planning-title">
      <h2 id="planning-title" class="text-[26px] leading-tight tracking-[-0.025em]">{{ p.title }}</h2>
      <p class="text-muted-foreground mt-1 text-[13px]">{{ p.description }}</p>
      @if (state.point() === null) {
        <p class="text-muted-foreground mt-6 text-sm">{{ p.regionNote }}</p>
      } @else {
        <div class="mt-5 grid items-start gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
          <af-crop-panel />
          @if (state.crop()) {
            <af-windows-panel />
          } @else {
            <div class="text-muted-foreground grid min-h-[200px] place-items-center rounded-lg border border-dashed p-6 text-center text-sm">
              {{ p.exploringHint }}
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class PlanningSectionComponent {
  protected readonly p = STRINGS.planning;
  protected readonly state = inject(PlanningStateService);
  private readonly plan = inject(PlanService);

  /** The land being planned (null in the region view). */
  readonly landId = input<number | null>(null);

  constructor() {
    effect(() => {
      const id = this.landId();
      if (id !== null) {
        void this.plan.load(id);
      }
    });
  }
}
