import { Component, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { HeaderComponent } from './core/header/component/header/header.component';
import { FooterComponent } from './core/footer/component/footer/footer.component';
import { BackToTopComponent } from './shared/components/back-to-top/back-to-top.component';
import { AuthService } from './core/auth/services/auth.service';
import { filter, take } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, BackToTopComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  providers: [AuthService]
})
export class AppComponent implements OnInit, AfterViewInit {

  @ViewChild('routeContainer') routeContainerRef!: ElementRef<HTMLDivElement>;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // 🔐 Attendre la fin de la navigation initiale avant de vérifier le token
    // Cela évite les requêtes inutiles lors des redirections
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      take(1)
    ).subscribe((event: any) => {
      // Ne pas vérifier le token si on est sur la page d'accueil (non authentifié),
      // si on vient juste de se déconnecter, ou si on est sur la route SSO
      if (event.url === '/' || event.url.startsWith('/?') || event.url.startsWith('/sso')) {
        return;
      }
      this.checkTokenOnStartup();
    });

    // 🔐 Vérifier périodiquement le token toutes les 30 minutes
    this.startTokenCheckInterval();
  }

  ngAfterViewInit(): void {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      const el = this.routeContainerRef?.nativeElement;
      if (!el) return;
      // Rejouer l'animation en retirant puis en rajoutant la classe
      el.classList.remove('route-fade-in');
      void el.offsetHeight; // force reflow
      el.classList.add('route-fade-in');
      // Retirer la classe une fois l'animation terminée pour éviter de créer
      // un stacking context permanent qui ferait passer le header devant les popups
      el.addEventListener('animationend', () => {
        el.classList.remove('route-fade-in');
      }, { once: true });
    });
  }

  /**
   * 🔐 Vérifie si le token est valide au démarrage
   * Si invalide ou expiré, redirige vers l'accueil
   */
  private checkTokenOnStartup(): void {
    const token = localStorage.getItem('Token');
    
    // Si pas de token, ne rien faire (user non connecté)
    if (!token) {
      return;
    }

    // Vérifier si c'est un JWT ou un token simple
    const parts = token.split('.');
    
    if (parts.length === 3) {
      // Token JWT : validation synchrone
      if (!this.authService.isTokenValid()) {
        this.authService.clearAuth();
        this.router.navigate(['/'], {
          queryParams: { sessionExpired: 'true' }
        });
      }
    } else {
      // Token simple : validation asynchrone via API
      this.authService.validateTokenViaAPI(token).subscribe({
        next: (isValid) => {
          // Vérifier que le token n'a pas été remplacé entre-temps (ex: flow SSO)
          const currentToken = localStorage.getItem('Token');
          if (!isValid && currentToken === token) {
            this.authService.clearAuth();
            this.router.navigate(['/'], {
              queryParams: { sessionExpired: 'true' }
            });
          }
        }
      });
    }
  }

  /**
   * 🔄 Vérifie périodiquement la validité du token
   */
  private startTokenCheckInterval(): void {
    // Vérifier toutes les 30 minutes pour réduire la charge serveur
    setInterval(() => {
      const token = localStorage.getItem('Token');
      
      // Si pas de token, ne rien faire
      if (!token) {
        return;
      }

      // Vérifier si c'est un JWT ou un token simple
      const parts = token.split('.');
      
      if (parts.length === 3) {
        // Token JWT : validation synchrone
        if (!this.authService.isTokenValid()) {
          this.authService.clearAuth();
          this.router.navigate(['/'], {
            queryParams: { autoLogout: 'true' }
          });
        }
      } else {
        // Token simple : validation asynchrone via API
        this.authService.validateTokenViaAPI(token).subscribe({
          next: (isValid) => {
            if (!isValid) {
              this.authService.clearAuth();
              this.router.navigate(['/'], {
                queryParams: { autoLogout: 'true' }
              });
            }
          },
          error: () => {
            this.authService.clearAuth();
            this.router.navigate(['/'], {
              queryParams: { autoLogout: 'true' }
            });
          }
        });
      }
    }, 30 * 60 * 1000); // 30 minutes au lieu de 5 pour réduire la charge serveur
  }
}
