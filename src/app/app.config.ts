import { ApplicationConfig, provideZoneChangeDetection, isDevMode, LOCALE_ID } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { httpInterceptorProviers } from './core/interceptors';
import { AuthService } from './core/auth/services/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(
      routes,
      //withComponentInputBinding()
      // Défilement automatique vers l'élément dont l'id correspond au fragment de l'URL
      // (ex. #cgu-section-3) — nécessaire pour que les liens routerLink+fragment du sommaire
      // CGU fassent réellement défiler la page, pas juste changer l'URL.
      withInMemoryScrolling({ anchorScrolling: 'enabled' }),
    ),
    {
      provide : LOCALE_ID,
      useValue : 'fr-FR'
    },
    provideHttpClient(
      withInterceptorsFromDi()
    ),
    provideAnimationsAsync(), 
    httpInterceptorProviers,
    AuthService,
    provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
          })
        ]
};
