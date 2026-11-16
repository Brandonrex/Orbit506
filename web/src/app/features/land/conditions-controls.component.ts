import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CROP_VARIABLES, VARIABLES } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { Period, RenderMode } from '@/core/models';
import { CropDataService } from '@/core/services/crop-data.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { ZardSelectImports } from '@/shared/components/select';
import { ZardToggleGroupComponent, type ZardToggleGroupItem } from '@/shared/components/toggle-group';

/**
 * Variable tabs (Figma: .variable-tabs, underlined active tab) and the period / month / map-color
 * selectors underneath. Drives the shared UiStateService read by the map, legend and dashboard.
 */
@Component({
  selector: 'af-conditions-controls',
  imports: [ZardSelectImports, ZardToggleGroupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div role="tablist" [attr.aria-label]="h.variable" class="mt-8 flex gap-6 overflow-x-auto border-b [scrollbar-width:thin]">
      @for (v of variables(); track v.key) {
        <button
          type="button"
          role="tab"
          class="text-muted-foreground hover:text-foreground aria-selected:text-primary relative min-h-11 shrink-0 cursor-pointer text-[13px] font-semibold whitespace-nowrap
            focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none
            aria-selected:after:bg-primary aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:bottom-0 aria-selected:after:h-[3px] aria-selected:after:content-['']"
          [attr.aria-selected]="ui.activeVar() === v.key"
          (click)="ui.setVar(v.key)"
        >
          @if (v.key === 'crop_thermal' || v.key === 'crop_rain') {
            <span class="bg-primary text-primary-foreground mr-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold">{{ cropShort() }}</span>
          }
          {{ v.shortLabel }}
        </button>
      }
    </div>

    <div class="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div class="flex items-center gap-2">
        <span class="text-[13px] font-bold">{{ h.period }}</span>
        <z-toggle-group
          zMode="single"
          zType="outline"
          [zItems]="periodItems"
          [zValue]="ui.period()"
          (valueChange)="onPeriod($event)"
        />
      </div>

      @if (ui.period() === 'month') {
        <label class="flex items-center gap-2">
          <span class="text-[13px] font-bold">{{ h.month }}</span>
          <z-select class="w-40" [zValue]="monthValue()" (zSelectionChange)="onMonth($event)">
            @for (m of s.monthsLong; track m; let i = $index) {
              <z-select-item [zValue]="'' + (i + 1)">{{ m }}</z-select-item>
            }
          </z-select>
        </label>
      }

      <div class="flex items-center gap-2">
        <span class="text-[13px] font-bold">{{ h.renderMode }}</span>
        <z-toggle-group
          zMode="single"
          zType="outline"
          [zItems]="modeItems"
          [zValue]="ui.renderMode()"
          (valueChange)="onMode($event)"
        />
      </div>
    </div>
  `,
})
export class ConditionsControlsComponent {
  protected readonly s = STRINGS;
  protected readonly h = STRINGS.header;
  protected readonly ui = inject(UiStateService);

  private readonly crops = inject(CropDataService);
  /** The two crop-fit tabs appear once a crop is chosen in the planning section. */
  protected readonly variables = computed(() => (this.ui.crop() === null ? VARIABLES : [...VARIABLES, ...CROP_VARIABLES]));
  protected readonly cropShort = computed(() => this.crops.crop(this.ui.crop())?.shortName ?? '');
  protected readonly periodItems: ZardToggleGroupItem[] = [
    { value: 'month', label: STRINGS.header.typicalMonth },
    { value: 'normal', label: STRINGS.header.annualNormal },
  ];
  protected readonly modeItems: ZardToggleGroupItem[] = [
    { value: 'classes', label: STRINGS.header.classes },
    { value: 'continuous', label: STRINGS.header.continuous },
  ];
  protected readonly monthValue = computed(() => String(this.ui.month()));

  protected onPeriod(v: string | string[]): void {
    if (v === 'month' || v === 'normal') {
      this.ui.setPeriod(v as Period);
    }
  }

  protected onMonth(v: string | string[]): void {
    if (typeof v === 'string' && v) {
      this.ui.setMonth(Number(v));
    }
  }

  protected onMode(v: string | string[]): void {
    if (v === 'classes' || v === 'continuous') {
      this.ui.renderMode.set(v as RenderMode);
    }
  }
}
