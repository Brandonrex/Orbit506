import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

import { provideZardCharts } from '@/shared/components/chart';
import { provideZard } from '@/shared/core/provider/providezard';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideZard(), provideZardCharts()],
};
