import { STRINGS } from '@/core/i18n/strings';
import type { Crop, CropPointSuitability, PlanCycle, PlanSource, StatusCode } from '@/core/models';
import { fmt } from '@/core/services/analysis.service';
import { cycleMonths } from '@/core/services/plan.service';

const P = STRINGS.planning;

/** A window the user can open: a run of optimal-temperature months, or of optimal-rain planting months. */
export interface PlanWindow {
  key: string;
  source: PlanSource;
  /** First / last month of the window (thermal) or first / last planting month (rainfall); 1–12. */
  startMonth: number;
  endMonth: number;
  /** Number of months in the window (thermal) or of planting months (rainfall). */
  length: number;
  /** Cycle length (thermal) or growing period (rainfall), months. */
  cycleMonths: number;
  cycles: CycleOption[];
}

export interface CycleOption {
  key: string;
  label: string;
  startMonth: number;
  endMonth: number;
  durationMonths: number;
}

export function statusLabel(code: StatusCode | number | undefined): string {
  return code === 2 ? P.favorable : code === 1 ? P.caution : code === 0 ? P.unfavorable : P.unknown;
}

export function monthName(m: number): string {
  return STRINGS.monthsLong[(m - 1 + 12) % 12];
}

/** "January–March", or a single month. */
export function formatPeriod(start: number, end: number): string {
  return start === end ? monthName(start) : `${monthName(start)}–${monthName(end)}`;
}

export function endOf(start: number, duration: number): number {
  return ((start - 1 + duration - 1) % 12) + 1;
}

/** Windows from the precomputed ECOCROP results (thermal windows/cycles and rainfall planting windows). */
export function windowsFor(crop: Crop, s: CropPointSuitability): PlanWindow[] {
  const thermal: PlanWindow[] = s.tw.map(([start, end, cm, cycles], i) => ({
    key: `t${i}`,
    source: 'thermal',
    startMonth: start,
    endMonth: end,
    length: end - start + 1,
    cycleMonths: cm,
    cycles: cycles.map(([cs, ce], j) => ({
      key: `t${i}-${j}`,
      label: P.cycleLabel(j + 1, formatPeriod(cs, ce)),
      startMonth: cs,
      endMonth: ce,
      durationMonths: cm,
    })),
  }));
  const dur = crop.rainDurationMonths;
  const rainfall: PlanWindow[] = s.rw
    .filter(months => months.length)
    .map((months, i) => ({
      key: `r${i}`,
      source: 'rainfall',
      startMonth: months[0],
      endMonth: months[months.length - 1],
      length: months.length,
      cycleMonths: dur,
      cycles: months.map(m => ({
        key: `r${i}-${m}`,
        label: P.startLabel(formatPeriod(m, endOf(m, dur))),
        startMonth: m,
        endMonth: endOf(m, dur),
        durationMonths: dur,
      })),
    }));
  return [...thermal, ...rainfall];
}

/**
 * Notes for a cycle from the OTHER independent assessment (never merged into a score):
 * thermal cycles get the rainfall result for a planting in their first month and the annual rain;
 * rainfall cycles get the months whose temperature is outside the optimal range.
 */
export function considerations(crop: Crop, s: CropPointSuitability, source: PlanSource, start: number, duration: number): string[] {
  const notes: string[] = [];
  if (source === 'thermal') {
    const [mm, st] = s.r[start - 1] ?? [];
    if (st !== undefined && st !== 2) {
      notes.push(P.noteRainStart(monthName(start), statusLabel(st), fmt(mm, 0), crop.rainDurationMonths, crop.rain.optMin, crop.rain.optMax));
    }
    const [annual, ast] = s.a;
    if (ast !== 2) {
      notes.push(P.noteAnnual(fmt(annual, 0), statusLabel(ast), crop.rain.optMin, crop.rain.optMax));
    }
  } else {
    const months = cycleMonths({ startMonth: start, durationMonths: duration });
    for (const code of [1, 0] as const) {
      const hit = months.filter(m => s.t[m - 1]?.[1] === code);
      if (hit.length) {
        notes.push(P.noteTemp(hit.map(m => STRINGS.months[m - 1]).join(', '), statusLabel(code)));
      }
    }
  }
  return notes;
}

/** A plan cycle for an option of a window. */
export function toPlanCycle(crop: Crop, s: CropPointSuitability, w: PlanWindow, o: CycleOption): PlanCycle {
  return {
    id: `${crop.id}-${o.key}-${Date.now().toString(36)}`,
    cropId: crop.id,
    cropName: crop.name,
    shortName: crop.shortName,
    source: w.source,
    startMonth: o.startMonth,
    endMonth: o.endMonth,
    durationMonths: o.durationMonths,
    notes: considerations(crop, s, w.source, o.startMonth, o.durationMonths),
  };
}
