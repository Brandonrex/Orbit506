import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { VARIABLES } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { Period, RenderMode, VarKey } from '@/core/models';
import { UiStateService } from '@/core/services/ui-state.service';
import { ZardSelectImports } from '@/shared/components/select';
import { ZardToggleGroupComponent, type ZardToggleGroupItem } from '@/shared/components/toggle-group';

@Component({
  selector: 'af-header',
  imports: [ZardSelectImports, ZardToggleGroupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block border-b bg-card text-card-foreground' },
  template: `
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
      <div class="mr-2 leading-tight">
        <div class="text-base font-semibold">{{ s.appTitle }}</div>
        <div class="text-muted-foreground text-xs">{{ s.appSubtitle }}</div>
      </div>

      <label class="flex items-center gap-2 text-xs">
        <span class="text-muted-foreground">{{ h.variable }}</span>
        <z-select class="w-60" [zValue]="ui.activeVar()" (zSelectionChange)="onVar($event)">
          @for (v of variables; track v.key) {
            <z-select-item [zValue]="v.key">{{ v.label }}</z-select-item>
          }
        </z-select>
      </label>

      <div class="flex items-center gap-2 text-xs">
        <span class="text-muted-foreground">{{ h.period }}</span>
        <z-toggle-group
          zMode="single"
          zType="outline"
          zSize="sm"
          [zItems]="periodItems"
          [zValue]="ui.period()"
          (valueChange)="onPeriod($event)"
        />
      </div>

      @if (ui.period() === 'month') {
        <label class="flex items-center gap-2 text-xs">
          <span class="text-muted-foreground">{{ h.month }}</span>
          <z-select class="w-36" [zValue]="monthValue()" (zSelectionChange)="onMonth($event)">
            @for (m of s.monthsLong; track m; let i = $index) {
              <z-select-item [zValue]="'' + (i + 1)">{{ m }}</z-select-item>
            }
          </z-select>
        </label>
      }

      <div class="flex items-center gap-2 text-xs">
        <span class="text-muted-foreground">{{ h.renderMode }}</span>
        <z-toggle-group
          zMode="single"
          zType="outline"
          zSize="sm"
          [zItems]="modeItems"
          [zValue]="ui.renderMode()"
          (valueChange)="onMode($event)"
        />
      </div>
    </div>
  `,
})
export class HeaderComponent {
  protected readonly s = STRINGS;
  protected readonly h = STRINGS.header;
  protected readonly ui = inject(UiStateService);

  protected readonly variables = VARIABLES;
  protected readonly periodItems: ZardToggleGroupItem[] = [
    { value: 'month', label: STRINGS.header.typicalMonth },
    { value: 'normal', label: STRINGS.header.annualNormal },
  ];
  protected readonly modeItems: ZardToggleGroupItem[] = [
    { value: 'classes', label: STRINGS.header.classes },
    { value: 'continuous', label: STRINGS.header.continuous },
  ];
  protected readonly monthValue = computed(() => String(this.ui.month()));

  protected onVar(v: string | string[]): void {
    if (typeof v === 'string' && v) {
      this.ui.setVar(v as VarKey);
    }
  }

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
