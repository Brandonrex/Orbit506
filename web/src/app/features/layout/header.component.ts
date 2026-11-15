import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { STRINGS } from '@/core/i18n/strings';

/** App header (Figma "AppHeader"): brand on the left, data scope on the right. */
@Component({
  selector: 'af-header',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-[76px] border-b bg-card/96 max-sm:h-[68px]' },
  template: `
    <div class="mx-auto flex h-full max-w-[1200px] items-center justify-between px-8 max-lg:px-6 max-sm:px-4">
      <a routerLink="/" class="inline-flex items-center gap-3 text-[17px] font-bold tracking-[-0.02em] max-sm:text-[15px]" [attr.aria-label]="s.home">
        <span class="bg-primary inline-flex size-[42px] items-center justify-center rounded-full max-sm:size-[38px]">
          <img src="figma/brand-leaf.svg" width="23" height="23" alt="" />
        </span>
        <span>{{ s.appTitle }}</span>
      </a>
      <span class="text-muted-foreground text-sm font-semibold max-sm:hidden">{{ s.appSubtitle }}</span>
    </div>
  `,
})
export class HeaderComponent {
  protected readonly s = STRINGS;
}
