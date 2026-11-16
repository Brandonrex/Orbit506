import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { STRINGS } from '@/core/i18n/strings';
import type { PlanCycle } from '@/core/models';
import { cycleMonths, PlanService } from '@/core/services/plan.service';
import { ZardButtonComponent } from '@/shared/components/button';

import { formatPeriod } from './planning';

interface Segment {
  cycle: PlanCycle;
  /** 1-based grid columns. */
  from: number;
  to: number;
  first: boolean;
}

/**
 * "My annual plan" (Figma: .annual-planner): 12-month timeline of the planned cycles, the planned
 * crops summary and Save. A saved plan is read-only until "Edit plan".
 */
@Component({
  selector: 'af-annual-plan',
  imports: [A11yModule, NgIcon, ZardButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bg-card shadow-soft block rounded-lg border p-6 max-sm:p-4' },
  template: `
    <div class="flex items-end justify-between gap-6">
      <div>
        <p class="text-primary text-xs font-bold tracking-widest uppercase">{{ p.planEyebrow }}</p>
        <h2 id="plan-title" class="mt-1 text-[26px] leading-tight tracking-[-0.025em]">{{ p.planTitle }}</h2>
      </div>
      @if (plan.isSaved()) {
        <span class="bg-accent text-sage-text flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold">
          <ng-icon name="fsCheck" size="14" />{{ p.saved }}
        </span>
      } @else {
        <span class="bg-accent text-sage-text rounded-full px-3 py-1 text-[11px] font-bold">{{ p.cycles(plan.cycles().length) }}</span>
      }
    </div>

    <!-- Timeline -->
    <div class="mt-6 overflow-x-auto">
      <div class="min-w-[640px] overflow-hidden rounded-sm border">
        <div class="bg-background grid grid-cols-12 border-b">
          @for (m of months; track m) {
            <span class="text-muted-foreground border-r py-2 text-center text-[10px] font-bold last:border-r-0">{{ m }}</span>
          }
        </div>
        <div class="relative">
          <div class="pointer-events-none absolute inset-0 grid grid-cols-12" aria-hidden="true">
            @for (m of months; track m) {
              <span class="border-r last:border-r-0"></span>
            }
          </div>
          @if (rows().length) {
            <ul class="relative space-y-2 py-3">
              @for (row of rows(); track row[0].cycle.id) {
                <li class="grid grid-cols-12 px-1">
                  @for (seg of row; track seg.from) {
                    <button
                      type="button"
                      class="hover:border-primary aria-pressed:border-primary aria-pressed:ring-primary/20 bg-accent/90 border-sage-border relative flex min-h-12 cursor-pointer items-center justify-center gap-1.5 rounded-sm border px-1 aria-pressed:ring-3 disabled:cursor-default"
                      [style.grid-column]="seg.from + ' / ' + (seg.to + 1)"
                      [attr.aria-pressed]="active() === seg.cycle.id"
                      [attr.aria-label]="seg.cycle.cropName + ' · ' + period(seg.cycle)"
                      [title]="seg.cycle.cropName + ' · ' + period(seg.cycle) + (seg.cycle.notes.length ? ' · ' + seg.cycle.notes.join(' ') : '')"
                      [disabled]="plan.isSaved()"
                      (click)="toggle(seg.cycle.id)"
                    >
                      <span class="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold">{{ seg.cycle.shortName }}</span>
                      @if (seg.first && seg.to - seg.from >= 1) {
                        <span class="text-sage-text truncate text-[11px] font-semibold max-md:hidden">{{ seg.cycle.cropName }}</span>
                      }
                      @if (seg.cycle.notes.length) {
                        <ng-icon name="fsAlert" size="14" class="text-season-dry-text shrink-0" />
                      }
                      @if (active() === seg.cycle.id && seg.first && !plan.isSaved()) {
                        <span
                          role="button"
                          tabindex="0"
                          class="bg-card text-destructive-text border-destructive/30 hover:bg-destructive-subtle absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border shadow-sm"
                          [attr.aria-label]="p.remove(seg.cycle.cropName, period(seg.cycle))"
                          (click)="pendingRemoval.set(seg.cycle); $event.stopPropagation()"
                          (keydown.enter)="pendingRemoval.set(seg.cycle); $event.stopPropagation()"
                        >
                          <ng-icon name="fsClose" size="13" />
                        </span>
                      }
                    </button>
                  }
                </li>
              }
            </ul>
          } @else {
            <div class="relative px-6 py-10 text-center">
              <strong class="text-[13px]">{{ p.planEmptyTitle }}</strong>
              <p class="text-muted-foreground mt-1 text-xs">{{ p.planEmptyDescription }}</p>
            </div>
          }
        </div>
      </div>
    </div>

    <!-- Summary -->
    <div class="mt-6 border-t pt-6">
      <h3 class="text-[17px] tracking-[-0.015em]">{{ p.summaryTitle }}</h3>
      <div class="mt-3 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        @for (k of stats(); track k.label) {
          <div class="bg-background rounded-sm border px-4 py-3">
            <span class="text-muted-foreground block text-[10px] font-bold tracking-[0.04em] uppercase">{{ k.label }}</span>
            <strong class="text-xl tabular-nums">{{ k.value }}</strong>
          </div>
        }
      </div>
      @if (plan.byCrop().length) {
        <div class="mt-3 space-y-2">
          @for (group of plan.byCrop(); track group[0].cropId) {
            <details class="group/acc rounded-sm border">
              <summary class="hover:bg-background flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2">
                <span class="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold">{{ group[0].shortName }}</span>
                <span class="min-w-0 flex-1">
                  <strong class="block text-[13px]">{{ group[0].cropName }}</strong>
                  <small class="text-muted-foreground text-[11px]">{{ p.cropSummary(group.length, monthsOf(group)) }}</small>
                </span>
                <ng-icon name="fsChevronDown" size="18" class="text-muted-foreground transition-transform group-open/acc:rotate-180" />
              </summary>
              <ul class="space-y-2 border-t px-4 py-3">
                @for (c of group; track c.id) {
                  <li class="text-xs">
                    <strong>{{ period(c) }}</strong>
                    <span class="text-muted-foreground"> · {{ c.source === 'thermal' ? p.thermalWindow : p.rainWindow }}</span>
                    @for (n of c.notes; track n) {
                      <p class="text-muted-foreground mt-1 flex gap-1.5"><ng-icon name="fsAlert" size="13" class="text-season-dry-text mt-0.5 shrink-0" />{{ n }}</p>
                    }
                  </li>
                }
              </ul>
            </details>
          }
        </div>
      } @else {
        <p class="text-muted-foreground mt-2 text-[11px]">{{ p.summaryEmpty }}</p>
      }
    </div>

    <div class="mt-6 flex flex-wrap items-center justify-end gap-3 border-t pt-5">
      @if (plan.isSaved()) {
        <button z-button zType="outline" zSize="xl" type="button" [zLoading]="plan.saving()" (click)="plan.edit()">{{ p.edit }}</button>
      } @else {
        @if (!plan.cycles().length) {
          <p class="text-muted-foreground text-xs">{{ p.saveHint }}</p>
        }
        <button z-button zSize="xl" type="button" [zDisabled]="!plan.cycles().length" [zLoading]="plan.saving()" (click)="plan.save()">{{ p.save }}</button>
      }
    </div>

    @if (pendingRemoval(); as c) {
      <div class="fixed inset-0 z-1100 flex items-center justify-center bg-white/72 p-6 dark:bg-black/60" (mousedown)="onBackdrop($event)" (keydown.escape)="pendingRemoval.set(null)">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-cycle-title"
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
          class="bg-card shadow-modal w-full max-w-[440px] rounded-2xl border p-8 text-center"
        >
          <span class="bg-destructive-subtle text-destructive-text mx-auto mb-5 flex size-[52px] items-center justify-center rounded-full">
            <ng-icon name="fsTrash" size="24" />
          </span>
          <h2 id="remove-cycle-title" class="text-[23px] tracking-[-0.025em]">{{ p.removeTitle }}</h2>
          <p class="text-muted-foreground mt-3 text-[13px]">{{ p.removeQuestion(c.cropName, period(c)) }}</p>
          <div class="mt-6 grid grid-cols-2 gap-3">
            <button z-button zType="outline" zSize="xl" type="button" class="text-[13px]" cdkFocusInitial (click)="pendingRemoval.set(null)">{{ p.cancel }}</button>
            <button z-button zType="danger" zSize="xl" type="button" class="text-[13px]" (click)="confirmRemove(c)">{{ p.removeConfirm }}</button>
          </div>
        </section>
      </div>
    }
  `,
})
export class AnnualPlanComponent {
  protected readonly p = STRINGS.planning;
  protected readonly months = STRINGS.months;
  protected readonly plan = inject(PlanService);

  protected readonly active = signal<string | null>(null);
  protected readonly pendingRemoval = signal<PlanCycle | null>(null);

  /** One row per cycle; a cycle that wraps past December is drawn as two segments. */
  protected readonly rows = computed<Segment[][]>(() =>
    [...this.plan.cycles()]
      .sort((a, b) => a.startMonth - b.startMonth)
      .map(c => {
        const end = c.startMonth + c.durationMonths - 1;
        return end <= 12
          ? [{ cycle: c, from: c.startMonth, to: end, first: true }]
          : [
              { cycle: c, from: c.startMonth, to: 12, first: true },
              { cycle: c, from: 1, to: end - 12, first: false },
            ];
      }),
  );

  protected readonly stats = computed(() => [
    { label: this.p.distinctCrops, value: this.plan.distinctCrops() },
    { label: this.p.plannedCycles, value: this.plan.cycles().length },
    { label: this.p.monthsOccupied, value: this.plan.monthsOccupied() },
  ]);

  protected period(c: PlanCycle): string {
    return formatPeriod(c.startMonth, c.endMonth);
  }

  protected monthsOf(group: PlanCycle[]): number {
    return new Set(group.flatMap(c => cycleMonths(c))).size;
  }

  protected toggle(id: string): void {
    this.active.update(a => (a === id ? null : id));
  }

  protected async confirmRemove(c: PlanCycle): Promise<void> {
    this.pendingRemoval.set(null);
    this.active.set(null);
    await this.plan.removeCycle(c.id);
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.pendingRemoval.set(null);
    }
  }
}
