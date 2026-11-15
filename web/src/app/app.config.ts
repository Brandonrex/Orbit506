import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, type Routes, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideIcons } from '@ng-icons/core';

import { provideZardCharts } from '@/shared/components/chart';
import { provideZard } from '@/shared/core/provider/providezard';

import { DESIGN_ICONS } from './core/icons/design-icons';
import { LandPageComponent } from './features/land/land-page.component';
import { LandsPageComponent } from './features/lands/lands-page.component';
import { ShellComponent } from './features/layout/shell.component';

/**
 * Flow from the Figma design: "My lands" (empty state, or the registered lands) → add a land →
 * its analysis page. `/region` shows the same analysis for the whole data area.
 */
const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: '', component: LandsPageComponent, title: 'My lands | Adaptive Farming' },
      { path: 'lands/:id', component: LandPageComponent, title: 'Land analysis | Adaptive Farming' },
      { path: 'region', component: LandPageComponent, title: 'Region | Adaptive Farming' },
    ],
  },
  { path: '**', redirectTo: '' },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideIcons(DESIGN_ICONS),
    provideZard(),
    provideZardCharts(),
  ],
};
