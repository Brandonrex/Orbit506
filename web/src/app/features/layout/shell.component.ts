import { ChangeDetectionStrategy, Component, effect, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { STRINGS } from '@/core/i18n/strings';
import { DataService } from '@/core/services/data.service';
import { PropertyService } from '@/core/services/property.service';
import { ZardSonnerService } from '@/shared/components/sonner';

import { HeaderComponent } from './header.component';

/** App layout (Figma "DashboardLayout"): header on top, centered 1200px content column below. */
@Component({
  selector: 'af-shell',
  imports: [RouterOutlet, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-h-dvh bg-background text-foreground' },
  template: `
    <a
      href="#main-content"
      class="bg-foreground text-background sr-only z-2000 rounded-sm px-4 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-4"
      >{{ s.skipToContent }}</a
    >
    <af-header />
    <main
      id="main-content"
      class="mx-auto min-h-[calc(100dvh-76px)] max-w-[1200px] px-8 pt-16 pb-20 max-lg:px-6 max-sm:px-4 max-sm:pt-10 max-sm:pb-16"
    >
      <router-outlet />
    </main>
  `,
})
export class ShellComponent implements OnInit {
  protected readonly s = STRINGS;
  private readonly data = inject(DataService);
  private readonly property = inject(PropertyService);
  private readonly toast = inject(ZardSonnerService);

  constructor() {
    effect(() => {
      if (this.data.status() === 'error') {
        this.toast.error(STRINGS.toasts.dataError, { description: this.data.error() ?? undefined });
      }
    });
  }

  ngOnInit(): void {
    void this.data.load();
    void this.property.load();
  }
}
