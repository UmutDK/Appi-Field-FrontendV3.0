import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * Bouton flottant "Revenir en haut" (bas droite), affiché après environ un écran de défilement.
 * À placer dans les pages longues (CGU, Besoin d'aide...) : <app-back-to-top></app-back-to-top>
 * Fonctionne que la page défile sur la fenêtre ou sur <body> (cas actuel de l'app, voir onScroll).
 */
@Component({
  selector: 'app-back-to-top',
  standalone: true,
  template: `
    <button
      type="button"
      class="back-to-top"
      [class.visible]="visible"
      [attr.tabindex]="visible ? 0 : -1"
      [attr.aria-hidden]="!visible"
      (click)="scrollToTop()"
      title="Revenir en haut"
      aria-label="Revenir en haut de la page">
      <i class="bi bi-arrow-up"></i>
    </button>
  `,
  styles: [`
    .back-to-top {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 900;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      background: #05b1af;
      color: #ffffff;
      border: none;
      border-radius: 50%;
      box-shadow: 0 6px 18px rgba(18, 16, 60, 0.18);
      cursor: pointer;
      opacity: 0;
      visibility: hidden;
      transform: translateY(10px);
      transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s, background-color 0.2s ease;
    }

    .back-to-top.visible {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .back-to-top:hover { background: #049694; }

    .back-to-top:focus-visible {
      outline: 2px solid rgba(5, 177, 175, 0.5);
      outline-offset: 3px;
    }

    .back-to-top i { font-size: 1.25rem; }

    @media (max-width: 575.98px) {
      .back-to-top { right: 16px; bottom: 16px; }
    }
  `]
})
export class BackToTopComponent implements OnInit, OnDestroy {
  visible = false;

  private zone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  // styles.scss donne `height:100%` + `overflow-x:hidden` à html ET body : dans ce cas c'est
  // <body> qui défile, pas la fenêtre (window.scrollY reste à 0 et 'window:scroll' ne se
  // déclenche jamais). On écoute donc le défilement en phase de capture (un événement scroll
  // d'élément ne remonte pas, mais la capture le voit passer) et on lit la position sur les
  // trois candidats possibles.
  private readonly onScroll = () => {
    const offset = Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop);
    const visible = offset > window.innerHeight * 0.8;
    if (visible !== this.visible) {
      this.zone.run(() => {
        this.visible = visible;
        this.cdr.markForCheck();
      });
    }
  };

  ngOnInit(): void {
    // Hors zone Angular : pas de détection de changements à chaque pixel défilé
    this.zone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScroll, { capture: true });
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
