import { computed, effect, inject, Injectable, signal } from '@angular/core';

import { AnalysisService } from '@/core/services/analysis.service';
import { CropDataService } from '@/core/services/crop-data.service';
import { UiStateService } from '@/core/services/ui-state.service';

import { type PlanWindow, windowsFor } from './planning';

/** Map / chart tabs that show the temperature or rainfall curve the crop windows belong to. */
const THERMAL_TABS = new Set(['tmean_c', 'tmax_c', 'tmin_c', 'crop_thermal']);
const RAIN_TABS = new Set(['rain_mm', 'crop_rain']);

/**
 * UI state shared by the environmental chart and the planning section: chart year, the selected
 * crop's windows, and the open window / chosen cycles. The chart variable is the map's active tab.
 */
@Injectable({ providedIn: 'root' })
export class PlanningStateService {
  private readonly crops = inject(CropDataService);
  private readonly analysis = inject(AnalysisService);
  private readonly ui = inject(UiStateService);

  readonly year = signal<number | null>(null);
  readonly openWindowKey = signal<string | null>(null);
  readonly selectedCycles = signal<string[]>([]);
  readonly message = signal('');

  readonly crop = computed(() => this.crops.crop(this.ui.crop()));
  readonly point = computed(() => this.analysis.dominantPoint());
  readonly suitability = computed(() => {
    const crop = this.crop();
    const pid = this.point();
    return crop && pid !== null ? this.crops.suitability(crop.id, pid) : null;
  });
  readonly windows = computed<PlanWindow[]>(() => {
    const crop = this.crop();
    const s = this.suitability();
    return crop && s ? windowsFor(crop, s) : [];
  });
  readonly openWindow = computed(() => this.windows().find(w => w.key === this.openWindowKey()) ?? null);
  readonly activeYear = computed(() => {
    const years = this.crops.years();
    return this.year() ?? years[years.length - 1] ?? null;
  });

  constructor() {
    // A different crop or land invalidates the open window.
    effect(() => {
      this.ui.crop();
      this.point();
      this.closeWindow();
    });
  }

  selectCrop(id: number): void {
    this.ui.setCrop(this.ui.crop() === id ? null : id);
  }

  openWindowFor(key: string): void {
    const w = this.windows().find(x => x.key === key);
    if (!w) {
      return;
    }
    this.openWindowKey.set(key);
    this.selectedCycles.set([]);
    this.message.set('');
    // Show the matching curve in the chart (and map), unless it is already showing.
    const tab = this.ui.activeVar();
    if (w.source === 'thermal' && !THERMAL_TABS.has(tab)) {
      this.ui.setVar('tmean_c');
    } else if (w.source === 'rainfall' && !RAIN_TABS.has(tab)) {
      this.ui.setVar('rain_mm');
    }
  }

  closeWindow(): void {
    this.openWindowKey.set(null);
    this.selectedCycles.set([]);
    this.message.set('');
  }

  toggleCycle(key: string): void {
    this.selectedCycles.update(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]));
    this.message.set('');
  }

  stepYear(delta: number): void {
    const years = this.crops.years();
    const current = this.activeYear();
    const i = current === null ? -1 : years.indexOf(current);
    const next = years[i + delta];
    if (next !== undefined) {
      this.year.set(next);
    }
  }
}
