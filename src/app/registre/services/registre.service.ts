import { HttpClient } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
import { map, Observable, switchMap, tap, combineLatest, of, catchError, throwError, delay, retry, BehaviorSubject, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Traduit une parcelle renvoyée par le nouveau serveur (camelCase) vers la forme
 * legacy (id_parcel, parcel_name...) attendue par les composants du module registre.
 * Copie locale de parcelles-server.service.ts::fromApi pour éviter une dépendance
 * circulaire (ParcellesService importe déjà RegistreService).
 */
function parcelFromApi(p: any): any {
  return {
    id_parcel: p.parcelId,
    parcel_name: p.parcelName || '',
    parcel_area: p.parcelArea != null ? String(p.parcelArea) : '',
    parcel_area_unit_fr: p.parcelAreaUnit || 'ha',
    parcel_address: p.parcelAddress || '',
    parcel_category: p.parcelCategory || '',
    lat: p.latitude != null ? String(p.latitude) : '',
    lon: p.longitude != null ? String(p.longitude) : '',
    polygone: typeof p.polygon === 'string' ? p.polygon : (p.polygon ? JSON.stringify(p.polygon) : undefined),
    imported_from_gml: p.recordType === 'gml_import',
    record_type: p.recordType,
    exploitation_id: p.exploitationId,
  };
}

/** Traduit un lien parcelle legacy (parcel_id/parcel_name/crop_id/crop_name/phytoweb_name) vers le format API (parcelId/parcelName/cropId/cropName/phytowebCropName). */
function parcelLinkToApi(p: any): any {
  return {
    parcelId: p.parcel_id,
    parcelName: p.parcel_name,
    cropId: p.crop_id,
    cropName: p.crop_name,
    phytowebCropName: p.phytoweb_name,
  };
}

/** Traduit un lien parcelle API vers la forme legacy attendue par les composants travaux/traitements. */
function parcelLinkFromApi(p: any): any {
  return {
    parcel_id: p.parcelId,
    parcels_id: p.parcelId,
    parcel_name: p.parcelName,
    parcels_name: p.parcelName,
    crop_id: p.cropId,
    crop_name: p.cropName,
    phytoweb_name: p.phytowebCropName,
  };
}

/** Traduit un travail au champ normalisé (event_id/type/date/informations/remark/tool/dose...) vers POST/PUT /field_works. */
function fieldWorkToApi(w: any): any {
  const eventInfo = [w.field_work_type, w.description, w.observation, w.informations].filter(Boolean).join(' - ') || undefined;
  return {
    eventType: w.type,
    eventDate: w.date || w.harvest_date,
    eventInfo,
    remarks: w.remark,
    eventDose: w.dose || undefined,
    eventDoseUnit: w.dose_unit,
    eventTool: w.tool,
    parcelsConcerned: (w.parcels_concerned || []).map(parcelLinkToApi),
  };
}

/** Traduit un travail au champ renvoyé par le serveur vers la forme legacy attendue par le module registre. */
function fieldWorkFromApi(w: any): any {
  return {
    event_id: w.eventId,
    type: w.eventType,
    date: w.eventDate,
    informations: w.eventInfo,
    remark: w.remarks,
    dose: w.eventDose,
    dose_unit: w.eventDoseUnit,
    tool: w.eventTool,
    parcels_concerned: (w.parcelsConcerned || []).map(parcelLinkFromApi),
    userId: w.userId,
    exploitationId: w.exploitationId,
  };
}

/** Traduit une parcelle concernée par un traitement (legacy) vers phytoTreatmentsParcelsCrops (API). */
function treatmentParcelToApi(p: any): any {
  return {
    parcelId: p.parcel_id ?? p.parcels_id,
    parcelName: p.parcel_name ?? p.parcels_name,
    cropId: p.crop_id,
    cropName: p.crop_name,
    phytowebCropName: p.phytoweb_name,
    // surfaceTreated : valeur de base saisie par l'utilisateur (défaut = surface de la
    // parcelle si absente).
    surfaceTreated: p.parcel_surface_treated,
    surfaceTreatedUnit: p.surface_unit || 'ha',
    // Mode Bouillie : volume de bouillie réparti sur cette parcelle (étape "Répartition",
    // slider/champ + verrouillage). Le serveur respecte cette valeur si elle est fournie et
    // positive, sinon calcule un défaut proportionnel à la surface (voir treatment_calc/bouillie.py).
    // Ignoré par les modes Surface/Quantité, qui calculent treatmentQuantity eux-mêmes.
    treatmentQuantity: p.treatment_volume_applied || undefined,
    treatmentQuantityUnit: 'L',
  };
}

function treatmentParcelFromApi(p: any): any {
  return {
    parcel_id: p.parcelId,
    parcels_id: p.parcelId,
    parcel_name: p.parcelName,
    parcels_name: p.parcelName,
    crop_id: p.cropId,
    crop_name: p.cropName,
    phytoweb_name: p.phytowebCropName,
    parcel_surface_treated: p.surfaceTreated,
    standard_surface_treated: p.standardSurfaceTreated ?? p.surfaceTreated,
    surface_unit: p.surfaceTreatedUnit || 'ha',
    // Quantité de produit calculée par le serveur pour cette parcelle (distincte de la
    // surface depuis l'ajout des colonnes surfaceTreated dédiées).
    parcel_treatment_quantity: p.treatmentQuantity,
    standard_parcel_treatment_quantity: p.standardTreatmentQuantity ?? p.treatmentQuantity,
    parcel_treatment_quantity_unit: p.treatmentQuantityUnit || '',
    // ⚠️ Mode Bouillie : l'étape "Répartition" (sliders, verrouillage) lit/écrit
    // treatment_volume_applied — sans ce mapping, la répartition manuelle chargée depuis le
    // serveur était invisible pour cette UI (elle atterrissait dans parcel_treatment_quantity,
    // que rien ne lit) et se faisait donc écraser au prochain enregistrement.
    treatment_volume_applied: p.treatmentQuantity,
  };
}

/** Traduit un composant de traitement (legacy component_*) vers phytoTreatmentsComposition (API). */
function treatmentComponentToApi(c: any, fallbackTarget?: string): any {
  return {
    productId: c.component_id,
    productName: c.component_name,
    productNumAut: c.component_numaut,
    productDose: c.component_dose,
    productDoseUnit: c.component_dose_unit,
    productQuantity: c.component_quantity,
    productQuantityUnit: c.component_quantity_unity,
    productTarget: c.target || fallbackTarget || '',
  };
}

function treatmentComponentFromApi(c: any): any {
  return {
    component_id: c.productId,
    component_name: c.productName,
    component_numaut: c.productNumAut,
    component_dose: c.productDose,
    standard_component_dose: c.standardProductDose ?? c.productDose,
    component_dose_unit: c.productDoseUnit,
    component_quantity: c.productQuantity,
    component_quantity_unity: c.productQuantityUnit,
    target: c.productTarget,
  };
}

/** Traduit le draft de traitement (currentTreatmentDraft, legacy) vers POST/PUT /phyto_treatments (API). */
export function treatmentToApi(t: any): any {
  return {
    exploitationId: t.exploitation_id,
    eventType: t.type,
    eventDate: t.date,
    eventTime: t.event_hour || undefined,
    operatorId: t.operator_id || undefined,
    // Bases du mode Bouillie (volume de bouillie préparé/utilisé, toujours en L côté UI —
    // voir traitement-phyto.component.html). Ignorées par le serveur pour les autres modes,
    // qui dérivent leurs totaux depuis treatment_composition.
    treatmentTotalQuantity: t.treatment_total_quantity || undefined,
    treatmentTotalQuantityUnit: 'L',
    treatmentTotalQuantityUsed: t.treatment_total_quantity_used || undefined,
    treatmentTotalQuantityUsedUnit: 'L',
    remarks: t.remark,
    cleanFlag: t.clean_flag === 'Oui',
    localizedTreatment: t.localized_treatment === 'Oui',
    decisionBase: t.decision_base,
    effectiveness: t.effectiveness,
    parcelsConcerned: (t.parcels_concerned || []).map(treatmentParcelToApi),
    treatmentComposition: (t.treatment_composition || []).map((c: any) => treatmentComponentToApi(c, t.target)),
  };
}

/** Traduit un traitement renvoyé par le serveur vers la forme legacy attendue par le module registre. */
export function treatmentFromApi(t: any): any {
  return {
    event_id: t.eventId,
    type: t.eventType,
    date: t.eventDate,
    event_hour: t.eventTime,
    operator_id: t.operatorId,
    remark: t.remarks,
    clean_flag: t.cleanFlag ? 'Oui' : 'Non',
    localized_treatment: t.localizedTreatment ? 'Oui' : 'Non',
    treatment_total_quantity: t.treatmentTotalQuantity,
    treatment_total_quantity_unit: t.treatmentTotalQuantityUnit,
    standard_treatment_total_quantity: t.standardTreatmentTotalQuantity,
    treatment_total_quantity_used: t.treatmentTotalQuantityUsed,
    treatment_total_quantity_used_unit: t.treatmentTotalQuantityUsedUnit,
    standard_treatment_total_quantity_used: t.standardTreatmentTotalQuantityUsed,
    decision_base: t.decisionBase,
    effectiveness: t.effectiveness,
    total_surface: t.surfaceTreated,
    standard_total_surface_treated: t.standardSurfaceTreated ?? t.surfaceTreated,
    target: (t.treatmentComposition && t.treatmentComposition[0]?.productTarget) || '',
    parcels_concerned: (t.parcelsConcerned || []).map(treatmentParcelFromApi),
    treatment_composition: (t.treatmentComposition || []).map(treatmentComponentFromApi),
    userId: t.userId,
    exploitationId: t.exploitationId,
  };
}

/**
 * Traduit une culture renvoyée par le serveur (cropId/cropName + liaisons cropsParcels,
 * phytowebName déjà résolu côté serveur depuis phytowebId) vers la forme legacy
 * (crop_id/crop_name/parcels_id...) attendue par les composants du module registre
 * (registre-get, archives...). Conserve aussi les champs camelCase bruts (cropId, parcels,
 * phytowebId...) car certaines méthodes de ce service les consomment encore directement
 * (buildAssociations, updateCulture...).
 */
export function cropFromApi(c: any): any {
  return {
    ...c,
    crop_id: c.cropId,
    crop_name: c.cropName,
    remarque: c.remarks,
    semis: c.sowingDate,
    sowing_date: c.sowingDate,
    harvest_date: c.harvestDate,
    is_archived: !!c.isArchived,
    phytoweb_id: c.phytowebId,
    phytoweb_name: c.phytowebName || '',
    nomPhytoweb_crops_id: c.phytowebName || '',
    parcels_id: Array.isArray(c.parcels) ? c.parcels.map((p: any) => p.parcelId) : [],
  };
}

/** Traduit le code utilisateur de general.user ('PRO'/'AMA') vers un libellé affichable. */
function userGroupLabel(user: string | undefined | null): string {
  if (user === 'PRO') return 'Professionnel';
  if (user === 'AMA') return 'Amateur';
  return user || '';
}

/** Traduit un produit Phytoweb renvoyé par le serveur (table `general`) vers la forme legacy product_id/product_name/product_numaut. */
export function productFromApi(p: any): any {
  return {
    product_id: p.idAct,
    product_name: p.productName,
    product_numaut: p.numAut,
    product_type: p.productType,
    product_composition: p.productComposition,
    product_statut: p.statut,
    // Statut d'autorisation calculé côté serveur (general.statut + dates.useToleranceDate) :
    // 'authorized' | 'withdrawing' | 'forbidden' | 'unknown'.
    authorization_status: p.authorizationStatus,
    use_tolerance_date: p.useToleranceDate,
    spe8_flag: !!p.spe8Flag,
    user_group: userGroupLabel(p.user),
  };
}

@Injectable({ providedIn: 'root' })
export class RegistreService {

  // 🚀 CACHE INSTANTANÉ : BehaviorSubject pour émettre immédiatement les nouvelles valeurs
  private treatmentsCache$ = new BehaviorSubject<any[]>([]);
  private fieldWorksCache$ = new BehaviorSubject<any[]>([]);
  private culturesCache$ = new BehaviorSubject<any[]>([]);
  
  // 🏁 Flags pour savoir si les données ont déjà été chargées
  private treatmentsLoaded = false;
  private fieldWorksLoaded = false;
  private culturesLoaded = false;
  
  siganlService = signal<any>([]);
  signalTreatment = signal<any>([]);
  signalGetDose = signal<any>([]);
  signalGet = signal<any>([]);
  signalGetTableauGeneralTraitement = signal<any>([]);
  
  // 🎯 NOUVEAU SYSTÈME : Signals pour rafraîchissement incrémental ciblé
  // Chaque type de données a son propre signal
  treatmentsData = signal<any[]>([]);
  fieldWorksData = signal<any[]>([]);
  culturesData = signal<any[]>([]);
  
  // Signals pour déclencher uniquement le rechargement nécessaire
  needRefreshTreatments = signal<boolean>(false);
  needRefreshFieldWorks = signal<boolean>(false);
  needRefreshCultures = signal<boolean>(false);
  needRefreshArchives = signal<boolean>(false); // Signal pour rafraîchir les archives
  
  // Signal pour déclencher le rafraîchissement du dashboard (legacy - à supprimer progressivement)
  refreshDashboard = signal<boolean>(false);
  
  // 🔄 Signal pour déclencher le rafraîchissement quand une parcelle est modifiée
  parcelUpdated = signal<boolean>(false);
  
  // Cache pour les données fréquemment utilisées
  cachedProducts = signal<any>([]);
  cachedCrops = signal<any>([]);
  cachedParcels = signal<any>([]);
  
  // Système de limitation des requêtes simultanées et localStorage
  private pendingRequests = 0;
  private readonly MAX_CONCURRENT_REQUESTS = 2;
  private readonly CACHE_DURATION = 10 * 60 * 1000; // 10 minutes en milliseconds
  private readonly CACHE_KEYS = {
    PARCELS: 'appifield_parcels_cache',
    CROPS: 'appifield_crops_cache',
    PRODUCTS: 'appifield_products_cache',
    TIMESTAMP_SUFFIX: '_timestamp'
  };

  // 🚫 Déduplication des requêtes identiques
  private ongoingRequests = new Map<string, Observable<any>>();

  total!:number;
  totalSurface!:number;

  constructor(
    private http : HttpClient
  ) { 
    // Le chargement se fera automatiquement à la première demande
  }

  /**
   * 🛡️ Initialisation sécurisée pour éviter les erreurs 429
   */
  private initializeSafely(): void {
    
    // Remplacer les méthodes par leurs versions optimisées
    this.resetAndUseOptimizedMethods();
    
    // Préchargement différé pour éviter les requêtes simultanées
    setTimeout(() => {
      this.preloadEssentialDataSafely();
    }, 2000); // Attendre 2 secondes avant le préchargement
  }

  /**
   * 🚀 Préchargement sécurisé avec délais pour éviter les 429
   */
  private preloadEssentialDataSafely(): void {
    
    // Précharger les parcelles en premier
    this.getParcellesOptimized().subscribe({
      next: () => {
        
        // Précharger les cultures après un délai
        setTimeout(() => {
          this.getExploitationOptimized().subscribe({
            next: () => console.log('')
          });
        }, 1500); // Délai de 1.5 secondes entre les requêtes
      }
    });
  }

  /**
   * 🚫 Méthode utilitaire pour déduplication et optimisation des requêtes HTTP
   */
  private makeDeduplicatedRequest<T>(url: string, cacheKey?: string): Observable<T> {
    // Vérifier si une requête identique est déjà en cours
    if (this.ongoingRequests.has(url)) {
      return this.ongoingRequests.get(url) as Observable<T>;
    }

    // Créer la nouvelle requête
    const request$ = this.makeHttpRequest<T>(url).pipe(
      tap(() => {
        // Supprimer de la liste des requêtes en cours quand terminé
        this.ongoingRequests.delete(url);
      }),
      catchError(error => {
        // Supprimer aussi en cas d'erreur
        this.ongoingRequests.delete(url);
        return throwError(() => error);
      })
    );

    // Stocker la requête en cours
    this.ongoingRequests.set(url, request$);
    return request$;
  }
  /**
   * 🔄 Méthode utilitaire pour faire des requêtes HTTP avec retry en cas d'erreur 429
   */
  private makeHttpRequest<T>(url: string): Observable<T> {
    // Attendre si trop de requêtes simultanées, mais ne pas créer de boucle infinie
    if (this.pendingRequests >= this.MAX_CONCURRENT_REQUESTS) {
      return new Observable<T>(subscriber => {
        const checkAndExecute = () => {
          if (this.pendingRequests < this.MAX_CONCURRENT_REQUESTS) {
            this.executeHttpRequest<T>(url).subscribe(subscriber);
          } else {
            setTimeout(checkAndExecute, 1000); // Vérifier toutes les secondes
          }
        };
        checkAndExecute();
      });
    }
    
    return this.executeHttpRequest<T>(url);
  }

  /**
   * Exécute réellement la requête HTTP
   */
  private executeHttpRequest<T>(url: string): Observable<T> {
    this.pendingRequests++;
    
    return this.http.get<T>(url).pipe(
      tap((response) => {
        this.pendingRequests--;
      }),
      catchError(error => {
        this.pendingRequests--;
        
        
        if (error.status === 429) {
          return of(null).pipe(
            delay(3000), // Attendre 3 secondes
            switchMap(() => this.executeHttpRequest<T>(url)) // Retry avec la méthode execute
          );
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Initialise le cache manuellement si nécessaire
   */
  public initializeCacheIfNeeded(): void {
    if (this.isCacheReady()) {
      return;
    }
    
    this.initializeCache();
  }

  /**
   * Initialise le cache avec les données fréquemment utilisées
   */
  private initializeCache(): void {
    
    // Limiter les requêtes simultanées pour éviter l'erreur 429
    // Charger les données une par une avec délai
    this.loadDataSequentially();
  }

  /**
   * Charge les données séquentiellement pour éviter trop de requêtes simultanées
   */
  private loadDataSequentially(): void {
    // 1. Charger les cultures d'abord (UTILISATEUR, pas Phytoweb)
    this.makeHttpRequest<any[]>(`${environment.apiRegistre}/crops`).subscribe({
      next: (crops) => {
        this.cachedCrops.set(crops);

        // 2. Puis charger les parcelles après 500ms
        setTimeout(() => {
          this.makeHttpRequest<any[]>(`${environment.apiRegistre}/parcels`).subscribe({
            next: (parcels) => {
              this.cachedParcels.set((parcels || []).map(parcelFromApi));
              
              // 3. Enfin charger les produits après 500ms supplémentaires
              setTimeout(() => {
                this.preloadProducts();
              }, 500);
            },
          });
        }, 500);
      },
    });
  }

  /**
   * Précharge les produits phytosanitaires au démarrage de l'application.
   * Doit mapper via productFromApi comme getVolumeDeBouillipreparer() : sinon ce préchargement
   * (qui s'exécute en premier, au démarrage) remplit cachedProducts avec la forme brute
   * (idAct/productName...), et le court-circuit "cache déjà rempli" de
   * getVolumeDeBouillipreparer()/getIdVolumeDeBouillipreparer() renvoie alors cette forme brute
   * pour toute la session — cassant toute recherche sur product_id (ex. ajout d'un produit
   * à un traitement, qui échoue avec "Produit non trouvé").
   */
  private preloadProducts(): void {
    this.makeHttpRequest<any[]>(`${environment.apiRegistre}/index/phytoweb_products`).subscribe({
      next: (products) => {
        this.cachedProducts.set((products || []).map(productFromApi));
      }
    });
  }

  /**
   * Force le rechargement du cache si nécessaire
   */
  ensureCacheLoaded(): void {
    if (!this.isCacheReady()) {
      this.initializeCache();
    }
  }

  /**
   * Rafraîchit uniquement la liste des parcelles et met à jour le cache central
   * Utilisé par les composants qui modifient les parcelles (création / suppression / modification)
   */
  public async refreshParcels(): Promise<void> {
    try {
      
      // Force un rechargement même si le cache existe
      const parcels = await this.makeHttpRequest<any[]>(`${environment.apiRegistre}/parcels`).toPromise();
      if (Array.isArray(parcels)) {
        this.cachedParcels.set(parcels.map(parcelFromApi));
      }
    } catch (error) {
    }
  }

  /**
   * 🔄 Notifie que les parcelles ont été modifiées et force le rechargement des cultures/crops
   * Méthode à appeler après modification d'une parcelle pour rafraîchir l'affichage
   */
  public async notifyParcelUpdated(): Promise<void> {
    try {
      
      // 1. Rafraîchir les parcelles
      await this.refreshParcels();
      
      // 2. Forcer le rechargement des cultures qui utilisent les noms de parcelles
      this.cachedCrops.set([]);
      localStorage.removeItem(this.CACHE_KEYS.CROPS + this.CACHE_KEYS.TIMESTAMP_SUFFIX);
      localStorage.removeItem(this.CACHE_KEYS.CROPS);
      
      // 3. Déclencher le signal de mise à jour
      this.parcelUpdated.set(!this.parcelUpdated());
      this.refreshDashboard.set(!this.refreshDashboard());
      
    } catch (error) {
    }
  }

  /**
   * Le nouveau serveur synchronise automatiquement l'inventaire à chaque POST/PUT
   * sur /phyto_treatments — cette synchronisation manuelle n'est plus nécessaire.
   * Conservée en no-op pour ne pas casser les appelants existants.
   */
  public updateInventoryForBouillieModification(treatment: any): Observable<any> {
    return of({ success: true });
  }

  /**
   * Le nouveau serveur synchronise automatiquement l'inventaire (ajout/suppression
   * des mouvements de stock liés) à chaque POST/PUT/DELETE sur /phyto_treatments —
   * plus besoin de le déclencher manuellement depuis le frontend. Conservé en no-op
   * pour ne pas casser les appelants existants.
   */
  public removeInventoryForDeletedTreatment(eventId: string): Observable<any> {
    return of({ success: true });
  }

  // Récupérer tous les traitements finaux (pour dashboard)
  /**
   * 🚀 OPTIMISÉ : Retourne le cache BehaviorSubject (émission immédiate)
   */
  getAllTraitements(): Observable<any[]> {
    // Charger une seule fois au premier appel
    if (!this.treatmentsLoaded) {
      this.treatmentsLoaded = true;
      this.loadTreatmentsToCache();
    }
    return this.treatmentsCache$.asObservable();
  }

  /**
   * 🔄 Force le rechargement des traitements
   */
  private loadTreatmentsToCache(): void {
    this.makeHttpRequest<any[]>(`${environment.apiRegistre}/phyto_treatments`).pipe(
      map(treatments => (treatments || []).map(treatmentFromApi)),
      tap(treatments => {
        this.treatmentsData.set(treatments);
        // Émettre immédiatement vers tous les abonnés
        this.treatmentsCache$.next(treatments);
      })
    ).subscribe();
  }

  /**
   * 🚀 OPTIMISÉ : Retourne le cache BehaviorSubject (émission immédiate)
   */
  getAllTravauxChamps(): Observable<any[]> {
    // Charger une seule fois au premier appel
    if (!this.fieldWorksLoaded) {
      this.fieldWorksLoaded = true;
      this.loadFieldWorksToCache();
    }
    return this.fieldWorksCache$.asObservable();
  }

  /**
   * 🔄 Force le rechargement des travaux aux champs
   */
  private loadFieldWorksToCache(): void {
    this.makeHttpRequest<any[]>(`${environment.apiRegistre}/field_works`).pipe(
      map(fieldWorks => (fieldWorks || []).map(fieldWorkFromApi)),
      tap(fieldWorks => {
        this.fieldWorksData.set(fieldWorks);
        // Émettre immédiatement vers tous les abonnés
        this.fieldWorksCache$.next(fieldWorks);
      })
    ).subscribe();
  }
  
  // 🚀 OPTIMISÉ : Méthode pour rafraîchir INSTANTANÉMENT uniquement les traitements
  refreshTreatmentsOnly(): void {
    this.needRefreshTreatments.set(true);
    this.loadTreatmentsToCache(); // Recharger le cache immédiatement
  }
  
  // 🚀 OPTIMISÉ : Méthode pour rafraîchir INSTANTANÉMENT uniquement les travaux aux champs
  refreshFieldWorksOnly(): void {
    this.needRefreshFieldWorks.set(true);
    this.loadFieldWorksToCache(); // Recharger le cache immédiatement
  }
  
  // 🚀 OPTIMISÉ : Méthode pour rafraîchir INSTANTANÉMENT uniquement les cultures
  refreshCulturesOnly(): void {
    this.needRefreshCultures.set(true);
    this.loadCulturesToCache(); // Recharger le cache immédiatement
  }

  /**
   * 🔄 Méthode centrale pour invalider et rafraîchir tous les caches après modification
   * Appeler cette méthode après chaque création/modification/suppression
   */
  refreshAllCaches(): void {
    this.refreshCulturesOnly();
    this.refreshTreatmentsOnly();
    this.refreshFieldWorksOnly();
  }

  /**
   * 🚀 OPTIMISÉ : Retourne le cache BehaviorSubject (émission immédiate)
   */
  get(): Observable<any[]> {
    // Charger une seule fois au premier appel
    if (!this.culturesLoaded) {
      this.culturesLoaded = true;
      this.loadCulturesToCache();
    }
    return this.culturesCache$.asObservable();
  }

  /**
   * 🔄 Force le rechargement des cultures
   */
  private loadCulturesToCache(): void {
    this.makeHttpRequest<any[]>(`${environment.apiRegistre}/crops`).pipe(
      map(crops => (crops || []).map(cropFromApi)),
      tap((crops) => {
        this.signalGet.set(crops);
        // Émettre immédiatement vers tous les abonnés
        this.culturesCache$.next(crops);
      })
    ).subscribe();
  }

  updateGet(){
    // Forcer le rechargement
    this.loadCulturesToCache();
  }

  getCulture():Observable<any[]>{
    // Forcer le rechargement depuis le serveur distant en vidant le cache
    this.cachedCrops.set([]);

    return this.makeHttpRequest<any[]>(`${environment.apiRegistre}/phytoweb_categories`).pipe(
      tap(crops => this.cachedCrops.set(crops))
    );
  }

  getCultureId(id:string):Observable<any[]>{
    // Utiliser le cache si disponible pour éviter un appel HTTP
    if (this.cachedCrops().length > 0) {
      const culture = this.cachedCrops().filter((r: any) => r.cropId === id);
      if (culture.length > 0) {
        return of(culture).pipe(tap(s => s[0].nameFr));
      }
    }

    // Fallback sur l'ancienne méthode si le cache n'est pas encore chargé
    return this.getCulture().pipe(
      map(r => r.filter(r => r.cropId === id)),
      tap(s => s[0].nameFr)
    );
  }

  getCultureName(id:string):Observable<any[]>{
    // Utiliser le cache si disponible
    if (this.cachedCrops().length > 0) {
      const culture = this.cachedCrops().filter((r: any) => r.name_fr === id);
      if (culture.length > 0) {
        return of(culture).pipe(
          tap(s => {
            s[0].name_fr;
          })
        );
      }
    }
    
    // Fallback sur l'ancienne méthode
    return this.getCulture().pipe(
      map(r => r.filter(r => r.name_fr === id)),
      tap(s => {
        s[0].name_fr;
      })
    );
  }

  /**
   * 🔄 Vérifie si les données en cache localStorage sont encore valides
   */
  private isCacheValid(cacheKey: string): boolean {
    try {
      const timestamp = localStorage.getItem(cacheKey + this.CACHE_KEYS.TIMESTAMP_SUFFIX);
      if (!timestamp) return false;
      
      const cacheTime = parseInt(timestamp, 10);
      const now = Date.now();
      return (now - cacheTime) < this.CACHE_DURATION;
    } catch (error) {
      return false;
    }
  }

  /**
   * 💾 Sauvegarde les données dans localStorage avec timestamp
   */
  private saveToLocalStorage(cacheKey: string, data: any): void {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (error) {
    }
  }

  /**
   * 📦 Récupère les données depuis localStorage
   */
  private getFromLocalStorage(cacheKey: string): any[] {
    try {
      if (!this.isCacheValid(cacheKey)) {
        return [];
      }
      
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return [];
      
      const data = JSON.parse(cached);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  getParcelles():Observable<any[]>{
    // 1. Vérifier le cache en mémoire (signal)
    if (this.cachedParcels().length > 0) {
      return of(this.cachedParcels());
    }
    
    // 2. Vérifier le cache localStorage
    const localStorageData = this.getFromLocalStorage(this.CACHE_KEYS.PARCELS);
    if (localStorageData.length > 0) {
      this.cachedParcels.set(localStorageData);
      return of(localStorageData);
    }
    
    // 3. Faire l'appel API en dernier recours
    return this.makeHttpRequest<any[]>(`${environment.apiRegistre}/parcels`).pipe(
      map(parcels => (parcels || []).map(parcelFromApi)),
      tap(parcels => {
        this.cachedParcels.set(parcels);
        this.saveToLocalStorage(this.CACHE_KEYS.PARCELS, parcels);
      })
    );
  }

  getExploitation():Observable<any[]>{
    // 1. Vérifier le cache en mémoire (signal)
    if (this.cachedCrops().length > 0) {
      return of(this.cachedCrops());
    }
    
    // 2. Vérifier le cache localStorage
    const localStorageData = this.getFromLocalStorage(this.CACHE_KEYS.CROPS);
    if (localStorageData.length > 0) {
      this.cachedCrops.set(localStorageData);
      return of(localStorageData);
    }
    
    // 3. Faire l'appel API en dernier recours
    return this.makeHttpRequest<any[]>(`${environment.apiRegistre}/crops`).pipe(
      tap(crops => {
        this.cachedCrops.set(crops);
        this.saveToLocalStorage(this.CACHE_KEYS.CROPS, crops);
      })
    );
  }

  /**
   * Force le rechargement du cache (utile pour les mises à jour)
   */
  refreshCache(): void {
    this.clearCache();
    this.preloadEssentialData();
  }

  /**
   * 🗑️ Nettoie complètement le cache en mémoire et localStorage
   */
  clearCache(): void {
    this.cachedParcels.set([]);
    this.cachedCrops.set([]);
    this.cachedProducts.set([]);
    
    // Nettoyer aussi localStorage
    Object.values(this.CACHE_KEYS).forEach(key => {
      if (key !== '_timestamp') {
        localStorage.removeItem(key);
        localStorage.removeItem(key + this.CACHE_KEYS.TIMESTAMP_SUFFIX);
      }
    });
  }

  /**
   * 🧪 DEBUG: Force le rechargement des cultures depuis l'API
   */
  debugForceReloadCrops(): Observable<any[]> {
    this.cachedCrops.set([]);
    localStorage.removeItem(this.CACHE_KEYS.CROPS);
    localStorage.removeItem(this.CACHE_KEYS.CROPS + this.CACHE_KEYS.TIMESTAMP_SUFFIX);
    return this.getExploitation();
  }

  /**
   * Utilisée par traitement-phyto pour construire les associations parcelle+culture
   * (grille de sélection). Doit renvoyer la forme legacy (crop_id/parcels_id...), comme
   * get() : sans cropFromApi ici, culture.parcels_id/crop_id sont toujours undefined
   * (l'API renvoie cropId/parcels en camelCase) et aucune association n'est jamais construite.
   */
  testCropsLoading(): Observable<any[]> {
    const url = `${environment.apiRegistre}/crops`;

    return this.http.get<any[]>(url).pipe(
      map(crops => (crops || []).map(cropFromApi)),
      catchError(error => {
        return throwError(() => error);
      })
    );
  }

  /**
   * � Méthodes optimisées avec CacheService pour éviter les erreurs 429
   */
  getParcellesOptimized(): Observable<any[]> {
    // Méthode simplifiée sans CacheService
    return this.getParcelles();
  }

  getExploitationOptimized(): Observable<any[]> {
    // Méthode simplifiée sans CacheService
    return this.getExploitation();
  }

  /**
   * 🔄 Vide le cache en cas de problème et utilise les méthodes optimisées
   */
  resetAndUseOptimizedMethods(): void {
    this.clearCache();
      }

  preloadEssentialData(): void {
    // Précharger seulement si pas de cache valide pour éviter les erreurs 429
    if (this.cachedParcels().length === 0 && this.getFromLocalStorage(this.CACHE_KEYS.PARCELS).length === 0) {
      this.getParcelles().subscribe({
        next: () => console.log(''),
        error: (err) => console.warn('')
      });
    }
    
    if (this.cachedCrops().length === 0 && this.getFromLocalStorage(this.CACHE_KEYS.CROPS).length === 0) {
      setTimeout(() => {
        this.getExploitation().subscribe({
          next: () => console.log(''),
          error: (err) => console.warn('')
        });
      }, 1000); // Décaler de 1 seconde pour éviter trop de requêtes simultanées
    }
  }

  /**
   * Vérifie si le cache est prêt
   */
  isCacheReady(): boolean {
    return this.cachedProducts().length > 0 && 
           this.cachedCrops().length > 0 && 
           this.cachedParcels().length > 0;
  }

  /**
   * Récupère les associations parcelle-culture pour le système harmonisé
   * Compatible avec le système de traitement phytosanitaire
   * Version optimisée avec cache
   */
  getParcelCultureAssociations(): Observable<any[]> {
    // Si le cache est prêt, utiliser les données mises en cache
    if (this.isCacheReady()) {
      return this.buildAssociationsFromCache();
    }
    
    // Sinon utiliser la méthode avec appels HTTP
    return combineLatest([
      this.getExploitation(), // cultures
      this.getParcelles()     // parcelles
    ]).pipe(
      map(([cultures, parcelles]) => this.buildAssociations(cultures, parcelles))
    );
  }

  /**
   * Construit les associations depuis le cache (plus rapide)
   */
  private buildAssociationsFromCache(): Observable<any[]> {
    return combineLatest([
      this.get(), // cultures de l'exploitation
      of(this.cachedParcels()) // parcelles depuis le cache
    ]).pipe(
      map(([cultures, parcelles]) => this.buildAssociations(cultures, parcelles))
    );
  }

  /**
   * Logique commune pour construire les associations
   * Version optimisée avec limitation et dédoublonnage
   */
  private buildAssociations(cultures: any[], parcelles: any[]): any[] {
    const associations: any[] = [];
    const seenAssociations = new Set<string>(); // Pour éviter les doublons
    
    // Limiter le nombre de cultures traitées pour éviter une liste trop longue
    const limitedCultures = cultures.slice(0, 20); // Maximum 20 cultures
    
    limitedCultures.forEach((culture: any) => {
      const linkedParcelIds = Array.isArray(culture.parcels) ? culture.parcels.map((link: any) => link.parcelId) : [];
      if (linkedParcelIds.length > 0) {
        // Limiter aussi le nombre de parcelles par culture
        const limitedParcels = linkedParcelIds.slice(0, 10); // Maximum 10 parcelles par culture

        limitedParcels.forEach((parcelId: string) => {
          const parcelle = parcelles.find(p => p.id_parcel === parcelId);
          if (parcelle) {
            const uniqueKey = `${culture.cropId}-${parcelle.id_parcel}`;

            // Éviter les doublons
            if (seenAssociations.has(uniqueKey)) {
              return;
            }
            seenAssociations.add(uniqueKey);

            const association = {
              uniqueId: uniqueKey,
              crop_id: culture.cropId,
              crop_name: culture.cropName,
              phytoweb_name: '',
              phytoweb_id: culture.phytowebId || '',
              parcel_id: parcelle.id_parcel,
              parcel_name: parcelle.parcel_name,
              parcel_surface: parseFloat(parcelle.parcel_area) || 0,
              surface_unit: parcelle.parcel_area_unit_fr || 'ha',
              standard_surface: (parseFloat(parcelle.parcel_area) || 0) * this.onReference(parcelle.parcel_area_unit_fr || 'ha'),
              eppo: culture.eppo || ''
            };
            associations.push(association);
          }
        });
      }
    });
    
    return associations.slice(0, 50); // Limite globale de 50 associations maximum
  }

  /**
   * Récupère uniquement les associations récentes/actives pour réduire la liste
   * Utile pour la popup de traitement
   */
  getRecentParcelCultureAssociations(): Observable<any[]> {
    
    return this.getParcelCultureAssociations().pipe(
      map(associations => {
        // Trier par nom de culture et prendre les plus récentes/importantes
        const sortedAssociations = associations
          .sort((a, b) => a.crop_name.localeCompare(b.crop_name))
          .slice(0, 25); // Encore plus restrictif : 25 max
        
        return sortedAssociations;
      })
    );
  }

  /**
   * ⚠️ DÉPRÉCIÉ : Ne pas utiliser pour la recherche interactive
   * Utilisez searchProducts() à la place
   * Garde pour compatibilité avec code existant (getIdVolumeDeBouillipreparer)
   */
  getVolumeDeBouillipreparer():Observable<any[]>{
    // ⚠️ ATTENTION : catalogue complet des produits homologués actuels ! Ne pas utiliser pour recherche interactive
    // Utiliser uniquement pour chargements ponctuels (ex: récupérer UN produit par ID)

    // Utiliser le cache si disponible
    if (this.cachedProducts().length > 0) {
      return of(this.cachedProducts());
    }

    return this.makeHttpRequest<any[]>(`${environment.apiRegistre}/index/phytoweb_products`).pipe(
      map(products => (products || []).map(productFromApi)),
      tap(products => this.cachedProducts.set(products))
    );
  }

  getIdVolumeDeBouillipreparer(id:string):Observable<any[]>{
    // Utiliser le cache si disponible pour éviter un appel HTTP
    if (this.cachedProducts().length > 0) {
      const product = this.cachedProducts().filter((c: any) => c.product_id === id);
      return of(product);
    }

    // Fallback sur l'ancienne méthode si le cache n'est pas encore chargé
    return this.getVolumeDeBouillipreparer().pipe(
      map(r => r.filter(c => c.product_id === id)),
    );
  }

  cleanupAfterTreatmentModification(): void {
    this.siganlService.set([]);
    this.signalGetDose.set([]);
    this.signalTreatment.set([]);
  }

  post(formulaire:{nomCulture:string, remarque:string, semis:string, culturePrecedant:string, autre:string, parcels:string | string[]}): Observable<boolean> {

    return this.getCultureId(formulaire.autre).pipe(
      tap(r => {
        // S'assurer que parcels_id est toujours un tableau
        const parcelsArray = Array.isArray(formulaire.parcels) ? 
                            formulaire.parcels : 
                            typeof formulaire.parcels === 'string' ? 
                            formulaire.parcels.split(',').filter(Boolean) : 
                            [formulaire.parcels].filter(Boolean);

        const sendFormulaire = {
          cropName: formulaire.nomCulture,
          phytowebId: r[0].initialCropId || formulaire.autre,
          parcelIds: parcelsArray,
          remarks: formulaire.remarque,
          sowingDate: formulaire.semis,
          previousCrop: formulaire.culturePrecedant,
          efficiency: "autre"
        }

        this.http.post(`${environment.apiRegistre}/crops`, sendFormulaire).subscribe({
          next: () => {
            // 🚀 Forcer le rechargement du cache BehaviorSubject
            this.signalGet.set([]);
            // Déclencher le rafraîchissement optimisé
            this.needRefreshCultures.set(true);
            
            // ⏳ Attendre 200ms que le backend finalise l'écriture avant de recharger
            setTimeout(() => {
              this.loadCulturesToCache();
            }, 200);
          }
        });
      }),
      // ⏳ Ajouter un délai avant de retourner true pour s'assurer que le cache est rechargé
      tap(() => {
        // Petit délai pour laisser le temps au cache de se recharger
        return new Promise(resolve => setTimeout(resolve, 300));
      }),
      map(() => true), // Retourner true si succès
      catchError(() => of(false)) // Retourner false si erreur
    );
  }

  /**
   * Calcule le facteur de référence pour normaliser les doses
   * Mode Surface: normalise vers L/ha ou kg/ha
   * Mode Bouillie: normalise vers L/100L ou kg/100L
   */
  onReference(littre: string): number {
    // === UNITÉS DE SURFACE (pour parcelles) ===
    if ("m2" === littre) {
      return 0.0001; // 1 m² = 0.0001 ha
    } else if ("ha" === littre) {
      return 1;
    } else if ("a" === littre) {
      return 0.01; // 1 are = 0.01 ha
    }
    
    // === MODE SURFACE - Par hectare ===
    else if ("L/ha" === littre || "kg/ha" === littre) {
      return 1;
    } else if ("g/ha" === littre || "ml/ha" === littre) {
      return 0.001; // g→kg, ml→L
    }
    // Par are (1 ha = 100 a)
    else if ("L/a" === littre || "kg/a" === littre) {
      return 100; // 1 L/a = 100 L/ha
    } else if ("g/a" === littre || "ml/a" === littre) {
      return 0.1; // 100 × 0.001 = 0.1
    }
    // Par m² (1 ha = 10000 m²)
    else if ("L/m2" === littre || "kg/m2" === littre) {
      return 10000; // 1 L/m² = 10000 L/ha
    } else if ("g/m2" === littre || "ml/m2" === littre) {
      return 10; // 10000 × 0.001 = 10
    }
    
    // === MODE BOUILLIE - Par 100L ===
    else if ("L/100L" === littre || "kg/100L" === littre) {
      return 1;
    } else if ("ml/100L" === littre || "g/100L" === littre) {
      return 0.001; // ml→L, g→kg
    }
    // Par 10L de bouillie (100L = 10 × 10L)
    else if ("L/10L" === littre || "kg/10L" === littre) {
      return 10; // 1 L/10L = 10 L/100L
    } else if ("ml/10L" === littre || "g/10L" === littre) {
      return 0.01; // 10 × 0.001 = 0.01
    }
    // Par litre de bouillie (100L = 100 × 1L)
    else if ("ml/L" === littre || "g/L" === littre) {
      return 0.1; // 100 × 0.001 = 0.1
    }
    
    // === QUANTITÉS TOTALES ===
    else if ("L" === littre || "Kg" === littre) {
      return 1; // Géré différemment dans le calcul
    }
    
    else {
      return 0;
    }
  }

  /** Sans objet depuis la suppression des fichiers tampons ; conservé pour compatibilité d'appel (résultat non consommé). */
  getDose():Observable<any[]>{
    return of([]);
  }

  postTravailAuxChamps(formulaire: {
    type?: string,
    type_travaux_aux_champs?: string,
    date?: string,
    datee?: string,
    informations?: string,
    tool?: string,
    outil?: string,
    remark?: string,
    remaques?: string,
    dose?: string,
    dose_unit?: string,
    lha?: string,
    harvest_date?: string,
    dateDeRecolte?: string,
    observation?: string,
    field_work_type?: string,
    travailtype?: string,
    description?: string,
    parcels_concerned: any[]
  }) {

    // Construction de l'objet à envoyer avec les nouvelles clés
    const travauxAuxChamps = {
      type: formulaire.type || formulaire.type_travaux_aux_champs || '',
      date: formulaire.date || formulaire.datee || '',
      informations: formulaire.informations || '',
      tool: formulaire.tool || formulaire.outil || '',
      remark: formulaire.remark || formulaire.remaques || '',
      dose: formulaire.dose || '',
      dose_unit: formulaire.dose_unit || formulaire.lha || '',
      harvest_date: formulaire.harvest_date || formulaire.dateDeRecolte || '',
      observation: formulaire.observation || '',
      field_work_type: formulaire.field_work_type || formulaire.travailtype || '',
      description: formulaire.description || '',
      parcels_concerned: formulaire.parcels_concerned,
      created_at: new Date().toISOString()
    };

    // NB : le nouveau schéma fieldWorks n'a pas de colonne opérateur — les champs
    // operator_id/operator_name/operator_phytolicence saisis ne sont plus persistés.

    // event_id n'est jamais envoyé au serveur (fieldWorkToApi ne le transmet pas) : c'est
    // lui qui assigne l'id définitif. On le récupère ici pour que l'appelant (ex.
    // fieldWorkCreated.emit) porte le vrai id plutôt qu'un id local jamais persisté.
    return this.http.post<any>(`${environment.apiRegistre}/field_works`, fieldWorkToApi(travauxAuxChamps)).pipe(
      map(response => ({ ...travauxAuxChamps, event_id: response.eventId })),
      tap(() => {
        this.refreshFieldWorksOnly();
        this.refreshDashboard.set(true);
      })
    );
  }

  /**
   * Fusionne les métadonnées du traitement (étape 3 du formulaire) avec les parcelles/
   * produits déjà sélectionnés (étapes 1-2, portés par le composant) pour préparer
   * l'étape de répartition (étape 4). Purement local depuis la suppression des fichiers
   * tampons — la création/modification réelle n'a lieu qu'à la soumission finale.
   */
  transferFromStep3ToStep4(isModification: boolean = false, originalEventId?: string, requestData?: any): Observable<any> {
    const metadata = requestData?.cached_metadata || {};
    const finalTreatment = {
      ...metadata,
      event_id: (isModification && originalEventId)
        ? originalEventId
        : (metadata.event_id || `phyto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`),
      parcels_concerned: requestData?.parcels_concerned || [],
      treatment_composition: requestData?.treatment_composition || [],
    };
    this.refreshDashboard.set(true);
    return of({ success: true, final_treatment: finalTreatment });
  }

  // enregistrements Traitement bouille final
    loadWorkForModification(workId: string): Observable<any> {
      return this.http.get<any>(`${environment.apiRegistre}/field_works/${workId}`).pipe(
        map(fieldWorkFromApi)
      );
    }

    /**
     * Finalise une modification de travail au champ
     * Écrase l'ancien travail avec les nouvelles données
     */
    finalizeModifiedWork(form: any, originalWorkId: string): Observable<any> {
      return this.http.put(`${environment.apiRegistre}/field_works/${originalWorkId}`, fieldWorkToApi(form)).pipe(
        tap(() => {
          this.refreshFieldWorksOnly();
          this.refreshDashboard.set(true);
        })
      );
    }

    /**
     * Récupère tous les travaux au champ pour affichage/modification
     */
    /**
     * 🚀 OPTIMISÉ : Retourne immédiatement les données du cache
     * (Alias de getAllTravauxChamps pour compatibilité)
     */
    getAllFieldWorks(): Observable<any[]> {
      return this.getAllTravauxChamps();
    }

    /**
     * Étape de préparation avant chargement d'un travail pour modification.
     * Sans objet depuis la suppression du système de fichiers tampons — conservé
     * en no-op pour ne pas casser la chaîne concatMap côté composant.
     */
    resetFieldWorkParcels(workId: string): Observable<any> {
      return of({});
    }

    updatePhytoTreatmentFinal(eventId: string, treatmentData: any): Observable<any> {
      return this.http.put(`${environment.apiRegistre}/phyto_treatments/${eventId}`, treatmentToApi(treatmentData)).pipe(
        tap((response: any) => {
          this.refreshDashboard.set(true);
          this.refreshTreatmentsOnly();
        }),
        catchError((error: any) => {
          throw error;
        })
      );
    }

    /**
     * Supprime un traitement phyto spécifique
     */
    deleteTreatmentFinal(eventId: string): Observable<any> {
      return this.http.delete(`${environment.apiRegistre}/phyto_treatments/${eventId}`).pipe(
        tap((response: any) => {
          // 🚀 Forcer le rechargement du cache BehaviorSubject
          // Déclencher le rafraîchissement des traitements
          this.needRefreshTreatments.set(true);
          // Recharger immédiatement le cache
          this.loadTreatmentsToCache();
        }),
        catchError((error: any) => {
          throw error;
        })
      );
    }

    deleteFieldWork(eventId: string): Observable<any> {
      return this.http.delete(`${environment.apiRegistre}/field_works/${eventId}`).pipe(
        tap(() => this.refreshFieldWorksOnly())
      );
    }

    /**
     * Le nouveau serveur synchronise automatiquement l'inventaire à chaque POST/PUT
     * sur /phyto_treatments — cette synchronisation manuelle n'est plus nécessaire.
     * Conservée en no-op pour ne pas casser les appelants existants.
     */
    saveToPhytoTreatmentsComponents(treatment: any): Observable<any> {
      this.refreshDashboard.set(true);
      return of({ success: true });
    }

    // Méthode pour abandonner l'encodage en cours
    deleteCulture(cropId: string): Observable<any> {
      return this.http.delete(`${environment.apiRegistre}/crops/${cropId}`).pipe(
        tap({
          next: () => {
            // Rafraîchir le cache des cultures
            this.updateGet();
            // Déclencher le rafraîchissement du dashboard
            this.refreshDashboard.set(true);
          }
        })
      );
    }

    /**
     * Met à jour une culture existante
     */
    updateCulture(culture: any): Observable<any> {
      const cultureId = culture.cropId;
      const { cropId, ...updateData } = culture;

      return this.http.put(`${environment.apiRegistre}/crops/${cultureId}`, updateData).pipe(
        tap({
          next: () => {
            // 🚀 Forcer le rechargement du cache BehaviorSubject
            this.signalGet.set([]);
            // Déclencher le rafraîchissement optimisé
            this.needRefreshCultures.set(true);
            
            // ⏳ Attendre 200ms que le backend finalise l'écriture avant de recharger
            setTimeout(() => {
              this.loadCulturesToCache();
            }, 200);
          }
        })
      );
    }

    /**
     * Récupère l'ID utilisateur depuis le localStorage avec validation
     */
    private getUserId(): string {
      
      // Essayer d'abord la clé Ref (ID réel de l'utilisateur)
      const userId = localStorage.getItem('Ref');
      
      // Vérifier si la valeur est valide (pas null, pas 'null', pas 'undefined', pas vide)
      if (userId && userId !== 'null' && userId !== 'undefined' && userId !== 'undefined' && userId.trim() !== '') {
        return userId;
      }
      
      // Si Ref n'est pas valide, essayer d'autres clés possibles
      const alternativeKeys = ['Id_User', 'user_id', 'userId', 'id'];
      for (const key of alternativeKeys) {
        const altValue = localStorage.getItem(key);
        if (altValue && altValue !== 'null' && altValue !== 'undefined' && altValue.trim() !== '') {
          return altValue;
        }
      }
      
      // Essayer de récupérer l'ID depuis le token si possible
      const token = localStorage.getItem('Token');
      if (token) {
        // Pour l'instant, on lance une erreur pour forcer la reconnexion
        throw new Error('ID utilisateur réel non trouvé. Veuillez vous reconnecter pour actualiser vos informations.');
      }
      
      throw new Error('Utilisateur non connecté - ID utilisateur introuvable');
    }

    /**
     * Valide le token et récupère l'ID utilisateur
     */
    private validateTokenAndGetUserId(): string {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('Aucun token d\'authentification trouvé');
      }
      
      return this.getUserId();
    }

    /**
     * Supprime une intervention (traitement phytosanitaire) complète
     */
    deleteIntervention(treatment: any, type?: string): Observable<any> {
      
      const treatmentId = treatment.event_id || treatment.id;
      if (!treatmentId) {
        throw new Error('ID intervention non trouvé');
      }

      return this.http.delete(`${environment.apiRegistre}/phyto_treatments/${treatmentId}`).pipe(
        tap({
          next: () => {
            // Rafraîchir les données du dashboard
            this.refreshTreatmentsOnly();
            this.refreshDashboard.set(true);
          }
        })
      );
    }

    /**
     * Retire une parcelle spécifique d'une intervention (traitement ou travail au champ)
     */
    removeParcelFromIntervention(intervention: any, parcelToRemove: any): Observable<any> {
      
      // Déterminer le type d'intervention et l'ID approprié
      let interventionId: string;
      let isFieldWork = false;
      
      if (intervention.event_id) {
        // Traitement phytosanitaire ou travail au champ après migration
        interventionId = intervention.event_id;
        // Déterminer si c'est un travail au champ par l'absence de treatment_composition
        isFieldWork = !intervention.treatment_composition && !intervention.type?.startsWith('phyto');
      } else if (intervention.travaux_aux_champs_id) {
        // Travail au champ (ancien format)
        interventionId = intervention.travaux_aux_champs_id;
        isFieldWork = true;
      } else {
        throw new Error('ID intervention non trouvé - ni event_id ni travaux_aux_champs_id présent');
      }


      if (isFieldWork) {
        // Utiliser la méthode spécialisée pour les travaux au champ
        const parcelId = parcelToRemove.parcel_id ?? parcelToRemove.parcels_id;
        return this.removeParcelFromFieldWork(interventionId, parcelId);
      } else {
        // Utiliser la méthode spécialisée pour les traitements phyto
        return this.removeParcelFromPhytoTreatment(interventionId, parcelToRemove.parcel_id ?? parcelToRemove.parcels_id);
      }
    }

    // Méthode pour supprimer une parcelle spécifique d'un travail au champ
    removeParcelFromFieldWork(workId: string, parcelId: any): Observable<any> {
        return this.http.delete(`${environment.apiRegistre}/field_works/${workId}/parcel/${parcelId}`).pipe(
            tap(() => {
                this.refreshDashboard.set(true);
            })
        );
    }

    // Méthode pour supprimer une parcelle spécifique d'un traitement phyto
    removeParcelFromPhytoTreatment(eventId: string, parcelId: number): Observable<any> {
        return this.http.delete(`${environment.apiRegistre}/phyto_treatments/${eventId}/parcel/${parcelId}`).pipe(
            tap(() => {
                this.refreshDashboard.set(true);
                this.refreshTreatmentsOnly();
            })
        );
    }

    /**
     * Supprime un produit spécifique du fichier phyto_treatments.json
     */
    /** Les surfaces/quantités standardisées sont désormais calculées automatiquement à l'écriture — no-op. */
    ensureAllSurfacesCalculated(): Observable<any> {
        return of({ success: true });
    }

    // ============================================
    // MÉTHODES D'ARCHIVAGE DES CULTURES
    // ============================================

    /**
     * Récupère la liste des collections disponibles pour l'utilisateur
     */
    getCollections(): Observable<string[]> {
        return combineLatest([
            this.http.get<any[]>(`${environment.apiRegistre}/crops`),
            this.http.get<any[]>(`${environment.apiRegistre}/crops/archive`)
        ]).pipe(
            map(([active, archived]) => {
                const all = [...(active || []), ...(archived || [])];
                const collections = new Set(all.map(c => c.collection).filter(Boolean));
                return Array.from(collections).sort();
            }),
            catchError((error) => {
                console.error('Erreur lors de la récupération des collections:', error);
                return of([]);
            })
        );
    }

    /**
     * Archive une culture dans une collection spécifique
     */
    archiveCrop(cropId: string, collection: string): Observable<any> {
        return this.http.put(`${environment.apiRegistre}/crops/${cropId}`, { collection }).pipe(
            switchMap(() => this.http.post<any>(`${environment.apiRegistre}/crops/${cropId}/archive`, {})),
            tap(() => {
                // Déclencher le rafraîchissement des cultures et des archives
                this.needRefreshCultures.set(true);
                this.needRefreshArchives.set(true);
                // Recharger le cache des cultures
                this.loadCulturesToCache();
            }),
            catchError((error) => {
                console.error('Erreur lors de l\'archivage de la culture:', error);
                return throwError(() => error);
            })
        );
    }

    /**
     * Récupère la liste des cultures archivées
     */
    getArchivedCrops(): Observable<any[]> {
        return this.http.get<any[]>(`${environment.apiRegistre}/crops/archive`).pipe(
            map(crops => (crops || []).map(cropFromApi)),
            catchError((error) => {
                console.error('Erreur lors de la récupération des cultures archivées:', error);
                return of([]);
            })
        );
    }

    /**
     * Restaure une culture archivée
     */
    restoreCrop(cropId: string): Observable<any> {
        return this.http.post<any>(`${environment.apiRegistre}/crops/${cropId}/unarchive`, {}).pipe(
            tap(() => {
                // Déclencher le rafraîchissement des cultures et des archives
                this.needRefreshCultures.set(true);
                this.needRefreshArchives.set(true);
                // Recharger le cache des cultures
                this.loadCulturesToCache();
            }),
            catchError((error) => {
                console.error('Erreur lors de la restauration de la culture:', error);
                return throwError(() => error);
            })
        );
    }

    /**
     * Supprime définitivement une culture archivée
     */
    deleteArchivedCrop(cropId: string): Observable<any> {
        return this.http.delete<any>(`${environment.apiRegistre}/crops/${cropId}`).pipe(
            tap(() => {
                // Déclencher le rafraîchissement des archives
                this.needRefreshArchives.set(true);
            }),
            catchError((error) => {
                console.error('Erreur lors de la suppression de la culture archivée:', error);
                return throwError(() => error);
            })
        );
    }
}
