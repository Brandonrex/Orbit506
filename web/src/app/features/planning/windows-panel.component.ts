import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { STRINGS } from '@/core/i18n/strings';
import type { StatusCode } from '@/core/models';
import { fmt } from '@/core/services/analysis.service';
import { PlanService } from '@/core/services/plan.service';
import { ZardButtonComponent } from '@/shared/components/button';

import { considerations, formatPeriod, statusLabel, toPlanCycle } from './planning';
import { PlanningStateService } from './planning-state.service';

/**
 * Potential windows for the selected crop at this land (12-month status strips + window chips),
 * and the selected window's details: stats, cycle checkboxes, considerations, "Add to my plan"
 * (Figma: .window-details).
 */
@Component({
  selector: 'af-windows-panel',
  imports: [NgIcon, ZardButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block space-y-5' },
  template: `
    @if (state.crop(); as crop) {
      @if (state.suitability(); as s) {
        <div class="bg-card shadow-soft rounded-lg border p-5">
          <h3 class="text-[19px] tracking-[-0.02em]">{{ p.windowsTitle }} · {{ crop.name }}</h3>
          <p class="text-muted-foreground mt-1 text-xs">{{ p.windowsDescription(state.point()!) }}</p>

          <!-- Thermal -->
          <div class="mt-5">
            <div class="flex items-baseline justify-between gap-3">
              <strong class="text-[13px]">{{ p.thermalTitle }}</strong>
              <span class="text-muted-foreground text-[11px]">{{ crop.temp.optMin }}–{{ crop.temp.optMax }} °C</span>
            </div>
            <div class="mt-2 grid grid-cols-12 gap-1">
              @for (t of s.t; track $index) {
                <div class="flex flex-col items-center gap-1" [title]="months[$index] + ': ' + fmt(t[0], 1) + ' °C · ' + label(t[1])">
                  <span class="h-6 w-full rounded-[3px]" [class]="statusBg(t[1])"></span>
                  <span class="text-muted-foreground text-[10px]">{{ months[$index] }}</span>
                </div>
              }
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              @for (w of thermalWindows(); track w.key) {
                <button type="button" [class]="chipClass" [attr.aria-pressed]="state.openWindowKey() === w.key" (click)="state.openWindowFor(w.key)">
                  <ng-icon name="fsPolygon" size="14" />
                  {{ p.thermalWindow }}: {{ period(w.startMonth, w.endMonth) }}
                </button>
              } @empty {
                <p class="text-muted-foreground text-xs">{{ p.thermalNone }}</p>
              }
            </div>
          </div>

          <!-- Rainfall -->
          <div class="mt-6">
            <div class="flex items-baseline justify-between gap-3">
              <strong class="text-[13px]">{{ p.rainTitle }}</strong>
              <span class="text-muted-foreground text-[11px]">{{ crop.rain.optMin }}–{{ crop.rain.optMax }} mm / {{ p.months(crop.rainDurationMonths) }}</span>
            </div>
            <div class="mt-2 grid grid-cols-12 gap-1">
              @for (r of s.r; track $index) {
                <div class="flex flex-col items-center gap-1" [title]="months[$index] + ': ' + fmt(r[0], 0) + ' mm · ' + label(r[1])">
                  <span class="h-6 w-full rounded-[3px]" [class]="statusBg(r[1])"></span>
                  <span class="text-muted-foreground text-[10px]">{{ months[$index] }}</span>
                </div>
              }
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              @for (w of rainWindows(); track w.key) {
                <button type="button" [class]="chipClass" [attr.aria-pressed]="state.openWindowKey() === w.key" (click)="state.openWindowFor(w.key)">
                  <ng-icon name="fsPin" size="14" />
                  {{ p.rainWindow }}: {{ period(w.startMonth, w.endMonth) }}
                </button>
              } @empty {
                <p class="text-muted-foreground text-xs">{{ p.rainNone }}</p>
              }
            </div>
            <p class="text-muted-foreground mt-3 text-[11px]">{{ p.annualRain(fmt(s.a[0], 0), label(s.a[1])) }}</p>
          </div>

          <div class="text-muted-foreground mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-[11px]">
            <span class="flex items-center gap-1.5"><i class="bg-status-favorable size-2.5 rounded-[2px]"></i>{{ p.favorable }}</span>
            <span class="flex items-center gap-1.5"><i class="bg-status-caution size-2.5 rounded-[2px]"></i>{{ p.caution }}</span>
            <span class="flex items-center gap-1.5"><i class="bg-status-unfavorable size-2.5 rounded-[2px]"></i>{{ p.unfavorable }}</span>
            <span class="basis-full">{{ p.independentNote }}</span>
          </div>
        </div>

        @if (state.openWindow(); as w) {
          <section class="bg-card shadow-soft overflow-hidden rounded-lg border" aria-labelledby="window-title">
            <div class="flex items-start gap-3 px-5 py-4">
              <span class="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">{{ crop.shortName }}</span>
              <div class="min-w-0 flex-1">
                <p class="text-primary text-xs font-bold tracking-widest uppercase">{{ p.selectedEyebrow }}</p>
                <h3 id="window-title" class="text-[19px] tracking-[-0.02em]">{{ crop.name }}</h3>
                <p class="text-muted-foreground text-xs">
                  {{ w.source === 'thermal' ? p.thermalWindow : p.rainWindow }} · {{ period(w.startMonth, w.endMonth) }}
                </p>
              </div>
              <button z-button zType="outline" type="button" class="size-10 p-0" [attr.aria-label]="p.closeWindow" (click)="state.closeWindow()">
                <ng-icon name="fsClose" size="18" />
              </button>
            </div>

            <div class="grid grid-cols-3 border-y max-sm:grid-cols-1">
              <div class="border-r px-5 py-3 max-sm:border-r-0 max-sm:border-b">
                <span class="text-muted-foreground block text-[10px] font-bold tracking-[0.04em] uppercase">{{ w.source === 'thermal' ? p.windowLength : p.plantingMonths }}</span>
                <strong class="text-sm">{{ p.months(w.length) }}</strong>
              </div>
              <div class="border-r px-5 py-3 max-sm:border-r-0 max-sm:border-b">
                <span class="text-muted-foreground block text-[10px] font-bold tracking-[0.04em] uppercase">{{ w.source === 'thermal' ? p.cropCycle : p.growingPeriod }}</span>
                <strong class="text-sm">{{ p.months(w.cycleMonths) }}</strong>
              </div>
              <div class="px-5 py-3">
                <span class="text-muted-foreground block text-[10px] font-bold tracking-[0.04em] uppercase">{{ p.theoreticalMax }}</span>
                <strong class="text-sm">{{ w.source === 'thermal' ? p.fullCycles(w.cycles.length) : p.starts(w.cycles.length) }}</strong>
              </div>
            </div>

            <fieldset class="px-5 py-4">
              <legend class="sr-only">{{ p.chooseCycles }}</legend>
              <h4 class="text-[13px] font-bold">{{ p.chooseCycles }}</h4>
              <p class="text-muted-foreground text-[11px]">{{ w.source === 'thermal' ? p.chooseCyclesNote : p.chooseStartsNote }}</p>
              <div class="mt-3 grid grid-cols-3 gap-2 max-lg:grid-cols-2 max-sm:grid-cols-1">
                @for (o of w.cycles; track o.key) {
                  <label
                    class="has-checked:border-primary has-checked:bg-accent hover:bg-background flex min-h-14 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2"
                  >
                    <input type="checkbox" class="accent-primary size-4 shrink-0" [checked]="state.selectedCycles().includes(o.key)" (change)="state.toggleCycle(o.key)" />
                    <span class="min-w-0">
                      <strong class="block text-xs">{{ o.label }}</strong>
                      <small class="text-muted-foreground text-[11px]">{{ p.months(o.durationMonths) }}</small>
                    </span>
                  </label>
                }
              </div>
            </fieldset>

            <div class="bg-background border-t px-5 py-4">
              @if (selectedNotes().length) {
                <h4 class="flex items-center gap-2 text-[13px] font-bold">
                  <span class="bg-season-dry text-season-dry-text flex size-7 items-center justify-center rounded-full"><ng-icon name="fsAlert" size="16" /></span>
                  {{ p.considerations }}
                </h4>
                <div class="mt-3 space-y-3">
                  @for (g of selectedNotes(); track g.key) {
                    <div>
                      <div class="flex items-baseline justify-between gap-2 text-xs">
                        <strong>{{ g.label }}</strong>
                        <span class="text-muted-foreground">{{ p.observations(g.notes.length) }}</span>
                      </div>
                      @for (n of g.notes; track n) {
                        <p class="bg-card text-muted-foreground mt-1.5 rounded-sm border px-3 py-2 text-xs">{{ n }}</p>
                      } @empty {
                        <p class="text-primary mt-1.5 flex items-center gap-1.5 text-xs"><ng-icon name="fsCheck" size="14" />{{ p.noConsiderations }}</p>
                      }
                    </div>
                  }
                </div>
                <p class="text-muted-foreground mt-3 flex items-center gap-1.5 text-[11px]"><ng-icon name="fsInfo" size="14" class="text-primary" />{{ p.considerationsNote }}</p>
              } @else {
                <p class="text-muted-foreground text-center text-xs">{{ p.considerationsPrompt }}</p>
              }
            </div>

            @if (state.message()) {
              <div role="alert" class="bg-destructive-subtle text-destructive-text mx-5 mt-4 flex items-center gap-2 rounded-sm p-3 text-xs font-semibold">
                <ng-icon name="fsAlert" size="17" class="shrink-0" />{{ state.message() }}
              </div>
            }

            <div class="flex items-center justify-between gap-3 px-5 py-4">
              <span class="text-muted-foreground text-xs">{{ p.selectedCount(state.selectedCycles().length) }}</span>
              <button z-button zSize="xl" type="button" [zDisabled]="!state.selectedCycles().length || plan.isSaved()" [zLoading]="plan.saving()" (click)="add()">
                {{ p.add }}
              </button>
            </div>
          </section>
        }
      }
    }
  `,
})
export class WindowsPanelComponent {
  protected readonly p = STRINGS.planning;
  protected readonly months = STRINGS.months;
  protected readonly fmt = fmt;
  protected readonly label = statusLabel;
  protected readonly period = formatPeriod;
  protected readonly chipClass =
    'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-foreground hover:border-primary aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-sage-text focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none';

  protected readonly state = inject(PlanningStateService);
  protected readonly plan = inject(PlanService);

  protected readonly thermalWindows = computed(() => this.state.windows().filter(w => w.source === 'thermal'));
  protected readonly rainWindows = computed(() => this.state.windows().filter(w => w.source === 'rainfall'));

  /** Considerations for each checked cycle (from the other, independent assessment). */
  protected readonly selectedNotes = computed(() => {
    const w = this.state.openWindow();
    const crop = this.state.crop();
    const s = this.state.suitability();
    if (!w || !crop || !s) {
      return [];
    }
    return w.cycles
      .filter(o => this.state.selectedCycles().includes(o.key))
      .map(o => ({ key: o.key, label: o.label, notes: considerations(crop, s, w.source, o.startMonth, o.durationMonths) }));
  });

  protected statusBg(code: StatusCode): string {
    return code === 2 ? 'bg-status-favorable' : code === 1 ? 'bg-status-caution/70' : code === 0 ? 'bg-status-unfavorable/80' : 'bg-muted';
  }

  protected async add(): Promise<void> {
    const w = this.state.openWindow();
    const crop = this.state.crop();
    const s = this.state.suitability();
    if (!w || !crop || !s) {
      return;
    }
    const chosen = w.cycles.filter(o => this.state.selectedCycles().includes(o.key));
    const cycles = chosen.map(o => toPlanCycle(crop, s, w, o));
    const rejected = await this.plan.addCycles(cycles);
    if (rejected.length) {
      // Keep only the rejected ones checked, as the design does.
      const keys = new Set(rejected.map(r => chosen[cycles.indexOf(r)]?.key));
      this.state.selectedCycles.set([...keys].filter((k): k is string => !!k));
      this.state.message.set(this.p.overlap);
    } else {
      this.state.closeWindow();
    }
  }
}
