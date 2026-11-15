import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucidePencil } from '@ng-icons/lucide';

import { STRINGS } from '@/core/i18n/strings';
import type { SavedProperty } from '@/core/models';
import { landArea, landLocation } from '@/core/utils/land';
import { ZardButtonComponent } from '@/shared/components/button';

/** One registered land (Figma: LandCard): name, location, area, options menu and "View land". */
@Component({
  selector: 'af-land-card',
  imports: [NgIcon, ZardButtonComponent],
  providers: [provideIcons({ lucideDownload, lucidePencil })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    '(document:mousedown)': 'onDocumentDown($event)',
    '(document:keydown.escape)': 'menuOpen.set(false)',
  },
  template: `
    <article
      class="group/card bg-card shadow-soft hover:border-border-strong hover:shadow-lift active:shadow-soft relative flex h-full flex-col rounded-lg border p-6 transition-[border-color,box-shadow,transform] duration-180 hover:-translate-y-[3px] active:-translate-y-px"
    >
      <span
        aria-hidden="true"
        class="bg-primary absolute inset-x-0 top-0 h-[3px] scale-x-70 rounded-t-lg opacity-0 transition-[opacity,transform] duration-180 group-focus-within/card:scale-x-100 group-focus-within/card:opacity-100 group-hover/card:scale-x-100 group-hover/card:opacity-100"
      ></span>

      <div class="mb-6 flex items-start justify-between">
        <div class="min-w-0 flex-1">
          @if (renaming()) {
            <input
              #renameInput
              class="border-input bg-card focus:border-primary focus:ring-primary/14 w-full rounded-sm border px-2 py-1 text-[21px] tracking-[-0.025em] outline-none focus:ring-3"
              maxlength="120"
              [value]="land().name"
              [attr.aria-label]="t.rename"
              (keydown.enter)="commitRename($any($event.target).value)"
              (keydown.escape)="renaming.set(false); $event.stopPropagation()"
              (blur)="commitRename($any($event.target).value)"
            />
          } @else {
            <h2 class="text-[21px] leading-[1.3] tracking-[-0.025em] break-words">{{ land().name }}</h2>
          }
          <p class="text-muted-foreground mt-5 flex items-start gap-2 text-[13px] leading-[1.55]">
            <ng-icon name="fsPin" size="18" class="text-primary mt-px shrink-0" />
            <span>{{ location() }}</span>
          </p>
          <p class="text-muted-foreground mt-3 flex items-center gap-2 text-xs leading-[1.4]">
            <ng-icon name="fsCrop" size="18" class="text-olive shrink-0" />
            <span class="tabular-nums">{{ area() }}</span>
          </p>
        </div>

        <div #menu class="relative ml-3 shrink-0">
          <button
            z-button
            zType="ghost"
            type="button"
            class="text-muted-foreground hover:border-border hover:bg-background aria-expanded:border-border aria-expanded:bg-background size-11 border border-transparent p-0"
            aria-haspopup="menu"
            [attr.aria-expanded]="menuOpen()"
            [attr.aria-label]="t.menu"
            (click)="menuOpen.set(!menuOpen())"
          >
            <ng-icon name="fsMore" size="20" />
          </button>
          @if (menuOpen()) {
            <div role="menu" class="bg-card shadow-lift absolute top-[calc(100%+4px)] right-0 z-10 min-w-[190px] rounded-sm border p-1">
              <button type="button" role="menuitem" [class]="itemClass" (click)="startRename()">
                <ng-icon name="lucidePencil" size="16" />
                {{ t.rename }}
              </button>
              <button type="button" role="menuitem" [class]="itemClass" (click)="menuOpen.set(false); exportGeoJson.emit()">
                <ng-icon name="lucideDownload" size="16" />
                {{ t.export }}
              </button>
              <button
                type="button"
                role="menuitem"
                [class]="itemClass + ' text-destructive-text hover:bg-destructive-subtle'"
                (click)="menuOpen.set(false); remove.emit()"
              >
                <ng-icon name="fsTrash" size="17" />
                {{ t.delete }}
              </button>
            </div>
          }
        </div>
      </div>

      <div class="mt-auto flex items-center justify-between gap-3 border-t pt-5">
        <button
          z-button
          zSize="xl"
          type="button"
          class="group/view w-full px-4 text-[13px]"
          [attr.aria-label]="t.viewLabel(land().name)"
          (click)="view.emit()"
        >
          {{ t.view }}
          <ng-icon name="fsArrowRight" size="18" class="transition-transform duration-160 group-hover/view:translate-x-[3px]" />
        </button>
      </div>
    </article>
  `,
})
export class LandCardComponent {
  protected readonly t = STRINGS.lands;
  protected readonly itemClass =
    'flex min-h-[42px] w-full cursor-pointer items-center gap-2 rounded-[6px] px-3 py-2 text-left text-xs font-bold hover:bg-background focus-visible:bg-background focus-visible:outline-none';

  readonly land = input.required<SavedProperty>();
  readonly view = output<void>();
  readonly remove = output<void>();
  readonly exportGeoJson = output<void>();
  readonly rename = output<string>();

  protected readonly menuOpen = signal(false);
  protected readonly renaming = signal(false);
  protected readonly location = computed(() => landLocation(this.land().geometry));
  protected readonly area = computed(() => landArea(this.land().geometry));

  private readonly menu = viewChild.required<ElementRef<HTMLDivElement>>('menu');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  protected startRename(): void {
    this.menuOpen.set(false);
    this.renaming.set(true);
    setTimeout(() => this.renameInput()?.nativeElement.select());
  }

  protected commitRename(value: string): void {
    if (!this.renaming()) {
      return; // Enter already committed; this is the blur that follows
    }
    this.renaming.set(false);
    if (value.trim() && value.trim() !== this.land().name) {
      this.rename.emit(value);
    }
  }

  protected onDocumentDown(event: MouseEvent): void {
    if (this.menuOpen() && !this.menu().nativeElement.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }
}
