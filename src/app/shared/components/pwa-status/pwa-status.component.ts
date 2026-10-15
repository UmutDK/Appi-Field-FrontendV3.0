import { Component, DestroyRef, NgZone, OnInit, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

/**
 * PWA : bandeau « Hors connexion » (perte du réseau) et message « Nouvelle version disponible »
 * (le service worker a téléchargé une version plus récente de l'application).
 * Le service worker n'est actif qu'en production (voir app.config.ts) : en `ng serve`, seul le
 * bandeau « Hors connexion » apparaît.
 */
@Component({
  selector: 'app-pwa-status',
  standalone: true,
  template: `
    @if (offline()) {
      <div class="pwa-offline" role="status" aria-live="polite">
        <i class="bi bi-wifi-off" aria-hidden="true"></i>
        <span>Hors connexion</span>
      </div>
    }

    @if (updateReady()) {
      <div class="pwa-update" role="alertdialog" aria-labelledby="pwa-update-title">
        <i class="bi bi-arrow-repeat pwa-update-icon" aria-hidden="true"></i>
        <div class="pwa-update-text">
          <strong id="pwa-update-title">Nouvelle version disponible</strong>
          <span>Mettez à jour pour profiter des dernières améliorations.</span>
        </div>
        <div class="pwa-update-actions">
          <button type="button" class="pwa-update-later" (click)="updateReady.set(false)">Plus tard</button>
          <button type="button" class="pwa-update-now" (click)="reload()">Mettre à jour</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pwa-offline {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1100;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: calc(100vw - 32px);
      padding: 6px 14px;
      white-space: nowrap;
      border-radius: 999px;
      background: #12103c;
      color: #ffffff;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.3;
      box-shadow: 0 6px 18px rgba(18, 16, 60, 0.25);
      i { color: #f5b301; font-size: 1.05rem; flex-shrink: 0; }
    }

    .pwa-update {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 1100;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 12px;
      width: 380px;
      max-width: calc(100vw - 32px);
      padding: 14px 16px;
      border-radius: 14px;
      background: #ffffff;
      color: #12103c;
      border: 1px solid #edf0f3;
      box-shadow: 0 12px 32px rgba(18, 16, 60, 0.18);
    }
    .pwa-update-icon { font-size: 1.4rem; color: #05b1af; }
    .pwa-update-text {
      flex: 1 1 200px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 14px;
      span { color: #6b7280; font-size: 13px; }
    }
    .pwa-update-actions { display: flex; gap: 8px; margin-left: auto; }
    .pwa-update-actions button {
      min-height: 44px;
      padding: 0 14px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .pwa-update-later { background: transparent; border: 1px solid #edf0f3; color: #6b7280; }
    .pwa-update-now { background: #05b1af; border: none; color: #ffffff; }
    .pwa-update-now:hover { background: #03918a; }

    /* Téléphone / tablette : sous la barre du haut, au-dessus de la barre du bas */
    @media (max-width: 992px) {
      .pwa-offline { top: calc(64px + env(safe-area-inset-top, 0px)); }
      .pwa-update {
        left: 16px;
        right: 16px;
        width: auto;
        bottom: calc(72px + env(safe-area-inset-bottom, 0px));
      }
    }
  `]
})
export class PwaStatusComponent implements OnInit {
  private swUpdate = inject(SwUpdate);
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);

  offline = signal(typeof navigator !== 'undefined' && !navigator.onLine);
  updateReady = signal(false);

  ngOnInit(): void {
    const setOnline = () => this.zone.run(() => this.offline.set(false));
    const setOffline = () => this.zone.run(() => this.offline.set(true));
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOffline);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', setOnline);
      window.removeEventListener('offline', setOffline);
    });

    if (this.swUpdate.isEnabled) {
      const sub = this.swUpdate.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() => this.updateReady.set(true));
      this.destroyRef.onDestroy(() => sub.unsubscribe());
    }
  }

  reload(): void {
    document.location.reload();
  }
}
