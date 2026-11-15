import { Component } from '@angular/core';

import { ShellComponent } from './features/layout/shell.component';
import { ZardSonnerComponent } from './shared/components/sonner';

@Component({
  selector: 'app-root',
  imports: [ShellComponent, ZardSonnerComponent],
  template: `
    <af-shell />
    <z-sonner position="bottom-left" [richColors]="true" />
  `,
})
export class App {}
