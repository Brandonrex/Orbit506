import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { VARIABLES } from '@/core/config/indices';
import { STRINGS } from '@/core/i18n/strings';
import type { Period, RenderMode, VarKey } from '@/core/models';
import { PropertyService } from '@/core/services/property.service';
import { UiStateService } from '@/core/services/ui-state.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardSelectImports } from '@/shared/components/select';
import { ZardSonnerService } from '@/shared/components/sonner';
import { ZardToggleGroupComponent, type ZardToggleGroupItem } from '@/shared/components/toggle-group';

@Component({
  selector: 'af-header',
  imports: [ZardSelectImports, ZardToggleGroupComponent, ZardButtonComponent],
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

      <div class="ml-auto flex items-center gap-2">
        <input #fileInput type="file" accept=".geojson,.json,application/geo+json" class="hidden" (change)="onFile($event)" />
        <button z-button zType="outline" zSize="sm" (click)="fileInput.click()">{{ h.importGeojson }}</button>
        <button z-button zType="outline" zSize="sm" [disabled]="!property.hasProperty()" (click)="property.exportGeoJson()">
          {{ h.exportGeojson }}
        </button>
        <button z-button zType="destructive" zSize="sm" [disabled]="!property.hasProperty()" (click)="clear()">
          {{ h.clearProperty }}
        </button>
      </div>
    </div>
  `,
})
export class HeaderComponent {
  protected readonly s = STRINGS;
  protected readonly h = STRINGS.header;
  protected readonly ui = inject(UiStateService);
  protected readonly property = inject(PropertyService);
  private readonly toast = inject(ZardSonnerService);

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

  protected clear(): void {
    this.property.clear('external');
    this.toast.show(STRINGS.toasts.cleared);
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    const feature = this.property.parseGeoJson(await file.text());
    if (!feature) {
      this.toast.error(STRINGS.toasts.importError);
      return;
    }
    const result = this.property.set(feature, 'external');
    if (result.ok) {
      this.toast.success(STRINGS.toasts.imported);
    } else {
      this.toast.error(result.reason === 'self-intersection' ? STRINGS.toasts.selfIntersection : STRINGS.toasts.importError);
    }
  }
}
