import { computed, Injectable, signal } from '@angular/core';

import { classesFor, VAR_BY_KEY } from '../config/indices';
import type { Period, RenderMode, VarKey } from '../models';

/** Shared UI state. The map and the dashboard both read these signals; that keeps them in sync. */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  readonly activeVar = signal<VarKey>('ndvi');
  readonly period = signal<Period>('month');
  /** 1–12; defaults to the current calendar month (useful for planting decisions). */
  readonly month = signal<number>(new Date().getMonth() + 1);
  readonly renderMode = signal<RenderMode>('classes');
  /** Index of the class being hovered in the legend / class chart, or null. */
  readonly hoveredClass = signal<number | null>(null);
  /** With a property selected: color the whole ~5 km cells instead of only the part inside the property. */
  readonly fullCells = signal(false);
  /** Bumped to ask the map to start drawing a new property polygon. */
  readonly drawRequest = signal(0);

  readonly activeDef = computed(() => VAR_BY_KEY[this.activeVar()]);
  readonly activeClasses = computed(() => classesFor(this.activeDef(), this.period()));

  setVar(key: VarKey): void {
    this.activeVar.set(key);
    this.hoveredClass.set(null);
  }

  setPeriod(p: Period): void {
    this.period.set(p);
    this.hoveredClass.set(null);
  }

  /** Selecting a month always switches to the typical-month view. */
  setMonth(m: number): void {
    if (m >= 1 && m <= 12) {
      this.month.set(m);
      this.period.set('month');
    }
  }
}
