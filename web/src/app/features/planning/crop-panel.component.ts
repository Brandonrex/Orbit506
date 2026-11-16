import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { STRINGS } from '@/core/i18n/strings';
import { CropDataService } from '@/core/services/crop-data.service';
import { UiStateService } from '@/core/services/ui-state.service';

import { PlanningStateService } from './planning-state.service';

/** "Reference crop" panel (Figma: .crop-panel): the 4 ECOCROP crops and the selected crop's ranges. */
@Component({
  selector: 'af-crop-panel',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bg-card shadow-soft block overflow-hidden rounded-lg border' },
  template: `
    <div class="border-b px-5 py-4">
      <p class="text-primary text-xs font-bold tracking-widest uppercase">{{ p.cropEyebrow }}</p>
      <h3 class="mt-1 text-[19px] tracking-[-0.02em]">{{ p.cropTitle }}</h3>
    </div>

    <div class="flex flex-col gap-1 p-3">
      @for (c of crops.crops(); track c.id) {
        <button
          type="button"
          class="hover:bg-background aria-pressed:border-primary/40 aria-pressed:bg-accent focus-visible:ring-ring/50 flex min-h-[60px] w-full cursor-pointer items-center gap-3 rounded-sm border border-transparent px-3 py-2 text-left focus-visible:ring-3 focus-visible:outline-none"
          [attr.aria-pressed]="ui.crop() === c.id"
          (click)="state.selectCrop(c.id)"
        >
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold"
            [class]="ui.crop() === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-sage-text'"
            >{{ c.shortName }}</span
          >
          <span class="min-w-0 flex-1">
            <strong class="block text-[13px]">{{ c.name }}</strong>
            <small class="text-muted-foreground block text-[11px]">{{ p.cycle(c.cycleMonths) }}</small>
          </span>
          @if (ui.crop() === c.id) {
            <ng-icon name="fsCheck" size="18" class="text-primary shrink-0" />
          }
        </button>
      }
    </div>

    <div class="bg-background border-t px-5 py-4">
      @if (state.crop(); as c) {
        <span class="text-muted-foreground text-[10px] font-bold tracking-[0.04em] uppercase">{{ p.temperature }}</span>
        <strong class="text-primary block text-[17px]">{{ c.temp.optMin }}–{{ c.temp.optMax }} °C</strong>
        <span class="text-muted-foreground mt-2 block text-[10px] font-bold tracking-[0.04em] uppercase">{{ p.rainSeason }}</span>
        <strong class="text-primary block text-[17px]">{{ c.rain.optMin }}–{{ c.rain.optMax }} mm</strong>
        <small class="text-muted-foreground mt-1 block text-[10px] font-semibold uppercase">{{ p.optimal }} · <i>{{ c.scientificName }}</i></small>
      } @else {
        <strong class="text-primary block text-[17px]">{{ p.exploring }}</strong>
        <small class="text-muted-foreground block text-[11px]">{{ p.exploringHint }}</small>
      }
    </div>
  `,
})
export class CropPanelComponent {
  protected readonly p = STRINGS.planning;
  protected readonly crops = inject(CropDataService);
  protected readonly ui = inject(UiStateService);
  protected readonly state = inject(PlanningStateService);
}
