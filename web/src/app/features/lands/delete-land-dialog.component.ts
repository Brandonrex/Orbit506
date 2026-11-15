import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { STRINGS } from '@/core/i18n/strings';
import { ZardButtonComponent } from '@/shared/components/button';

/** "Delete land?" confirmation (Figma: DeleteLandModal). Focus starts on Cancel. */
@Component({
  selector: 'af-delete-land-dialog',
  imports: [A11yModule, NgIcon, ZardButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fixed inset-0 z-1100 flex items-center justify-center bg-white/72 p-6 dark:bg-black/60',
    '(mousedown)': 'onBackdrop($event)',
    '(document:keydown.escape)': 'cancel.emit()',
  },
  template: `
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-land-title"
      aria-describedby="delete-land-description"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
      class="bg-card shadow-modal w-full max-w-[480px] rounded-2xl border p-8 text-center"
    >
      <span class="bg-destructive-subtle text-destructive-text mx-auto mb-5 flex size-[52px] items-center justify-center rounded-full">
        <ng-icon name="fsTrash" size="24" />
      </span>
      <h2 id="delete-land-title" class="text-[23px] tracking-[-0.025em]">{{ t.deleteTitle }}</h2>
      <p id="delete-land-description" class="text-muted-foreground mt-3 text-[13px]">
        {{ t.deleteQuestion }} <strong class="text-foreground">{{ name() }}</strong>?
      </p>
      <p class="text-muted-foreground mt-3 text-[13px]">{{ t.deleteNote }}</p>
      <div class="mt-6 grid grid-cols-2 gap-3">
        <button z-button zType="outline" zSize="xl" type="button" class="text-[13px]" cdkFocusInitial (click)="cancel.emit()">
          {{ t.cancel }}
        </button>
        <button z-button zType="danger" zSize="xl" type="button" class="text-[13px]" (click)="confirm.emit()">{{ t.delete }}</button>
      </div>
    </section>
  `,
})
export class DeleteLandDialogComponent {
  protected readonly t = STRINGS.lands;
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly name = input.required<string>();
  readonly cancel = output<void>();
  readonly confirm = output<void>();

  constructor() {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => (document.body.style.overflow = previousOverflow));
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.host.nativeElement) {
      this.cancel.emit();
    }
  }
}
