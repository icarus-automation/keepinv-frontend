import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TitleStrategy, provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { forkJoin, of, switchMap } from 'rxjs';

import { routes } from './app.routes';
import { AppTitleStrategy } from './app-title.strategy';
import { KeepInvPreset } from './theme/keep-inv-preset';
import { authInterceptor } from './modules/auth/interceptors/auth.interceptor';
import { AuthService } from './modules/auth/services/auth.service';
import { OrganizationService } from './modules/organization/services/organization.service';
import { EntitlementsService } from '../common/entitlements/entitlements.service';
import { PreferencesService } from '../common/preferences/preferences.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Apply the saved per-device text size before first paint, so it never flashes
    // at the default and then jump.
    provideAppInitializer(() => inject(PreferencesService).apply()),
    // Hydrate the auth session from the cookie before the first route is evaluated, so the
    // route guards see the correct signed-in/out state on a hard refresh. Once a user is
    // present, resolve their organization too so the shell renders branded on first paint.
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      const organizations = inject(OrganizationService);
      const entitlements = inject(EntitlementsService);
      return auth.loadSession().pipe(
        switchMap((user) =>
          user
            ? forkJoin([organizations.loadActiveOrganization(), entitlements.load()])
            : of(null),
        ),
      );
    }),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    providePrimeNG({
      theme: {
        preset: KeepInvPreset,
        options: {
          // Light-only for now; point dark mode at a class that is never applied.
          darkModeSelector: '.app-dark',
          // Let Tailwind utilities win over PrimeNG component styles.
          cssLayer: {
            name: 'primeng',
            order: 'theme, base, primeng, components, utilities',
          },
        },
      },
    }),
  ],
};
