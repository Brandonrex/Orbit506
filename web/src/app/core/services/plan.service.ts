import { computed, inject, Injectable, signal } from '@angular/core';

import { ZardSonnerService } from '@/shared/components/sonner';

import { STRINGS } from '../i18n/strings';
import type { LandPlan, PlanCycle } from '../models';
import { PropertyApiService } from './property-api.service';
import { PropertyService } from './property.service';

/** Calendar months (1–12) covered by a cycle; handles cycles that wrap past December. */
export function cycleMonths(c: Pick<PlanCycle, 'startMonth' | 'durationMonths'>): number[] {
  return Array.from({ length: Math.min(12, c.durationMonths) }, (_, i) => ((c.startMonth - 1 + i) % 12) + 1);
}

export function cyclesOverlap(a: Pick<PlanCycle, 'startMonth' | 'durationMonths'>, b: Pick<PlanCycle, 'startMonth' | 'durationMonths'>): boolean {
  const months = new Set(cycleMonths(a));
  return cycleMonths(b).some(m => months.has(m));
}

/** Annual crop plan of the active land (Figma "Mi planificación anual"), stored by the API. */
@Injectable({ providedIn: 'root' })
export class PlanService {
  private readonly api = inject(PropertyApiService);
  private readonly property = inject(PropertyService);
  private readonly toast = inject(ZardSonnerService);

  /** Plan of the land being viewed (null while loading / no land). */
  readonly plan = signal<LandPlan | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  /** Plans of every land, for the lands page ("N crops planned"). */
  private readonly summaries = signal<Map<number, LandPlan>>(new Map());

  readonly cycles = computed(() => this.plan()?.cycles ?? []);
  readonly isSaved = computed(() => this.plan()?.status === 'saved');
  readonly distinctCrops = computed(() => new Set(this.cycles().map(c => c.cropId)).size);
  readonly monthsOccupied = computed(() => new Set(this.cycles().flatMap(c => cycleMonths(c))).size);
  /** Cycles grouped by crop, in plan order. */
  readonly byCrop = computed(() => {
    const groups = new Map<number, PlanCycle[]>();
    for (const c of this.cycles()) {
      groups.set(c.cropId, [...(groups.get(c.cropId) ?? []), c]);
    }
    return [...groups.values()];
  });

  private loadedFor: number | null = null;

  /** Number of distinct crops planned on a land (lands page cards). */
  plannedCrops(propertyId: number): number {
    const p = this.summaries().get(propertyId);
    return p ? new Set(p.cycles.map(c => c.cropId)).size : 0;
  }

  async loadSummaries(): Promise<void> {
    try {
      const list = await this.api.listPlans();
      this.summaries.set(new Map(list.map(p => [p.propertyId, p])));
    } catch {
      // The lands page still works without the counts.
    }
  }

  async load(propertyId: number): Promise<void> {
    if (this.loadedFor === propertyId && this.plan()) {
      return;
    }
    this.loadedFor = propertyId;
    this.plan.set(null);
    this.loading.set(true);
    try {
      const plan = await this.api.getPlan(propertyId);
      if (this.loadedFor === propertyId) {
        this.plan.set(plan);
      }
    } catch (err) {
      console.error('[plan] load failed', err);
      if (this.loadedFor === propertyId) {
        this.plan.set({ propertyId, status: 'draft', cycles: [] });
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Cycles of `candidates` that overlap a cycle already in the plan. */
  conflicts(candidates: PlanCycle[]): PlanCycle[] {
    return candidates.filter(c => this.cycles().some(p => cyclesOverlap(c, p)));
  }

  /** Adds the non-conflicting cycles (saved as a draft). Returns the ones that were rejected. */
  async addCycles(candidates: PlanCycle[]): Promise<PlanCycle[]> {
    const rejected = this.conflicts(candidates);
    const accepted = candidates.filter(c => !rejected.includes(c));
    // Candidates may also overlap each other.
    const unique: PlanCycle[] = [];
    for (const c of accepted) {
      if (unique.some(u => cyclesOverlap(u, c))) {
        rejected.push(c);
      } else {
        unique.push(c);
      }
    }
    if (unique.length) {
      await this.persist('draft', [...this.cycles(), ...unique]);
    }
    return rejected;
  }

  async removeCycle(id: string): Promise<void> {
    await this.persist('draft', this.cycles().filter(c => c.id !== id));
  }

  async save(): Promise<void> {
    if (!this.cycles().length) {
      return;
    }
    if (await this.persist('saved', this.cycles())) {
      this.toast.success(STRINGS.planning.savedToast);
    }
  }

  /** Back to editing a saved plan. */
  async edit(): Promise<void> {
    await this.persist('draft', this.cycles());
  }

  private async persist(status: LandPlan['status'], cycles: PlanCycle[]): Promise<boolean> {
    const current = this.plan();
    const id = current?.propertyId ?? this.property.activeId();
    if (id === null || id === undefined) {
      return false;
    }
    const previous = current;
    this.plan.set({ ...(current ?? { propertyId: id }), propertyId: id, status, cycles });
    this.saving.set(true);
    try {
      const stored = await this.api.putPlan(id, { status, cycles });
      if (this.loadedFor === id) {
        this.plan.set(stored);
      }
      this.summaries.update(m => new Map(m).set(id, stored));
      return true;
    } catch (err) {
      this.plan.set(previous);
      this.toast.error(STRINGS.toasts.saveError);
      console.error('[plan] save failed', err);
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
