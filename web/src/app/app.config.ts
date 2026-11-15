import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, type Routes } from '@angular/router';

import { provideZardCharts } from '@/shared/components/chart';
import { provideZard } from '@/shared/core/provider/providezard';

import { ShellComponent } from './features/layout/shell.component';

/** One page. The active property lives in the query string (`?p=<id>`) so it survives reloads. */
const routes: Routes = [
  { path: '', component: ShellComponent },
  { path: '**', redirectTo: '' },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(routes),
    provideZard(),
    provideZardCharts(),
  ],
};
