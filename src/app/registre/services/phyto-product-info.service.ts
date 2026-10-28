import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Ligne `crops` de corderPhytoweb (une par couple acte × culture), cf. /index/crop_authorizations. */
export interface CropAuthorizationRow {
  idCropData: string;
  idCrop: string;
  idAct: string;
  cropName: string;
  cropApplicationStade: string | null;
  cropMaxDose: number | null;
  cropMaxDoseUnit: string | null;
  cropMaxDoseUnitId: string | null;
  cropMaxApp: number | null;
}

/** Nombre d'applications déjà faites d'un produit sur une culture de l'utilisateur. */
export interface ApplicationCount {
  cropId: string;
  count: number;
}

/**
 * Accès en lecture aux référentiels Phytoweb utilisés par le popup d'information produit,
 * avec un cache par produit (idAct) partagé entre le popup et le formulaire de traitement :
 * un produit survolé dans la recherche n'est pas rechargé une fois ajouté au traitement.
 */
@Injectable({ providedIn: 'root' })
export class PhytoProductInfoService {
  private http = inject(HttpClient);

  private cropAuthorizations = new Map<string, Observable<CropAuthorizationRow[]>>();
  private phytowebCrops$?: Observable<{ idCrop: string; cropName: string }[]>;

  /** Cultures autorisées, dose max, nb max d'applications et stade BBCH par culture pour un acte. */
  getCropAuthorizations(idAct: string): Observable<CropAuthorizationRow[]> {
    if (!idAct) return of([]);
    if (!this.cropAuthorizations.has(idAct)) {
      const url = `${environment.apiPhytoweb}/index/crop_authorizations?idAct=${encodeURIComponent(idAct)}`;
      this.cropAuthorizations.set(idAct, this.http.get<CropAuthorizationRow[]>(url).pipe(
        map(rows => rows || []),
        catchError(() => {
          // Ne pas garder l'échec en cache : un prochain survol retentera l'appel.
          this.cropAuthorizations.delete(idAct);
          return of([]);
        }),
        shareReplay(1)
      ));
    }
    return this.cropAuthorizations.get(idAct)!;
  }

  /**
   * Applications déjà faites du produit sur les cultures de l'utilisateur (GET
   * /phyto_treatments/application_count, backend appifield). Pas de cache : le compte change
   * dès qu'un traitement est enregistré. En cas d'erreur (route pas encore déployée…),
   * renvoie [] et le popup n'affiche simplement pas la ligne.
   */
  getApplicationCounts(productId: string, cropIds: string[], excludeEventId?: string | null): Observable<ApplicationCount[]> {
    if (!productId || cropIds.length === 0) return of([]);
    const params: Record<string, string> = { productId, cropIds: cropIds.join(',') };
    if (excludeEventId) params['excludeEventId'] = excludeEventId;
    return this.http.get<ApplicationCount[]>(`${environment.apiRegistre}/phyto_treatments/application_count`, { params }).pipe(
      map(rows => rows || []),
      catchError(() => of([]))
    );
  }

  /** Catalogue dédupliqué des cultures (indexCrop), pour résoudre un nom de culture en idCrop. */
  getPhytowebCrops(): Observable<{ idCrop: string; cropName: string }[]> {
    if (!this.phytowebCrops$) {
      this.phytowebCrops$ = this.http.get<{ idCrop: string; cropName: string }[]>(`${environment.apiPhytoweb}/index/phytoweb_crops`).pipe(
        map(rows => rows || []),
        catchError(() => of([])),
        shareReplay(1)
      );
    }
    return this.phytowebCrops$;
  }
}
