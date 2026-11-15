import { ChangeDetectionStrategy, Component, effect, inject, OnInit } from '@angular/core';

import { STRINGS } from '@/core/i18n/strings';
import { DataService } from '@/core/services/data.service';
import { PropertyService } from '@/core/services/property.service';
import { ZardResizableImports } from '@/shared/components/resizable';
import { ZardSonnerService } from '@/shared/components/sonner';

import { DashboardComponent } from '../dashboard/dashboard.component';
import { MapComponent } from '../map/map.component';
import { PropertyListComponent } from '../properties/property-list.component';
import { HeaderComponent } from './header.component';

/** App layout: header on top, resizable properties | map | dashboard split below. */
@Component({
  selector: 'af-shell',
  imports: [ZardResizableImports, HeaderComponent, PropertyListComponent, MapComponent, DashboardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-dvh flex-col bg-background text-foreground' },
  template: `
    <af-header />
    <z-resizable class="min-h-0 flex-1" zLayout="horizontal">
      <z-resizable-panel [zDefaultSize]="16" [zMin]="12" [zMax]="30" zCollapsible>
        <af-property-list />
      </z-resizable-panel>
      <z-resizable-handle zWithHandle />
      <z-resizable-panel [zDefaultSize]="54" [zMin]="30">
        <af-map />
      </z-resizable-panel>
      <z-resizable-handle zWithHandle />
      <z-resizable-panel [zDefaultSize]="30" [zMin]="22">
        <af-dashboard />
      </z-resizable-panel>
    </z-resizable>
  `,
})
export class ShellComponent implements OnInit {
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
