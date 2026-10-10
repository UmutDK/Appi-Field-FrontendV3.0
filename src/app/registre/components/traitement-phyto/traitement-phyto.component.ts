import { Component, computed, inject, OnInit, OnDestroy, Output, EventEmitter, Input, effect, ChangeDetectorRef, Injector, runInInjectionContext, signal, ViewChild, ElementRef } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { combineLatest, map, Observable, startWith, of, catchError, BehaviorSubject, debounceTime, distinctUntilChanged, throwError, take, Subject, takeUntil } from 'rxjs';
import { RegistreService, treatmentToApi, treatmentFromApi } from '../../services/registre.service';
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { shareReplay } from 'rxjs/operators';
import { VirtualForDirective } from './virtual-for.directive';
import { CalculationConsolidationService } from '../../services/calculation-consolidation.service';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { NgSelectModule } from '@ng-select/ng-select';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-traitement-phyto',
  standalone: true,
  imports: [
    SharedModule,
    VirtualForDirective,
    NgSelectModule,
    MatTooltipModule
  ],
  templateUrl: './traitement-phyto.component.html',
  styleUrls: ['./traitement-phyto.component.scss'],
  animations: [
    trigger('expandCollapse', [
      transition(':enter', [
        style({ height: '0', opacity: 0, overflow: 'hidden' }),
        animate('300ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ height: '*', opacity: 1 }))
      ]),
      transition(':leave', [
        style({ height: '*', opacity: 1, overflow: 'hidden' }),
        animate('300ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ height: '0', opacity: 0 }))
      ])
    ]),
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-10px)' }),
        animate('200ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0, transform: 'translateY(-10px)' }))
      ])
    ]),
    trigger('slideStep', [
      // Simplement détecter les changements pour trigger le callback
      transition('* => *', [
        animate('1ms')
      ])
    ])
  ]
})
export class TraitementPhytoComponent implements OnInit, OnDestroy {

  // Référence au tableau pour scroll auto après ajout produit
  @ViewChild('tableauTraitement', { static: false }) tableauTraitementRef?: ElementRef<HTMLTableElement>;

  // Référence à la zone scrollable, pour la remettre en haut à chaque changement d'étape
  @ViewChild('scrollableContent', { static: false }) scrollableContentRef?: ElementRef<HTMLDivElement>;

  // Fermer les dropdowns quand on clique ailleurs
  // (gardé vide pour éviter les erreurs - le HostListener reste pour d'autres usages futurs)

  // Output pour fermer la popup
  @Output() closePopup = new EventEmitter<void>();
  @Output() closePopupWithRefresh = new EventEmitter<void>();
  //  Output pour la création réussie avec données du traitement
  @Output() treatmentCreated = new EventEmitter<any>();
  // Output pour le pourcentage de progression
  @Output() progressChanged = new EventEmitter<number>();
  // Output pour l'état de validation
  @Output() validationChanged = new EventEmitter<boolean>();
  // Input pour recevoir les données d'intervention à modifier
  @Input() interventionToModify: any = null;
  
  // Mode modification
  isEditMode: boolean = false;
  //  Signal pour éviter ExpressionChangedAfterItHasBeenCheckedError
  isEditModeSignal = signal(false);
  editingTreatment: any = null;
  dataLoaded: boolean = false; // Flag pour éviter le rechargement multiple des données en mode édition
  // 🔒 Verrou : une fois la sélection établie par loadParcelsDirectly(), aucun refresh
  // asynchrone (loadParcelCultureGroupsOptimized, refreshParcelCultureData...) ne peut
  // plus écraser selectedParcelCultureIds / selectedParcelCultureAssociations.
  private editModeSelectionLocked: boolean = false;
  
  //  NOUVEAU SYSTÈME : Draft local pour création/modification
  currentTreatmentDraft: any = null;

  // 🔄 Flag pour forcer la mise à jour du template
  public forceTemplateRefresh: boolean = false;

  private _traitement!: string;
  // Setter plutôt qu'une propriété simple : garantit le reset du scroll à CHAQUE changement
  // d'étape, quel que soit l'endroit du fichier qui affecte this.traitement (une trentaine
  // d'appels), sans devoir modifier chacun d'eux individuellement.
  get traitement(): string {
    return this._traitement;
  }
  set traitement(value: string) {
    this._traitement = value;
    if (this.scrollableContentRef) {
      this.scrollableContentRef.nativeElement.scrollTop = 0;
    }
  }
  typeDeTraitement: boolean = false;
  form!: FormGroup;
  formAddDose!: FormGroup;
  formTraitement!: FormGroup;
  
  //  Variables pour l'animation de slide entre étapes
  public slideDirection: 'forward' | 'backward' | 'none' = 'none';

  // Contrôles de recherche
  searchControl = new FormControl('');
  searchControlBouillie = new FormControl('');

  treatment_total_quantity!: FormControl;
  treatment_total_quantity_used!: FormControl

  // 🚀 Observables optimisés avec mise en cache pour les performances
  getExploitation!: Observable<any[]>;
  VolumeDeBouillipreparer!: Observable<any[]>;
  VolumeDeBouilliepreparerFiltered!: Observable<any[]>;
  AddDose!: Observable<any[]>;
  
  //  Cache SIMPLE pour les groupes de parcelles/cultures
  private parcelCultureGroupsCache$ = new BehaviorSubject<any[]>([]);
  parcelCultureGroups$: Observable<any[]> = this.parcelCultureGroupsCache$.asObservable();

  // Mode de regroupement
  groupByMode: 'phytoweb' | 'culture' | 'parcelle' = 'phytoweb';
  private rawAssociations: any[] = [];
  private displayGroupsSubject = new BehaviorSubject<any[]>([]);
  
  // État de chargement des parcelles/cultures
  public isLoadingParcelCultures = false;
  
  // Flag pour savoir si on a tenté de charger au moins une fois
  private hasTriedToLoadParcelCultures = false;
  
  // �📊 Constantes pour l'optimisation
  private readonly SEARCH_DEBOUNCE_TIME = 200; // Debounce réduit pour une meilleure réactivité
  private readonly MIN_SEARCH_CHARS = 2; // Minimum 2 caractères pour déclencher la recherche
  
  //  Variables de recherche
  public showSearchHint = true; // Affiche le message d'aide
  public hasSearchResults = false; // Indique si des résultats sont affichés
  public isLoadingProducts = false; // État de chargement des produits

  // Array pour stocker les associations sélectionnées  
  selectedParcelCultureAssociations: any[] = [];
  // Set pour les lookups O(1) dans isParcelCultureSelected (perf)
  selectedParcelCultureIds: Set<string> = new Set();

  // Set pour tracker les groupes de cultures ouverts/fermés sur mobile
  expandedGroupsOnMobile: Set<string> = new Set();

  // Liste des opérateurs (chargée à l'init)
  operators: any[] = [];
  // Opérateur sélectionné
  selectedOperator: any = null;

  // Système d'édition inline pour les cartes produits
  currentEditingProductId: string | null = null; // Produit en édition pour section surface
  currentEditingProductIdBouillie: string | null = null; // Produit en édition pour section bouillie
  productForms: Map<string, FormGroup> = new Map(); // Formulaires individuels par produit
  
  // 🎨 Listes d'options pour ng-select (format plat avec groupBy)
  // � Custom dropdown pour les unités
  openDropdownId: string | null = null; // ID du dropdown ouvert (format: 'surface-{productId}' ou 'bouillie-{productId}')
  
  // Options des unités pour le mode surface
  surfaceUnitOptions = [
    { group: 'Par hectare', options: [
      { value: 'L/ha', label: 'L/ha' },
      { value: 'kg/ha', label: 'kg/ha' },
      { value: 'ml/ha', label: 'ml/ha' },
      { value: 'g/ha', label: 'g/ha' }
    ]},
    { group: 'Par are', options: [
      { value: 'L/a', label: 'L/a' },
      { value: 'kg/a', label: 'kg/a' },
      { value: 'ml/a', label: 'ml/a' },
      { value: 'g/a', label: 'g/a' }
    ]},
    { group: 'Par m²', options: [
      { value: 'L/m2', label: 'L/m²' },
      { value: 'kg/m2', label: 'kg/m²' },
      { value: 'ml/m2', label: 'ml/m²' },
      { value: 'g/m2', label: 'g/m²' }
    ]},
    { group: 'quantité totale', options: [
      { value: 'L', label: 'L (quantité totale)' },
      { value: 'Kg', label: 'Kg (quantité totale)' }
    ]}
  ];
  
  // Options des unités pour le mode bouillie
  bouillieUnitOptions = [
    { group: 'Par 100L de bouillie', options: [
      { value: 'L/100L', label: 'L/100L' },
      { value: 'kg/100L', label: 'kg/100L' },
      { value: 'ml/100L', label: 'ml/100L' },
      { value: 'g/100L', label: 'g/100L' }
    ]},
    { group: 'Par 10L de bouillie', options: [
      { value: 'L/10L', label: 'L/10L' },
      { value: 'kg/10L', label: 'kg/10L' },
      { value: 'ml/10L', label: 'ml/10L' },
      { value: 'g/10L', label: 'g/10L' }
    ]},
    { group: 'Par litre de bouillie', options: [
      { value: 'L/L', label: 'L/L' },
      { value: 'kg/L', label: 'kg/L' },
      { value: 'ml/L', label: 'ml/L' },
      { value: 'g/L', label: 'g/L' }
    ]},
    { group: 'quantité totale', options: [
      { value: 'L', label: 'L (quantité totale)' },
      { value: 'Kg', label: 'Kg (quantité totale)' }
    ]}
  ];
  
  // Système d'accordéon pour les warning-box et info-box
  isBbchWarningExpanded = signal(false);
  isApplicationHourExpanded = signal(false);
  
  //  Système de tooltip pour l'icône info de l'heure de traitement
  showHourInfoTooltip = false;
  
  //  Protection contre les appels multiples
  private fetchingTreatmentIds = new Set<string>(); // IDs en cours de traitement

  // Cache des parcelles pour éviter les appels répétitifs
  private cachedParcelles$: Observable<any[]> | null = null;

  // ── Produits personnalisés ──────────────────────────────────────────────
  /** Mode actif dans le sélecteur de produits : 'phyto' | 'personal' */
  productMode: 'phyto' | 'personal' = 'phyto';
  /** Liste des produits personnels de l'utilisateur */
  personalProducts: any[] = [];
  /** Produits personnels filtrés selon la recherche */
  filteredPersonalProducts: any[] = [];
  /** Afficher le formulaire de création d'un nouveau produit personnel */
  showNewPersonalProductForm = false;
  /** Formulaire de création de produit personnel */
  personalProductForm!: FormGroup;
  /** Sauvegarde en cours */
  isSavingPersonalProduct = false;
  /** Recherche pour les produits personnels */
  personalProductSearchControl = new FormControl('');
  /** Options pour le type de produit (autocomplétion) */
  personalProductTypeOptions = ['Engrais', 'Amendement', 'Biostimulant', 'Autre'];
  filteredTypeOptions: string[] = [];
  // ── fin produits personnalisés ──────────────────────────────────────────

  // ── Produits récemment utilisés ──────────────────────────────────────────
  /** Produits déjà utilisés dans des traitements antérieurs (dédoublonnés) */
  recentlyUsedProducts: any[] = [];
  isLoadingRecentProducts = false;
  // Mode saisie libre pour le champ cible (par produit)
  targetFreeTextMap: Map<string, boolean> = new Map();
  // ── fin produits récemment utilisés ──────────────────────────────────────

  http = inject(RegistreService);
  calculationService = inject(CalculationConsolidationService);
  httpClient = inject(HttpClient);
  formBuilder = inject(FormBuilder);
  router = inject(Router);
  cdr = inject(ChangeDetectorRef);
  injector = inject(Injector);

  private destroy$ = new Subject<void>();
  getSignalDose = this.http.signalGetDose;
  getSignalTotalTrainement = this.http.signalGetTableauGeneralTraitement;

  // Propri�t�s de navigation d'�tapes
  private previousStep: string = '';
  private isAnimating: boolean = false;

  // Cache template pour �viter les recalculs
  private templateRefreshKey: string = '';
  private treatmentDataCache: any[] = [];

  ngOnInit(): void {
    // Bloquer le scroll du background
    document.body.classList.add('no-scroll');
    
    // S'assurer que le cache des produits est chargé au démarrage
    this.http.ensureCacheLoaded();
    
    // Initialiser les formulaires
    this.initializeForms();
    
    //  Écouter le signal refreshDashboard pour recharger les données quand nécessaire
    runInInjectionContext(this.injector, () => {
      effect(() => {
        if (this.http.refreshDashboard()) {
          setTimeout(() => {
            this.loadFinalTreatmentData();
            this.http.refreshDashboard.set(false); // Reset du signal
          }, 100);
        }
      });
    });
    
    // Watcher sur le signal des produits pour mettre à jour la validation
    // Utilisation de runInInjectionContext pour le bon contexte d'injection
    runInInjectionContext(this.injector, () => {
      effect(() => {
        const products = this.getSignalDose();
        // Utiliser setTimeout pour éviter ExpressionChangedAfterItHasBeenCheckedError
        setTimeout(() => {
          this.emitValidation();
        }, 0);
      });
      
      //  Écouter les changements de parcelles pour rafraîchir les données
      effect(() => {
        if (this.http.parcelUpdated()) {
          this.refreshParcelCultureData();
        }
      });

      // � SUPPRIMÉ : pas d'effet automatique, déclenchement manuel plus fiable
    });
    
    // Vérifier si on est en mode modification
    if (this.interventionToModify) {
      this.initEditMode();
    } else {
      this.initCreateMode();
    }

    // Charger les données nécessaires
    this.loadInitialData();
    
    // Charger les cibles pour l'autocomplétion
    this.loadCiblesData();
    
    // Charger les opérateurs
    this.loadOperators();

    // Charger les produits personnels de l'utilisateur
    this.loadPersonalProducts();

    // Charger les produits récemment utilisés depuis les traitements enregistrés
    this.loadRecentlyUsedProducts();

    // Initialiser le formulaire de création de produit personnel
    this.initPersonalProductForm();
    // récupérer la version consolidée côté serveur pour pré-remplir la répartition
    if (this.interventionToModify && this.editingTreatment && (this.editingTreatment.strategy === 'bouillie' || this.getTreatmentType() === 'phyto_porridge_treatment')) {
      const eventId = this.editingTreatment.event_id || this.interventionToModify.event_id;
      if (eventId) {
        // Force fetch persisted final treatment to populate editingTreatment with server-calculated values
        setTimeout(() => {
          this.fetchFinalTreatmentByEventId(eventId);
        }, 100);
      }
    }
    
    // 🔧 NOUVEAU: Initialiser les observateurs des quantités de bouillie
    this.initializeQuantityObservers();
    
    // 📊 NOUVEAU: Initialiser les données d'avertissements (BBCH et heures)
    this.initializeWarningsData();
    
    // Émettre la progression initiale
    this.emitProgress();

    // Pré-charger les parcelles/cultures en arrière-plan dès l'ouverture du formulaire
    // afin que l'étape "sélection parcelles" s'affiche instantanément
    if (!this.interventionToModify) {
      this.loadParcelCultureGroupsOptimized();
    }
  }

  ngAfterViewInit() {
    // Initialisation des dropdowns Materialize si nécessaire
  }

  ngOnDestroy(): void {
    // Réactiver le scroll du background
    document.body.classList.remove('no-scroll');
    // Nettoyage du cache pour éviter les fuites mémoire
    this.cachedParcelles$ = null;
    // Compléter le Subject de destruction pour déclencher takeUntil
    this.destroy$.next();
    this.destroy$.complete();
    // Compléter les BehaviorSubjects internes
    this.parcelCultureGroupsCache$.complete();
    this.displayGroupsSubject.complete();
  }

  // === MÉTHODES D'OPTIMISATION DES REQUÊTES ===

  /**
   * 🚀 Méthode optimisée pour récupérer les parcelles avec cache
   */
  private getParcellesCached(): Observable<any[]> {
    if (!this.cachedParcelles$) {
      this.cachedParcelles$ = this.http.getParcelles().pipe(
        shareReplay(1),
        catchError(error => {
          this.cachedParcelles$ = null; // Reset pour retry
          return throwError(() => error);
        })
      );
    } else {
    }
    return this.cachedParcelles$;
  }

  // === MÉTHODES DE PROGRESSION ET VALIDATION ===

  canProceedToNext(): boolean {
    switch (this.traitement) {
      case 'selection parcelles':
        return this.hasSelectedCultures();
      case 'type de traitement':
        return this.formTraitement.valid;
      case 'composition de mon traitement':
        return this.hasValidComposition();
      case 'volument de bouillie utilisee':
        return this.hasValidComposition() && this.form.valid;
      case 'repartition de mon traitement':
      case 'repartition de mon traitement littre':
        return this.hasValidRepartition();
      default:
        return false;
    }
  }

  public hasSelectedCultures(): boolean {
    // Vérifier qu'au moins une association parcelle+culture est sélectionnée
    return this.selectedParcelCultureAssociations && this.selectedParcelCultureAssociations.length > 0;
  }

  //  Getter SIMPLE pour les données
  public get parcelCultureGroupsData(): any[] {
    return this.displayGroupsSubject.value;
  }
  
  public get shouldShowEmptyState(): boolean {
    // Afficher l'état vide seulement si :
    // 1. On n'est pas en cours de chargement
    // 2. On a déjà tenté de charger au moins une fois ET le chargement est terminé
    // 3. Le cache est vide
    // 4. On est sur l'étape de sélection des parcelles
    return !this.isLoadingParcelCultures && 
           this.parcelCultureGroupsData.length === 0 &&
           this.traitement === 'selection parcelles';
  }

  public shouldShowValidateButton(): boolean {
    // Le bouton Valider fixe devrait être visible pour toutes les étapes interactives du traitement
    const interactiveSteps = [
      'selection parcelles',
      'type de traitement', 
      'composition de mon traitement',
      'volument de bouillie utilisee',
      'repartition de mon traitement',
      'repartition de mon traitement littre'
    ];
    return interactiveSteps.includes(this.traitement);
  }

  private hasValidComposition(): boolean {
    // Vérifier si au moins un produit a été encodé dans le traitement
    const products = this.getSignalDose();
    const hasProducts = products && products.length > 0;
    if (!hasProducts) return false;

    // La cible est obligatoire pour chaque produit encodé, tous modes confondus.
    if (this.getProductsMissingTarget().length > 0) {
      return false;
    }

    return hasProducts;
  }

  /**
   * Noms des produits déjà encodés sans cible renseignée (tous modes confondus).
   * Utilisé pour bloquer la validation (hasValidComposition) et afficher un avertissement.
   */
  getProductsMissingTarget(): string[] {
    const products = this.getSignalDose() || [];
    return products
      .filter((p: any) => !p.target || !String(p.target).trim())
      .map((p: any) => p.component_name);
  }

  private hasValidRepartition(): boolean {
    // Modes Bouillie/Quantité : la somme des valeurs réparties par parcelle doit correspondre
    // à la quantité totale utilisée avant de pouvoir valider (voir isVolumeMismatched()).
    const type = this.getTreatmentType();
    if (type === 'phyto_porridge_treatment' || type === 'phyto_quantity_treatment') {
      return !this.isVolumeMismatched();
    }
    return true;
  }

  private emitProgress(): void {
    this.progressChanged.emit(this.getProgressPercentage());
  }

  private emitValidation(): void {
    this.validationChanged.emit(this.canProceedToNext());
  }

  triggerValidation(): void {
    this.emitValidation();
  }

  /**
   * Procède à l'étape suivante du formulaire
   */
  proceedToNextStep(): void {
    if (!this.canProceedToNext()) {
      return;
    }
    
    //  Définir la direction de l'animation SAUF pour la dernière étape (validation finale)
    const isLastStep = this.traitement === 'repartition de mon traitement' || 
                       this.traitement === 'repartition de mon traitement littre';
    
    if (!isLastStep) {
      this.slideDirection = 'forward';
      this.previousStep = this.traitement;
      
      // Force la détection de changement pour s'assurer que l'animation démarre
      this.cdr.detectChanges();
    }

    switch (this.traitement) {
      case 'selection parcelles':
        this.proceedFromParcelSelection();
        return;
      case 'type de traitement':
        this.onTypeTraitement();
        break;
      case 'composition de mon traitement':
        //  NOUVEAU SYSTÈME : Mettre à jour le draft avec les produits du signal
        this.updateDraftWithProducts();
        this.traitement = "repartition de mon traitement";
        break;
      case 'volument de bouillie utilisee':
        //  NOUVEAU SYSTÈME : Mettre à jour le draft avec les produits du signal
        this.updateDraftWithProducts();
        this.traitement = "repartition de mon traitement littre";
        break;
      case 'repartition de mon traitement':
      case 'repartition de mon traitement littre':
        this.finalizeTraitement();
        break;
      default:
    }

    this.emitProgress();
    this.emitValidation();
    
    //  Réinitialiser la direction après l'animation (600ms + 100ms de marge)
    // Ne s'applique pas si on est sur la dernière étape
    if (!isLastStep) {
      setTimeout(() => {
        this.slideDirection = 'none';
        this.cdr.detectChanges();
      }, 700);
    }
  }
  
  /**
   *  Retourne à l'étape précédente du formulaire
   */
  goToPreviousStep(): void {
    
    //  Définir la direction de l'animation (backward = venir de la gauche)
    this.slideDirection = 'backward';
    this.previousStep = this.traitement;
    
    // Force la détection de changement pour s'assurer que l'animation démarre
    this.cdr.detectChanges();
    
    switch(this.traitement) {
      case 'type de traitement':
        // Retour à la sélection des parcelles
        this.traitement = 'selection parcelles';
        break;
      case 'composition de mon traitement':
        this.traitement = 'type de traitement';
        break;
      case 'volument de bouillie utilisee':
        this.traitement = 'composition de mon traitement';
        break;
      case 'repartition de mon traitement':
        // Retour à composition (traitement surface)
        this.traitement = 'composition de mon traitement';
        break;
      case 'repartition de mon traitement littre':
        // Retour à volume de bouillie (traitement volume)
        this.traitement = 'volument de bouillie utilisee';
        break;
      case 'selection parcelles':
        // Retour à l'étape répartition selon le type
        if (this.getTreatmentType() === 'phyto_volume_treatment') {
          this.traitement = 'repartition de mon traitement littre';
        } else {
          this.traitement = 'repartition de mon traitement';
        }
        break;
      default:
        console.warn('⚠️ Impossible de revenir en arrière depuis:', this.traitement);
    }
    
    // Mettre à jour la progression et la validation
    this.emitProgress();
    this.emitValidation();
    
    //  Réinitialiser la direction après l'animation (600ms + 100ms de marge)
    setTimeout(() => {
      this.slideDirection = 'none';
      this.cdr.detectChanges();
    }, 700);
  }
  
  /**
   *  Callback appelé à la fin de l'animation de slide
   */
  onSlideAnimationDone(): void {
    this.isAnimating = false;
  }
  
  /**
   *  Vérifie si le bouton "Précédent" doit être affiché
   */
  canGoToPreviousStep(): boolean {
    // Le bouton précédent ne doit PAS être visible sur la sélection des parcelles (dernière étape)
    return this.traitement !== 'selection parcelles';
  }
  
  /**
   *  Vérifie si des produits sont présents dans la composition du traitement
   *  Si des produits sont présents, le type de traitement ne peut plus être modifié
   *  Vérifie directement le signal pour une réactivité immédiate
   */
  hasProductsInComposition(): boolean {
    // Vérifier directement le signal des produits (mis à jour en temps réel)
    const products = this.getSignalDose();
    return products && products.length > 0;
  }

  /**
   * Progression depuis la sélection des parcelles
   */
  private proceedFromParcelSelection(): void {
    // 🔧 CORRECTION : Sauvegarder d'abord les parcelles dans le draft
    // Vérifier qu'au moins une association parcelle+culture est sélectionnée
    if (this.selectedParcelCultureAssociations.length === 0) {
      alert('Veuillez sélectionner au moins une parcelle avec sa culture');
      return;
    }

    //  LOGIQUE DE PRÉSERVATION INTELLIGENTE POUR MODE MODIFICATION :
    // En mode modification (surface OU bouillie), on doit préserver les données existantes
    const isBouillieMode = this.currentTreatmentDraft?.type === 'phyto_porridge_treatment' || 
                           this.currentTreatmentDraft?.strategy === 'bouillie';
    const isEditMode = this.isEditMode;
    
    // 🔧 CORRECTION : En mode modification (surface OU bouillie), mapper les parcelles originales
    const originalParcelsMap = new Map<string, any>();
    let hasNewParcels = false;
    const originalTotalVolumeUsed = parseFloat(this.currentTreatmentDraft?.treatment_total_quantity_used || '0');
    
    if (isEditMode && this.currentTreatmentDraft?.parcels_concerned?.length) {
      // Remplir la map des parcelles originales (POUR TOUS LES MODES)
      this.currentTreatmentDraft.parcels_concerned.forEach((parcel: any) => {
        const key = `${parcel.parcel_id}_${parcel.crop_id}`;
        originalParcelsMap.set(key, parcel);
      });
      
      // Détecter si de nouvelles parcelles ont été ajoutées
      this.selectedParcelCultureAssociations.forEach(association => {
        const parcelKey = `${association.parcel_id}_${association.crop_id}`;
        if (!originalParcelsMap.has(parcelKey)) {
          hasNewParcels = true;
        }
      });
    }

    //  Formater et sauvegarder les parcelles dans le draft
    const parcellesFormatted = this.selectedParcelCultureAssociations.map(association => {
      const parcelKey = `${association.parcel_id}_${association.crop_id}`;
      const originalParcel = originalParcelsMap.get(parcelKey);
      
      return {
        parcel_id: association.parcel_id,
        parcel_name: association.parcel_name,
        parcel_surface: parseFloat(association.parcel_area) || 0,
        //  MODE MODIFICATION : Préserver les surfaces traitées existantes
        parcel_surface_treated: (() => {
          if (isEditMode && originalParcel && originalParcel.parcel_surface_treated !== undefined && originalParcel.parcel_surface_treated !== null) {
            return parseFloat(originalParcel.parcel_surface_treated);
          }
          // Sinon, utiliser l'association ou fallback
          return association.parcel_surface_treated !== undefined && association.parcel_surface_treated !== null
            ? parseFloat(association.parcel_surface_treated)
            : parseFloat(association.parcel_area) || 0;
        })(),
        surface_unit: association.parcel_area_unit_fr || 'ha',
        //  MODE SURFACE : TOUJOURS préserver standard_surface_treated en mode modification
        standard_surface_treated: (() => {
          if (isEditMode && originalParcel && originalParcel.standard_surface_treated !== undefined && originalParcel.standard_surface_treated !== null) {
            return parseFloat(originalParcel.standard_surface_treated);
          }
          // Sinon, utiliser l'association ou calculer
          return association.standard_surface_treated !== undefined && association.standard_surface_treated !== null
            ? parseFloat(association.standard_surface_treated)
            : (parseFloat(association.parcel_area) || 0) * this.http.onReference(association.parcel_area_unit_fr || 'ha');
        })(),
        crop_id: association.crop_id,
        crop_name: association.crop_name,
        phytoweb_name: association.phytoweb_name || association.nomPhytoweb_crops_id || '',
        eppo: association.eppo || association.EPPOCode || association.eppo_code || association.code_eppo || '',
        // Champs d'archivage de la culture
        is_archived: association.is_archived ?? association.isArchived ?? false,
        collection: association.collection || '',
        // Volume temporaire (sera recalculé après si nouvelles parcelles)
        treatment_volume_applied: originalParcel?.treatment_volume_applied || 0,
        // MODE QUANTITÉ : préserver parcel_quantity_applied si déjà calculé/saisi
        ...(isEditMode && originalParcel?.parcel_quantity_applied !== undefined && originalParcel?.parcel_quantity_applied !== null
          ? { parcel_quantity_applied: parseFloat(originalParcel.parcel_quantity_applied) }
          : {})
      };
    });

    // ─── Répartition automatique de la surface entre cultures d'une même parcelle ───
    // Si plusieurs associations partagent le même parcels_id (crop_id différents),
    // diviser parcel_surface_treated équitablement — sauf si la valeur a été préservée
    // (entrée existante en mode modification).
    {
      const parcelIdCount = new Map<number, number>();
      for (const p of parcellesFormatted) {
        parcelIdCount.set(p.parcel_id, (parcelIdCount.get(p.parcel_id) || 0) + 1);
      }
      for (const p of parcellesFormatted) {
        const count = parcelIdCount.get(p.parcel_id) || 1;
        if (count <= 1) continue;
        const parcelKey = `${p.parcel_id}_${p.crop_id}`;
        const isPreserved = isEditMode && originalParcelsMap.has(parcelKey);
        if (isPreserved) continue;
        const divided = parseFloat(((p.parcel_surface || 0) / count).toFixed(2));
        const dividedStd = parseFloat((divided * this.http.onReference(p.surface_unit || 'ha')).toFixed(6));
        p.parcel_surface_treated = divided;
        p.standard_surface_treated = dividedStd;
      }
    }

    // Mettre à jour le draft avec les parcelles sélectionnées
    this.currentTreatmentDraft.parcels_concerned = parcellesFormatted;
    
    // � REDISTRIBUTION INTELLIGENTE : Si de nouvelles parcelles ajoutées en mode bouillie
    if (isBouillieMode && isEditMode && hasNewParcels && originalTotalVolumeUsed > 0) {
      // Calculer la nouvelle surface totale standard
      const newTotalSurface = parcellesFormatted.reduce((sum, parcel) => 
        sum + parseFloat(String(parcel.standard_surface_treated || '0')), 0
      );
      
      if (newTotalSurface > 0) {
        // Redistribuer le volume total EXISTANT proportionnellement sur TOUTES les parcelles
        parcellesFormatted.forEach(parcel => {
          const parcelSurface = parseFloat(String(parcel.standard_surface_treated || '0'));
          parcel.treatment_volume_applied = parseFloat(
            ((originalTotalVolumeUsed * parcelSurface) / newTotalSurface).toFixed(2)
          );
        });
        
        // Le total reste identique (juste redistribué)
        this.currentTreatmentDraft.treatment_total_quantity_used = originalTotalVolumeUsed;
      }
    } else if (isBouillieMode && isEditMode) {
      // Pas de nouvelles parcelles : recalculer le total comme somme (gestion des suppressions)
      const totalVolumeApplied = parcellesFormatted.reduce((sum, parcel) => 
        sum + parseFloat(String(parcel.treatment_volume_applied || '0')), 0
      );
      this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalVolumeApplied.toFixed(2));
    }
    
    // Recalculer la surface totale immédiatement
    this.recalculateTotalSurface();
    
    // Passer à l'étape "type de traitement" pour choisir le mode
    this.traitement = "type de traitement";
    this.emitProgress();
  }

  /**
   * Finalise le traitement (dernière étape)
   */
  private finalizeTraitement(): void {
    // Appeler directement onTerminerTraitement qui gère tout
    this.onTerminerTraitement();
  }

  /**
   * Calcule le pourcentage de progression basé sur l'étape actuelle du traitement
   */
  getProgressPercentage(): number {
    if (!this.traitement) {
      return 25; // Progression initiale dès l'ouverture de la popup
    }

    switch (this.traitement) {
      case 'type de traitement':
        return 50; // Première étape de sélection
      case 'composition de mon traitement':
        return 70; // Composition sélectionnée
      case 'volument de bouillie utilisee':
        return 85; // Volume défini  
      case 'autre produits litre':
      case 'repartition de mon traitement': // Répartition surface
      case 'repartition de mon traitement littre': // Répartition volume
        return 100; // Répartition configurée
      case 'selection parcelles':
      default:
        // Dernière étape (sélection des parcelles) = 100%
        return 25;
    }
  }

  /**
   * Retourne l'unité par défaut selon la stratégie de traitement
   */
  private getDefaultUnit(): string {
    // En mode modification, utiliser la stratégie du traitement en cours
    if (this.isEditMode && this.editingTreatment?.strategy) {
      return this.editingTreatment.strategy === 'bouillie' ? 'L/100L' : 'L/ha';
    }
    
    // En mode création, utiliser le type du formulaire
    const treatmentType = this.formTraitement?.value?.type || 'phyto_surface_treatment';
    
    if (treatmentType === 'phyto_porridge_treatment') {
      return 'L/100L';
    } else if (treatmentType === 'phyto_quantity_treatment') {
      return 'L';
    } else {
      // Pour les traitements surface (ou autres)
      return 'L/ha';
    }
  }

  /**
   * Initialise les formulaires
   */
  private initializeForms(): void {
    this.formTraitement = this.formBuilder.group({
      type: ['phyto_surface_treatment', [Validators.required]], // Surface par défaut
      date: [this.formatDateForInput(new Date()), [Validators.required]],
      target: [''],
      harvest_date: [''],
      produit_humidite: [''],
      temperature: [''],
      vitesse_vent: [''],
      humidite_vent: [''],
      autres_remarques: [''],
      bbch: [''], // Champ pour le stade BBCH (optionnel)
      event_hour: [''], // Nouveau champ pour l'heure de traitement (optionnel)
      remark: [''],
      localized_treatment: ['Non'], // Valeur par défaut : Non (false)
      clean_flag: ['Non'], // Valeur par défaut : Non (false)
      operator_id: [''], // Nouvel champ opérateur
      treatment_total_quantity: [''], // Volume de bouillie préparé
      treatment_total_quantity_used: [''], // Volume de bouillie utilisé (mode bouillie)
      decision_base: ['Non défini'],
      effectiveness: ['Pas d\'avis']
    });

    this.formAddDose = this.formBuilder.group({
      dose: ['', [Validators.required, Validators.min(0.1)]],
      component_id: [''],
      littre: [this.getDefaultUnit()] // 🔧 Unité dynamique selon le type de traitement
    });

    // Formulaire pour la sélection de parcelles (utilisé dans le template)
    this.form = this.formBuilder.group({
      parcels_id: this.formBuilder.array([])
    });

    // Contrôles pour les volumes
    this.treatment_total_quantity = this.formBuilder.control('');
    this.treatment_total_quantity_used = this.formBuilder.control('');
    
    //  Initialiser le draft avec les valeurs par défaut
    this.initializeTreatmentDraft();
  }
  
  /**
   *  NOUVEAU SYSTÈME : Initialiser le draft local
   */
  private initializeTreatmentDraft(): void {
    this.currentTreatmentDraft = {
      event_id: this.isEditMode && this.editingTreatment ? this.editingTreatment.event_id : `phyto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'phyto_surface_treatment',
      date: this.formatDateForInput(new Date()),
      event_hour: '',
      operator_id: '',
      operator_name: '',
      operator_phytolicence: '',
      target: '',
      bbch: '',
      remark: '',
      harvest_date: '',
      clean_flag: 'Non',
      localized_treatment: 'Non',
      treatment_total_quantity: '',
      treatment_total_quantity_used: '',
      decision_base: 'Non défini',
      effectiveness: 'Pas d\'avis',
      parcels_concerned: [],
      treatment_composition: [],
      total_surface: 0
    };
  }
  
  /**
   *  NOUVEAU SYSTÈME : Recalculer la surface totale localement
   * ⚠️ IMPORTANT: Utiliser standard_surface_treated (en ha) pour les calculs,
   *    car parcel_surface_treated est en unité originale (peut être m², a, ha...)
   */
  private recalculateTotalSurface(): void {
    if (!this.currentTreatmentDraft) return;
    
    let totalSurface = 0;
    const parcels = this.currentTreatmentDraft.parcels_concerned || [];
    
    for (const parcel of parcels) {
      // 🔧 CORRECTION: Utiliser standard_surface_treated EN PRIORITÉ car c'est déjà en hectares
      // parcel_surface_treated est en unité originale (m², a, ha) et ne doit PAS être utilisé pour les calculs
      const surface = parseFloat(parcel.standard_surface_treated || '0');
      totalSurface += surface;
    }
    
    this.currentTreatmentDraft.total_surface = totalSurface;
    this.currentTreatmentDraft.standard_total_surface_treated = totalSurface;
  }
  
  /**
   *  NOUVEAU SYSTÈME : Recalculer les quantités de composants localement
   */
  private recalculateComponentQuantities(): void {
    if (!this.currentTreatmentDraft) return;
    
    const components = this.currentTreatmentDraft.treatment_composition || [];
    const totalSurface = this.currentTreatmentDraft.total_surface || 0;
    const treatmentType = this.currentTreatmentDraft.type || 'phyto_surface_treatment';
    
    let totalQuantityUsed = 0;
    let hasMultipleUnits = false;
    let firstUnit = '';
    
    for (const component of components) {
      const dose = parseFloat(component.component_dose || '0');
      const doseUnit = (component.component_dose_unit || '');
      let calculatedQuantity = 0;
      let componentUnit = '';
      
      // Utiliser la dose standardisée (déjà calculée via onReference)
      const standardDose = parseFloat(component.standard_component_dose || '0') || (dose * this.onReference(doseUnit));
      
      if (treatmentType === 'phyto_quantity_treatment') {
        // Mode quantité : component_quantity est FIXE (saisie utilisateur), on recalcule uniquement component_dose
        const fixedQty = parseFloat(component.component_quantity || '0');
        const dose = totalSurface > 0 ? fixedQty / totalSurface : 0;
        component.component_dose = parseFloat(dose.toFixed(6));
        component.standard_component_dose = parseFloat(dose.toFixed(6));
        // Unité de dose = unité de base + /ha (L → L/ha, Kg → Kg/ha)
        const rawUnit = component.component_dose_unit || 'L';
        const baseUnit = rawUnit.replace('/ha', '').replace('/are', '').replace('/m²', '');
        component.component_dose_unit = baseUnit + '/ha';
        component.component_quantity_unity = baseUnit;
        totalQuantityUsed += fixedQty;
      } else if (treatmentType === 'phyto_surface_treatment') {
        // Mode surface : quantité = dose_standard * surface
        calculatedQuantity = standardDose * totalSurface;
        
        // Déterminer l'unité de quantité
        componentUnit = this.getQuantityUnitFromDoseUnit(doseUnit);
        
        component.component_quantity = calculatedQuantity.toFixed(2);
        component.component_quantity_unity = componentUnit;
        
        // Vérifier si on a plusieurs unités différentes
        if (!firstUnit) {
          firstUnit = componentUnit;
        } else if (firstUnit !== componentUnit) {
          hasMultipleUnits = true;
        }
        
        // Seulement additionner si même unité que le premier produit
        if (componentUnit === firstUnit) {
          totalQuantityUsed += calculatedQuantity;
        }
      } else if (treatmentType === 'phyto_porridge_treatment') {
        // Mode bouillie : quantité = dose_standard * volume_bouillie_utilisé / 100
        const volumeBouillieUtilise = parseFloat(this.currentTreatmentDraft.treatment_total_quantity_used || this.currentTreatmentDraft.treatment_total_quantity || '0');
        calculatedQuantity = (standardDose * volumeBouillieUtilise / 100);
        
        // Déterminer l'unité de quantité
        componentUnit = this.getQuantityUnitFromDoseUnit(doseUnit);
        
        component.component_quantity = calculatedQuantity.toFixed(2);
        component.component_quantity_unity = componentUnit;
      }
    }
    
    //  Calculer la quantité totale utilisée
    if (treatmentType === 'phyto_surface_treatment' || treatmentType === 'phyto_quantity_treatment') {
      // Mode surface/quantité : somme des quantités du premier type d'unité
      this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalQuantityUsed.toFixed(2));
    }
    // En mode bouillie, treatment_total_quantity_used sera calculé dans recalculateDistribution()
  }
  
  /**
   * � Vérifie si au moins un produit utilise une unité de quantité totale (L ou Kg)
   * Ces produits ont été saisis avec une quantité fixe, pas une dose
   */
  private hasAbsoluteQuantityProducts(): boolean {
    if (!this.currentTreatmentDraft?.treatment_composition?.length) {
      return false;
    }
    
    const components = this.currentTreatmentDraft.treatment_composition;
    
    const hasAbsolute = components.some((component: any) => {
      const doseUnit = component.component_dose_unit || '';
      const isAbsolute = doseUnit === 'L' || doseUnit === 'Kg';
      return isAbsolute;
    });
    
    return hasAbsolute;
  }
  
  /**
   * 🆕 Recalcule les DOSES à partir des QUANTITÉS fixes (pour les unités de quantité totale)
   * Utilisé quand l'utilisateur a saisi une quantité totale et modifie ensuite la surface
   * Formule: dose = quantité / surface_totale
   */
  private recalculateDosesFromQuantity(): void {
    if (!this.currentTreatmentDraft) return;
    
    const components = this.currentTreatmentDraft.treatment_composition || [];
    const totalSurface = this.currentTreatmentDraft.total_surface || 0;
    const standardTotalSurface = this.currentTreatmentDraft.standard_total_surface_treated || 0;
    const treatmentType = this.currentTreatmentDraft.type || 'phyto_surface_treatment';
    

    
    let totalQuantityUsed = 0;
    
    for (const component of components) {
      const doseUnit = component.component_dose_unit || '';
      
      // 🆕 Seulement pour les produits avec unité de quantité totale (L ou Kg)
      if (doseUnit === 'L' || doseUnit === 'Kg') {
        const fixedQuantity = parseFloat(component.component_quantity || '0');
                
        if (fixedQuantity > 0) {
          // Recalculer la dose: dose = quantité / surface
          if (treatmentType === 'phyto_surface_treatment') {
            const newDose = fixedQuantity / standardTotalSurface;
            // Mettre à jour les doses
            component.component_dose = parseFloat(newDose.toFixed(6));
            component.standard_component_dose = parseFloat(newDose.toFixed(6));
            if (doseUnit === 'L') {
              component.component_dose_unit = 'L/ha';
            }
              else if (doseUnit === 'Kg') {
              component.component_dose_unit = 'Kg/ha';
            }
          } else if (treatmentType === 'phyto_porridge_treatment') {
            // En mode bouillie, la dose est recalculée en fonction du volume utilisé
            const volumeBouillieUtilise = parseFloat(this.currentTreatmentDraft.treatment_total_quantity_used || this.currentTreatmentDraft.treatment_total_quantity || '0');
            const newDose = (fixedQuantity / volumeBouillieUtilise) * 100;
            component.component_dose = parseFloat(newDose.toFixed(6));
            component.standard_component_dose = parseFloat(newDose.toFixed(6));
            if (doseUnit === 'L') {
              component.component_dose_unit = 'L/100L';
            }
              else if (doseUnit === 'Kg') {
              component.component_dose_unit = 'Kg/100L';
            }
          }
          
          // L'unité de dose affichée reste la même (sera régénérée à L/ha ou kg/ha)
          // Note: On garde component_dose_unit à 'L' ou 'Kg' pour tracker le type d'encodage
          // component_quantity reste FIXE !
          component.component_quantity_unity = doseUnit === 'Kg' ? 'Kg' : 'L';
          
          totalQuantityUsed += fixedQuantity;
          
        }
      } else {
        // Pour les autres unités, comportement normal : recalculer la quantité
        const dose = parseFloat(component.component_dose || '0');
        const standardDose = parseFloat(component.standard_component_dose || '0') || (dose * this.onReference(doseUnit));
        const calculatedQuantity = standardDose * totalSurface;
        
        component.component_quantity = calculatedQuantity.toFixed(2);
        component.component_quantity_unity = this.getQuantityUnitFromDoseUnit(doseUnit);
        totalQuantityUsed += calculatedQuantity;
        
      }
    }
    
    // Mettre à jour le total de quantité utilisée dans le draft
    this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalQuantityUsed.toFixed(2));
    
    // Mettre à jour treatment_composition dans le draft
    this.currentTreatmentDraft.treatment_composition = [...components];
    
    // Mettre à jour le signal des produits
    this.http.signalGetDose.set([...components]);
    
  }
  
  /**
   * NOUVEAU SYSTÈME : Mettre à jour une valeur de parcelle localement (sans serveur en mode création)
   */
  private updateParcelValueLocally(parcelId: number, field: string, value: number, cropId?: string): void {
    if (!this.currentTreatmentDraft?.parcels_concerned?.length) return;
    
    
    // Mettre à jour la valeur dans le draft
    this.currentTreatmentDraft.parcels_concerned = this.currentTreatmentDraft.parcels_concerned.map((parcel: any) => {
      const parcelMatch = parcel.parcel_id === parcelId;
      const cropMatch = !cropId || parcel.crop_id === cropId || parcel.crop_id === String(cropId);
      
      if (parcelMatch && cropMatch) {
        const updated = { ...parcel, [field]: value };
        // Synchroniser standard_surface_treated (en ha) quand l'utilisateur modifie la superficie
        if (field === 'parcel_surface_treated') {
          const conversionFactor = this.http.onReference(parcel.surface_unit || 'ha');
          updated.standard_surface_treated = value * conversionFactor;
        }
        return updated;
      }
      return parcel;
    });
    
    const treatmentType = this.currentTreatmentDraft.type || 'phyto_surface_treatment';
    
    // Si c'est une modification de volume en mode bouillie, recalculer uniquement le total utilisé
    if (field === 'treatment_volume_applied' && treatmentType === 'phyto_porridge_treatment') {
      const parcels = this.currentTreatmentDraft.parcels_concerned;
      const totalApplied = parcels.reduce((sum: number, p: any) => 
        sum + parseFloat(p.treatment_volume_applied || '0'), 0
      );
      this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalApplied.toFixed(2));

      
      // Recalculer les quantités de produits basées sur le nouveau volume utilisé
      this.recalculateComponentQuantities();
      
      // Forcer la détection des changements pour mise à jour UI
      this.cdr.detectChanges();
    } else if (field === 'parcel_surface_treated') {
      // Modification de surface
      this.recalculateTotalSurface();
      
      
      // En mode bouillie, recalculer la distribution basée sur la nouvelle surface
      if (treatmentType === 'phyto_porridge_treatment') {
        this.recalculateDistribution();
        this.recalculateComponentQuantities();
      } else if (treatmentType === 'phyto_quantity_treatment') {
        // MODE QUANTITÉ : recalculer uniquement les doses dérivées, jamais les quantités
        this.recalculateComponentQuantities();
        this.recalculateDistribution();
      } else {
        //  MODE SURFACE : Vérifier si des produits utilisent une unité de quantité totale (L ou Kg)
        const hasAbsoluteQuantityProducts = this.hasAbsoluteQuantityProducts();
        
        
        if (hasAbsoluteQuantityProducts) {
          // Pour les produits en quantité totale : recalculer les DOSES, pas les quantités
          this.recalculateDosesFromQuantity();
          // Ne PAS appeler recalculateDistribution qui écraserait les quantités
        } else {
          // Comportement normal : recalculer les quantités à partir des doses
          this.recalculateComponentQuantities();
          this.recalculateDistribution();
        }
      }
      
      // Forcer la détection des changements
      this.cdr.detectChanges();
    }
  }
  
  /**
   *  NOUVEAU SYSTÈME : Recalculer la distribution localement
   */
  private recalculateDistribution(): void {
    if (!this.currentTreatmentDraft) return;
    
    const parcels = this.currentTreatmentDraft.parcels_concerned || [];
    const totalSurface = this.currentTreatmentDraft.total_surface || 0;
    const treatmentType = this.currentTreatmentDraft.type || 'phyto_surface_treatment';

    if (treatmentType === 'phyto_quantity_treatment') {
      // Mode quantité : calculer la quantité de produit par parcelle proportionnellement à la surface
      // En mode édition, préserver les parcel_quantity_applied déjà définis (modifiés manuellement)
      const components = this.currentTreatmentDraft.treatment_composition || [];
      for (const parcel of parcels) {
        parcel.treatment_volume_applied = 0; // non applicable
        // Ne recalculer que si pas encore défini (undefined ou null) — valeur 0 est considérée comme définie
        if (parcel.parcel_quantity_applied === undefined || parcel.parcel_quantity_applied === null) {
          if (totalSurface > 0) {
            const parcelSurface = parseFloat(parcel.standard_surface_treated || '0');
            const ratio = parcelSurface / totalSurface;
            const parcelQty = components.reduce((sum: number, comp: any) => sum + parseFloat(comp.component_quantity || '0'), 0);
            parcel.parcel_quantity_applied = parseFloat((parcelQty * ratio).toFixed(2));
          }
        }
        parcel.parcel_quantity_unit = components[0]?.component_quantity_unity || 'L';
      }
      // treatment_total_quantity_used est calculé dans recalculateComponentQuantities()
      return;
    }
    
    if (treatmentType === 'phyto_porridge_treatment') {
      //  MODE BOUILLIE : Logique intelligente de préservation des volumes
      // En mode modification, on préserve les volumes existants et ne calcule que pour les nouvelles parcelles
      
      let volumeBouillieUtilise = parseFloat(
        String(this.currentTreatmentDraft.treatment_total_quantity_used || this.currentTreatmentDraft.treatment_total_quantity || '0')
      );
      
      // Si on est en répartition et que l'utilisateur a saisi un volume utilisé dans le formulaire, l'utiliser
      if (this.treatment_total_quantity_used && this.treatment_total_quantity_used.value) {
        volumeBouillieUtilise = parseFloat(this.treatment_total_quantity_used.value);
        this.currentTreatmentDraft.treatment_total_quantity_used = volumeBouillieUtilise;
      }
      
      //  NOUVEAU : En mode modification, préserver les volumes existants
      if (this.isEditMode) {
        // Mode modification : NE PAS recalculer les volumes existants
        // Seulement calculer pour les parcelles qui n'ont pas encore de volume (nouvelles parcelles)
        let hasCalculated = false;
        
        for (const parcel of parcels) {
          const currentVolume = parseFloat(parcel.treatment_volume_applied || '0');
          
          if (currentVolume === 0 && totalSurface > 0 && volumeBouillieUtilise > 0) {
            // 🆕 Nouvelle parcelle sans volume : calculer proportionnellement
            // 🔧 CORRECTION: Utiliser standard_surface_treated (en ha) pour les calculs
            const parcelSurface = parseFloat(parcel.standard_surface_treated || '0');
            parcel.treatment_volume_applied = ((volumeBouillieUtilise * parcelSurface) / totalSurface).toFixed(2);
            hasCalculated = true;
          }
          // Sinon, garder le volume existant (ne rien faire)
        }
        
        // Toujours recalculer le total utilisé comme somme des volumes
        const totalApplique = parcels.reduce((sum: number, p: any) => 
          sum + parseFloat(p.treatment_volume_applied || '0'), 0
        );
        this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalApplique.toFixed(2));
        
      } else {
        // Mode création : comportement original - distribuer le volume proportionnellement
        if (totalSurface > 0 && volumeBouillieUtilise > 0) {
          for (const parcel of parcels) {
            // 🔧 CORRECTION: Utiliser standard_surface_treated (en ha) pour les calculs
            const parcelSurface = parseFloat(parcel.standard_surface_treated || '0');
            parcel.treatment_volume_applied = ((volumeBouillieUtilise * parcelSurface) / totalSurface).toFixed(2);
          }
          
          const totalApplique = parcels.reduce((sum: number, p: any) => 
            sum + parseFloat(p.treatment_volume_applied || '0'), 0
          );
          this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalApplique.toFixed(2));
        } else {
          // Pas de surface ou de volume : mettre à zéro
          for (const parcel of parcels) {
            parcel.treatment_volume_applied = '0.00';
          }
          this.currentTreatmentDraft.treatment_total_quantity_used = 0;
        }
      }
    }
  }
  
  /**
   * NOUVEAU SYSTÈME : Mettre à jour le draft avec les produits du signal et les métadonnées du formulaire
   */
  private updateDraftWithProducts(): void {
    if (!this.currentTreatmentDraft) return;

    // 1. Récupérer les produits depuis le signal
    const products = this.getSignalDose();
    if (products && products.length > 0) {
      const currentType = this.currentTreatmentDraft.type || 'phyto_surface_treatment';
      if (currentType === 'phyto_quantity_treatment' && this.isEditMode) {
        // Mode quantité en édition : le DRAFT est la source de vérité pour component_quantity.
        // On ne synchronise que les ajouts/suppressions depuis le signal.
        const draftComp: any[] = this.currentTreatmentDraft.treatment_composition || [];
        const signalIds = new Set(products.map((p: any) => p.component_id));
        const draftIds = new Set(draftComp.map((p: any) => p.component_id));
        const kept = draftComp.filter((p: any) => signalIds.has(p.component_id));
        const added = products.filter((p: any) => !draftIds.has(p.component_id));
        this.currentTreatmentDraft.treatment_composition = [...kept, ...added];
      } else {
        this.currentTreatmentDraft.treatment_composition = products;
      }
    }
    
    // 2. Mettre à jour les métadonnées depuis le formulaire
    const formValues = this.formTraitement.value;
    Object.assign(this.currentTreatmentDraft, {
      type: formValues.type,
      date: formValues.date,
      event_hour: formValues.event_hour,
      target: formValues.target,
      bbch: formValues.bbch,
      remark: formValues.remark,
      harvest_date: formValues.harvest_date,
      clean_flag: formValues.clean_flag,
      localized_treatment: formValues.localized_treatment,
      decision_base: formValues.decision_base || 'Non défini',
      effectiveness: formValues.effectiveness || 'Pas d\'avis',
      treatment_total_quantity: formValues.treatment_total_quantity,
      // treatment_total_quantity_used géré par recalculateComponentQuantities en mode quantité
      ...(this.currentTreatmentDraft.type !== 'phyto_quantity_treatment' && {
        treatment_total_quantity_used: formValues.treatment_total_quantity_used
      })
    });
    
    // 3. Ajouter les infos opérateur si sélectionné
    if (this.selectedOperator) {
      this.currentTreatmentDraft.operator_id = this.selectedOperator.operatorId;
      this.currentTreatmentDraft.operator_name = this.selectedOperator.operatorName;
      this.currentTreatmentDraft.operator_phytolicence = this.selectedOperator.operatorPhytolicence;
    }
    
    // 4. Recalculer tous les champs dérivés
    this.recalculateTotalSurface();
    
    // En mode bouillie : d'abord calculer la distribution (pour avoir treatment_total_quantity_used)
    // puis les quantités de produits
    const treatmentType = this.currentTreatmentDraft.type || 'phyto_surface_treatment';
    if (treatmentType === 'phyto_quantity_treatment') {
      // Mode quantité : ne PAS recalculer component_quantity (fixe) — juste les doses dérivées
      this.recalculateComponentQuantities();
      // recalculateDistribution préserve les parcel_quantity_applied existants
      this.recalculateDistribution();
    } else if (treatmentType === 'phyto_porridge_treatment') {
      this.recalculateDistribution();
      this.recalculateComponentQuantities();
    } else {
      // En mode surface : d'abord les quantités de produits, puis la distribution n'est pas nécessaire
      this.recalculateComponentQuantities();
      this.recalculateDistribution();
    }
  }

  private loadInitialData(): void {
    //  DEBUG: Test direct de chargement des cultures
    this.http.testCropsLoading().subscribe({
      next: (testResult) => console.log(''),
      error: (testError) => console.error('')
    });
    
    //  Optimisation avec shareReplay pour éviter les appels API multiples
    this.getExploitation = this.http.getExploitation().pipe(shareReplay(1));
    this.VolumeDeBouillipreparer = this.http.getVolumeDeBouillipreparer().pipe(shareReplay(1));
    this.AddDose = this.http.getDose().pipe(shareReplay(1));
    
    // En mode édition, les groupes seront chargés après le préchargement
    if (!this.isEditMode) {
      this.loadParcelCultureGroupsOptimized();
    }
    
    // Initialiser les filtres de produits avec optimisations
    this.initializeOptimizedProductFilters();
    this.initializeTreatmentTypeWatcher();
  }

  /**
   * Chargement optimisé des groupes parcelles/cultures avec cache
   */
  private loadParcelCultureGroupsOptimized(): void {
    // Si des données sont déjà en cache, les utiliser directement sans requête HTTP
    if (this.parcelCultureGroupsCache$.value.length > 0) {
      this.isLoadingParcelCultures = false;
      this.hasTriedToLoadParcelCultures = true;
      // Alimenter displayGroupsSubject si pas encore fait (cas du mode édition avec createFallbackGroups)
      if (this.displayGroupsSubject.value.length === 0 && this.rawAssociations.length === 0) {
        this.rawAssociations = this.parcelCultureGroupsCache$.value.flatMap((g: any) => g.associations);
        if (this.isEditMode && this.editingTreatment?.parcels_concerned?.length) {
          this.syncSelectionFromStoredParcels();
        }
        this.displayGroupsSubject.next(this.buildDisplayGroups(this.rawAssociations, this.groupByMode));
      }
      return;
    }

    // Activer l'indicateur de chargement
    this.isLoadingParcelCultures = true;

    const exploitation$ = this.http.testCropsLoading().pipe(shareReplay(1));
    const parcelles$ = this.getParcellesCached();

    combineLatest([
      exploitation$,
      parcelles$
    ]).pipe(
      take(1),
      map(([cultures, parcelles]: [any[], any[]]) => {
        
        // LOGIQUE ORIGINALE CORRIGÉE: Les cultures ont bien parcels_id !
        const parcelMap = new Map(
          (parcelles || []).map(p => [p.id_parcel, p])
        );
        
        
        const associations: any[] = [];
        
        cultures.forEach((culture, index) => {
          
          if (culture.parcels_id && Array.isArray(culture.parcels_id)) {
            
            culture.parcels_id.forEach((parcelId: string) => {
              const parcelInfo = parcelMap.get(parcelId);
              
              if (parcelInfo) {
                const uniqueId = `${parcelInfo.id_parcel}_${culture.crop_id}`;
                
                associations.push({
                  uniqueId,
                  parcel_id: parcelInfo.id_parcel,
                  parcel_name: parcelInfo.parcel_name,
                  parcel_area: parcelInfo.parcel_area,
                  parcel_area_unit_fr: parcelInfo.parcel_area_unit_fr,
                  crop_id: culture.crop_id,
                  crop_name: culture.crop_name,
                  phytoweb_name: culture.phytoweb_name || culture.nomPhytoweb_crops_id || '',
                  eppo: culture.eppo || culture.EPPOCode || culture.eppo_code || culture.code_eppo || '',
                  is_archived: culture.is_archived ?? culture.isArchived ?? false,
                  collection: culture.collection || ''
                });
              } else {
              }
            });
          } else {
          }
        });


        // Regroupement par culture
        const groupsMap = new Map<string, any>();
        associations.forEach(association => {
          const groupKey = association.phytoweb_name || association.crop_name;
          if (!groupsMap.has(groupKey)) {
            groupsMap.set(groupKey, {
              phytoweb_name: groupKey,
              crop_name: association.crop_name,
              associations: []
            });
          }
          groupsMap.get(groupKey)!.associations.push(association);
        });

        const finalGroups = Array.from(groupsMap.values());
        return finalGroups;
      }),
      shareReplay(1)
    ).subscribe({
      next: (groups) => {
        this.parcelCultureGroupsCache$.next(groups);
        this.rawAssociations = groups.flatMap((g: any) => g.associations);
        // En mode édition : synchroniser la sélection juste avant le rendu
        // pour que les checkboxes soient correctes dès le premier affichage
        if (this.isEditMode && this.editingTreatment?.parcels_concerned?.length) {
          this.syncSelectionFromStoredParcels();
        }
        this.displayGroupsSubject.next(this.buildDisplayGroups(this.rawAssociations, this.groupByMode));
        this.isLoadingParcelCultures = false;
        this.hasTriedToLoadParcelCultures = true;
      },
      error: (error) => {
        this.parcelCultureGroupsCache$.next([]);
        this.isLoadingParcelCultures = false;
        this.hasTriedToLoadParcelCultures = true;
      }
    });
  }

  /**
   * 🔄 Rafraîchit les données de parcelles/cultures suite à une modification de parcelle
   */
  private refreshParcelCultureData(): void {
    // En mode édition, la grille est gérée par loadParcelGridEditMode().
    // On ne recharge pas en cours d'édition pour ne pas écraser la sélection.
    if (this.isEditMode) return;

    // 🔄 Activer l'indicateur de chargement lors du rafraîchissement
    this.isLoadingParcelCultures = true;

    // Vider le cache des BehaviorSubject
    this.parcelCultureGroupsCache$.next([]);
    this.rawAssociations = [];
    this.displayGroupsSubject.next([]);

    // Recharger les données
    this.loadParcelCultureGroupsOptimized();
  }

  /**
   * 🔄 Déclenche le chargement des parcelles/cultures avec indicateur de chargement
   */
  private triggerParcelCultureLoading(): void {
    // 🔄 Activer l'indicateur de chargement
    this.isLoadingParcelCultures = true;
    
    // Déclencher le chargement
    this.loadParcelCultureGroupsOptimized();
  }

  /**
   * 📊 Initialisation optimisée des filtres de produits avec debounce et état de chargement
   */
  private initializeOptimizedProductFilters(): void {
    const searchTerm$ = combineLatest([
      this.searchControl.valueChanges.pipe(
        startWith(''),
        debounceTime(this.SEARCH_DEBOUNCE_TIME),
        distinctUntilChanged()
      ),
      this.searchControlBouillie.valueChanges.pipe(
        startWith(''),
        debounceTime(this.SEARCH_DEBOUNCE_TIME),
        distinctUntilChanged()
      )
    ]).pipe(
      map(([search1, search2]) => {
        const term = (search1 || search2 || '').toLowerCase().trim();
        
        //  Mettre à jour les indicateurs de recherche
        this.showSearchHint = !this.isEditMode && term.length < this.MIN_SEARCH_CHARS;
        this.hasSearchResults = this.isEditMode || term.length >= this.MIN_SEARCH_CHARS;
        
        // Activer le chargement si recherche en cours
        if (term.length >= this.MIN_SEARCH_CHARS) {
          this.isLoadingProducts = true;
        } else {
          this.isLoadingProducts = false;
        }
        
        return term;
      })
    );

    this.VolumeDeBouilliepreparerFiltered = combineLatest([
      this.VolumeDeBouillipreparer,
      searchTerm$
    ]).pipe(
      map(([products, term]) => {
        // En mode modification, afficher tous les produits par défaut
        // En mode création, nécessiter MIN_SEARCH_CHARS pour éviter d'afficher trop de produits d'un coup
        const shouldShowAll = this.isEditMode || term.length >= this.MIN_SEARCH_CHARS;
        
        if (!shouldShowAll) {
          this.isLoadingProducts = false;
          return []; // Retourner un tableau vide si pas assez de caractères en mode création
        }
        
        //  Si pas de terme de recherche et en mode modification, afficher tous les produits
        if (term.length === 0 && this.isEditMode) {
          this.isLoadingProducts = false;
          return this.sortProductsOptimized(products);
        }
        
        //  Filtrage optimisé si terme de recherche présent
        if (term.length > 0) {
          const filteredProducts = products.filter(product => {
            const name = product.product_name?.toLowerCase() || '';
            const numaut = product.product_numaut?.toLowerCase() || '';
            return name.includes(term) || numaut.includes(term);
          });
          
          // Désactiver le chargement une fois les résultats prêts
          this.isLoadingProducts = false;
          return this.sortProductsOptimized(filteredProducts);
        }
        
        // Fallback : retourner un tableau vide
        this.isLoadingProducts = false;
        return [];
      }),
      shareReplay(1)
    );
  }

  /**
   *  Tri optimisé des produits avec cache des priorités
   */
  private sortProductsOptimized(products: any[]): any[] {
    // Cache pour éviter de recalculer les priorités
    const statusPriorityCache = new Map<string, number>();
    
    const getStatusPriority = (status: string): number => {
      if (!statusPriorityCache.has(status)) {
        let priority = 3; // Default (statut inconnu)
        if (status === 'authorized') priority = 0;        // 🟢 Autorisés
        else if (status === 'withdrawing') priority = 1;  // 🟠 En cours de retrait
        else if (status === 'forbidden') priority = 2;    // 🔴 Interdits
        statusPriorityCache.set(status, priority);
      }
      return statusPriorityCache.get(status)!;
    };

    return products.sort((a, b) => {
      const statusA = getStatusPriority(a.authorization_status || '');
      const statusB = getStatusPriority(b.authorization_status || '');
      
      if (statusA !== statusB) {
        return statusA - statusB;
      }
      
      // Comparaison alphabétique optimisée
      const nameA = a.product_name || '';
      const nameB = b.product_name || '';
      return nameA.localeCompare(nameB);
    });
  }
  /**
   * 🔧 Initialise les observateurs pour recalculer automatiquement quand les quantités changent
   */
  private initializeQuantityObservers(): void {
    // Observer les changements de quantité préparée
    this.treatment_total_quantity.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(newQuantityPrepared => {
      // Empêcher les valeurs négatives
      if (newQuantityPrepared && parseFloat(newQuantityPrepared) < 0) {
        this.treatment_total_quantity.setValue(0, { emitEvent: false });
        return;
      }
      
      if (newQuantityPrepared && parseFloat(newQuantityPrepared) > 0) {
        // Sync avec le formulaire principal
        this.formTraitement.patchValue({
          treatment_total_quantity: newQuantityPrepared
        }, { emitEvent: false });
        
        //  AUTO-REMPLISSAGE : Si "Utilisée" est vide ou zéro, copier "Préparée"
        const currentUsed = this.treatment_total_quantity_used.value;
        if (!currentUsed || parseFloat(currentUsed) === 0) {
          this.treatment_total_quantity_used.setValue(newQuantityPrepared, { emitEvent: true });
        }
      }
    });

    // Observer les changements de quantité utilisée en mode bouillie
    this.treatment_total_quantity_used.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(newQuantityUsed => {
      // Empêcher les valeurs négatives
      if (newQuantityUsed && parseFloat(newQuantityUsed) < 0) {
        this.treatment_total_quantity_used.setValue(0, { emitEvent: false });
        return;
      }
      
      if (newQuantityUsed && parseFloat(newQuantityUsed) > 0) {
        const currentType = this.formTraitement.get('type')?.value;
        if (currentType === 'phyto_porridge_treatment' || this.traitement === 'volument de bouillie utilisee') {
          this.recalculateForBouillieMode();
        }
      }
    });
  }

    // Forcer la mise à jour des calculs via la logique existante (no-op placeholder)

  /**
   * Mode modification - initialise avec les données existantes
   */
  private initEditMode(): void {
    this.isEditMode = true;
    this.isEditModeSignal.set(true);
    this.editingTreatment = this.interventionToModify.originalData;
    this.dataLoaded = false;
    this.editModeSelectionLocked = false;

    this.traitement = "selection parcelles";

    // Chargement unique atomique : grille + sélection dans le même callback
    this.loadParcelGridEditMode();

    setTimeout(() => { this.emitProgress(); }, 0);

    // Charger les autres données du formulaire (produits, opérateur, etc.)
    this.loadExistingDataDirectly();
  }

  /**
   * Méthode UNIQUE et ATOMIQUE pour le mode édition :
   * charge toutes les associations disponibles, puis marque celles du traitement
   * stocké comme sélectionnées, le tout dans un seul callback HTTP.
   * Aucune autre méthode ne doit toucher selectedParcelCultureIds en mode édition.
   */
  private loadParcelGridEditMode(): void {
    this.isLoadingParcelCultures = true;

    combineLatest([
      this.getParcellesCached(),
      this.http.testCropsLoading()
    ]).pipe(take(1)).subscribe({
      next: ([parcelles, cultures]: [any[], any[]]) => {
        // 1. Construire toutes les associations disponibles (grille complète)
        const parcelMap = new Map<string, any>(
          (parcelles || []).map((p: any) => [p.id_parcel, p])
        );
        const allAssociations: any[] = [];

        (cultures || []).forEach((culture: any) => {
          if (culture.parcels_id && Array.isArray(culture.parcels_id)) {
            culture.parcels_id.forEach((parcelId: string) => {
              const parcelInfo = parcelMap.get(parcelId);
              if (parcelInfo) {
                allAssociations.push({
                  uniqueId: `${parcelInfo.id_parcel}_${culture.crop_id}`,
                  parcel_id: parcelInfo.id_parcel,
                  parcel_name: parcelInfo.parcel_name,
                  parcel_area: parcelInfo.parcel_area,
                  parcel_area_unit_fr: parcelInfo.parcel_area_unit_fr || 'ha',
                  crop_id: culture.crop_id,
                  crop_name: culture.crop_name,
                  phytoweb_name: culture.phytoweb_name || culture.nomPhytoweb_crops_id || '',
                  eppo: culture.eppo || culture.EPPOCode || culture.eppo_code || '',
                  is_archived: culture.is_archived ?? culture.isArchived ?? false,
                  collection: culture.collection || ''
                });
              }
            });
          }
        });

        // 2. Depuis les parcelles du traitement stocké, retrouver les associations correspondantes
        const storedParcels: any[] = this.editingTreatment?.parcels_concerned || [];
        const selectedIds = new Set<string>();
        const selectedAssociations: any[] = [];

        storedParcels.forEach((stored: any) => {
          // Double matching : par ID d'abord, par nom ensuite (sécurité)
          const match = allAssociations.find((a: any) =>
            String(a.parcel_id) === String(stored.parcel_id) &&
            String(a.crop_id) === String(stored.crop_id)
          ) || allAssociations.find((a: any) =>
            a.parcel_name === stored.parcel_name &&
            String(a.crop_id) === String(stored.crop_id)
          );

          if (match) {
            selectedIds.add(match.uniqueId);
            selectedAssociations.push({
              ...match,
              // Préserver les surfaces et volumes du traitement original
              parcel_surface_treated: stored.parcel_surface_treated ?? match.parcel_area,
              standard_surface_treated: stored.standard_surface_treated ?? match.parcel_area,
              treatment_volume_applied: stored.treatment_volume_applied ?? 0,
              parcels_id: match.parcel_id,
              parcels_name: match.parcel_name,
            });
          }
        });

        // 3. Mise à jour atomique : grille + sélection en une seule opération
        this.rawAssociations = allAssociations;
        this.selectedParcelCultureIds = selectedIds;
        this.selectedParcelCultureAssociations = selectedAssociations;
        this.editModeSelectionLocked = true; // Verrouiller définitivement

        // 4. Mettre à jour le cache pour éviter un rechargement inutile
        const groupsMap2 = new Map<string, any>();
        allAssociations.forEach((a: any) => {
          const key = a.phytoweb_name || a.crop_name;
          if (!groupsMap2.has(key)) {
            groupsMap2.set(key, { phytoweb_name: key, crop_name: a.crop_name, associations: [] });
          }
          groupsMap2.get(key)!.associations.push(a);
        });
        this.parcelCultureGroupsCache$.next(Array.from(groupsMap2.values()));

        // 5. Afficher la grille
        this.displayGroupsSubject.next(this.buildDisplayGroups(allAssociations, this.groupByMode));
        this.isLoadingParcelCultures = false;
        this.hasTriedToLoadParcelCultures = true;
        this.triggerValidation();
      },
      error: () => {
        this.isLoadingParcelCultures = false;
        this.hasTriedToLoadParcelCultures = true;
      }
    });
  }

  /**
   * Charge directement les données existantes dans l'interface - APPROCHE SIMPLIFIÉE
   */
  private loadExistingDataDirectly(): void {
    if (!this.editingTreatment) return;
    
    // 🔧 ÉVITER LE RECHARGEMENT MULTIPLE DES DONNÉES
    if (this.dataLoaded) {
      return;
    }
    
    //  NOUVEAU SYSTÈME : Charger le traitement dans le draft
    this.currentTreatmentDraft = JSON.parse(JSON.stringify(this.editingTreatment)); // Deep copy
    
    // 🔧 CORRECTION UNIFIÉE : Toujours récupérer les données fraîches du serveur (surface ET bouillie)
    // Cela garantit qu'on a les valeurs les plus récentes de phyto_treatments_final.json
    if (this.editingTreatment.event_id) {
      // Récupérer le traitement depuis le serveur pour avoir les données à jour
      this.fetchFinalTreatmentByEventId(this.editingTreatment.event_id);

      // Continuer le chargement après la récupération serveur
      setTimeout(() => {
        //  SYNCHRONISER le draft avec editingTreatment mis à jour par le serveur
        this.currentTreatmentDraft = JSON.parse(JSON.stringify(this.editingTreatment));

        // 1. Charger le formulaire principal
        this.loadMainFormDirectly();
        // NOTE: les parcelles sont gérées par loadParcelGridEditMode() dans initEditMode()
        // 2. Pré-charger les données du traitement (produits + sauvegarde)
        this.preloadTreatmentData();
        // 3. Re-essayer l'opérateur si nécessaire
        setTimeout(() => {
          this.retryOperatorSelection();
        }, 150);
      }, 350);

      // Marquer les données comme chargées
      this.dataLoaded = true;
      return;
    }

    // Fallback si pas d'event_id : charger directement depuis editingTreatment
    // 1. Charger le formulaire principal immédiatement
    this.loadMainFormDirectly();

    // NOTE: les parcelles sont gérées par loadParcelGridEditMode() dans initEditMode()

    // 2. Pré-charger les données du traitement (produits + sauvegarde)
    this.preloadTreatmentData();

    // 3. Attendre un peu puis re-essayer l'opérateur si nécessaire
    setTimeout(() => {
      this.retryOperatorSelection();
    }, 500);

    // 🔧 MARQUER LES DONNÉES COMME CHARGÉES pour éviter la duplication
    this.dataLoaded = true;
    
  }

  /**
   * Charge le formulaire principal avec les données existantes
   */
  private loadMainFormDirectly(): void {
    if (!this.editingTreatment) return;
    
    // Charger directement dans le formulaire
    this.formTraitement.patchValue({
      type: this.editingTreatment.type || 'phyto_surface_treatment',
      date: (this.editingTreatment.date || this.editingTreatment.event_date) || new Date().toISOString().split('T')[0],
      target: this.editingTreatment.target || this.editingTreatment.ciblee || '',
      harvest_date: this.editingTreatment.harvest_date || '',
      produit_humidite: this.editingTreatment.produit_humidite || '',
      temperature: this.editingTreatment.temperature || '',
      vitesse_vent: this.editingTreatment.vitesse_vent || '',
      humidite_vent: this.editingTreatment.humidite_vent || '',
      autres_remarques: this.editingTreatment.autres_remarques || '',
      bbch: this.editingTreatment.bbch || '',
      event_hour: this.editingTreatment.event_hour || '',
      remark: (this.editingTreatment.remark || this.editingTreatment.remarque) || '',
      localized_treatment: (this.editingTreatment.localized_treatment || this.editingTreatment.traitementLocal) || 'Non',
      clean_flag: (this.editingTreatment.clean_flag || this.editingTreatment.effectuerNottoyage) || 'Non',
      operator_id: this.editingTreatment.operator_id || '',
      // 🔧 AJOUT: Charger les quantités de bouillie en mode modification
      treatment_total_quantity: this.editingTreatment.treatment_total_quantity || '',
      treatment_total_quantity_used: this.editingTreatment.treatment_total_quantity_used || '',
      decision_base: (this.editingTreatment.decision_base || this.editingTreatment.BaseDecision) || 'Non défini',
      effectiveness: (this.editingTreatment.effectiveness || this.editingTreatment.Efficacite) || 'Pas d\'avis'
    });
    
    // Synchroniser les dropdowns simples
    this.selectedBaseDecision = (this.editingTreatment.decision_base || this.editingTreatment.BaseDecision) || 'Non défini';
    this.selectedEfficacite = (this.editingTreatment.effectiveness || this.editingTreatment.Efficacite) || 'Pas d\'avis';

    // 🔧 CRITIQUE: Charger aussi dans les FormControls séparés pour le mode bouillie
    if (this.editingTreatment.treatment_total_quantity) {
      this.treatment_total_quantity.setValue(this.editingTreatment.treatment_total_quantity);
    }
    
    if (this.editingTreatment.treatment_total_quantity_used) {
      this.treatment_total_quantity_used.setValue(this.editingTreatment.treatment_total_quantity_used);
    }
    
    // Essayer de pré-sélectionner l'opérateur maintenant
    this.trySelectOperator();
    
  }

  /**
   * Essaie de sélectionner l'opérateur si les données sont disponibles
   */
  private trySelectOperator(): void {
    if (this.editingTreatment.operator_id && this.operators && this.operators.length > 0) {
      const operator = this.operators.find(op => op.operatorId === this.editingTreatment.operator_id);
      if (operator) {
        this.selectedOperator = operator;
      } else {
      }
    }
  }

  /**
   * Re-essaye la sélection d'opérateur après un délai (si les opérateurs se chargent plus tard)
   */
  private retryOperatorSelection(): void {
    if (this.editingTreatment.operator_id && !this.selectedOperator) {
      this.trySelectOperator();
    }
  }

  /**
   * Charge les parcelles directement dans le signal
   */
  private loadParcelsDirectly(): void {
    if (!this.editingTreatment?.parcels_concerned) {
      return;
    }
    
    const parcelData = this.editingTreatment.parcels_concerned || [];
    if (parcelData.length === 0) {
      return;
    }
    
    
    // 🔧 CORRECTION EPPOCode : Récupérer les données de culture pour avoir l'EPPOCode correct
    combineLatest([
      this.getParcellesCached(),
      this.http.testCropsLoading()
    ]).subscribe({
      next: ([parcelles, cultures]) => {
        const mappedAssociations: any[] = [];
        
        parcelData.forEach((parcel: any) => {
          const matchingParcel = parcelles.find(p => p.parcel_name === parcel.parcel_name);
          const parcel_id = matchingParcel?.id_parcel || parcel.parcel_id;
          const uniqueId = `${parcel_id}_${parcel.crop_id}`;
          
          // 🔑 CORRECTION CLÉE : Récupérer l'EPPOCode depuis les données de culture, pas de parcelle
          const matchingCulture = cultures.find((c: any) => c.crop_id === parcel.crop_id);
          const eppoCode = matchingCulture ? 
            (matchingCulture.eppo || matchingCulture.EPPOCode || matchingCulture.eppo_code || matchingCulture.code_eppo || '') :
            (parcel.eppo || parcel.EPPOCode || parcel.eppo_code || parcel.code_eppo || '');
          
          const association = {
            uniqueId: uniqueId,
            parcel_id: parcel_id,
            parcel_name: parcel.parcel_name,
            parcel_area: parcel.parcel_surface,
            parcel_area_unit_fr: parcel.surface_unit || 'ha',
            crop_id: parcel.crop_id,
            crop_name: parcel.crop_name || '',
            phytoweb_name: parcel.phytoweb_name || parcel.nomPhytoweb_crops_id || '',
            eppo: eppoCode,
            is_archived: parcel.is_archived ?? parcel.isArchived ?? matchingCulture?.is_archived ?? matchingCulture?.isArchived ?? false,
            collection: parcel.collection || matchingCulture?.collection || '',
            treatmentSurface: parcel.treatment_surface || parcel.parcel_surface,
            // 🥣 AJOUT POUR COMPATIBILITÉ AVEC saveParcelsToTempFile()
            surface_totale: parcel.parcel_surface,
            //  CORRECTION CRITIQUE : Préserver les surfaces du serveur EN MODE MODIFICATION
            parcel_surface_treated: parcel.parcel_surface_treated !== undefined && parcel.parcel_surface_treated !== null
              ? parcel.parcel_surface_treated
              : parcel.parcel_surface,
            //  MODE SURFACE : TOUJOURS préserver standard_surface_treated du serveur (jamais recalculer)
            standard_surface_treated: parcel.standard_surface_treated !== undefined && parcel.standard_surface_treated !== null
              ? parcel.standard_surface_treated
              : (parcel.parcel_surface * this.http.onReference(parcel.surface_unit || 'ha')),
            // 🚨 CORRECTION BOUILLIE : Préserver les valeurs exactes du serveur en mode bouillie
            treatment_volume_applied: (() => {
              const isBouillie = this.editingTreatment?.strategy === 'bouillie' || 
                                this.editingTreatment?.type?.includes('porridge') || 
                                (this.editingTreatment?.type && this.editingTreatment.type.includes('bouillie'));
              if (isBouillie) {
                return parcel.treatment_volume_applied; // VALEUR EXACTE DU SERVEUR
              } else {
                return parcel.treatment_volume_applied !== undefined && parcel.treatment_volume_applied !== null
                  ? Number(parcel.treatment_volume_applied)
                  : 0;
              }
            })()
          };
          
          mappedAssociations.push(association);
        });
        
        // Mettre à jour les associations sélectionnées
        this.selectedParcelCultureAssociations = mappedAssociations;
        this.selectedParcelCultureIds = new Set(mappedAssociations.map((a: any) => a.uniqueId));

        // 🔒 Verrouiller : aucun refresh async ne pourra plus écraser cette sélection
        this.editModeSelectionLocked = true;

        //  NOUVEAU SYSTÈME : Plus besoin de saveParcelsToTempFile() en mode modification
        // Les parcelles sont maintenant gérées directement dans currentTreatmentDraft
        
        //  EN MODE ÉDITION : Créer les groupes directement pour l'affichage
        // Créer d'abord les groupes de base avec les parcelles sélectionnées
        this.createParcelGroupsForEditMode(mappedAssociations);

        // Si rawAssociations est déjà peuplé (par le premier loadParcelCultureGroupsOptimized),
        // rafraîchir directement l'affichage avec la sélection correctement positionnée.
        // On NE rappelle PLUS loadParcelCultureGroupsOptimized() ici pour éviter que
        // syncSelectionFromStoredParcels() ne vienne écraser la sélection qu'on vient de set.
        if (this.rawAssociations.length > 0) {
          this.displayGroupsSubject.next(this.buildDisplayGroups(this.rawAssociations, this.groupByMode));
        }

        // 🔧 IMPORTANT : Déclencher la validation pour que les cartes s'affichent
        this.triggerValidation();
      },
    });
  }

  /**
   * Crée les groupes parcelles/cultures pour le mode édition
   * Utilise la méthode simple qui fonctionnait avant
   */
  private createParcelGroupsForEditMode(selectedAssociations: any[]): void {
    
    // Revenir à la méthode simple qui fonctionnait
    this.createFallbackGroups(selectedAssociations);
  }

  /**
   * Méthode de fallback si le chargement complet échoue
   */
  private createFallbackGroups(associations: any[]): void {
    const groupsMap = new Map<string, any>();
    
    associations.forEach(association => {
      const cropKey = association.phytoweb_name || association.nomPhytoweb_crops_id || association.crop_name || 'Culture inconnue';
      
      if (!groupsMap.has(cropKey)) {
        groupsMap.set(cropKey, {
          phytoweb_name: cropKey,
          crop_name: association.crop_name || cropKey,
          associations: []
        });
      }
      
      // Marquer comme sélectionné puisque c'est une association existante
      association.isSelected = true;
      groupsMap.get(cropKey)!.associations.push(association);
    });
    
    const groups = Array.from(groupsMap.values());
    
    // Utiliser setTimeout pour éviter ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      this.parcelCultureGroupsCache$.next(groups);
    }, 0);
  }

  /**
   * Charge les produits directement dans le signal
   */
  private loadProductsDirectly(): void {
    if (!this.editingTreatment?.treatment_composition) return;
    
    const products = this.editingTreatment.treatment_composition || [];
    if (products.length === 0) return;
    
    // Convertir au format signal
    const productsForSignal = products.map((product: any) => ({
      component_id: product.component_id,
      component_name: product.component_name,
      component_numaut: product.component_numaut,
      component_type: product.component_type,
      component_dose: product.component_dose,
      component_dose_unit: product.component_dose_unit,
      standard_component_dose: product.standard_component_dose,
      component_quantity: product.component_quantity,
      component_quantity_unity: product.component_quantity_unity,
      target: product.target
    }));
    
    // Mettre directement dans le signal
    this.http.signalGetDose.set(productsForSignal);
    
    //  NOUVEAU SYSTÈME : Plus besoin de reinjectProductsIntoTempBuffer()
    // Les produits sont gérés directement dans currentTreatmentDraft via le signal
  }

  /**
   * 🔄 Réinitialise complètement le state du composant pour un nouveau traitement
   * Appelée lors de la création d'un nouveau traitement après une validation
   */
  public resetComponentState(): void {
    // 1. Réinitialiser les flags de mode
    this.isEditMode = false;
    this.isEditModeSignal.set(false);
    this.editingTreatment = null;
    this.dataLoaded = false;
    this.editModeSelectionLocked = false;
    
    // 2. Réinitialiser le draft de traitement
    this.currentTreatmentDraft = null;
    this.initializeTreatmentDraft();
    
    // 3. Réinitialiser les sélections de parcelles
    this.selectedParcelCultureAssociations = [];
    this.selectedParcelCultureIds.clear();
    
    // 4. Vider les produits (signal local uniquement - phyto_treatments.json n'est plus utilisé)
    this.http.signalGetDose.set([]);
    
    // 5. Réinitialiser les formulaires
    this.initializeForms();
    
    // 6. Réinitialiser l'opérateur
    this.selectedOperator = null;

    // 6b. Réinitialiser les tags cible
    this.selectedCibles = [];
    this.cibleInputValue = '';

    // 6c. Réinitialiser les dropdowns simples
    this.selectedBaseDecision = 'Non défini';
    this.selectedEfficacite = 'Pas d\'avis';
    
    // 7. Réinitialiser les états d'édition inline
    this.currentEditingProductId = null;
    this.currentEditingProductIdBouillie = null;
    this.productForms.clear();
    
    // 8. Réinitialiser la recherche
    this.searchControl.setValue('');
    this.searchControlBouillie.setValue('');
    this.showSearchHint = true;
    this.hasSearchResults = false;
    
    // 9. Réinitialiser le cache des parcelles
    this.parcelCultureGroupsCache$.next([]);
    this.hasTriedToLoadParcelCultures = false;
    
    // 10. Réinitialiser l'étape
    this.traitement = "selection parcelles";
    this.previousStep = '';
    this.slideDirection = 'none';
  }

  /**
   * Mode création - comportement normal
   */
  private initCreateMode(): void {
    // 🔄 Réinitialiser complètement le state pour éviter de garder les données du précédent traitement
    this.resetComponentState();
    
    // 🔄 Déclencher le chargement des parcelles avec indicateur
    this.triggerParcelCultureLoading();
    
    // Reporter l'émission pour éviter ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      this.emitProgress();
    }, 0);
  }

  /**
   * Pré-remplit les données du traitement en mode modification
   */
  private preloadTreatmentData(): void {
    if (!this.editingTreatment) return;
    
    //  NOUVEAU: Initialiser currentTreatmentDraft avec les données d'édition
    if (this.isEditMode && !this.currentTreatmentDraft) {
      this.currentTreatmentDraft = JSON.parse(JSON.stringify(this.editingTreatment));
    }
    
    // 1. Détecter et pré-sélectionner le type
    this.detectTreatmentType();

    // 2. Pré-charger les parcelles : géré exclusivement par loadParcelsDirectly() qui
    // fait un matching complet (place_id + EPPOCode + surfaces). preloadParcels() est
    // supprimé ici car il produisait une sélection incomplète qui s'intercalait et
    // déclenchait un detectChanges() prématuré avant la sélection finale correcte.

    // 3. Pré-remplir le formulaire principal
    this.preloadMainForm();

    // 4. Pré-charger les produits existants dans le signal
    this.preloadExistingProducts();
  }

  /**
   * Détecte le type de traitement basé sur les données existantes
   * EN MODE MODIFICATION: Préserve toujours le type original sans auto-détection
   */
  private detectTreatmentType(): void {
    if (!this.editingTreatment) return;
    
    // 🔧 EN MODE MODIFICATION : Toujours préserver le type original
    if (this.isEditMode && this.editingTreatment.type) {
      this.formTraitement.patchValue({
        type: this.editingTreatment.type // Préserver le type original
      });
      return;
    }
    
    // 🆕 EN MODE CRÉATION : Auto-détection seulement si nécessaire
    const hasVolumeData = this.editingTreatment.treatment_volume_applied && 
                          this.editingTreatment.treatment_volume_applied > 0;
    const hasSurfaceData = this.editingTreatment.standard_total_surface_treated && 
                           this.editingTreatment.standard_total_surface_treated > 0;
    
    let treatmentType = 'phyto_surface_treatment'; // par défaut
    
    if (hasVolumeData && !hasSurfaceData) {
      treatmentType = 'phyto_porridge_treatment';
    } else if (hasSurfaceData) {
      treatmentType = 'phyto_surface_treatment';
    }

    this.formTraitement.patchValue({
      type: treatmentType
    });
  }

  /**
   * Pré-charge les parcelles concernées en utilisant le même format d'uniqueId que les options disponibles
   */
  private preloadParcels(): void {
    if (!this.editingTreatment?.parcels_concerned) {
      return;
    }
    
    
    const parcelData = this.editingTreatment.parcels_concerned || [];
    
    if (parcelData.length === 0) {
      return;
    }
    
    // Obtenir la liste des parcelles pour faire la correspondance
    this.getParcellesCached().subscribe(parcelles => {
      
      const mappedAssociations: any[] = [];
      
      parcelData.forEach((parcel: any, index: number) => {
        
        // Trouver la parcelle correspondante dans la liste actuelle pour obtenir le id_parcel
        const matchingParcel = parcelles.find(p => p.parcel_name === parcel.parcel_name);
        
        if (!matchingParcel) {
        }
        
        const parcel_id = matchingParcel?.id_parcel || parcel.parcel_id;
        const uniqueId = `${parcel_id}_${parcel.crop_id}`;
        
        if (!parcel.crop_id) {
        }
        
        const association = {
          uniqueId: uniqueId,
          parcel_id: parcel_id,
          parcel_name: parcel.parcel_name,
          parcel_area: parcel.parcel_surface,
          parcel_area_unit_fr: parcel.surface_unit || 'ha',
          crop_id: parcel.crop_id,
          crop_name: parcel.crop_name,
          phytoweb_name: parcel.phytoweb_name || parcel.nomPhytoweb_crops_id || '',
          is_archived: parcel.is_archived ?? parcel.isArchived ?? false,
          collection: parcel.collection || ''
        };
        
        mappedAssociations.push(association);
      });
      
      this.selectedParcelCultureAssociations = mappedAssociations;
      this.selectedParcelCultureIds = new Set(mappedAssociations.map((a: any) => a.uniqueId));
      
      // Maintenant que les parcelles sont préchargées, initialiser les groupes de parcelles
      if (this.isEditMode) {
        this.parcelCultureGroups$ = this.getParcelCultureGroups();
      }
      
      // Forcer la détection des changements pour que les cases à cocher se mettent à jour
      this.cdr.detectChanges();
    });
  }

  /**
   * Pré-remplit le formulaire principal
   */
  private preloadMainForm(): void {
    if (!this.editingTreatment) return;
    
    // Récupérer les bonnes propriétés depuis le traitement existant
    this.formTraitement.patchValue({
      type: this.editingTreatment.type || 'phyto_surface_treatment',
      date: this.formatDateForInput(new Date((this.editingTreatment.date || this.editingTreatment.event_date) || Date.now())),
      target: (this.editingTreatment.target || this.editingTreatment.ciblee) || '', // Récupérer le champ "ciblee" correct
      harvest_date: this.editingTreatment.harvest_date || '',
      produit_humidite: this.editingTreatment.produit_humidite || '',
      temperature: this.editingTreatment.temperature || '',
      vitesse_vent: this.editingTreatment.vitesse_vent || '',
      humidite_vent: this.editingTreatment.humidite_vent || '',
      autres_remarques: this.editingTreatment.autres_remarques || '',
      bbch: this.editingTreatment.bbch || '',
      event_hour: this.editingTreatment.event_hour || '',
      remark: (this.editingTreatment.remark || this.editingTreatment.remarque) || '',
      localized_treatment: (this.editingTreatment.localized_treatment || this.editingTreatment.traitementLocal) || 'Non',
      clean_flag: (this.editingTreatment.clean_flag || this.editingTreatment.effectuerNottoyage) || 'Non',
      operator_id: this.editingTreatment.operator_id || '',
      decision_base: (this.editingTreatment.decision_base || this.editingTreatment.BaseDecision) || 'Non défini',
      effectiveness: (this.editingTreatment.effectiveness || this.editingTreatment.Efficacite) || 'Pas d\'avis'
    });

    // Synchroniser les dropdowns simples
    this.selectedBaseDecision = (this.editingTreatment.decision_base || this.editingTreatment.BaseDecision) || 'Non défini';
    this.selectedEfficacite = (this.editingTreatment.effectiveness || this.editingTreatment.Efficacite) || 'Pas d\'avis';

    // Restaurer les tags cible depuis la chaîne sauvegardée
    this.initCiblesFromString((this.editingTreatment.target || this.editingTreatment.ciblee) || '');

    // Pré-sélectionner l'opérateur si un operator_id existe
    if (this.editingTreatment.operator_id) {
      this.preloadSelectedOperator(this.editingTreatment.operator_id);
    }

  }

  /**
   * Pré-sélectionne l'opérateur basé sur son ID
   */
  private preloadSelectedOperator(operatorId: string): void {
    if (this.operators && this.operators.length > 0) {
      const operator = this.operators.find(op => op.operatorId === operatorId);
      if (operator) {
        this.selectedOperator = operator;
      }
    } else {
      // Si les opérateurs ne sont pas encore chargés, attendre un peu et réessayer
      setTimeout(() => {
        if (this.operators && this.operators.length > 0) {
          const operator = this.operators.find(op => op.operatorId === operatorId);
          if (operator) {
            this.selectedOperator = operator;
          } 
        }
      }, 500);
    }
  }

  /**
   * Supprime le traitement en mode modification
   */
  onDeleteTreatment(): void {
    if (!this.isEditMode || !this.editingTreatment?.event_id) {
      return;
    }

    if (confirm('Êtes-vous sûr de vouloir supprimer ce traitement ? Cette action est irréversible.')) {
      
      // Fonction pour supprimer le traitement final après avoir nettoyé l'inventaire
      const deleteFinalTreatment = () => {
        this.http.deleteTreatmentFinal(this.editingTreatment.event_id).subscribe({
          next: (response: any) => {
            
            // Nettoyer les fichiers temporaires après suppression
            this.http.cleanupAfterTreatmentModification();
            
            //  Rafraîchissement ciblé uniquement des traitements (déjà déclenché dans deleteTreatmentFinal)
            // Fermer la popup immédiatement (plus de délai pour les animations)
            this.onClosePopupWithRefresh();
          },
          error: (error: any) => {
            alert('Erreur lors de la suppression du traitement: ' + (error.error?.message || error.message));
          }
        });
      };
      
      // Supprimer l'entrée de l'inventaire d'abord pour les traitements bouillie
      if (this.editingTreatment.strategy === 'bouillie') {
        this.http.removeInventoryForDeletedTreatment(this.editingTreatment.event_id).subscribe({
          next: (inventoryResult) => {
            deleteFinalTreatment();
          },
          error: (inventoryError) => {
            deleteFinalTreatment();
          }
        });
      } else if (this.editingTreatment.strategy === 'surface') {
        deleteFinalTreatment();
      } else {
        deleteFinalTreatment();
      }
    }
  }

  /**
   * Pré-charge les produits existants du traitement dans le signal
   */
  private preloadExistingProducts(): void {
    if (!this.editingTreatment?.treatment_composition) return;
    
    const products = this.editingTreatment.treatment_composition || [];
    
    
    // Convertir les produits au format attendu par le signal
    const productsForSignal = products.map((product: any) => ({
      component_id: product.component_id,
      component_name: product.component_name,
      component_numaut: product.component_numaut,
      component_type: product.component_type,
      component_dose: product.component_dose,
      component_dose_unit: product.component_dose_unit,
      standard_component_dose: product.standard_component_dose,
      component_quantity: product.component_quantity,
      component_quantity_unity: product.component_quantity_unity,
      target: product.target
    }));
    
    // Mettre les produits dans le signal pour qu'ils s'affichent
    this.http.signalGetDose.set(productsForSignal);
    
    //  NOUVEAU SYSTÈME : Plus besoin de sauvegarder dans phyto_treatments.json en mode modification
    // Les produits sont maintenant gérés directement dans currentTreatmentDraft via le signal
    // La validation finale fera un PUT direct vers phyto_treatments_final.json
    
    // Émettre la validation pour activer le bouton "Valider"
    this.emitValidation();
    
  }

  /**
   * Formate une date pour un input de type date
   */
  private formatDateForInput(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Retourne le texte du bouton selon l'étape actuelle
   */
  getButtonText(): string {
    switch (this.traitement) {
      case 'type de traitement':
        return this.isEditMode ? 'Valider et continuer' : 'Valider';
      case 'composition de mon traitement':
        return 'Valider et passer à la répartition';
      case 'volument de bouillie utilisee':
        return 'Valider et passer à la répartition';
      case 'repartition de mon traitement littre':
        return 'Terminer';
      default:
        return 'Valider';
    }
  }

  // === MÉTHODES EXISTANTES ESSENTIELLES ===

  onTypeTraitement(): void {
    // Depuis "type de traitement", aller vers composition selon le type sélectionné
    const type = this.formTraitement.value.type;
    
    // En mode édition, charger les données avant de progresser
    if (this.isEditMode && !this.dataLoaded) {
      this.loadExistingDataDirectly();
      // Marquer les données comme chargées pour éviter le rechargement
      this.dataLoaded = true;
    }
    
    if (type === "phyto_surface_treatment" || type === "phyto_quantity_treatment") {
      this.traitement = "composition de mon traitement";
    } else {
      // Pour les traitements de bouillie, aller d'abord vers l'étape de volume de bouillie
      this.traitement = "volument de bouillie utilisee";
    }
    this.emitProgress();
    
    // Emit progress and validation changes
    this.emitProgress();
    this.emitValidation();
  }

  onTraitement(): void {
    // Vérifier qu'au moins une association parcelle+culture est sélectionnée
    if (this.selectedParcelCultureAssociations.length === 0) {
      alert('Veuillez sélectionner au moins une parcelle avec sa culture');
      return;
    }

    //  NOUVEAU SYSTÈME : Mettre à jour le draft local au lieu de sauvegarder sur serveur
    const parcellesFormatted = this.selectedParcelCultureAssociations.map(association => ({
      parcel_id: association.parcel_id,
      parcel_name: association.parcel_name,
      parcel_surface: parseFloat(association.parcel_area) || 0,
      parcel_surface_treated: parseFloat(association.parcel_area) || 0,
      surface_unit: association.parcel_area_unit_fr || 'ha',
      standard_surface_treated: (parseFloat(association.parcel_area) || 0) * this.http.onReference(association.parcel_area_unit_fr || 'ha'),
      crop_id: association.crop_id,
      crop_name: association.crop_name,
      phytoweb_name: association.phytoweb_name || association.nomPhytoweb_crops_id || '',
      eppo: association.eppo || association.EPPOCode || association.eppo_code || association.code_eppo || '',
      is_archived: association.is_archived ?? association.isArchived ?? false,
      collection: association.collection || ''
    }));

    // ─── Répartition automatique de la surface entre cultures d'une même parcelle ───
    {
      const parcelIdCount = new Map<number, number>();
      for (const p of parcellesFormatted) {
        parcelIdCount.set(p.parcel_id, (parcelIdCount.get(p.parcel_id) || 0) + 1);
      }
      for (const p of parcellesFormatted) {
        const count = parcelIdCount.get(p.parcel_id) || 1;
        if (count <= 1) continue;
        const divided = parseFloat(((p.parcel_surface || 0) / count).toFixed(2));
        const dividedStd = parseFloat((divided * this.http.onReference(p.surface_unit || 'ha')).toFixed(6));
        p.parcel_surface_treated = divided;
        p.standard_surface_treated = dividedStd;
      }
    }

    // Mettre à jour le draft avec les parcelles sélectionnées
    this.currentTreatmentDraft.parcels_concerned = parcellesFormatted;
    
    // Recalculer la surface totale immédiatement
    this.recalculateTotalSurface();
    
    // Passer à l'étape suivante
    this.traitement = "type de traitement";
    this.emitProgress();
  }

  /**
   * Méthode optimisée qui utilise le cache pour éviter les recalculs
   */
  getParcelCultureGroups(): Observable<any[]> {
    //  SIMPLE : si cache vide, charger
    if (this.parcelCultureGroupsCache$.value.length === 0) {
      this.loadParcelCultureGroupsOptimized();

    }
    return this.parcelCultureGroups$;
  }

  onCheckedParcelCulture(event: any, association: any): void {
    if (event.target.checked) {
      this.selectedParcelCultureAssociations.push(association);
      this.selectedParcelCultureIds.add(association.uniqueId);
    } else {
      const index = this.selectedParcelCultureAssociations.findIndex(
        item => item.uniqueId === association.uniqueId
      );
      if (index > -1) {
        this.selectedParcelCultureAssociations.splice(index, 1);
      }
      this.selectedParcelCultureIds.delete(association.uniqueId);
    }
    
    // Déclencher la validation après chaque changement de sélection
    this.triggerValidation();
  }

  onClosePopup(): void {
    
    // Réactiver le scroll du background
    document.body.classList.remove('no-scroll');
    
    // Sauvegarder l'état edit mode avant réinitialisation
    const wasEditMode = this.isEditMode;
    
    // 🔄 NOUVEAU: Réinitialiser le state du composant pour préparer une nouvelle création
    this.resetComponentState();
    
    // Nettoyer les fichiers temporaires si on était en mode modification
    if (wasEditMode) {
      this.http.cleanupAfterTreatmentModification();
    }
    
    this.closePopup.emit();
  }

  /**
   * 🔄 Ferme la popup avec rafraîchissement automatique du dashboard
   */
  onClosePopupWithRefresh(): void {
    
    // Réactiver le scroll du background
    document.body.classList.remove('no-scroll');
    
    // Sauvegarder l'état edit mode avant réinitialisation
    const wasEditMode = this.isEditMode;
    
    // 🔄 NOUVEAU: Réinitialiser le state du composant pour préparer une nouvelle création
    this.resetComponentState();
    
    // Nettoyer les fichiers temporaires si on était en mode modification
    if (wasEditMode) {
      this.http.cleanupAfterTreatmentModification();
    }
    
    this.closePopupWithRefresh.emit();
  }

  // Stubs pour les méthodes nécessaires au template

  /**
   * Vérifie si une association parcelle+culture est déjà sélectionnée
   */
  isParcelCultureSelected(uniqueId: string): boolean {
    return this.selectedParcelCultureIds.has(uniqueId);
  }

  isGroupFullySelected(group: any): boolean {
    if (!group.associations || group.associations.length === 0) return false;
    return group.associations.every((a: any) => this.selectedParcelCultureIds.has(a.uniqueId));
  }

  toggleGroupSelection(group: any, event: any): void {
    const select = event.target.checked;
    for (const association of group.associations) {
      if (select && !this.selectedParcelCultureIds.has(association.uniqueId)) {
        this.selectedParcelCultureAssociations.push(association);
        this.selectedParcelCultureIds.add(association.uniqueId);
      } else if (!select && this.selectedParcelCultureIds.has(association.uniqueId)) {
        const idx = this.selectedParcelCultureAssociations.findIndex(a => a.uniqueId === association.uniqueId);
        if (idx > -1) this.selectedParcelCultureAssociations.splice(idx, 1);
        this.selectedParcelCultureIds.delete(association.uniqueId);
      }
    }
    this.triggerValidation();
  }

  /**
   * 📱 Toggle l'expansion d'un groupe de cultures sur mobile
   */
  /**
   * Synchronise selectedParcelCultureIds depuis les parcelles stockées dans le traitement en cours de modification.
   * Doit être appelée après que rawAssociations est peuplé et juste avant displayGroupsSubject.next().
   */
  private syncSelectionFromStoredParcels(): void {
    // Si la sélection a déjà été établie de façon définitive, on ne touche plus à rien.
    if (this.editModeSelectionLocked) return;
    if (!this.isEditMode || !this.editingTreatment?.parcels_concerned?.length) return;

    const storedParcels: any[] = this.editingTreatment.parcels_concerned;
    if (storedParcels.length === 0 || this.rawAssociations.length === 0) return;

    // Double clé de matching : par ID (place_id) ET par nom de parcelle
    // Cela garantit la robustesse même si les IDs ont changé ou diffèrent de type
    const storedById = new Set<string>(
      storedParcels.map((p: any) => `${String(p.parcel_id)}_${String(p.crop_id)}`)
    );
    const storedByName = new Set<string>(
      storedParcels.map((p: any) => `${String(p.parcel_name)}_${String(p.crop_id)}`)
    );

    // Map des données stockées pour préserver surfaces/volumes
    const storedDataMap = new Map<string, any>();
    storedParcels.forEach((p: any) => {
      storedDataMap.set(`${String(p.parcel_id)}_${String(p.crop_id)}`, p);
      storedDataMap.set(`${String(p.parcel_name)}_${String(p.crop_id)}`, p);
    });

    const newSelectedIds = new Set<string>();
    const newSelectedAssociations: any[] = [];

    this.rawAssociations.forEach((a: any) => {
      const byId = `${String(a.parcel_id)}_${String(a.crop_id)}`;
      const byName = `${String(a.parcel_name)}_${String(a.crop_id)}`;

      if (storedById.has(byId) || storedByName.has(byName)) {
        newSelectedIds.add(a.uniqueId);
        const stored = storedDataMap.get(byId) || storedDataMap.get(byName);
        newSelectedAssociations.push({
          ...a,
          // Préserver les surfaces et volumes existants du traitement sauvegardé
          parcel_surface_treated: stored?.parcel_surface_treated ?? a.parcel_area,
          standard_surface_treated: stored?.standard_surface_treated ?? a.parcel_area,
          treatment_volume_applied: stored?.treatment_volume_applied ?? 0,
          parcels_id: a.parcel_id,
          parcels_name: a.parcel_name,
        });
      }
    });

    // Mise à jour UNIQUEMENT si au moins un match trouvé
    // → si le matching échoue complètement, on conserve la sélection existante
    if (newSelectedIds.size > 0) {
      this.selectedParcelCultureIds = newSelectedIds;
      this.selectedParcelCultureAssociations = newSelectedAssociations;
    }
  }

  setGroupByMode(mode: 'phytoweb' | 'culture' | 'parcelle'): void {
    this.groupByMode = mode;
    this.expandedGroupsOnMobile.clear();
    this.mobileGroupsTouched = false; // VERSION MOBILE : le 1er groupe du nouveau regroupement s'ouvre
    this.displayGroupsSubject.next(this.buildDisplayGroups(this.rawAssociations, this.groupByMode));
  }

  private buildDisplayGroups(associations: any[], mode: string): any[] {
    if (!associations || associations.length === 0) return [];
    const groupsMap = new Map<string, any>();
    associations.forEach(assoc => {
      let key: string;
      let title: string;
      switch (mode) {
        case 'culture':
          key = String(assoc.crop_id || assoc.crop_name);
          title = assoc.crop_name;
          break;
        case 'parcelle':
          key = String(assoc.parcel_id || assoc.parcel_name);
          title = assoc.parcel_name;
          break;
        default: // phytoweb
          key = assoc.phytoweb_name || assoc.nomPhytoweb_crops_id || assoc.crop_name;
          title = assoc.phytoweb_name || assoc.nomPhytoweb_crops_id || assoc.crop_name;
      }
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { groupTitle: title, groupKey: key, associations: [] });
      }
      groupsMap.get(key)!.associations.push(assoc);
    });
    return Array.from(groupsMap.values());
  }

  toggleGroupOnMobile(groupId: string): void {
    // VERSION MOBILE : au premier appui, on part de l'état affiché (1er groupe ouvert)
    if (!this.mobileGroupsTouched) {
      this.mobileGroupsTouched = true;
      const first = this.parcelCultureGroupsData?.[0]?.groupKey;
      if (first && this.expandedGroupsOnMobile.size === 0) this.expandedGroupsOnMobile.add(first);
    }
    if (this.expandedGroupsOnMobile.has(groupId)) {
      this.expandedGroupsOnMobile.delete(groupId);
    } else {
      this.expandedGroupsOnMobile.add(groupId);
    }
  }

  /**
   * 📱 Vérifie si un groupe est ouvert sur mobile
   */
  isGroupExpandedOnMobile(groupId: string): boolean {
    // VERSION MOBILE : tant que l'utilisateur n'a ouvert/fermé aucun groupe, le 1er est ouvert
    if (!this.mobileGroupsTouched && this.expandedGroupsOnMobile.size === 0) {
      return groupId === this.parcelCultureGroupsData?.[0]?.groupKey;
    }
    return this.expandedGroupsOnMobile.has(groupId);
  }

  /** VERSION MOBILE : vrai dès que l'utilisateur a ouvert ou fermé un groupe lui-même. */
  private mobileGroupsTouched = false;

  /**
   * Transfert simple des données temporaires vers final et passage à l'étape suivante
   */
  private transferToFinalAndProceed(): void {
    // 🔧 SYNCHRONISER LES VALEURS DE VOLUME AVEC LE FORMULAIRE PRINCIPAL
    // Ceci est crucial pour le mode bouillie
    if (this.treatment_total_quantity && this.treatment_total_quantity.value) {
      this.formTraitement.patchValue({
        treatment_total_quantity: this.treatment_total_quantity.value
      });
    }
    
    if (this.treatment_total_quantity_used && this.treatment_total_quantity_used.value) {
      this.formTraitement.patchValue({
        treatment_total_quantity_used: this.treatment_total_quantity_used.value
      });
    }
    
    // 🔧 DÉTECTION AUTOMATIQUE DU MODE BASÉ SUR L'ÉTAPE ACTUELLE
    // ⚠️ DÉSACTIVÉE EN MODE MODIFICATION pour préserver le type original
    if (!this.isEditMode && 
        (this.traitement === "volument de bouillie utilisee" || 
         (this.treatment_total_quantity_used && this.treatment_total_quantity_used.value))) {
      // Mode bouillie détecté (SEULEMENT en mode création)
      this.formTraitement.patchValue({
        type: 'phyto_porridge_treatment'
      });
    }
    
    // Récupérer les métadonnées du formulaire pour TOUS les modes
    const formValue = this.formTraitement.value;
    
    const metadata = {
      ...formValue,
      operator_id: this.selectedOperator?.operatorId || '',
      operator_name: this.selectedOperator?.operatorName || '',
      operator_pl: this.selectedOperator?.operatorPhytolicence || ''
    };
    
    // 🔧 EN MODE MODIFICATION : Forcer le type original pour préserver l'intégrité
    if (this.isEditMode && this.editingTreatment?.type) {
      metadata.type = this.editingTreatment.type; // Forcer le type original
    }
 

    if (this.isEditMode) {
      // Mode modification : faire le transfert avec les métadonnées ET les données existantes
      const originalEventId = this.editingTreatment?.event_id;
      
      //  CORRECTION CRITIQUE : Envoyer les données complètes du traitement existant
      const completeModificationData = {
        cached_metadata: metadata,
        // Envoyer les données existantes du traitement pour préservation
        parcels_concerned: this.editingTreatment?.parcels_concerned || [],
        treatment_composition: this.editingTreatment?.treatment_composition || [],
        // Informations pour la mise à jour
        modification_mode: true,
        original_event_id: originalEventId
      };
      
      
      this.http.transferFromStep3ToStep4(true, originalEventId, completeModificationData).subscribe({
        next: (result) => {
          
          // Mettre à jour le signal avec le traitement final retourné par le serveur
          if (result.final_treatment) {
            
            // Mettre à jour le signal avec le traitement modifié
            const currentTreatments = this.getSignalTotalTrainement();
            const index = currentTreatments.findIndex((t: any) => t.event_id === originalEventId);
            if (index !== -1) {
              currentTreatments[index] = result.final_treatment;
              this.http.signalGetTableauGeneralTraitement.set([...currentTreatments]);
            }
            
            // ⚡ IMPORTANT : Normaliser et Mettre à jour editingTreatment pour l'affichage répartition
            try {
              const finalT = JSON.parse(JSON.stringify(result.final_treatment));
              // Ensure parcels have numeric treatment_volume_applied
              if (finalT.parcels_concerned && Array.isArray(finalT.parcels_concerned) && finalT.parcels_concerned) {
                // 🚨 CORRECTION BOUILLIE : Préserver les valeurs exactes du serveur en mode bouillie
                const isBouillie = finalT.strategy === 'bouillie' || finalT.type?.includes('porridge') || (finalT.type && finalT.type.includes('bouillie'));
                if (isBouillie) {
                  finalT.parcels_concerned.forEach((p: any, i: number) => {
                  });
                } else {
                  finalT.parcels_concerned = finalT.parcels_concerned.map((p: any) => ({
                    ...p,
                    treatment_volume_applied: p.treatment_volume_applied !== undefined && p.treatment_volume_applied !== null
                      ? Number(p.treatment_volume_applied)
                      : 0
                  }));
                }
              }
              // Add a frontend refresh key to force cache/templating updates
              finalT.frontend_refresh_key = Math.random().toString(36);
              this.editingTreatment = finalT;
              // Force template re-render so ngModel inputs get the updated values
              this.forceTemplateRefresh = true;
              this.cdr.detectChanges();
              setTimeout(() => {
                this.forceTemplateRefresh = false;
                this.cdr.detectChanges();
              }, 60);
            } catch (err) {
              // Fallback to raw value if anything goes wrong
              this.editingTreatment = result.final_treatment;
            }
          }
          
          // 🔧 CORRECTION CRITIQUE : Mettre à jour l'inventaire pour les modifications de traitement surface
          // En mode modification, l'inventaire doit être mis à jour avec les nouvelles données
          this.updateInventoryImmediately(result.final_treatment);
          
          this.traitement = "repartition de mon traitement littre";
          this.emitProgress();
        },
        error: (error) => {
          this.traitement = "repartition de mon traitement littre";
          this.emitProgress();
        }
      });
    } else {
      // Mode création : faire le transfert normal
      this.http.transferFromStep3ToStep4(false, undefined, {
        cached_metadata: metadata,
        parcels_concerned: this.currentTreatmentDraft?.parcels_concerned || [],
        treatment_composition: this.currentTreatmentDraft?.treatment_composition || []
      }).subscribe({
        next: (result) => {
          
          // Récupérer le traitement final avec les métadonnées depuis la réponse du serveur
          if (result.final_treatment) {
            // Normalize final_treatment to ensure numeric parcel volumes and force template refresh
            let finalToUse: any = result.final_treatment;
            try {
              finalToUse = JSON.parse(JSON.stringify(result.final_treatment));
              if (finalToUse.parcels_concerned && Array.isArray(finalToUse.parcels_concerned) && finalToUse.parcels_concerned) {
                // 🚨 CORRECTION BOUILLIE : Préserver les valeurs exactes du serveur en mode bouillie
                const isBouillie = finalToUse.strategy === 'bouillie' || finalToUse.type?.includes('porridge') || (finalToUse.type && finalToUse.type.includes('bouillie'));
                if (isBouillie) {
                  finalToUse.parcels_concerned.forEach((p: any, i: number) => {
                  });
                } else {
                  finalToUse.parcels_concerned = finalToUse.parcels_concerned.map((p: any) => ({
                    ...p,
                    treatment_volume_applied: p.treatment_volume_applied !== undefined && p.treatment_volume_applied !== null
                      ? Number(p.treatment_volume_applied)
                      : 0
                  }));
                }
              }
              finalToUse.frontend_refresh_key = Math.random().toString(36);
            } catch (err) {
              // ignore
            }

            // Mettre à jour le signal avec le traitement final retourné par le serveur
            const currentTreatments = this.getSignalTotalTrainement();
            currentTreatments.push(finalToUse);
            this.http.signalGetTableauGeneralTraitement.set([...currentTreatments]);

            // Force template re-render so ngModel inputs get the updated values after creation
            this.forceTemplateRefresh = true;
            this.cdr.detectChanges();
            setTimeout(() => {
              this.forceTemplateRefresh = false;
              this.cdr.detectChanges();
            }, 60);

            this.updateInventoryImmediately(finalToUse);
          }
          
          this.traitement = "repartition de mon traitement littre";
          this.emitProgress();
          
          // Charger également les données pour l'affichage (backup)
          this.loadFinalTreatmentData();
        },
        error: (error) => {
          alert('Erreur lors du transfert des données');
        }
      });
    }
  }
  
  /**
   * ⏭️ Passage à l'étape suivante avec calcul des surfaces
   * Méthode commune pour création ET modification
   */
  private proceedToNextStepHarmonious(): void {
    setTimeout(() => {
      this.http.ensureAllSurfacesCalculated().subscribe({
        next: (result) => {

          
          this.onRepartitionDeMonTraitement();

        },
        error: (error) => {          
          //  CORRECTION : Même en cas d'erreur, faire le transfert
          this.onRepartitionDeMonTraitement();
        }
      });
    }, 500);
  }

  // =======================================
  // FIN SYSTÈME HARMONIEUX - MÉTHODES UTILITAIRES
  // =======================================

  onRepartitionTraitement(): void {
    
    // Passage à l'étape de répartition
    this.traitement = "repartition de mon traitement littre";
    this.emitProgress();
    
    // 🔧 CORRECTION: Vérifier que le formulaire est correctement initialisé
    if (!this.formTraitement) {
      this.initializeForms();
    }
    
    // Charger les données depuis phyto_treatments_final.json pour l'affichage
    setTimeout(() => {
      this.loadFinalTreatmentData();
    }, 100); // Petit délai pour s'assurer que les forms sont prêts
  }

  /**
   * Charger les données du traitement depuis phyto_treatments_final.json
   */
  private loadFinalTreatmentData(): void {
    // If we're editing a specific treatment, prefer a direct GET of the final treatments
    // file filtered by event_id to ensure we read the server-persisted, consolidated data.
    if (this.isEditMode && this.editingTreatment?.event_id) {
      this.fetchFinalTreatmentByEventId(this.editingTreatment.event_id);
      return;
    }

    this.http.getAllTraitements().subscribe({
      next: (treatments: any[]) => {
        if (treatments && treatments.length > 0) {
          
          // Trouver le traitement de l'utilisateur (le plus récent)
          try {
            const userId = this.getUserId();
            
            // 🔄 CORRECTION: Filtrer avec une approche plus souple
            let userTreatments = treatments.filter((t: any) => {
              return t.id_user === userId || 
                     (userId.startsWith('temp_user_') && t.event_id && t.event_id.includes('transfer_'));
            });
            
            // Si aucun traitement trouvé avec l'ID utilisateur, prendre le plus récent
            if (userTreatments.length === 0) {
              userTreatments = treatments.slice(-1); // Prendre le dernier
            }
            
            
            if (userTreatments.length > 0) {
              const latestTreatment = userTreatments.sort((a: any, b: any) => 
                new Date(b.created_at || b.transferred_at || 0).getTime() - new Date(a.created_at || a.transferred_at || 0).getTime()
              )[0];
              
              
              // 🔄 MISE À JOUR: Mettre à jour le signal avec le traitement chargé pour l'affichage en répartition
              this.http.signalGetTableauGeneralTraitement.set([latestTreatment]);
              
              // Mettre à jour le formulaire avec les données du traitement
              this.updateFormWithTreatmentData(latestTreatment);
              
            } else {
              this.http.signalGetTableauGeneralTraitement.set([]);
            }
          } catch (error) {
            // 🔄 CORRECTION: Continuer même en cas d'erreur ID utilisateur
            if (treatments.length > 0) {
              const latestTreatment = treatments[treatments.length - 1];
              this.http.signalGetTableauGeneralTraitement.set([latestTreatment]);
              this.updateFormWithTreatmentData(latestTreatment);
            }
          }
        } else {
          this.http.signalGetTableauGeneralTraitement.set([]);
        }
      },
      error: (error: any) => {
        this.http.signalGetTableauGeneralTraitement.set([]);
      }
    });
  }

  /**
   * Fetch a single finalized treatment directly from the final treatments file by event_id.
   * This bypasses caches and ensures we use the server-persisted consolidated values.
   */
  private fetchFinalTreatmentByEventId(eventId: string, attempt: number = 0): void {
    if (!eventId) return;
    
    //  PROTECTION: Éviter les appels multiples pour le même eventId
    if (this.fetchingTreatmentIds.has(eventId)) {
      return;
    }
    
    // Marquer cet eventId comme en cours de traitement
    this.fetchingTreatmentIds.add(eventId);

    const maxRetries = 3; // ⚡ RÉDUIT pour éviter la boucle infinie
    const delays = [500, 1000, 2000]; // ms - délais plus longs

    this.httpClient.get<any>(`${environment.apiRegistre}/phyto_treatments/${eventId}`).pipe(
      map(treatmentFromApi)
    ).subscribe({
      next: (found: any) => {
        //  Libérer la protection une fois terminé
        this.fetchingTreatmentIds.delete(eventId);

        // Normalize numeric parcel volumes and ensure structure
        const finalT = JSON.parse(JSON.stringify(found));
        if (finalT.parcels_concerned && Array.isArray(finalT.parcels_concerned) && finalT.parcels_concerned) {
          finalT.parcels_concerned.forEach((p: any, i: number) => {
          });
          
          // 🚨 DANGER ZONE : Cette conversion Number() peut CHANGER les valeurs !
          // EN MODE BOUILLIE : Utiliser EXACTEMENT les valeurs du serveur SANS conversion
          const isBouillie = finalT.strategy === 'bouillie' || finalT.type?.includes('porridge') || (finalT.type && finalT.type.includes('bouillie'));
          if (isBouillie) {
            finalT.parcels_concerned.forEach((p: any, i: number) => {
            });
          } else {
            finalT.parcels_concerned = finalT.parcels_concerned.map((p: any) => ({
              ...p,
              treatment_volume_applied: p.treatment_volume_applied !== undefined && p.treatment_volume_applied !== null
                ? Number(p.treatment_volume_applied)
                : 0
            }));
            
            finalT.parcels_concerned.forEach((p: any, i: number) => {
            });
          }
        }

        // Recreate the editingTreatment and reset template flags
        //  CORRECTION ExpressionChangedAfterItHasBeenCheckedError:
        // Utiliser setTimeout plus long pour éviter les erreurs de détection de changements
        setTimeout(() => {
          this.forceTemplateRefresh = false;
          this.editingTreatment = JSON.parse(JSON.stringify(finalT));
          
          //  CRITIQUE : Mettre à jour AUSSI le currentTreatmentDraft avec les données fraîches
          this.currentTreatmentDraft = JSON.parse(JSON.stringify(finalT));
          
          
          //  FORCE INVALIDATION: Reset de TOUS les caches pour mode bouillie
          const isBouillie = this.editingTreatment.strategy === 'bouillie' || 
                            this.editingTreatment.type === 'phyto_porridge_treatment' ||
                            this.getTreatmentType() === 'phyto_porridge_treatment';
          
          if (isBouillie) {
            // Force la destruction de TOUS les caches
            this.templateRefreshKey = '';
            this.treatmentDataCache = [];
            
            // Log des données exactes du serveur qui doivent s'afficher
            if (this.editingTreatment.parcels_concerned?.length) {
              this.editingTreatment.parcels_concerned.forEach((p: any, i: number) => {
              });
            }
          }
          
          // Inject frontend keys to force template re-render
          this.editingTreatment.frontend_updated_at = new Date().toISOString();
          this.editingTreatment.frontend_refresh_key = Math.random().toString(36);

          // Ensure forms reflect the values
          this.updateFormWithTreatmentData(this.editingTreatment);

          //  CORRECTION: Éviter ExpressionChangedAfterItHasBeenCheckedError
          // Utiliser NgZone.runOutsideAngular pour les changements async
          this.cdr.markForCheck();
          
          // If we were in the middle of a repartition flow, proceed now
          try {
            if (this.traitement && this.traitement.toString().toLowerCase().includes('repartition')) {
              setTimeout(() => this.proceedWithRepartition(), 100);
            }
          } catch (err) {
            // noop
          }
        }, 100); // ⚡ DÉLAI AUGMENTÉ pour stabilité Angular
      },
      error: (error: any) => {
        //  Libérer la protection en cas d'erreur aussi
        this.fetchingTreatmentIds.delete(eventId);
        
        if (attempt < maxRetries) {
          const delay = delays[Math.min(attempt, delays.length - 1)];
          setTimeout(() => this.fetchFinalTreatmentByEventId(eventId, attempt + 1), delay);
          return;
        }
        this.http.signalGetTableauGeneralTraitement.set([]);
      }
  });
  }

  /**
   * Update the main form fields from a treatment object (small helper)
   */
  private updateFormWithTreatmentData(treatment: any): void {
    if (!treatment || !this.formTraitement) return;
    if (treatment.remarque) this.formTraitement.patchValue({ remark: treatment.remark || treatment.remarque }, { emitEvent: false });
    if (treatment.ciblee) this.formTraitement.patchValue({ target: treatment.target || treatment.ciblee }, { emitEvent: false });
    if (treatment.bbch) this.formTraitement.patchValue({ bbch: treatment.bbch }, { emitEvent: false });
  }

  /**
   * Force le rechargement complet des données du serveur pour un traitement bouillie
   * Utilisé quand le tableau de répartition doit afficher les données exactes du serveur
   */
  public forceReloadBouillieData(callback?: () => void): void {
    if (!this.isEditMode || !this.editingTreatment || !this.editingTreatment.event_id) {
      if (callback) callback();
      return;
    }


    // Fetch direct des données du serveur
    this.httpClient.get<any>(`${environment.apiRegistre}/phyto_treatments/${this.editingTreatment.event_id}`).pipe(
      map(treatmentFromApi),
      catchError(() => of(null))
    ).subscribe({
      next: (found: any) => {
        if (!found) {
          if (callback) callback();
          return;
        }

        // Remplacer complètement editingTreatment avec les données du serveur
        this.editingTreatment = JSON.parse(JSON.stringify(found));

        // S'assurer que les volumes sont numériques
        if (this.editingTreatment.parcels_concerned?.length) {
          this.editingTreatment.parcels_concerned = this.editingTreatment.parcels_concerned.map((p: any) => ({
            ...p,
            treatment_volume_applied: Number(p.treatment_volume_applied) || 0
          }));

          this.editingTreatment.parcels_concerned.forEach((p: any, i: number) => {
          });
        }

        // Forcer le rafraîchissement du template
        this.editingTreatment.frontend_refresh_key = Math.random().toString(36);
        this.editingTreatment.frontend_updated_at = new Date().toISOString();

        // Réinitialiser le cache de données du template
        this.templateRefreshKey = '';
        this.treatmentDataCache = [];

        // Forcer la détection des changements
        this.cdr.markForCheck();
        this.cdr.detectChanges();

        
        // Exécuter le callback si fourni
        if (callback) callback();
      },
      error: (error: any) => {
        if (callback) callback();
      }
    });
  }

  // Small stubs for methods referenced elsewhere. Full implementations live elsewhere in the file
  private loadCiblesData(): void {
    // Load autocomplete targets for cible field from distant server index/enemies.json
    
    try {
      this.httpClient.get<any[]>(environment.apiRegistre + '/index/enemies').subscribe({
        next: (cibles) => {
          this.ciblesList = (cibles || []).map((c: any) => c?.targetName ?? c);
        },
        error: (err) => {
          // Fallback: créer quelques suggestions par défaut (chaînes simples)
          this.ciblesList = [
            'Adventices',
            'Maladies', 
            'Ravageurs',
            'Insectes',
            'Pucerons',
            'Limaces'
          ];
        }
      });
    } catch (e) {
      this.ciblesList = [];
    }
  }

  private loadOperators(): void {

    try {
      this.httpClient.get<any[]>(environment.apiRegistre + '/operators').subscribe({
        next: ops => {
          this.operators = ops || [];
          // 🔧 Résout la présélection de l'opérateur maintenant que la liste est chargée :
          // initEditMode() s'exécute AVANT cet appel HTTP (loadOperators est appelé après
          // dans ngOnInit), donc trySelectOperator()/preloadSelectedOperator() tournent
          // souvent avec this.operators encore vide. On résout ici de façon fiable, sans
          // dépendre du retry ponctuel à 500ms utilisé ailleurs.
          const pendingOperatorId = this.editingTreatment?.operator_id;
          if (pendingOperatorId && !this.selectedOperator) {
            const operator = this.operators.find(op => op.operatorId === pendingOperatorId);
            if (operator) {
              this.selectedOperator = operator;
              this.cdr.detectChanges();
            }
          }
        },
        error: (err) => {
          this.operators = [];
        }
      });
    } catch (e) {
      this.operators = [];
    }
  }

  // ===== Template helpers for 'cible' multi-tag autocomplete =====
  public showCibleSuggestions: boolean = false;
  public filteredCibles: any[] = [];
  // List of possible 'cible' suggestions (populated by loadCiblesData)
  public ciblesList: any[] = [];
  // Tags validés
  public selectedCibles: string[] = [];
  // Valeur courante du champ texte
  public cibleInputValue: string = '';

  /** Filtre les suggestions selon la saisie courante */
  public onCibleInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = (target?.value ?? '').trim().toLowerCase();
    if (!value) {
      this.filteredCibles = [];
      this.showCibleSuggestions = false;
      return;
    }
    const pool = Array.isArray(this.ciblesList) ? this.ciblesList : [];
    this.filteredCibles = pool
      .filter((c: any) => {
        if (typeof c === 'string') return c.toLowerCase().includes(value);
        return (c?.label?.toLowerCase().includes(value)) || (c?.nom?.toLowerCase().includes(value));
      })
      .filter((c: any) => !this.selectedCibles.includes(this.getCibleDisplayText(c)));
    this.showCibleSuggestions = this.filteredCibles.length > 0;
  }

  /** Rouvre les suggestions si du texte est présent */
  public onCibleFocus(): void {
    if (this.cibleInputValue.trim().length > 0) {
      const fakeEvent = { target: { value: this.cibleInputValue } } as unknown as Event;
      this.onCibleInput(fakeEvent);
    }
  }

  public onCibleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.showCibleSuggestions && this.filteredCibles.length > 0) {
        this.selectCibleSuggestion(this.filteredCibles[0]);
      } else if (this.cibleInputValue.trim()) {
        this.addCibleTag(this.cibleInputValue.trim());
      }
    } else if (event.key === 'Backspace' && !this.cibleInputValue && this.selectedCibles.length > 0) {
      this.removeCibleTag(this.selectedCibles.length - 1);
    }
  }

  public onCibleBlur(): void {
    setTimeout(() => {
      if (this.cibleInputValue.trim()) {
        this.addCibleTag(this.cibleInputValue.trim());
      }
      this.showCibleSuggestions = false;
      this.cdr.detectChanges();
    }, 150);
  }

  public selectCibleSuggestion(suggestion: any): void {
    if (!suggestion) return;
    this.addCibleTag(this.getCibleDisplayText(suggestion));
    this.showCibleSuggestions = false;
  }

  public addCibleTag(value: string): void {
    const trimmed = value.trim();
    if (!trimmed || this.selectedCibles.includes(trimmed)) return;
    this.selectedCibles.push(trimmed);
    this.cibleInputValue = '';
    this.filteredCibles = [];
    this.showCibleSuggestions = false;
    this.syncCibleToForm();
  }

  public removeCibleTag(index: number): void {
    this.selectedCibles.splice(index, 1);
    this.syncCibleToForm();
  }

  private syncCibleToForm(): void {
    if (this.formTraitement) {
      this.formTraitement.patchValue({ target: this.selectedCibles.join(' ; ') }, { emitEvent: false });
    }
  }

  /** Initialise les tags depuis une chaîne sauvegardée (ex: "a ; b ; c") */
  public initCiblesFromString(value: string): void {
    if (!value) { this.selectedCibles = []; return; }
    this.selectedCibles = value.split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  }

  public getCibleDisplayText(suggestion: any): string {
    if (typeof suggestion === 'string') return suggestion;
    return suggestion?.label || suggestion?.nom || String(suggestion);
  }

  public truncateTagLabel(tag: string, max: number = 38): string {
    return tag.length > max ? tag.slice(0, max) + '…' : tag;
  }

  // ── Dropdowns Base décisionnelle + Efficacité ─────────────────────────
  public readonly BASE_DECISION_OPTIONS: string[] = [
    'Observation visuelle dans la culture',
    'Système d\'avertissement',
    'Encadrement individuel',
    'Réflexion sur base de données climatologiques',
    'Analyse d\'un échantillon atteint par la maladie',
    'Réflexion sur base du cycle du nuisible',
    'Non défini'
  ];

  public readonly EFFICACITE_OPTIONS: string[] = [
    'Le traitement a été efficace',
    'Le traitement n\'a pas été efficace',
    'Pas d\'avis'
  ];

  public selectedBaseDecision: string = 'Non défini';
  public showBaseDecisionDropdown: boolean = false;

  public toggleBaseDecisionDropdown(): void {
    this.showBaseDecisionDropdown = !this.showBaseDecisionDropdown;
  }

  public closeBaseDecisionDropdown(): void {
    setTimeout(() => { this.showBaseDecisionDropdown = false; }, 150);
  }

  public selectBaseDecision(value: string): void {
    this.selectedBaseDecision = value;
    this.showBaseDecisionDropdown = false;
    if (this.formTraitement) {
      this.formTraitement.patchValue({ decision_base: value }, { emitEvent: false });
    }
  }

  public selectedEfficacite: string = 'Pas d\'avis';
  public showEfficaciteDropdown: boolean = false;

  public toggleEfficaciteDropdown(): void {
    this.showEfficaciteDropdown = !this.showEfficaciteDropdown;
  }

  public closeEfficaciteDropdown(): void {
    setTimeout(() => { this.showEfficaciteDropdown = false; }, 150);
  }

  public selectEfficacite(value: string): void {
    this.selectedEfficacite = value;
    this.showEfficaciteDropdown = false;
    if (this.formTraitement) {
      this.formTraitement.patchValue({ effectiveness: value }, { emitEvent: false });
    }
  }

  // Note: `operators` and `selectedOperator` are declared earlier; reuse them
  public showOperatorDropdown: boolean = false;

  public getSelectedOperator(): any {
    return this.selectedOperator || null;
  }

  public toggleOperatorDropdown(): void {
    this.showOperatorDropdown = !this.showOperatorDropdown;
  }

  public closeOperatorDropdown(): void {
    setTimeout(() => { this.showOperatorDropdown = false; }, 150);
  }

  public selectOperator(operator: any): void {
    if (!operator) return;
    this.selectedOperator = operator;
    this.showOperatorDropdown = false;
    if (this.formTraitement) {
      this.formTraitement.patchValue({
        operator_id: operator.operatorId || '',
        operator_name: operator.operatorName || ''
      }, { emitEvent: false });
    }
  }

  public clearOperator(): void {
    this.selectedOperator = null;
    this.showOperatorDropdown = false;
    if (this.formTraitement) {
      this.formTraitement.patchValue({ operator_id: '', operator_name: '' }, { emitEvent: false });
    }
  }

  private initializeTreatmentTypeWatcher(): void {
    // noop stub to keep previous behavior (full watcher omitted)
  }

  private recalculateForBouillieMode(): void {
    // Simple guard used by observers; full recalculation handled by dedicated methods
    if (!this.isEditMode && !this.editingTreatment) return;
    const v = parseFloat(this.treatment_total_quantity_used?.value) || 0;
    if (v > 0) {
      this.formTraitement.patchValue({ treatment_total_quantity_used: String(v) }, { emitEvent: false });
    }
  }

  /**
   * 🆔 Récupère l'ID utilisateur depuis le localStorage
   */
  private getUserId(): string {
    const userId = localStorage.getItem('Ref');
    
    if (userId && userId !== 'null' && userId !== 'undefined' && userId.trim() !== '') {
      return userId;
    }
    
    // Si en mode modification, utiliser l'ID du traitement existant
    if (this.isEditMode && this.editingTreatment?.id_user) {
      return this.editingTreatment.id_user;
    }
    
    // Fallback temporaire
    return 'temp_user_' + Date.now();
  }

  /**
   *  FINALISATION SIMPLIFIÉE : Récupération et pré-remplissage des métadonnées depuis le traitement
   */
  onRepartitionDeMonTraitement(): void {
    
    // 🔧 EN MODE MODIFICATION : Récupérer les données consolidées du backend AVANT la répartition
    if (this.isEditMode && this.editingTreatment) {
      
      // 🥣 STRATÉGIE BOUILLIE : Ne PAS recharger si currentTreatmentDraft existe avec des données
      if (this.editingTreatment.strategy === 'bouillie' || 
          this.editingTreatment.type === 'phyto_porridge_treatment' ||
          this.getTreatmentType() === 'phyto_porridge_treatment') {
        
        // 🔧 CORRECTION CRITIQUE : Si currentTreatmentDraft existe, l'utiliser directement
        if (this.currentTreatmentDraft && this.currentTreatmentDraft.parcels_concerned?.length) {
          
          // Synchroniser editingTreatment avec le draft
          this.editingTreatment = this.currentTreatmentDraft;
          
          // Passer directement à l'affichage sans rechargement
          this.proceedWithRepartition();
          return;
        }
        
        // Sinon, recharger depuis le serveur (première fois seulement)
        const eventIdToRefresh = this.editingTreatment.event_id;
        
        // INVALIDATION TOTALE de tout cache AVANT rechargement
        this.templateRefreshKey = '';
        this.treatmentDataCache = [];
        this.forceTemplateRefresh = true;
        
        
        this.fetchFinalTreatmentByEventId(eventIdToRefresh);
        
        // Attendre que les données soient chargées puis procéder
        setTimeout(() => {
          
          if (this.editingTreatment?.parcels_concerned?.length) {
            this.editingTreatment.parcels_concerned.forEach((p: any, i: number) => {
            });
          }
          
          // Procéder IMMÉDIATEMENT à l'affichage du tableau
          this.proceedWithRepartition();
        }, 200);
        
        return; // Sortir ici pour le mode bouillie
      }
      
      // Le traitement existe déjà côté serveur (mode édition) : les valeurs standardisées
      // sont recalculées automatiquement à l'écriture, plus besoin d'un appel de
      // consolidation séparé — on recharge simplement l'état persisté avant de continuer.
      const eventIdToRefresh = this.editingTreatment.event_id;
      this.forceTemplateRefresh = true;
      this.editingTreatment = null;
      this.cdr.detectChanges();
      this.fetchFinalTreatmentByEventId(eventIdToRefresh);
      setTimeout(() => {
        this.forceTemplateRefresh = false;
        this.proceedWithRepartition();
      }, 200);

      return; // Sortir ici, proceedWithRepartition() sera appelé après la récupération
    }
    
    // Mode création : Procéder directement
    this.proceedWithRepartition();
  }

  private proceedWithRepartition(): void {
    
    // 🔧 EN MODE CRÉATION : Pré-charger les produits du signal dans le draft et calculer les volumes
    if (!this.isEditMode && this.currentTreatmentDraft) {
      const products = this.getSignalDose();
      if (products && products.length > 0) {
        this.currentTreatmentDraft.treatment_composition = products;
      }
      this.recalculateTotalSurface();
      this.recalculateComponentQuantities();
    }

    // 🔧 EN MODE BOUILLIE : Vérifier qu'on a bien les données fraîches
    if (this.isEditMode && this.editingTreatment) {
      const isBouillie = this.editingTreatment.strategy === 'bouillie' || 
                        this.editingTreatment.type === 'phyto_porridge_treatment' ||
                        this.getTreatmentType() === 'phyto_porridge_treatment';
      
      if (isBouillie) {
    
        
        // 🔧 INVALIDATION FORCÉE du cache pour mode bouillie
        this.templateRefreshKey = '';
        this.treatmentDataCache = [];
        
        // Affichage détaillé des volumes pour vérification
        if (this.editingTreatment.parcels_concerned?.length) {
          this.editingTreatment.parcels_concerned.forEach((p: any, i: number) => {
          });
        }
        
        // Force une nouvelle détection des changements pour utiliser les données fraîches
        this.cdr.detectChanges();
      }
    }
    
    // Récupérer le traitement actuel (soit en modification avec données à jour, soit le dernier créé)
    const currentTreatments = this.getCurrentTreatment();
    if (!currentTreatments || currentTreatments.length === 0) {
      alert('Erreur: Aucun traitement disponible pour la répartition');
      return;
    }

    const treatment = currentTreatments[0];
    
    
    // Pré-remplir le formulaire avec les métadonnées du traitement
    if (treatment) {
      this.formTraitement.patchValue({
        target: (treatment.target || treatment.ciblee) || '',
        remark: (treatment.remark || treatment.remarque) || '',
        operator_id: treatment.operator_id || '',
        operator_name: treatment.operator_name || '',
        operator_phytolicence: (treatment.operator_phytolicence || treatment.operator_pl) || '',
        bbch: treatment.bbch || '',
        event_hour: treatment.event_hour || '',
        date: (treatment.date || treatment.event_date) || '',
        clean_flag: (treatment.clean_flag || treatment.effectuerNottoyage) || '',
        localized_treatment: (treatment.localized_treatment || treatment.traitementLocal) || '',
        // 🔧 AJOUT: Charger les quantités de bouillie pour la répartition
        treatment_total_quantity: treatment.treatment_total_quantity || '',
        treatment_total_quantity_used: treatment.treatment_total_quantity_used || ''
      });
      
      // 🔧 CRITIQUE: Charger aussi dans les FormControls séparés pour la répartition
      if (treatment.treatment_total_quantity) {
        this.treatment_total_quantity.setValue(treatment.treatment_total_quantity);
      }
      
      if (treatment.treatment_total_quantity_used) {
        this.treatment_total_quantity_used.setValue(treatment.treatment_total_quantity_used);
      }
      
    }
    
    // Passer à l'étape de répartition
    this.traitement = "repartition de mon traitement littre";
    this.emitProgress();
  }

  // === MÉTHODES DE FINALISATION SIMPLIFIÉE ===

  onTerminerTraitement(): void {
    
    const treatmentType = this.currentTreatmentDraft.type || 'phyto_surface_treatment';

    //  NOUVEAU SYSTÈME : Récupérer les produits du signal et les mettre dans le draft
    const products = this.getSignalDose();
    if (products && products.length > 0) {
      if ((treatmentType === 'phyto_quantity_treatment' || treatmentType === 'phyto_surface_treatment') && this.isEditMode) {
        // Mode quantité/surface en édition : le DRAFT est la source de vérité pour les produits déjà
        // présents (recalculés en direct via les changements de surface/dose par
        // recalculateComponentQuantities/recalculateDosesFromQuantity, qui ne touchent jamais le
        // signal). Le signal ne sert qu'à détecter les ajouts et suppressions de produits — sinon
        // on écraserait les valeurs à jour du draft par le snapshot chargé une seule fois à
        // l'ouverture du formulaire (preloadExistingProducts).
        const draftComposition: any[] = this.currentTreatmentDraft.treatment_composition || [];
        const signalIds = new Set(products.map((p: any) => p.component_id));
        const draftIds = new Set(draftComposition.map((p: any) => p.component_id));
        const kept = draftComposition.filter((p: any) => signalIds.has(p.component_id));
        const added = products.filter((p: any) => !draftIds.has(p.component_id));
        this.currentTreatmentDraft.treatment_composition = [...kept, ...added];
      } else {
        this.currentTreatmentDraft.treatment_composition = products;
      }
    }
    
    // 🔧 CORRECTION CRITIQUE : Sauvegarder les volumes manuels AVANT recalcul
    const manualVolumes = new Map<string, number>();
    if (treatmentType === 'phyto_porridge_treatment' && this.currentTreatmentDraft.parcels_concerned?.length) {
      // Sauvegarder les volumes qui ont été modifiés manuellement
      this.currentTreatmentDraft.parcels_concerned.forEach((parcel: any) => {
        const key = `${parcel.parcel_id}_${parcel.crop_id || ''}`;
        if (parcel.treatment_volume_applied !== undefined && parcel.treatment_volume_applied !== null) {
          manualVolumes.set(key, parseFloat(parcel.treatment_volume_applied) || 0);
        }
      });
      
    }
    
    // Finaliser tous les calculs locaux avec ordre correct selon le mode
    this.recalculateTotalSurface();
    
    if (treatmentType === 'phyto_quantity_treatment') {
      // Mode quantité : les quantités sont toujours fixes, on recalcule uniquement les doses
      this.recalculateComponentQuantities();
      // recalculateDistribution préserve les parcel_quantity_applied déjà définis (≠ undefined/null)
      this.recalculateDistribution();
    } else if (treatmentType === 'phyto_porridge_treatment') {
      // Mode bouillie : NE PAS recalculer la distribution pour préserver les volumes manuels
      // Seulement recalculer le total utilisé basé sur les volumes existants
      if (this.currentTreatmentDraft.parcels_concerned?.length) {
        const totalUsed = this.currentTreatmentDraft.parcels_concerned.reduce((sum: number, parcel: any) => {
          return sum + (parseFloat(parcel.treatment_volume_applied) || 0);
        }, 0);
        this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalUsed.toFixed(2));
      }
      
      // 🔧 CORRECTION : Vérifier si des produits utilisent une unité de quantité totale
      const hasAbsoluteQuantityProducts = this.hasAbsoluteQuantityProducts();
      if (hasAbsoluteQuantityProducts) {
        // Pour les produits en quantité totale : recalculer les DOSES d'abord
        this.recalculateDosesFromQuantity();
      } else {
        // Comportement normal : recalculer les quantités à partir des doses
        this.recalculateComponentQuantities();
      }
    } else {
      // Mode surface : Vérifier si des produits utilisent une unité de quantité totale (L ou Kg)
      const hasAbsoluteQuantityProducts = this.hasAbsoluteQuantityProducts();
      
      if (hasAbsoluteQuantityProducts) {
        // Pour les produits en quantité totale : recalculer les DOSES d'abord
        this.recalculateDosesFromQuantity();
      } else {
        // Comportement normal : recalculer les quantités à partir des doses
        this.recalculateComponentQuantities();
        this.recalculateDistribution();
      }
    }
    
    // 🔧 RESTAURER les volumes manuels après tout recalcul
    if (manualVolumes.size > 0 && this.currentTreatmentDraft.parcels_concerned?.length) {
      this.currentTreatmentDraft.parcels_concerned.forEach((parcel: any) => {
        const key = `${parcel.parcel_id}_${parcel.crop_id || ''}`;
        if (manualVolumes.has(key)) {
          parcel.treatment_volume_applied = manualVolumes.get(key);
        }
      });
      
      // Recalculer le total utilisé avec les volumes restaurés
      const totalUsed = this.currentTreatmentDraft.parcels_concerned.reduce((sum: number, parcel: any) => {
        return sum + (parseFloat(parcel.treatment_volume_applied) || 0);
      }, 0);
      this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalUsed.toFixed(2));
    }
    
    // 🔧 CORRECTION : Mettre à jour les métadonnées depuis le formulaire (avec vérification des valeurs)
    const formValues = this.formTraitement.value;
    
    // S'assurer que toutes les valeurs sont bien récupérées
    // Note: bbch et event_hour sont déjà dans le draft grâce à saveBbch() et saveEventHour()
    // mais on les récupère aussi du formulaire au cas où
    this.currentTreatmentDraft.type = formValues.type || this.currentTreatmentDraft.type;
    this.currentTreatmentDraft.date = formValues.date || this.currentTreatmentDraft.date;
    this.currentTreatmentDraft.event_hour = this.currentTreatmentDraft.event_hour || formValues.event_hour || '';
    // ⚠️ target est maintenant stocké par entrée de treatment_composition, pas au niveau root
    delete this.currentTreatmentDraft['target'];
    this.currentTreatmentDraft.bbch = this.currentTreatmentDraft.bbch || formValues.bbch || '';
    this.currentTreatmentDraft.remark = formValues.remark || this.currentTreatmentDraft.remark || '';
    this.currentTreatmentDraft.harvest_date = formValues.harvest_date || this.currentTreatmentDraft.harvest_date || '';
    this.currentTreatmentDraft.clean_flag = formValues.clean_flag || this.currentTreatmentDraft.clean_flag || 'Non';
    this.currentTreatmentDraft.localized_treatment = formValues.localized_treatment || this.currentTreatmentDraft.localized_treatment || 'Non';
    this.currentTreatmentDraft.treatment_total_quantity = formValues.treatment_total_quantity || this.currentTreatmentDraft.treatment_total_quantity || '';
    // En mode quantité : NE PAS écraser treatment_total_quantity_used depuis le formulaire —
    // il est calculé par recalculateComponentQuantities / onParcelQuantityAppliedChange
    if (treatmentType !== 'phyto_quantity_treatment') {
      this.currentTreatmentDraft.treatment_total_quantity_used = formValues.treatment_total_quantity_used || this.currentTreatmentDraft.treatment_total_quantity_used || '';
    }
    
    // Ajouter les infos opérateur si sélectionné
    if (this.selectedOperator) {
      this.currentTreatmentDraft.operator_id = this.selectedOperator.operatorId || formValues.operator_id;
      this.currentTreatmentDraft.operator_name = this.selectedOperator.operatorName;
      this.currentTreatmentDraft.operator_phytolicence = this.selectedOperator.operatorPhytolicence;
    } else if (formValues.operator_id) {
      this.currentTreatmentDraft.operator_id = formValues.operator_id;
    }

    const apiPayload = treatmentToApi(this.currentTreatmentDraft);

    if (this.isEditMode && this.editingTreatment?.event_id) {

      this.httpClient.put(`${environment.apiRegistre}/phyto_treatments/${this.editingTreatment.event_id}`, apiPayload)
        .subscribe({
          next: (response: any) => {
            // Le serveur est source de vérité pour les valeurs calculées (surfaces,
            // quantités, totaux) : on se resynchronise sur sa réponse plutôt que de
            // garder les valeurs calculées côté client comme définitives.
            const updated = treatmentFromApi(response);
            this.editingTreatment = { ...this.editingTreatment, ...updated };
            this.currentTreatmentDraft = { ...this.currentTreatmentDraft, ...updated };
            //  Rafraîchissement ciblé uniquement des traitements
            this.http.refreshTreatmentsOnly();
            // Mode modification : fermeture directe sans animation
            this.onClosePopupWithRefresh();
          },
          error: (error) => {
            const msg = error.error?.error || error.error?.message || error.message;
            alert('Erreur lors de la modification du traitement: ' + msg);
          }
        });
    } else {
      // Mode création : POST
      this.httpClient.post(`${environment.apiRegistre}/phyto_treatments`, apiPayload)
        .subscribe({
          next: (response: any) => {
            // Idem : le serveur renvoie le traitement intégralement calculé.
            const created = treatmentFromApi(response);
            this.currentTreatmentDraft = { ...this.currentTreatmentDraft, ...created };

            //  Rafraîchissement ciblé uniquement des traitements
            this.http.refreshTreatmentsOnly();

            //  Émettre les données du traitement créé pour l'animation de succès
            this.treatmentCreated.emit(this.currentTreatmentDraft);
          },
          error: (error) => {
            const msg = error.error?.error || error.error?.message || error.message;
            alert('Erreur lors de la création du traitement: ' + msg);
          }
        });
    }
  }
  
  /**
   * Finalise le traitement et ferme la popup
   */
  private finalizeTreatmentAndClose(): void {
    // Réactiver le scroll du background
    document.body.classList.remove('no-scroll');
    
    this.closePopupWithRefresh.emit();
    
    // Naviguer vers le registre pour voir les résultats
    this.router.navigate(['/registre']);
  }

  /**
   * Met à jour l'inventaire avec le traitement finalisé
   * @deprecated Remplacé par le système de handler côté serveur
   */
  private updateInventoryWithFinalizedTreatment(): void {
    
    // 1. Consolidation complète de tous les calculs
    this.consolidateAllTreatmentCalculations();
    
    // 2. 🔧 CORRECTION : Mettre à jour l'inventaire avec le traitement actuel
    // Ceci est important quand l'utilisateur finalise sans passer par le tableau de répartition
    const currentTreatments = this.getCurrentTreatment();
    if (currentTreatments && currentTreatments.length > 0) {
      const treatment = currentTreatments[0];
      if (treatment?.event_id) {
        // En mode modification, s'assurer que l'inventaire est à jour
        if (this.isEditMode) {
          this.updateInventoryImmediately(treatment);
        }
      }
    }
    
    // 3. Fermer et rafraîchir
    setTimeout(() => {
      
      // Réactiver le scroll du background
      document.body.classList.remove('no-scroll');
      
      this.closePopupWithRefresh.emit();
    }, 100);
  }

  /**
   * Met à jour l'inventaire immédiatement après un transfert réussi
   * Cette méthode évite les problèmes de validation en utilisant le traitement directement du serveur
   */
  private updateInventoryImmediately(finalTreatment: any): void {
    
    if (!finalTreatment?.event_id) {
      return;
    }
    
    // Utiliser directement le traitement final validé du serveur
    this.http.saveToPhytoTreatmentsComponents(finalTreatment).subscribe({
      next: (result) => {
      }
    });
  }

  /**
   * Méthode centralisée pour mettre à jour l'inventaire après modification/suppression d'un traitement bouillie
   * Appelée quand un recalcul est effectué sur phyto_treatments_final.json
   */
  private updateInventoryForBouillieRecalculation(treatment: any): void {
    
    // Vérifier si c'est un traitement en mode bouillie
    if (!treatment || treatment.strategy !== 'bouillie') {
      return;
    }

    if (!treatment.event_id) {
      return;
    }

    // Extraire les composants du traitement pour l'inventaire
    let treatmentComponents: any[] = [];
    
    if (Array.isArray(treatment.treatment_composition)) {
      treatmentComponents = treatment.treatment_composition || [];
    } else if (treatment.treatment_composition) {
      treatmentComponents = treatment.treatment_composition;
    }

    if (!treatmentComponents || treatmentComponents.length === 0) {
      return;
    }


    // Utiliser la méthode d'inventaire du service registre
    this.http.updateInventoryForBouillieModification(treatment).subscribe({
      next: (result) => {
      }
    });
  }

  /**
   * S'assure que standard_total_surface_treated est calculé et cohérent
   */
  private ensureStandardTotalSurfaceTreated(): void {
    if (!this.editingTreatment) return;
    
    let totalSurface = 0;
    
    // Toujours calculer la surface depuis les parcelles pour vérification
    if (this.editingTreatment.parcels_concerned && this.editingTreatment.parcels_concerned.length > 0) {
      const parcels = this.editingTreatment.parcels_concerned;
      if (Array.isArray(parcels)) {
        totalSurface = parcels.reduce((total: number, parcel: any) => {
          // 🔧 CORRECTION: Utiliser standard_surface_treated (en ha) pour les calculs
          const surface = parseFloat(parcel.standard_surface_treated) || 0;
          return total + surface;
        }, 0);
      }
    }
    
    // Vérifier la cohérence avec la valeur existante
    const currentValue = this.editingTreatment.standard_total_surface_treated;
    const needsRecalculation = !currentValue || 
                               currentValue === 0 || 
                               Math.abs(currentValue - totalSurface) > 0.01; // Tolérance de 0.01 pour les arrondis
    
    if (needsRecalculation && totalSurface > 0) {
      this.editingTreatment.standard_total_surface_treated = totalSurface;
      this.editingTreatment.surface_recalculated_at = new Date().toISOString();
    } else if (currentValue && totalSurface > 0 && Math.abs(currentValue - totalSurface) <= 0.01) {
    }
  }

  /**
   * Consolidation complète de tous les calculs automatiques pour un traitement
   */
  private consolidateAllTreatmentCalculations(): void {
    if (!this.editingTreatment) return;
    
    const result = this.calculationService.consolidateAllCalculations(this.editingTreatment);
    
  }

  /**
   * Calcule treatment_volume_applied pour chaque parcelle
   */
  private consolidateTreatmentVolumeApplied(): void {
    // Déléguer au service de consolidation
    this.consolidateAllTreatmentCalculations();
  }

  /**
   * Calcule component_quantity pour chaque produit
   */
  private consolidateComponentQuantities(): void {
    // Déléguer au service de consolidation
    this.consolidateAllTreatmentCalculations();
  }

  /**
   * Validation des calculs avant sauvegarde
   */
  private validateTreatmentCalculations(): boolean {
    if (!this.editingTreatment) return false;
    
    const result = this.calculationService.validateTreatmentCalculations(this.editingTreatment);
    
    if (result.errors.length > 0) {
      return false;
    }
    
    return true;
  }

  // === MÉTHODES MANQUANTES POUR LE TEMPLATE ===

  /**
   * Active l'édition inline pour un produit spécifique
   * Ferme automatiquement l'édition du produit précédent si il y en a un
   * 🚀 OPTIMISÉ : Pré-charge les doses en arrière-plan pour affichage instantané
   */
  onAddDose(productId: string): void {
    // Si un autre produit était déjà en cours d'édition, le fermer d'abord
    if (this.currentEditingProductId && this.currentEditingProductId !== productId) {
      this.onAnnulerAddDose(this.currentEditingProductId);
    }
    
    // Masquer le hint et la section récemment utilisés dès qu'un produit est sélectionné
    this.showSearchHint = false;

    // 🚀 PRÉ-CHARGEMENT ANTICIPÉ : Déclencher la requête API immédiatement
    // Cela permet au cache de se remplir avant même que le template ne s'affiche
    this.getDosesPhytoweb(productId).subscribe();
    
    // Définir ce produit comme le produit actuellement en cours d'édition
    this.currentEditingProductId = productId;
    this.isTargetDropdownOpen = false;
    // Créer un formulaire spécifique pour ce produit s'il n'existe pas
    if (!this.productForms.has(productId)) {
      const productForm = this.formBuilder.group({
        component_id: [productId],
        dose: ['', [Validators.required, Validators.min(0.01)]],
        littre: [this.getDefaultUnit(), Validators.required], // 🔧 Unité dynamique selon le type de traitement
        quantity: [''],
        target: ['', Validators.required]
      });
      this.productForms.set(productId, productForm);
    }
  }

  /**
   * Annule l'édition inline pour un produit
   */
  onAnnulerAddDose(productId: string): void {
    
    // Désactiver l'édition pour ce produit
    if (this.currentEditingProductId === productId) {
      this.currentEditingProductId = null;
      
      // 🧹 Nettoyer le cache des doses pour ce produit spécifiquement
      this.clearDosesCacheForProduct(productId);
    }
    
    // Réinitialiser le formulaire s'il existe
    const form = this.productForms.get(productId);
    if (form) {
      const resetUnit = this.getTreatmentType() === 'phyto_quantity_treatment' ? 'L' : 'L/ha';
      form.reset({
        component_id: productId,
        dose: '',
        littre: resetUnit,
        quantity: '',
        target: ''
      });
    }
  }

  /**
   * Vérifie si un produit est en cours d'édition
   */
  isProductEditing(productId: string): boolean {
    return this.currentEditingProductId === productId;
  }

  /**
   * Active l'édition inline pour un produit spécifique (section Bouillie)
   * Ferme automatiquement l'édition du produit précédent si il y en a un
   * 🚀 OPTIMISÉ : Pré-charge les doses en arrière-plan pour affichage instantané
   */
  onAddDoseBouillie(productId: string): void {
    // Si un autre produit était déjà en cours d'édition, le fermer d'abord
    if (this.currentEditingProductIdBouillie && this.currentEditingProductIdBouillie !== productId) {
      this.onAnnulerAddDoseBouillie(this.currentEditingProductIdBouillie);
    }
    
    // Masquer le hint et la section récemment utilisés dès qu'un produit est sélectionné
    this.showSearchHint = false;

    // 🚀 PRÉ-CHARGEMENT ANTICIPÉ : Déclencher la requête API immédiatement
    this.getDosesPhytoweb(productId).subscribe();
    
    // Définir ce produit comme le produit actuellement en cours d'édition
    this.currentEditingProductIdBouillie = productId;
    this.isTargetDropdownOpen = false;
    // Créer un formulaire spécifique pour ce produit s'il n'existe pas
    if (!this.productForms.has(productId)) {
      const productForm = this.formBuilder.group({
        component_id: [productId],
        dose: ['', [Validators.required, Validators.min(0.01)]],
        littre: ['L/100L', Validators.required], // 🔧 Unité par défaut pour bouillie
        quantity: [''],
        target: ['', Validators.required]
      });
      this.productForms.set(productId, productForm);
    }
  }

  /**
   * Annule l'édition inline pour un produit (section Bouillie)
   */
  onAnnulerAddDoseBouillie(productId: string): void {
    
    // Désactiver l'édition pour ce produit
    if (this.currentEditingProductIdBouillie === productId) {
      this.currentEditingProductIdBouillie = null;
      
      // 🧹 Nettoyer le cache des doses pour ce produit spécifiquement
      this.clearDosesCacheForProduct(productId);
    }
    
    // Réinitialiser le formulaire s'il existe
    const form = this.productForms.get(productId);
    if (form) {
      form.reset({
        component_id: productId,
        dose: '',
        littre: 'L/100L',
        quantity: '',
        target: ''
      });
    }
  }

  /**
   * Récupère le formulaire d'un produit spécifique
   */
  getProductForm(productId: string): FormGroup {
    return this.productForms.get(productId) || new FormGroup({});
  }

  /**
   * Calcule en temps réel la valeur dérivée (quantité ou dose) à afficher
   * dans la card product-edit-fullwidth en fonction du type de traitement.
   */
  getPreviewDerivedValue(productId: string | null): { label: string; value: string; unit: string } | null {
    if (!productId) return null;
    const form = this.productForms.get(productId);
    if (!form) return null;

    const doseValue = parseFloat(form.get('dose')?.value);
    const unitValue: string = form.get('littre')?.value || '';
    if (!doseValue || doseValue <= 0 || !unitValue) return null;

    const treatmentType = this.getTreatmentType();

    if (treatmentType === 'phyto_quantity_treatment') {
      // Utilisateur saisit la quantité → afficher la dose calculée
      const totalSurface = this.currentTreatmentDraft?.standard_total_surface_treated || 0;
      if (totalSurface <= 0) return null;
      const dose = doseValue / totalSurface;
      const baseUnit = unitValue.toLowerCase().includes('kg') ? 'kg' : 'L';
      return { label: 'Dose de produit', value: dose.toFixed(2), unit: baseUnit + '/ha' };
    }

    if (treatmentType === 'phyto_porridge_treatment' || this.traitement === 'volument de bouillie utilisee') {
      // Mode bouillie : utilisateur saisit la dose → afficher la quantité calculée
      if (this.isAbsoluteQuantityUnit(unitValue)) {
        return { label: 'quantité de produit', value: doseValue.toFixed(2), unit: unitValue };
      }
      const volumeUtilise = parseFloat(this.treatment_total_quantity_used.value) || 0;
      if (volumeUtilise <= 0) return null;
      const standardDose = doseValue * this.onReference(unitValue);
      const quantity = (standardDose / 100) * volumeUtilise;
      const unit = this.getQuantityUnitFromDoseUnit(unitValue);
      return { label: 'quantité de produit', value: quantity.toFixed(2), unit };
    }

    // Mode surface (phyto_surface_treatment) : utilisateur saisit la dose → afficher la quantité
    if (this.isAbsoluteQuantityUnit(unitValue)) {
      return { label: 'quantité de produit', value: doseValue.toFixed(2), unit: unitValue };
    }
    const totalSurface = this.currentTreatmentDraft?.standard_total_surface_treated || 0;
    if (totalSurface <= 0) return null;
    const standardDose = doseValue * this.onReference(unitValue);
    const quantity = standardDose * totalSurface;
    const unit = this.getQuantityUnitFromDoseUnit(unitValue);
    return { label: 'quantité de produit', value: quantity.toFixed(2), unit };
  }

  /**
   * 🌾 Récupère les cultures non autorisées pour un produit
   * Compare les cultures du draft avec les crop_use du produit
   */
  
  /**
   *  Bascule l'état d'expansion de la warning-box BBCH
   */
  toggleBbchWarning(): void {
    this.isBbchWarningExpanded.set(!this.isBbchWarningExpanded());
  }
  
  /**
   *  Bascule l'état d'expansion de la info-box heures d'application
   */
  toggleApplicationHour(): void {
    this.isApplicationHourExpanded.set(!this.isApplicationHourExpanded());
  }
  
  /**
   *  Bascule l'affichage du tooltip pour l'icône info de l'heure
   */
  toggleHourInfoTooltip(event: Event): void {
    event.stopPropagation();
    this.showHourInfoTooltip = !this.showHourInfoTooltip;
  }
  /** Résout le idCrop (indexCrop) d'un nom de culture Phytoweb, via le cache déjà chargé. */
  private resolveIdCropByName(cropName: string): string | null {
    if (!this.phytowebCropsCache || !cropName) return null;
    const normalized = cropName.toLowerCase().replace(/\s+/g, '');
    const entry = this.phytowebCropsCache.find(
      (c: any) => c.cropName?.toLowerCase().replace(/\s+/g, '') === normalized
    );
    return entry?.idCrop || null;
  }

  /**
   * Cultures non autorisées pour un produit, sur base de la table `crops` (corderPhytoweb),
   * filtrée par idAct (productId) — une ligne par culture réellement autorisée pour cet acte,
   * indépendamment de la présence de cibles déclarées (contrairement à /doseminmax, basé sur
   * `targets`, qui pouvait rater une culture autorisée sans cible renseignée).
   */
  getUnauthorizedCrops(productId: string): string[] {
    if (this.isPersonalProduct(productId)) return [];
    if (!this.currentTreatmentDraft?.parcels_concerned?.length) {
      return [];
    }

    // Déclenche le chargement si pas encore en cache (voir getCropAuthorizations).
    this.getCropAuthorizations(productId).subscribe();
    const cropRows = this.cropAuthCache.get(productId);

    if (!cropRows || cropRows.length === 0) {
      // Encore non chargé (requête /index/crop_authorizations en cours) ou produit sans
      // donnée connue : ne pas alerter à tort.
      return [];
    }

    const authorizedCropNames = new Set<string>();
    const authorizedCropIds = new Set<string>();
    cropRows.forEach((row: any) => {
      if (row.cropName) authorizedCropNames.add(row.cropName.toLowerCase().replace(/\s+/g, ''));
      if (row.idCrop) authorizedCropIds.add(row.idCrop);
    });

    const unauthorized: string[] = [];
    this.currentTreatmentDraft.parcels_concerned.forEach((parcel: any) => {
      const cropName = parcel.phytoweb_name || parcel.nomPhytoweb_crops_id;
      if (!cropName) return;
      const normalized = cropName.toLowerCase().replace(/\s+/g, '');

      if (authorizedCropNames.has(normalized)) return;

      const idCrop = this.resolveIdCropByName(cropName);
      if (idCrop && authorizedCropIds.has(idCrop)) return;

      if (!unauthorized.includes(cropName)) {
        unauthorized.push(cropName);
      }
    });

    return unauthorized;
  }

  // 📊 Cache pour éviter les appels répétés à l'API doses
  private dosesCache = new Map<string, any[]>();
  // 🚀 Cache d'Observables mémorisés pour éviter les requêtes multiples
  private dosesObservableCache = new Map<string, Observable<any[]>>();
  // 🎯 Cache des cultures/cibles autorisées par produit (idAct), non filtré par culture du
  // draft — alimenté par getDosesPhytoweb() depuis /index/doseminmax. Voir getCropUseForProduct.
  private cropUseCache = new Map<string, { crop_name: string; targets: { target_name: string }[] }[]>();

  /**
   * Cultures/cibles autorisées pour un produit, telles que réellement récupérées depuis
   * corderPhytoweb (table `targets` jointe à `crops`/`general` via /index/doseminmax).
   * Remplace l'usage de product.crop_use (toujours vide : /index/phytoweb_products ne renvoie
   * que les colonnes de `general`, jamais les cultures/cibles autorisées).
   * Peut être vide tant que getDosesPhytoweb(productId) n'a pas encore répondu.
   */
  private getCropUseForProduct(productId: string): { crop_name: string; targets: { target_name: string }[] }[] {
    return this.cropUseCache.get(productId) || [];
  }
  
  private phytowebCropsCache: any[] | null = null;

  // 🎯 Cache des lignes `crops` (cultures autorisées, dose max par culture, stades BBCH) par
  // produit (idAct), non filtré par culture du draft — alimenté par getCropAuthorizations()
  // depuis /index/crop_authorizations. Utilisé par getUnauthorizedCrops() et
  // getBbchWarningsForDraft() (contrairement à cropUseCache, basé sur `targets`/doseminmax,
  // réservé au dropdown de cible : voir getCropUseForProduct/getTargetOptionsForProduct).
  private cropAuthCache = new Map<string, any[]>();
  private cropAuthObservableCache = new Map<string, Observable<any[]>>();

  /**
   * Lignes `crops` (corderPhytoweb) pour un produit (idAct) : cultures autorisées, dose max
   * par culture (cropMaxDose/cropMaxDoseUnit), stades d'application (cropApplicationStade).
   * Non filtré par culture du draft — filtré côté client (voir getUnauthorizedCrops /
   * getBbchWarningsForDraft), même pattern que getDosesPhytoweb.
   */
  private getCropAuthorizations(productId: string): Observable<any[]> {
    if (this.isPersonalProduct(productId) || !productId) return of([]);

    if (this.cropAuthObservableCache.has(productId)) {
      return this.cropAuthObservableCache.get(productId)!;
    }

    const apiUrl = `${environment.apiRegistre}/index/crop_authorizations?idAct=${encodeURIComponent(productId)}`;
    const obs = this.httpClient.get<any[]>(apiUrl).pipe(
      map(rows => {
        this.cropAuthCache.set(productId, rows || []);
        return rows || [];
      }),
      catchError(() => of([])),
      shareReplay(1)
    );
    this.cropAuthObservableCache.set(productId, obs);
    return obs;
  }

  /**
   * 📊 Récupère les doses Phytoweb recommandées pour un produit (VERSION API PHP OPTIMISÉE)
   *  Utilise un cache d'Observable avec shareReplay pour éviter les requêtes multiples
   */
  getDosesPhytoweb(productId: string): Observable<any[]> {
    if (this.isPersonalProduct(productId)) return of([]);
    if (!this.currentTreatmentDraft?.parcels_concerned || !productId) {
      return of([]);
    }

    const draftCrops = this.getDraftCropsForCache();
    const cacheKey = `${productId}_${Array.from(draftCrops).sort().join('|')}`;
    
    //  NOUVEAU : Cache d'Observable pour éviter les appels multiples lors du change detection
    if (this.dosesObservableCache.has(cacheKey)) {
      return this.dosesObservableCache.get(cacheKey)!;
    }

    // Cache de données instantané
    if (this.dosesCache.has(cacheKey)) {
      const cachedObservable = of(this.dosesCache.get(cacheKey)!);
      this.dosesObservableCache.set(cacheKey, cachedObservable);
      return cachedObservable;
    }

    // /index/doseminmax remplace get_doses_phytoweb.php côté serveur (cf. server/app/routes/public.py).
    // productId ici est l'idAct (cf. productFromApi : product_id = p.idAct), donc on filtre sur
    // idAct plutôt que numAut. Il ne filtre que sur UNE culture à la fois : on récupère donc
    // toutes les doses du produit puis on filtre nous-mêmes sur l'ensemble des cultures du
    // draft, exactement comme le faisait l'ancien script PHP.
    const apiUrl = `${environment.apiRegistre}/index/doseminmax?idAct=${encodeURIComponent(productId)}`;

    // Appel API optimisé avec shareReplay pour éviter les requêtes multiples
    const dosesObservable = this.httpClient.get<any[]>(apiUrl).pipe(
      map(rows => {
        // 🔧 /index/phytoweb_products (catalogue) ne renvoie que les colonnes de `general` —
        // jamais de crop_use (cultures/cibles autorisées, table `crops`/`targets`). Ces lignes
        // NON filtrées par culture du draft sont la seule source réelle de cette info : on les
        // regroupe par culture ici pour alimenter getTargetOptionsForProduct/getUnauthorizedCrops
        // (voir getCropUseForProduct), qui ne doivent plus lire product.crop_use (toujours vide).
        const cropUseMap = new Map<string, { crop_name: string; targets: { target_name: string }[] }>();
        (rows || []).forEach(row => {
          const cropName = row.cropName || '';
          if (!cropName) return;
          if (!cropUseMap.has(cropName)) {
            cropUseMap.set(cropName, { crop_name: cropName, targets: [] });
          }
          if (row.target) {
            cropUseMap.get(cropName)!.targets.push({ target_name: row.target });
          }
        });
        this.cropUseCache.set(productId, Array.from(cropUseMap.values()));

        const doses = (rows || [])
          .filter(row => draftCrops.has((row.cropName || '').toLowerCase().replace(/\s+/g, '')))
          .map(row => ({
            enemy_name: row.target || '',
            target_rate_min: row.minDose ?? '',
            target_rate_max: row.maxDose ?? '',
            target_rate_unit: row.doseUnit || '',
            crop_name: row.cropName || '',
            product_id: productId
          }));
        // Mise en cache locale des données
        this.dosesCache.set(cacheKey, doses);
        return doses;
      }),
      catchError(error => {
        return of([]);
      }),
      shareReplay(1) // 🚀 CRITIQUE : Partage le résultat entre toutes les souscriptions
    );

    // Mise en cache de l'Observable mémorisé
    this.dosesObservableCache.set(cacheKey, dosesObservable);
    
    return dosesObservable;
  }

  
  /**
   * 🔧 Helper pour récupérer les cultures du draft (utilisé pour le cache)
   */
  private getDraftCropsForCache(): Set<string> {
    const draftCrops = new Set<string>();
    if (this.currentTreatmentDraft?.parcels_concerned?.length) {
      this.currentTreatmentDraft.parcels_concerned.forEach((parcel: any) => {
        if (parcel.phytoweb_name || parcel.nomPhytoweb_crops_id) {
          const normalized = (parcel.phytoweb_name || parcel.nomPhytoweb_crops_id).toLowerCase().replace(/\s+/g, '');
          draftCrops.add(normalized);
        }
      });
    }
    return draftCrops;
  }

  /**
   * 🧹 Nettoie le cache des doses pour un produit spécifique
   * Appelé quand l'utilisateur ferme le formulaire d'édition
   */
  private clearDosesCacheForProduct(productId: string): void {
    const draftCrops = this.getDraftCropsForCache();
    const cacheKey = `${productId}_${Array.from(draftCrops).sort().join('|')}`;
    
    // Supprimer du cache de données
    this.dosesCache.delete(cacheKey);
    // Supprimer du cache d'Observables
    this.dosesObservableCache.delete(cacheKey);
  }

  /**
   * 🚀 Fonction trackBy optimisée pour le rendu des doses
   * Évite le re-rendu inutile des lignes de dose inchangées
   */
  trackByDoseEnemyName(index: number, dose: any): string {
    return dose.enemy_name || index.toString();
  }

  /**
   * Récupère la hiérarchie des cultures Phytoweb depuis l'API
   */
  private loadPhytowebCrops(): Observable<any[]> {
    if (this.phytowebCropsCache) {
      return of(this.phytowebCropsCache);
    }

    return this.httpClient.get<any[]>(`${environment.apiRegistre}/index/phytoweb_crops`).pipe(
      map(data => {
        this.phytowebCropsCache = data;
        return data;
      }),
      catchError(() => of([]))
    );
  }

  /**
   * 🌾 Analyse le draft et retourne les avertissements BBCH pertinents.
   * Basé sur `crops.cropApplicationStade` (via /index/crop_authorizations, cf.
   * getCropAuthorizations) : une ligne par (produit, culture du draft) dont le stade
   * d'application contient "BBCH".
   */
  getBbchWarningsForDraft(): { cropName: string, stage: string, productName: string }[] {
    if (!this.currentTreatmentDraft?.parcels_concerned?.length || !this.currentTreatmentDraft?.treatment_composition?.length) {
      return [];
    }

    // Cultures du draft (nom normalisé + idCrop résolu quand possible)
    const draftCropNames = new Set<string>();
    const draftCropIds = new Set<string>();
    this.currentTreatmentDraft.parcels_concerned.forEach((parcel: any) => {
      const cropName = parcel.phytoweb_name || parcel.nomPhytoweb_crops_id;
      if (!cropName) return;
      draftCropNames.add(cropName.toLowerCase().replace(/\s+/g, ''));
      const idCrop = this.resolveIdCropByName(cropName);
      if (idCrop) draftCropIds.add(idCrop);
    });

    const warnings: { cropName: string, stage: string, productName: string }[] = [];
    const seen = new Set<string>();

    this.currentTreatmentDraft.treatment_composition.forEach((component: any) => {
      const productId = component.component_id;
      if (!productId || this.isPersonalProduct(productId)) return;

      // Déclenche le chargement si pas encore en cache (voir getCropAuthorizations).
      this.getCropAuthorizations(productId).subscribe();
      const cropRows = this.cropAuthCache.get(productId);
      if (!cropRows) return;

      const product = this.getProductById(productId);

      cropRows.forEach((row: any) => {
        const stade: string = row.cropApplicationStade || '';
        if (!stade.includes('BBCH')) return;

        const normalizedRowCrop = (row.cropName || '').toLowerCase().replace(/\s+/g, '');
        const matchesDraft = draftCropNames.has(normalizedRowCrop) || (row.idCrop && draftCropIds.has(row.idCrop));
        if (!matchesDraft) return;

        const key = `${productId}_${row.idCropData || row.idCrop}_${stade}`;
        if (seen.has(key)) return;
        seen.add(key);

        warnings.push({
          cropName: row.cropName || '',
          stage: stade,
          productName: product?.product_name || component.component_name || 'Produit inconnu'
        });
      });
    });

    return warnings;
  }

  /**
   * ⏰ Analyse le draft et retourne les produits nécessitant une mention d'heure de
   * traitement (general.spe8Flag == 1, déjà présent sur chaque produit du catalogue —
   * voir productFromApi).
   */
  getApplicationHoursForDraft(): { productName: string, productNumAut: string }[] {
    if (!this.currentTreatmentDraft?.treatment_composition?.length) {
      return [];
    }

    const recommendations: { productName: string, productNumAut: string }[] = [];
    const seen = new Set<string>();

    this.currentTreatmentDraft.treatment_composition.forEach((component: any) => {
      const productId = component.component_id;
      if (!productId || this.isPersonalProduct(productId) || seen.has(productId)) return;

      const product = this.getProductById(productId);
      if (product?.spe8_flag) {
        seen.add(productId);
        recommendations.push({
          productName: product.product_name || component.component_name || 'Produit inconnu',
          productNumAut: product.product_numaut || component.component_numaut || 'N/A'
        });
      }
    });

    return recommendations;
  }

  /**
   * 🔄 Initialise les données de référence (cultures Phytoweb) au chargement du composant
   */
  private initializeWarningsData(): void {
    this.loadPhytowebCrops().subscribe();
  }

  // ── Cible par produit ─────────────────────────────────────────────────────

  /**
   * Retourne les target_name disponibles pour un produit, filtrés par les cultures du draft.
   * Si aucune culture du draft ne correspond aux crop_use, retourne toutes les cibles du produit.
   */
  getTargetOptionsForProduct(productId: string): string[] {
    if (this.isPersonalProduct(productId)) return [];
    // Cultures/cibles autorisées réellement récupérées depuis corderPhytoweb (pas
    // product.crop_use, toujours vide — voir getCropUseForProduct).
    const cropUse = this.getCropUseForProduct(productId);
    if (cropUse.length === 0) return [];

    // Cultures sélectionnées dans le draft (normalisées)
    const draftNames = new Set<string>();
    (this.currentTreatmentDraft?.parcels_concerned || []).forEach((p: any) => {
      const n = (p.phytoweb_name || p.nomPhytoweb_crops_id || '').toLowerCase().trim();
      if (n) draftNames.add(n);
    });

    const matchingUse = draftNames.size > 0
      ? cropUse.filter((cu: any) => draftNames.has((cu.crop_name || '').toLowerCase().trim()))
      : cropUse;

    const targetSet = new Set<string>();
    (matchingUse.length > 0 ? matchingUse : cropUse).forEach((cu: any) => {
      (cu.targets || []).forEach((t: any) => { if (t.target_name) targetSet.add(t.target_name); });
    });
    return Array.from(targetSet).sort();
  }

  /** Vérifie si le produit est en mode saisie libre pour la cible */
  isTargetFreeText(productId: string): boolean {
    return this.targetFreeTextMap.get(productId) ?? false;
  }

  /** Bascule entre liste et saisie libre pour la cible du produit */
  setTargetFreeText(productId: string, isFree: boolean): void {
    this.targetFreeTextMap.set(productId, isFree);
    if (isFree) {
      // Effacer la valeur sélectionnée depuis la liste
      this.productForms.get(productId)?.get('target')?.setValue('', { emitEvent: false });
    }
  }

  /** Sélectionne une cible depuis la liste dropdown */
  selectTarget(productId: string, value: string): void {
    if (value === '__free__') {
      this.setTargetFreeText(productId, true);
      return;
    }
    this.targetFreeTextMap.set(productId, false);
    this.productForms.get(productId)?.get('target')?.setValue(value, { emitEvent: false });
  }

  // ── Dropdown "Cible" (remplace le <select> natif par .dropdown-container/.dropdown-btn,
  // voir src/styles/_popup-system.scss, même pattern que les autres popups) ──
  isTargetDropdownOpen = false;

  toggleTargetDropdown(): void {
    this.isTargetDropdownOpen = !this.isTargetDropdownOpen;
  }

  /** Sélectionne une cible depuis le dropdown puis le referme (selectTarget gère aussi '__free__') */
  selectTargetFromDropdown(productId: string, value: string): void {
    this.selectTarget(productId, value);
    this.isTargetDropdownOpen = false;
  }

  // ── Dose ↔ Quantité bidirectionnel ──────────────────────────────────────

  /**
   * Recalcule la quantité quand la dose change (input event du champ dose).
   */
  onDoseInputChange(productId: string, rawValue: string): void {
    const form = this.productForms.get(productId);
    if (!form) return;
    const dose = parseFloat(rawValue);
    const unit: string = form.get('littre')?.value || '';
    if (!dose || dose <= 0 || !unit) { form.get('quantity')?.setValue('', { emitEvent: false }); return; }

    const treatmentType = this.getTreatmentType();
    let qty = 0;

    if (treatmentType === 'phyto_porridge_treatment' || this.traitement === 'volument de bouillie utilisee') {
      const vol = parseFloat(this.treatment_total_quantity_used?.value) || 0;
      if (vol > 0) {
        qty = this.isAbsoluteQuantityUnit(unit) ? dose : (dose * this.onReference(unit) / 100) * vol;
      }
    } else if (treatmentType === 'phyto_quantity_treatment') {
      // Ce champ ("dose") contient en réalité la QUANTITÉ saisie par l'utilisateur dans ce
      // mode ; le champ dérivé ("quantity", affiché "Dose") = quantité / surface totale.
      const surface = this.currentTreatmentDraft?.standard_total_surface_treated || 0;
      qty = surface > 0 ? dose / surface : 0;
    } else {
      const surface = this.currentTreatmentDraft?.standard_total_surface_treated || 0;
      if (surface > 0) {
        qty = this.isAbsoluteQuantityUnit(unit) ? dose : dose * this.onReference(unit) * surface;
      }
    }
    form.get('quantity')?.setValue(qty > 0 ? parseFloat(qty.toFixed(4)).toString() : '', { emitEvent: false });
  }

  /**
   * Recalcule la dose quand la quantité change (input event du champ quantité).
   */
  onQuantityInputChange(productId: string, rawValue: string): void {
    const form = this.productForms.get(productId);
    if (!form) return;
    const qty = parseFloat(rawValue);
    const unit: string = form.get('littre')?.value || '';
    if (!qty || qty <= 0 || !unit) { form.get('dose')?.setValue('', { emitEvent: false }); return; }

    const treatmentType = this.getTreatmentType();
    let dose = 0;

    if (treatmentType === 'phyto_porridge_treatment' || this.traitement === 'volument de bouillie utilisee') {
      const vol = parseFloat(this.treatment_total_quantity_used?.value) || 0;
      if (vol > 0) {
        dose = this.isAbsoluteQuantityUnit(unit) ? qty : (qty * 100) / (this.onReference(unit) * vol);
      }
    } else if (treatmentType === 'phyto_quantity_treatment') {
      // Ce champ ("quantity", affiché "Dose") contient ici la dose dérivée ; le modifier
      // directement fixe la dose, dont on déduit la quantité ("dose" du form) = dose × surface.
      const surface = this.currentTreatmentDraft?.standard_total_surface_treated || 0;
      dose = surface > 0 ? qty * surface : 0;
    } else {
      const surface = this.currentTreatmentDraft?.standard_total_surface_treated || 0;
      if (surface > 0) {
        dose = this.isAbsoluteQuantityUnit(unit) ? qty : qty / (this.onReference(unit) * surface);
      }
    }
    form.get('dose')?.setValue(dose > 0 ? parseFloat(dose.toFixed(4)).toString() : '', { emitEvent: false });
  }

  /**
   * Recalcule la quantité quand l'unité change (depuis selectUnit).
   */
  refreshQuantityAfterUnitChange(productId: string): void {
    const form = this.productForms.get(productId);
    if (!form) return;
    const dose = form.get('dose')?.value;
    if (dose) this.onDoseInputChange(productId, dose);
  }

  /**
   * Statut d'autorisation d'un produit (calculé côté serveur, cf. productFromApi) :
   * 'authorized' (vert), 'withdrawing' (orange, en cours de retrait), 'forbidden' (rouge),
   * ou 'unknown' si non déterminable.
   */
  getProductAuthorizationStatus(productId: string): 'authorized' | 'withdrawing' | 'forbidden' | 'unknown' {
    if (this.isPersonalProduct(productId)) return 'authorized';
    const product = this.getProductById(productId);
    return product?.authorization_status || 'unknown';
  }

  getProductAuthorizationLabel(status: string): string {
    switch (status) {
      case 'authorized': return 'Autorisé';
      case 'withdrawing': return 'Autorisation en cours de retrait';
      case 'forbidden': return 'Interdit';
      default: return '';
    }
  }

  /** Date limite d'utilisation (useToleranceDate), pertinente quand le statut est 'withdrawing'. */
  getProductToleranceDate(productId: string): string | null {
    if (this.isPersonalProduct(productId)) return null;
    const product = this.getProductById(productId);
    return product?.use_tolerance_date || null;
  }

  /**
   * ── PRODUITS PERSONNALISÉS ──────────────────────────────────────────────
   */

  /** Initialiser le FormGroup du produit personnel */
  initPersonalProductForm(): void {
    this.personalProductForm = this.formBuilder.group({
      product_name: ['', [Validators.required, Validators.minLength(2)]],
      product_type: ['', Validators.required]
    });
    this.filteredTypeOptions = [...this.personalProductTypeOptions];
  }

  /** Charge les produits déjà utilisés dans phyto_treatments_final.json */
  loadRecentlyUsedProducts(): void {
    this.isLoadingRecentProducts = true;
    this.httpClient
      .get<any[]>(`${environment.apiRegistre}/phyto_treatments`)
      .pipe(map(treatments => (treatments || []).map(treatmentFromApi)), catchError(() => of([])))
      .subscribe(treatments => {
        // Collecter les component_id uniques dans l'ordre de la plus récente utilisation
        const seenIds = new Set<string>();
        const orderedIds: string[] = [];
        const sorted = [...(treatments || [])].sort((a, b) => {
          const da = a.date || a.event_date || '';
          const db = b.date || b.event_date || '';
          return db.localeCompare(da);
        });
        for (const t of sorted) {
          if (!Array.isArray(t.treatment_composition)) continue;
          for (const comp of t.treatment_composition) {
            const id = comp.component_id;
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              orderedIds.push(id);
            }
          }
        }
        if (orderedIds.length === 0) {
          this.isLoadingRecentProducts = false;
          return;
        }
        // Joindre avec le catalogue de produits
        this.VolumeDeBouillipreparer.pipe(catchError(() => of([]))).subscribe(allProducts => {
          const productMap = new Map<string, any>(allProducts.map(p => [p.product_id, p]));
          this.recentlyUsedProducts = orderedIds
            .map(id => productMap.get(id))
            .filter((p): p is any => !!p);
          this.isLoadingRecentProducts = false;
        });
      });
  }

  /** Charger les produits personnels depuis le serveur */
  loadPersonalProducts(): void {
    const url = `${environment.apiRegistre}/personal_products`;
    this.httpClient.get<any[]>(url).pipe(
      catchError(() => of([]))
    ).subscribe(products => {
      this.personalProducts = (products || []).map(p => ({ product_id: p.productId, product_name: p.productName, product_type: p.productType }));
      this.filterPersonalProducts();
    });
  }

  /** Filtrer les produits personnels selon la valeur de recherche */
  filterPersonalProducts(): void {
    const term = (this.personalProductSearchControl.value || '').toLowerCase().trim();
    if (!term) {
      this.filteredPersonalProducts = [...this.personalProducts];
    } else {
      this.filteredPersonalProducts = this.personalProducts.filter(p =>
        p.product_name?.toLowerCase().includes(term) ||
        p.product_type?.toLowerCase().includes(term)
      );
    }
  }

  /** Basculer entre le mode phyto et le mode produits personnels */
  toggleProductMode(mode: 'phyto' | 'personal'): void {
    this.productMode = mode;
    if (mode === 'personal') {
      this.filterPersonalProducts();
    }
    // Fermer tout formulaire d'édition ouvert
    this.currentEditingProductId = null;
    this.currentEditingProductIdBouillie = null;
    this.showNewPersonalProductForm = false;
  }

  /** Filtrer les options de type lors de la saisie */
  onPersonalTypeInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value.toLowerCase();
    this.filteredTypeOptions = this.personalProductTypeOptions.filter(o =>
      o.toLowerCase().includes(value)
    );
  }

  /** Sauvegarder un nouveau produit personnel sur le serveur */
  saveNewPersonalProduct(): void {
    if (this.personalProductForm.invalid || this.isSavingPersonalProduct) return;
    this.isSavingPersonalProduct = true;

    const productName = this.personalProductForm.get('product_name')?.value;
    const productType = this.personalProductForm.get('product_type')?.value;

    const url = `${environment.apiRegistre}/personal_products`;
    this.httpClient.post<any>(url, { productName, productType }).pipe(
      catchError(err => {
        alert('Erreur lors de la création du produit. Veuillez réessayer.');
        return of(null);
      })
    ).subscribe(response => {
      this.isSavingPersonalProduct = false;
      if (response?.success) {
        this.personalProducts.push({ product_id: response.productId, product_name: productName, product_type: productType });
        this.filterPersonalProducts();
        this.showNewPersonalProductForm = false;
        this.personalProductForm.reset();
      }
    });
  }

  /** Annuler la création d'un produit personnel */
  cancelNewPersonalProduct(): void {
    this.showNewPersonalProductForm = false;
    this.personalProductForm.reset();
  }

  /** Supprimer un produit personnel */
  deletePersonalProduct(productId: string): void {
    if (!confirm('Supprimer ce produit de votre liste ?')) return;
    const url = `${environment.apiRegistre}/personal_products/${encodeURIComponent(productId)}`;
    this.httpClient.delete<any>(url).pipe(catchError(() => of(null))).subscribe(response => {
      if (response?.success !== false) {
        this.personalProducts = this.personalProducts.filter(p => p.product_id !== productId);
        this.filterPersonalProducts();
      }
    });
  }

  /** Ouvre le formulaire d'édition pour un produit personnel (mode Surface) */
  onAddDosePersonal(productId: string): void {
    if (this.currentEditingProductId && this.currentEditingProductId !== productId) {
      this.onAnnulerAddDose(this.currentEditingProductId);
    }
    this.showSearchHint = false;
    this.currentEditingProductId = productId;
    if (!this.productForms.has(productId)) {
      const productForm = this.formBuilder.group({
        component_id: [productId],
        dose: ['', [Validators.required, Validators.min(0.01)]],
        littre: [this.getDefaultUnit(), Validators.required],
        quantity: [''],
        target: ['', Validators.required]
      });
      this.productForms.set(productId, productForm);
    }
  }

  /** Ouvre le formulaire d'édition pour un produit personnel (mode Bouillie) */
  onAddDosePersonalBouillie(productId: string): void {
    if (this.currentEditingProductIdBouillie && this.currentEditingProductIdBouillie !== productId) {
      this.onAnnulerAddDoseBouillie(this.currentEditingProductIdBouillie);
    }
    this.showSearchHint = false;
    this.currentEditingProductIdBouillie = productId;
    if (!this.productForms.has(productId)) {
      const productForm = this.formBuilder.group({
        component_id: [productId],
        dose: ['', [Validators.required, Validators.min(0.01)]],
        littre: ['L/100L', Validators.required],
        quantity: [''],
        target: ['', Validators.required]
      });
      this.productForms.set(productId, productForm);
    }
  }

  /** Vérifie si un productId correspond à un produit personnel */
  isPersonalProduct(productId: string): boolean {
    return productId?.startsWith('perso-') ?? false;
  }

  /** ── FIN PRODUITS PERSONNALISÉS ─────────────────────────────────────── */

  /**
   *  Récupère un produit par son ID (phyto ou personnel)
   */
  getProductById(productId: string): any | null {
    // Produit personnel
    if (this.isPersonalProduct(productId)) {
      return this.personalProducts.find(p => p.product_id === productId) || null;
    }
    // Produit phyto
    let product: any = null;
    this.VolumeDeBouillipreparer.subscribe(products => {
      product = products.find(p => p.product_id === productId);
    }).unsubscribe();
    return product;
  }

  /**
   * Garde currentTreatmentDraft.treatment_composition synchronisé avec un produit
   * ajouté/édité via le formulaire de dose (onRemoveAddDose). Sans ça, la dose/quantité
   * fraîchement saisie ne vit que dans le signal — le draft (source de vérité utilisée
   * par recalculateComponentQuantities et par le merge protecteur de onTerminerTraitement/
   * updateDraftWithProducts) reste sur l'ancienne valeur jusqu'à la prochaine synchronisation,
   * ce qui fait revenir l'édition en arrière à l'enregistrement final.
   */
  private upsertProductInDraft(product: any): void {
    if (!this.currentTreatmentDraft) return;
    const composition: any[] = this.currentTreatmentDraft.treatment_composition || [];
    const idx = composition.findIndex((p: any) => p.component_id === product.component_id);
    if (idx >= 0) {
      composition[idx] = product;
    } else {
      composition.push(product);
    }
    this.currentTreatmentDraft.treatment_composition = composition;
  }

  onRemoveAddDose(productId: string): void {
    //  NOUVEAU SYSTÈME : Ajout local du produit au signal (pas d'appel serveur)
    
    // Récupérer le formulaire spécifique à ce produit
    const productForm = this.productForms.get(productId);
    
    if (productForm && productForm.valid) {
      const formValue = productForm.value;
      const treatmentType = this.getTreatmentType();
      
      // Trouver le produit (personnel ou phyto)
      const product = this.isPersonalProduct(productId)
        ? this.personalProducts.find((p: any) => p.product_id === productId)
        : this.http.cachedProducts().find((p: any) => p.product_id === productId);
      if (!product) {
        alert('Erreur: Produit non trouvé.');
        return;
      }
      
      // 🔧 CALCUL SPÉCIFIQUE MODE BOUILLIE
      if (treatmentType === 'phyto_porridge_treatment' || this.traitement === "volument de bouillie utilisee") {
        
        // Récupérer le volume de bouillie utilisé
        const volumeUtilise = parseFloat(this.treatment_total_quantity_used.value) || 0;
        
        if (volumeUtilise <= 0) {
          alert('Erreur: Volume de bouillie utilisé manquant. Veuillez renseigner la quantité utilisée.');
          return;
        }
        
        let quantiteCalculee = 0;
        let doseCalculee = formValue.dose;
        let doseUnitFinale = formValue.littre;
        let standardDose = 0;
        let quantityUnit = '';
        
        // 🆕 GESTION DES UNITÉS ABSOLUES (L ou Kg) - Calcul inverse
        if (this.isAbsoluteQuantityUnit(formValue.littre)) {
          // L'utilisateur a saisi une quantité totale, on calcule la dose
          quantiteCalculee = formValue.dose; // La saisie EST la quantité
          // Calcul de la dose: dose = (quantité × 100) / volume_utilisé
          doseCalculee = (quantiteCalculee * 100) / volumeUtilise;
          // IMPORTANT: On garde l'unité originale 'L' ou 'Kg' pour la détecter lors des recalculs
          doseUnitFinale = formValue.littre; // Garder 'L' ou 'Kg' tel quel
          standardDose = doseCalculee; // Car L/100L et kg/100L ont facteur 1
          quantityUnit = formValue.littre; // 'L' ou 'Kg'
        } else {
          // Calcul normal: dose → quantité
          // Normaliser la dose selon l'unité
          const facteur = this.onReference(formValue.littre);
          standardDose = formValue.dose * facteur;
          
          // Calcul correct pour mode bouillie: (dose_standard/100) * volume_utilisé
          quantiteCalculee = (standardDose / 100) * volumeUtilise;
          
          // Déterminer l'unité de quantité
          quantityUnit = this.getQuantityUnitFromDoseUnit(formValue.littre);
        }
        
        // Créer l'objet produit pour le signal
        const newProduct = {
          component_id: productId,
          component_name: product.product_name,
          component_numaut: product.product_numaut || '',
          component_type: product.product_type,
          component_dose: doseCalculee,
          component_dose_unit: doseUnitFinale,
          standard_component_dose: standardDose,
          component_quantity: quantiteCalculee,
          component_quantity_unity: quantityUnit,
          target: formValue.target || '',
          type: 'phyto_porridge_treatment',
          treatment_total_quantity_used: volumeUtilise
        };
        
        // Ajouter au signal localement
        const currentProducts = this.getSignalDose();
        this.http.signalGetDose.set([...currentProducts, newProduct]);
        this.upsertProductInDraft(newProduct);

      } else if (treatmentType === 'phyto_quantity_treatment') {
        // Mode quantité : le champ "dose" du formulaire contient en réalité la QUANTITÉ
        // saisie par l'utilisateur (label "Quantité" dans ce mode) — pas une dose par ha.
        // L'unité choisie (L/ha, kg/ha...) sert uniquement à déduire si le produit est
        // liquide ou solide (le sélecteur n'offre pas d'unité absolue L/Kg dans ce mode).
        const totalSurface = this.currentTreatmentDraft?.standard_total_surface_treated || 0;

        if (totalSurface <= 0) {
          alert('Erreur: Surface totale manquante. Veuillez sélectionner des parcelles.');
          return;
        }

        const quantiteCalculee = formValue.dose;
        const quantityUnit = this.getQuantityUnitFromDoseUnit(formValue.littre);
        const doseCalculee = quantiteCalculee / totalSurface;
        const doseUnitFinale = `${quantityUnit}/ha`;

        const newProduct = {
          component_id: productId,
          component_name: product.product_name,
          component_numaut: product.product_numaut || '',
          component_type: product.product_type,
          component_dose: doseCalculee,
          component_dose_unit: doseUnitFinale,
          standard_component_dose: doseCalculee,
          component_quantity: quantiteCalculee,
          component_quantity_unity: quantityUnit,
          target: formValue.target || ''
        };

        const currentProducts = this.getSignalDose();
        this.http.signalGetDose.set([...currentProducts, newProduct]);
        this.upsertProductInDraft(newProduct);

      } else {
        // Mode surface classique
        const totalSurface = this.currentTreatmentDraft?.standard_total_surface_treated || 0;

        let quantiteCalculee = 0;
        let doseCalculee = formValue.dose;
        let doseUnitFinale = formValue.littre;
        let standardDose = 0;
        let quantityUnit = '';
        
        // 🆕 GESTION DES UNITÉS ABSOLUES (L ou Kg) - Calcul inverse
        if (this.isAbsoluteQuantityUnit(formValue.littre)) {
          // L'utilisateur a saisi une quantité totale, on calcule la dose
          quantiteCalculee = formValue.dose; // La saisie EST la quantité
          
          if (totalSurface <= 0) {
            alert('Erreur: Surface totale manquante. Veuillez sélectionner des parcelles.');
            return;
          }
          
          // Calcul de la dose: dose = quantité / surface
          doseCalculee = quantiteCalculee / totalSurface;
          // IMPORTANT: On garde l'unité originale 'L' ou 'Kg' pour la détecter lors des recalculs
          doseUnitFinale = formValue.littre; // Garder 'L' ou 'Kg' tel quel
          standardDose = doseCalculee; // Car L/ha et kg/ha ont facteur 1
          quantityUnit = formValue.littre; // 'L' ou 'Kg'
        } else {
          // Calcul normal: dose → quantité
          const facteur = this.onReference(formValue.littre);
          standardDose = formValue.dose * facteur;
          quantiteCalculee = standardDose * totalSurface;
          
          // Déterminer l'unité de quantité
          quantityUnit = this.getQuantityUnitFromDoseUnit(formValue.littre);
        }
        
        const newProduct = {
          component_id: productId,
          component_name: product.product_name,
          component_numaut: product.product_numaut || '',
          component_type: product.product_type,
          component_dose: doseCalculee,
          component_dose_unit: doseUnitFinale,
          standard_component_dose: standardDose,
          component_quantity: quantiteCalculee,
          component_quantity_unity: quantityUnit,
          target: formValue.target || ''
        };
        
        // Ajouter au signal localement
        const currentProducts = this.getSignalDose();
        this.http.signalGetDose.set([...currentProducts, newProduct]);
        this.upsertProductInDraft(newProduct);
      }

      // Réinitialiser le formulaire et fermer l'édition inline
      this.currentEditingProductId = null;
      this.currentEditingProductIdBouillie = null; // 🔧 Reset également pour section bouillie
      this.targetFreeTextMap.delete(productId);
      productForm.reset({
        component_id: productId,
        dose: '',
        littre: this.getDefaultUnit(),
        quantity: '',
        target: ''
      });
      
      // Émettre la validation pour mettre à jour le bouton "Valider"
      this.emitValidation();
      
      // ❌ DÉSACTIVÉ : Scroll automatique qui causait un saut de scroll indésirable
      // Le scroll reste à la position actuelle de l'utilisateur pour une meilleure UX
      // setTimeout(() => {
      //   if (this.tableauTraitementRef && this.tableauTraitementRef.nativeElement) {
      //     this.tableauTraitementRef.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      //   }
      // }, 300);
      
    } else {
    }
  }
  
  /**
   * Calcule le facteur de référence pour normaliser les doses
   * Mode Surface: normalise vers L/ha ou kg/ha
   * Mode Bouillie: normalise vers L/100L ou kg/100L
   */
  private onReference(unit: string): number {
    switch (unit) {
      // === MODE SURFACE (base: ha) ===
      case 'L/ha':
      case 'kg/ha':
        return 1;
      case 'ml/ha':
      case 'g/ha':
        return 0.001; // ml→L, g→kg
      // Par are (1 ha = 100 a)
      case 'L/a':
      case 'kg/a':
        return 100; // 1 L/a = 100 L/ha
      case 'ml/a':
      case 'g/a':
        return 0.1; // 100 × 0.001 = 0.1
      // Par m² (1 ha = 10000 m²)
      case 'L/m2':
      case 'kg/m2':
        return 10000; // 1 L/m² = 10000 L/ha
      case 'ml/m2':
      case 'g/m2':
        return 10; // 10000 × 0.001 = 10
      
      // === MODE BOUILLIE (base: 100L) ===
      case 'L/100L':
      case 'kg/100L':
        return 1;
      case 'ml/100L':
      case 'g/100L':
        return 0.001; // ml→L, g→kg
      // Par 10L de bouillie (100L = 10 × 10L)
      case 'L/10L':
      case 'kg/10L':
        return 10; // 1 L/10L = 10 L/100L
      case 'ml/10L':
      case 'g/10L':
        return 0.01; // 10 × 0.001 = 0.01
      // Par litre de bouillie (100L = 100 × 1L)
      case 'ml/L':
      case 'g/L':
        return 0.1; // 100 × 0.001 = 0.1
      
      // === QUANTITÉS TOTALES (pas de conversion de dose) ===
      case 'L':
      case 'Kg':
        return 1; // Sera géré différemment dans le calcul
      
      default:
        return 1;
    }
  }
  
  /**
   * Vérifie si l'unité est une quantité totale (L ou Kg)
   */
  private isAbsoluteQuantityUnit(unit: string): boolean {
    return unit === 'L' || unit === 'Kg';
  }
  
  /**
   * Génère l'unité de dose correspondante pour une quantité totale
   * Mode Surface: L → L/ha, Kg → kg/ha
   * Mode Bouillie: L → L/100L, Kg → kg/100L
   */
  private getGeneratedDoseUnit(quantityUnit: string, treatmentType: string): string {
    const isBouillieMode = treatmentType === 'phyto_porridge_treatment';
    if (quantityUnit === 'L') {
      return isBouillieMode ? 'L/100L' : 'L/ha';
    } else if (quantityUnit === 'Kg') {
      return isBouillieMode ? 'kg/100L' : 'kg/ha';
    }
    return quantityUnit;
  }
  
  /**
   * Gère le changement d'unité dans le formulaire
   * Met à jour le label si unité absolue (L ou Kg)
   */
  onUnitChange(event: Event, productId: string | null): void {
    if (!productId) return;
    const select = event.target as HTMLSelectElement;
    const newUnit = select.value;
    // Peut être utilisé pour adapter l'affichage si nécessaire
  }
  
  // ====================================
  // 🎨 Méthodes pour le dropdown personnalisé
  // ====================================
  
  // Position du menu dropdown actuellement ouvert
  dropdownMenuPosition: { top: string; left: string; width: string } = { top: '0', left: '0', width: '180px' };
  
  /**
   * Toggle l'ouverture/fermeture du dropdown
   */
  toggleUnitDropdown(dropdownId: string, event: Event): void {
    event.stopPropagation();
    
    if (this.openDropdownId === dropdownId) {
      this.openDropdownId = null;
    } else {
      // Calculer la position du menu par rapport au bouton
      const button = event.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();
      
      // Position en dessous du bouton
      this.dropdownMenuPosition = {
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        width: `${Math.max(rect.width, 180)}px`
      };
      
      this.openDropdownId = dropdownId;
    }
  }
  
  /**
   * Ferme tous les dropdowns (appelé sur click document)
   */
  closeAllDropdowns(): void {
    this.openDropdownId = null;
  }
  
  /**
   * Vérifie si un dropdown est ouvert
   */
  isDropdownOpen(dropdownId: string): boolean {
    return this.openDropdownId === dropdownId;
  }
  
  /**
   * Sélectionne une unité dans le dropdown
   */
  selectUnit(productId: string, unit: string, mode: 'surface' | 'bouillie'): void {
    const form = this.getProductForm(productId);
    if (form) {
      form.patchValue({ littre: unit });
      // Appeler onUnitChange si nécessaire
      this.onUnitChange({ target: { value: unit } } as unknown as Event, productId);
      // Recalculer la quantité après changement d'unité
      this.refreshQuantityAfterUnitChange(productId);
    }
    this.openDropdownId = null;
  }
  
  /**
   * Récupère le label de l'unité sélectionnée
   */
  getSelectedUnitLabel(productId: string, mode: 'surface' | 'bouillie'): string {
    const form = this.getProductForm(productId);
    if (!form) return 'Sélectionner';
    
    const currentUnit = form.get('littre')?.value || '';
    const options = mode === 'surface' ? this.surfaceUnitOptions : this.bouillieUnitOptions;
    
    for (const group of options) {
      for (const opt of group.options) {
        if (opt.value === currentUnit) {
          return opt.label;
        }
      }
    }
    
    return currentUnit || 'Sélectionner';
  }
  
  /**
   * Vérifie si une unité est sélectionnée
   */
  isUnitSelected(productId: string, unitValue: string): boolean {
    const form = this.getProductForm(productId);
    if (!form) return false;
    return form.get('littre')?.value === unitValue;
  }
  
  /**
   * Détermine l'unité de quantité (L ou Kg) à partir de l'unité de dose
   * Règle: toute unité contenant 'kg' ou commençant par 'g' (suivi de / ou espace) → Kg, sinon → L
   */
  private getQuantityUnitFromDoseUnit(doseUnit: string): string {
    const unit = doseUnit.toLowerCase().trim();
    
    // Unités de poids: kg, g (mais pas ml, l)
    // Patterns: kg/ha, g/ha, kg/a, g/a, kg/m2, g/m2, kg/100L, g/100L, kg/10L, g/10L, g/L, Kg
    
    // 1. Contient 'kg' → Kg
    if (unit.includes('kg')) {
      return 'Kg';
    }
    
    // 2. Commence par 'g/' ou 'g ' (gramme par...) → Kg
    if (unit.startsWith('g/') || unit.startsWith('g ')) {
      return 'Kg';
    }
    
    // 3. Contient '/g' (par gramme) → Kg (cas rare mais possible)
    if (unit.includes('/g')) {
      return 'Kg';
    }
    
    // 4. Exactement 'g' (gramme seul) → Kg
    if (unit === 'g') {
      return 'Kg';
    }
    
    // Tout le reste (L, ml, L/ha, ml/ha, L/100L, ml/100L, etc.) → L
    return 'L';
  }

  formatToTwoDecimals(value: number | string): string {
    // 🔧 Inclure le timestamp de refresh pour forcer la mise à jour
    const refreshKey = this.editingTreatment?.frontend_refresh_key || '';

    // Convertir en nombre si c'est une string
    const numValue = typeof value === 'string' ? parseFloat(value) : value;

    return numValue ? numValue.toFixed(2) : '0.00';
  }

  getTotalQuantityUsed(): number {
    // 🔧 CORRECTION: Seulement retourner le total sans recalculer la répartition
    if (this.getCurrentTreatment().length > 0) {
      const treatment = this.getCurrentTreatment()[0];
      const totalVoulu = treatment.treatment_total_quantity_used || 0;
      
      // ⚠️ IMPORTANT: Ne plus recalculer automatiquement ici car cela crée une boucle infinie
      // La répartition ne doit être faite que lors de modifications explicites
      
      // S'assurer de retourner un nombre
      return typeof totalVoulu === 'string' ? parseFloat(totalVoulu) || 0 : totalVoulu || 0;
    }
    return 0;
  }

  getComponentDosesForDisplay(): { name: string; dose: string; unit: string }[] {
    const components: any[] = this.currentTreatmentDraft?.treatment_composition || [];
    return components
      .map((c: any) => ({
        name: c.component_name || c.product_name || '',
        dose: parseFloat(c.component_dose || 0).toFixed(2),
        unit: c.component_dose_unit || ''
      }))
      .filter((c) => parseFloat(c.dose) > 0);
  }

  /**
   * 🔧 Détermine si au moins un produit est dosé en unité de poids (kg, g)
   */
  hasWeightBasedProducts(): boolean {
    if (this.getCurrentTreatment().length > 0) {
      const treatment = this.getCurrentTreatment()[0];
      
      if (treatment.treatment_composition && treatment.treatment_composition) {
        return treatment.treatment_composition.some((component: any) => {
          const unit = component.component_dose_unit || '';
          return this.getQuantityUnitFromDoseUnit(unit) === 'Kg';
        });
      }
    }
    return false;
  }

  /**
   * 🔧 Retourne l'unité d'affichage appropriée selon le type de produits
   * Utilise la propriété component_quantity_unity de l'API si disponible
   */
  /**
   * 🥣 Détecte si le traitement courant est en mode bouillie
   */
  private isBouillieMode(): boolean {
    if (this.getCurrentTreatment().length > 0) {
      const treatment = this.getCurrentTreatment()[0];
      return treatment.strategy === 'bouillie' || 
             treatment.type?.includes('porridge') || 
             (treatment.type && treatment.type.includes('bouillie'));
    }
    return false;
  }

  getDisplayUnit(): string {
    // 🥣 EN MODE BOUILLIE : Toujours afficher "L" même si component_quantity_unity est "Kg"
    if (this.isBouillieMode()) {
      return 'L';
    }
    
    if (this.getCurrentTreatment().length > 0) {
      const treatment = this.getCurrentTreatment()[0];
      
      if (treatment.treatment_composition && treatment.treatment_composition) {
        // Utiliser component_quantity_unity de l'API si disponible
        const firstComponent = treatment.treatment_composition;
        if (firstComponent && firstComponent.component_quantity_unity) {
          return firstComponent.component_quantity_unity;
        }
        
        // Fallback sur l'ancienne méthode de détection
        return this.hasWeightBasedProducts() ? 'Kg' : 'L';
      }
    }
    return 'L'; // Défaut
  }

  /**
   * 🔧 Méthode pour forcer le rafraîchissement des valeurs d'input
   */
  getRefreshedValue(value: any): any {
    // Ajouter une clé unique pour forcer Angular à re-rendre
    return value + (this.forceTemplateRefresh ? 0 : 0);
  }

  /**
   * Debug helper pour voir les données parcellaires utilisées dans le template
   */
  debugParcelData(parcel: any, field: string): any {
    const value = parcel[field];
    return value;
  }

  /**
   * NOUVELLE MÉTHODE SPÉCIFIQUE : Debug pour l'affichage dans le tableau de répartition
   */
  debugTemplateValue(parcel: any, field: string, context: string = ''): any {
    const value = parcel[field];
    return value;
  }

  getCurrentTreatment(): any[] {
    
    //  PRIORITÉ ABSOLUE : currentTreatmentDraft en mode édition (contient les modifs locales)
    if (this.isEditMode && this.currentTreatmentDraft && this.currentTreatmentDraft.parcels_concerned) {
      // 🔧 IMPORTANT : Retourner une référence directe (pas de spread) pour que les modifications
      // sur treatmentToUpdate dans updateQuantityAndSave() modifient bien currentTreatmentDraft
      return [this.currentTreatmentDraft];
    }
    
    if (this.isEditMode && this.editingTreatment?.parcels_concerned?.length) {
      this.editingTreatment.parcels_concerned.forEach((p: any, i: number) => {
      });
    }

    
    // 🔄 Vérifier si nous avons un cache valide et un refresh key correspondant
    const currentRefreshKey = this.editingTreatment?.frontend_refresh_key || '';
    
    // En mode modification sans draft, retourner le traitement en cours de modification
    if (this.isEditMode && this.editingTreatment) {
   
      
      // 🔧 DEBUG pour mode bouillie : afficher les volumes de chaque parcelle
      if (this.editingTreatment.strategy === 'bouillie' && this.editingTreatment.parcels_concerned?.length) {
        this.editingTreatment.parcels_concerned.forEach((p: any, i: number) => {
        });
      }
      
      // 🥣 MODE BOUILLIE : FORCE LE RECHARGEMENT DEPUIS LE SERVEUR à chaque appel
      const isBouillie = this.editingTreatment.strategy === 'bouillie' || 
                        this.editingTreatment.type === 'phyto_porridge_treatment' ||
                        this.getTreatmentType() === 'phyto_porridge_treatment';
      
      if (isBouillie) {
        if (this.editingTreatment.parcels_concerned?.length) {
          this.editingTreatment.parcels_concerned.forEach((p: any, i: number) => {
          });
        }
        
        // ⚠️ SOLUTION IMMÉDIATE : FORCER la mise à jour dès maintenant
        const eventId = this.editingTreatment.event_id;
        if (eventId && !this.fetchingTreatmentIds.has(eventId)) {
          
          // Marquer comme en cours pour éviter les doublons
          this.fetchingTreatmentIds.add(eventId);
          
          // Appel HTTP IMMÉDIAT et SYNCHRONE
          this.httpClient.get<any>(`${environment.apiRegistre}/phyto_treatments/${eventId}`).pipe(
            map(treatmentFromApi),
            catchError(() => of(null))
          ).subscribe({
            next: (freshTreatment: any) => {
              this.fetchingTreatmentIds.delete(eventId);

              if (freshTreatment && freshTreatment.parcels_concerned?.length) {
                freshTreatment.parcels_concerned.forEach((p: any, i: number) => {
                });
                
                // Mettre à jour IMMÉDIATEMENT sans Number() conversion
                this.editingTreatment = { ...freshTreatment };
                this.editingTreatment.frontend_refresh_key = Date.now().toString();
                
                // Forcer la détection des changements IMMÉDIATEMENT
                this.cdr.markForCheck();
                this.cdr.detectChanges();
                
                if (this.editingTreatment.parcels_concerned?.length) {
                  this.editingTreatment.parcels_concerned.forEach((p: any, i: number) => {
                  });
                }
              }
            },
            error: (error: any) => {
              this.fetchingTreatmentIds.delete(eventId);
            }
          });
        }
      }
      
      // 🔧 Forcer une nouvelle référence si nécessaire
      if (this.templateRefreshKey !== currentRefreshKey) {
        this.templateRefreshKey = currentRefreshKey;
        // Make a deep clone and ensure per-parcel treatment_volume_applied values are present
        const cloned = JSON.parse(JSON.stringify(this.editingTreatment));
        
        // 🥣 PROTECTION MODE BOUILLIE : Pas de conversion Number() en mode bouillie
        const isBouillieCloned = cloned.strategy === 'bouillie' || 
                                cloned.type === 'phyto_porridge_treatment' ||
                                (cloned.type && cloned.type.includes('porridge'));
        
        try {
          if (cloned && cloned.parcels_concerned && Array.isArray(cloned.parcels_concerned) && cloned.parcels_concerned) {
            if (isBouillieCloned) {
              // AUCUNE modification des données en mode bouillie
            } else {
              cloned.parcels_concerned = cloned.parcels_concerned.map((p: any) => ({
                ...p,
                treatment_volume_applied: p.treatment_volume_applied !== undefined && p.treatment_volume_applied !== null
                  ? Number(p.treatment_volume_applied)
                  : 0
              }));
            }
          }
        } catch (err) {
        }

        this.treatmentDataCache = [cloned];
        return this.treatmentDataCache;
      }

      // Ensure even the live editingTreatment exposes treatment_volume_applied for template binding
      // 🥣 PROTECTION MODE BOUILLIE : Pas de conversion Number() en mode bouillie
      const isBouillieEdit = this.editingTreatment.strategy === 'bouillie' || 
                           this.editingTreatment.type === 'phyto_porridge_treatment' ||
                           (this.editingTreatment.type && this.editingTreatment.type.includes('porridge'));
      
      try {
        if (this.editingTreatment && this.editingTreatment.parcels_concerned && Array.isArray(this.editingTreatment.parcels_concerned) && this.editingTreatment.parcels_concerned) {
          if (isBouillieEdit) {
            // AUCUNE modification des données en mode bouillie
          } else {
            this.editingTreatment.parcels_concerned = this.editingTreatment.parcels_concerned.map((p: any) => ({
              ...p,
              treatment_volume_applied: p.treatment_volume_applied !== undefined && p.treatment_volume_applied !== null
                ? Number(p.treatment_volume_applied)
                : 0
            }));
          }
        }
      } catch (err) {
        // noop
      }

      return [this.editingTreatment];
    }
    
    //  NOUVEAU SYSTÈME : En mode création, retourner le draft local
    if (this.currentTreatmentDraft && this.currentTreatmentDraft.parcels_concerned && 
        this.currentTreatmentDraft.parcels_concerned.length > 0) {
      
      //  Le draft a déjà la structure correcte parcels_concerned[[parcelles]]
      // Pas besoin de wrapper dans un array supplémentaire
      return [{
        ...this.currentTreatmentDraft
      }];
    }
    
    return [];
  }

  getTreatmentType(): string {
    // 🔧 AMÉLIORATION: Détecter le type depuis plusieurs sources
    
    // 1. Priorité au formulaire (mode création)
    const formType = this.formTraitement.value.type;
    if (formType) {
      return formType;
    }
    
    // 2. Fallback sur editingTreatment (mode modification)
    if (this.isEditMode && this.editingTreatment?.type) {
      return this.editingTreatment.type;
    }
    
    // 3. Détecter selon l'étape actuelle (mode création)
    if (this.traitement === "volument de bouillie utilisee" || 
        (this.treatment_total_quantity_used && this.treatment_total_quantity_used.value)) {
      return 'phyto_porridge_treatment';
    }
    
    // 4. Par défaut : mode surface
    return 'phyto_surface_treatment';
  }

  onSurfaceChange(parcelId: number, value: string, eventId?: string, cropId?: string): void {
    const numericValue = parseFloat(value) || 0;
    
    //  NOUVEAU SYSTÈME : Toujours mise à jour locale dans le draft
    // La sauvegarde sera faite lors de la validation finale
    this.updateParcelValueLocally(parcelId, 'parcel_surface_treated', numericValue, cropId);
  }

  /**
   * Retourne le volume de bouillie appliqué sur une parcelle en mode surface.
   * Utilise treatment_volume_applied stocké si > 0, sinon le calcule proportionnellement :
   * volume = (standard_surface_treated / total_surface) × total_quantité_liquide_des_produits
   */
  getParcelVolumeForDisplay(items: any): string {
    const stored = parseFloat(items.treatment_volume_applied || 0);
    if (stored > 0) return this.formatToTwoDecimals(stored);

    const totalSurface = this.currentTreatmentDraft?.total_surface || 0;
    const parcelSurface = parseFloat(items.standard_surface_treated || 0);
    if (!totalSurface || !parcelSurface) return '0.00';

    const ratio = parcelSurface / totalSurface;
    const components: any[] = this.currentTreatmentDraft?.treatment_composition || [];
    const totalLiquidQty = components
      .filter((c: any) => (c.component_quantity_unity || 'L').toLowerCase() === 'l')
      .reduce((sum: number, c: any) => sum + parseFloat(c.component_quantity || 0), 0);

    return this.formatToTwoDecimals(ratio * totalLiquidQty);
  }

  /**
   * Retourne la surface totale d'une parcelle (parcel_surface) arrondie à 3 décimales.
   * Utilisé comme max du slider de % de surface traitée.
   */
  getParcelTotalSurface(items: any): number {
    return parseFloat(items.parcel_surface || items.parcel_area || 0);
  }

  /**
   * Retourne le pourcentage de surface traitée (0-100) pour une parcelle.
   */
  getParcelSurfacePct(items: any): number {
    const total = this.getParcelTotalSurface(items);
    if (!total) return 100;
    const treated = parseFloat(items.parcel_surface_treated || 0);
    return Math.round((treated / total) * 100);
  }

  /**
   * Appelée quand le slider de % de surface est modifié.
   * Recalcule parcel_surface_treated, standard_surface_treated et standard_total_surface_treated.
   * En mode bouillie/quantité : pas d'effet sur les champs quantité/volume — uniquement les surfaces.
   * En mode surface : déclenche le recalcul complet habituel.
   */
  onParcelSurfacePctChange(items: any, pct: number, eventId?: string): void {
    const total = this.getParcelTotalSurface(items);
    const newSurface = parseFloat(((pct / 100) * total).toFixed(2));
    const treatmentType = this.getTreatmentType();

    if (treatmentType === 'phyto_surface_treatment') {
      // Mode surface : comportement normal — recalcule quantités
      this.updateParcelValueLocally(items.parcel_id, 'parcel_surface_treated', newSurface, items.crop_id);
    } else {
      // Mode bouillie / quantité : modifier uniquement les champs surface, PAS les volumes ni les quantités
      if (!this.currentTreatmentDraft?.parcels_concerned?.length) return;
      this.currentTreatmentDraft.parcels_concerned = this.currentTreatmentDraft.parcels_concerned.map((parcel: any) => {
        const parcelMatch = parcel.parcel_id === items.parcel_id;
        const cropMatch = !items.crop_id || parcel.crop_id === items.crop_id || parcel.crop_id === String(items.crop_id);
        if (parcelMatch && cropMatch) {
          const conversionFactor = this.http.onReference(parcel.surface_unit || 'ha');
          return { ...parcel, parcel_surface_treated: newSurface, standard_surface_treated: newSurface * conversionFactor };
        }
        return parcel;
      });
      // Recalcule uniquement standard_total_surface_treated
      this.recalculateTotalSurface();
      if (treatmentType === 'phyto_quantity_treatment') {
        // Recalcule les doses dérivées depuis les quantités fixes
        this.recalculateComponentQuantities();
      }
      this.cdr.detectChanges();
    }
  }

  onQuantityChange(parcelId: number, value: string, eventId?: string, cropId?: string): void {
    const numericValue = parseFloat(value) || 0;
    this.setParcelVolumeApplied(parcelId, cropId, numericValue);
  }

  /**
   * Nom du champ parcelle portant la répartition manuelle, selon le mode : le volume de
   * bouillie (Bouillie) ou la quantité de produit (Quantité). Toutes les méthodes de
   * répartition/verrouillage ci-dessous sont génériques et lisent ce champ.
   */
  private getAllocatedField(): string {
    return this.getTreatmentType() === 'phyto_quantity_treatment' ? 'parcel_quantity_applied' : 'treatment_volume_applied';
  }

  /**
   * Pourcentage de la quantité TOTALE (treatment_total_quantity_used) appliqué sur cette
   * parcelle — pas un pourcentage de surface. Ex: 75L/75kg sur un total de 100 => slider à 75%.
   * Modes Bouillie et Quantité.
   */
  getParcelVolumePct(items: any): number {
    const total = this.getTotalQuantityUsed();
    if (!total) return 0;
    const applied = parseFloat(items[this.getAllocatedField()] || 0);
    return Math.min(100, Math.round((applied / total) * 100));
  }

  /**
   * Appelée quand le slider de % (Bouillie ou Quantité) est modifié. Recalcule la valeur
   * répartie = (pct/100) × quantité totale utilisée, en synchro avec le champ numérique.
   */
  onParcelVolumePctChange(items: any, pct: number, eventId?: string): void {
    const total = this.getTotalQuantityUsed();
    const newVolume = parseFloat(((pct / 100) * total).toFixed(2));
    this.setParcelVolumeApplied(items.parcel_id, items.crop_id, newVolume);
  }

  /**
   * Somme des valeurs réparties par parcelle (modes Bouillie/Quantité), pour détecter un
   * écart avec la quantité totale utilisée quand l'utilisateur ajuste sliders/champs.
   */
  getTotalVolumeApplied(): number {
    const field = this.getAllocatedField();
    const parcels = this.currentTreatmentDraft?.parcels_concerned || [];
    return parcels.reduce((sum: number, p: any) => sum + (parseFloat(p[field]) || 0), 0);
  }

  /**
   * Vrai si la somme des volumes appliqués par parcelle ne correspond pas (trop ou pas assez)
   * à la quantité totale utilisée, avec une petite tolérance pour les arrondis. Bloque la
   * validation du traitement tant que ce n'est pas corrigé (voir hasValidRepartition()).
   */
  isVolumeMismatched(): boolean {
    const total = this.getTotalQuantityUsed();
    if (!total) return false;
    return Math.abs(this.getTotalVolumeApplied() - total) > 0.01;
  }

  /** Message d'avertissement adapté au sens de l'écart (trop réparti / pas assez réparti). */
  getVolumeMismatchMessage(): string {
    const total = this.getTotalQuantityUsed();
    const applied = this.getTotalVolumeApplied();
    const unit = this.getDisplayUnit();
    if (applied > total) {
      return `La somme des quantités appliquées par parcelle (${this.formatToTwoDecimals(applied)} ${unit}) dépasse la quantité totale utilisée (${this.formatToTwoDecimals(total)} ${unit}).`;
    }
    return `La somme des quantités appliquées par parcelle (${this.formatToTwoDecimals(applied)} ${unit}) est inférieure à la quantité totale utilisée (${this.formatToTwoDecimals(total)} ${unit}) — il reste ${this.formatToTwoDecimals(total - applied)} ${unit} à répartir.`;
  }

  /**
   * 🔒 Mode Bouillie : "fixer la quantité" — quand actif, la quantité totale utilisée
   * (treatment_total_quantity_used) ne bouge plus au fil des modifications de répartition ;
   * c'est l'inverse du comportement par défaut (où le total suit la somme des parcelles).
   */
  isTotalQuantityLocked(): boolean {
    // Activé par défaut (modes Bouillie/Quantité) tant que l'utilisateur n'a pas
    // explicitement décoché — undefined (jamais touché) est donc traité comme "fixé".
    const flag = this.currentTreatmentDraft?.treatment_total_quantity_locked;
    return flag === undefined ? true : !!flag;
  }

  onToggleTotalQuantityLocked(checked: boolean): void {
    if (!this.currentTreatmentDraft) return;
    this.currentTreatmentDraft.treatment_total_quantity_locked = checked;
    // Empêche aussi de modifier le total depuis l'étape "Volume de bouillie" tant qu'il est fixé.
    if (checked) {
      this.treatment_total_quantity_used.disable();
    } else {
      this.treatment_total_quantity_used.enable();
    }
    this.cdr.detectChanges();
  }

  /**
   * 🔒 Par parcelle : exclut cette parcelle du rééquilibrage automatique déclenché par la
   * modification d'une AUTRE parcelle (elle reste modifiable directement elle-même).
   */
  isParcelVolumeLocked(items: any): boolean {
    return !!items.volume_locked;
  }

  onToggleParcelVolumeLocked(items: any, checked: boolean): void {
    if (!this.currentTreatmentDraft?.parcels_concerned?.length) return;
    this.currentTreatmentDraft.parcels_concerned = this.currentTreatmentDraft.parcels_concerned.map((p: any) => {
      const parcelMatch = p.parcel_id === items.parcel_id;
      const cropMatch = !items.crop_id || p.crop_id === items.crop_id || p.crop_id === String(items.crop_id);
      return (parcelMatch && cropMatch) ? { ...p, volume_locked: checked } : p;
    });
    this.cdr.detectChanges();
  }

  /**
   * Quantité (L) encore disponible pour cette parcelle quand le total est fixé : le total
   * moins ce qui est déjà retenu par les AUTRES parcelles verrouillées. Sert de plafond au
   * slider/champ de cette parcelle pour qu'on ne puisse jamais dépasser la quantité fixée.
   * Hors mode "total fixé", retourne simplement le total (pas de plafond spécifique).
   */
  getMaxAllowedVolume(items: any): number {
    const total = this.getTotalQuantityUsed();
    if (!this.isTotalQuantityLocked() || !total) return total || 0;
    const field = this.getAllocatedField();
    const parcels = this.currentTreatmentDraft?.parcels_concerned || [];
    const lockedSumExcludingThis = parcels
      .filter((p: any) => p !== items && p.volume_locked)
      .reduce((sum: number, p: any) => sum + (parseFloat(p[field]) || 0), 0);
    return Math.max(0, total - lockedSumExcludingThis);
  }

  /** Version en % (0-100) de getMaxAllowedVolume, utilisée comme [max] du slider. */
  getMaxAllowedVolumePct(items: any): number {
    const total = this.getTotalQuantityUsed();
    if (!total) return 100;
    return Math.max(0, Math.min(100, Math.round((this.getMaxAllowedVolume(items) / total) * 100)));
  }

  /** Quantité restant à répartir (mode Bouillie, total fixé) : total - somme déjà appliquée. */
  getRemainingToAllocate(): number {
    const total = this.getTotalQuantityUsed();
    return Math.max(0, parseFloat((total - this.getTotalVolumeApplied()).toFixed(2)));
  }

  /** Remplissage simple du slider de répartition (mode Bouillie) : bleu = attribué, gris = libre. */
  getVolumeSliderBackground(items: any): string {
    const pct = this.getParcelVolumePct(items);
    return `linear-gradient(to right, #0ea5e9 0%, #0ea5e9 ${pct}%, #e5e7eb ${pct}%, #e5e7eb 100%)`;
  }

  /**
   * Modes Bouillie/Quantité : applique une nouvelle valeur répartie (volume de bouillie ou
   * quantité de produit, selon getAllocatedField()) sur une parcelle.
   * - Total NON fixé (comportement historique) : le total utilisé s'ajuste sur la somme
   *   des valeurs par parcelle (mode Quantité : délègue à onParcelQuantityAppliedChange,
   *   qui redistribue aussi les doses des produits).
   * - Total fixé ("fixer la quantité" coché) : le total reste constant ; l'écart est
   *   réparti proportionnellement sur les AUTRES parcelles non verrouillées (une parcelle
   *   "fixée" via sa propre checkbox n'est jamais touchée par le rééquilibrage des autres,
   *   mais reste modifiable directement).
   */
  private setParcelVolumeApplied(parcelId: number, cropId: string | undefined, newValue: number): void {
    if (!this.currentTreatmentDraft?.parcels_concerned?.length) return;
    const field = this.getAllocatedField();
    const matches = (p: any) => p.parcel_id === parcelId && (!cropId || p.crop_id === cropId || p.crop_id === String(cropId));
    const parcels: any[] = this.currentTreatmentDraft.parcels_concerned;
    const target = parcels.find(matches);
    if (!target) return;

    // Plafonne à la quantité encore disponible quand le total est fixé : impossible de
    // pousser un slider (ou de taper une valeur) au-delà de la limite mentionnée.
    const upperBound = this.isTotalQuantityLocked() ? this.getMaxAllowedVolume(target) : Infinity;
    const clampedValue = Math.min(Math.max(0, newValue), upperBound);

    if (this.isTotalQuantityLocked()) {
      const total = this.getTotalQuantityUsed();
      const others = parcels.filter((p: any) => p !== target && !p.volume_locked);
      const lockedSum = parcels
        .filter((p: any) => p !== target && p.volume_locked)
        .reduce((sum: number, p: any) => sum + (parseFloat(p[field]) || 0), 0);
      const remaining = Math.max(0, total - clampedValue - lockedSum);
      const othersCurrentSum = others.reduce((sum: number, p: any) => sum + (parseFloat(p[field]) || 0), 0);

      this.currentTreatmentDraft.parcels_concerned = parcels.map((p: any) => {
        if (p === target) {
          return { ...p, [field]: clampedValue };
        }
        if (others.includes(p)) {
          const share = othersCurrentSum > 0
            ? (parseFloat(p[field]) || 0) / othersCurrentSum
            : (others.length ? 1 / others.length : 0);
          return { ...p, [field]: parseFloat((remaining * share).toFixed(2)) };
        }
        return p;
      });
      // Le total reste inchangé par définition dans ce mode.
      this.recalculateComponentQuantities();
      this.cdr.detectChanges();
    } else if (this.getTreatmentType() === 'phyto_quantity_treatment') {
      // Réutilise la logique existante : met à jour le total ET redistribue les doses des
      // produits proportionnellement (voir onParcelQuantityAppliedChange).
      this.onParcelQuantityAppliedChange(parcelId, String(clampedValue), undefined, cropId);
    } else {
      // Comportement historique (Bouillie) : le total suit la somme des volumes par parcelle.
      this.currentTreatmentDraft.parcels_concerned = parcels.map((p: any) =>
        p === target ? { ...p, [field]: clampedValue } : p
      );
      const totalApplied = this.currentTreatmentDraft.parcels_concerned
        .reduce((sum: number, p: any) => sum + (parseFloat(p[field]) || 0), 0);
      this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(totalApplied.toFixed(2));
      this.recalculateComponentQuantities();
      this.cdr.detectChanges();
    }
  }

  onParcelQuantityAppliedChange(parcelId: number, value: string, eventId?: string, cropId?: string): void {
    const numericValue = parseFloat(value) || 0;
    if (!this.currentTreatmentDraft?.parcels_concerned?.length) return;

    this.currentTreatmentDraft.parcels_concerned = this.currentTreatmentDraft.parcels_concerned.map((parcel: any) => {
      const parcelMatch = parcel.parcel_id === parcelId;
      const cropMatch = !cropId || parcel.crop_id === cropId || parcel.crop_id === String(cropId);
      if (parcelMatch && cropMatch) {
        return { ...parcel, parcel_quantity_applied: numericValue };
      }
      return parcel;
    });

    // Recalculer le total = somme de toutes les quantités par parcelle
    const parcels = this.currentTreatmentDraft.parcels_concerned;
    const newTotal = parcels.reduce((sum: number, p: any) => sum + parseFloat(p.parcel_quantity_applied || '0'), 0);
    const oldTotal = parseFloat(this.currentTreatmentDraft.treatment_total_quantity_used || '0');
    this.currentTreatmentDraft.treatment_total_quantity_used = parseFloat(newTotal.toFixed(2));

    // Redistribuer les quantités de chaque composant proportionnellement au changement de total
    const totalSurface = this.currentTreatmentDraft.total_surface || 0;
    const components = this.currentTreatmentDraft.treatment_composition || [];
    for (const component of components) {
      const compQty = parseFloat(component.component_quantity || '0');
      const newQty = oldTotal > 0 ? (compQty / oldTotal) * newTotal : newTotal / (components.length || 1);
      component.component_quantity = parseFloat(newQty.toFixed(2));
      const rawUnit = component.component_dose_unit || 'L';
      const baseUnit = rawUnit.replace('/ha', '').replace('/are', '').replace('/m²', '');
      component.component_quantity_unity = baseUnit;
      component.component_dose_unit = baseUnit + '/ha';
      component.component_dose = parseFloat((totalSurface > 0 ? newQty / totalSurface : 0).toFixed(6));
      component.standard_component_dose = component.component_dose;
    }

    this.cdr.detectChanges();
  }

  /**
   * Mise à jour automatique du champ BBCH
   */
  // MÉTHODES SUPER SIMPLES POUR BBCH ET EVENT_HOUR
  private bbchTimeout: any;
  private eventHourTimeout: any;

  saveBbch(event: any): void {
    const value = event.target.value;
    
    // Annuler le précédent délai
    if (this.bbchTimeout) {
      clearTimeout(this.bbchTimeout);
    }
    
    //  NOUVEAU SYSTÈME : Mise à jour locale dans le draft uniquement
    this.bbchTimeout = setTimeout(() => {
      if (this.currentTreatmentDraft) {
        this.currentTreatmentDraft.bbch = value;
      }
    }, 500);
  }

  saveEventHour(event: any): void {
    const value = event.target.value;
    
    // Annuler le précédent délai
    if (this.eventHourTimeout) {
      clearTimeout(this.eventHourTimeout);
    }
    
    //  NOUVEAU SYSTÈME : Mise à jour locale dans le draft uniquement
    this.eventHourTimeout = setTimeout(() => {
      if (this.currentTreatmentDraft) {
        this.currentTreatmentDraft.event_hour = value;
      }
    }, 500);
  }

  private saveFieldDirectly(fieldName: string, value: string): void {
    //  NOUVEAU SYSTÈME : Cette méthode n'est plus utilisée
    // Les champs sont maintenant mis à jour directement dans currentTreatmentDraft
    // La sauvegarde sera faite lors de la validation finale
    if (this.currentTreatmentDraft) {
      this.currentTreatmentDraft[fieldName] = value;
    }
  }

  onBbchChange(value: string, eventId?: string): void {
    this.saveFieldDirectly('bbch', value);
  }

  /**
   * Mise à jour automatique du champ event_hour
   */
  onEventHourChange(value: string, eventId?: string): void {
    this.saveFieldDirectly('event_hour', value);
  }

  /**
   * Mise à jour automatique du champ remarque
   */
  onRemarqueChange(value: string, eventId?: string): void {
    this.updateTreatmentFieldAndSave('remarque', value, eventId);
  }

  /**
   * Mise à jour automatique du champ remarque
   */
  onRemarqueInputChange(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    if (target && target.value !== undefined) {
      const currentTreatment = this.getCurrentTreatment()[0];
      this.onRemarqueChange(target.value, currentTreatment?.event_id);
    }
  }

  /**
   * Méthode générique pour mettre à jour un champ de traitement et sauvegarder immédiatement
   */
  private updateTreatmentFieldAndSave(field: string, value: string, eventId?: string): void {

    // 1. Récupérer le traitement actuel selon le mode (modification ou création)
    const currentTreatments = this.getCurrentTreatment();
    if (!currentTreatments || currentTreatments.length === 0) {
      return;
    }

    // 2. En mode modification, utiliser directement le traitement en cours
    // En mode création, chercher par eventId si fourni, sinon prendre le premier  
    let treatmentToUpdate = currentTreatments[0];
    if (!this.isEditMode && eventId) {
      const foundTreatment = currentTreatments.find((t: any) => t.event_id === eventId);
      if (foundTreatment) {
        treatmentToUpdate = foundTreatment;
      }
    }

    if (!treatmentToUpdate) {
      return;
    }

    // 3. Mettre à jour le champ dans le traitement
    treatmentToUpdate[field] = value;

    // 4. Consolidation des calculs si nécessaire
    if (['bbch', 'event_hour', 'remarque'].includes(field)) {
      const result = this.calculationService.consolidateAllCalculations(treatmentToUpdate);
    }

    // 5. Sauvegarder immédiatement sur le serveur
    this.http.updatePhytoTreatmentFinal(treatmentToUpdate.event_id, treatmentToUpdate).subscribe({
      next: (response: any) => {
        
        // 5. En mode modification, mettre à jour la référence locale
        if (this.isEditMode) {
          this.editingTreatment = treatmentToUpdate;
        } else {
          // 5. En mode création, mettre à jour le signal local
          const allTreatments = this.getSignalTotalTrainement();
          const updatedTreatments = allTreatments.map((t: any) => 
            t.event_id === treatmentToUpdate.event_id ? treatmentToUpdate : t
          );
          this.http.signalGetTableauGeneralTraitement.set(updatedTreatments);
        }
        
        // 6. Mettre à jour le formulaire aussi
        if (this.formTraitement) {
          this.formTraitement.patchValue({ [field]: value }, { emitEvent: false });
        }
        
        // 7. Mettre à jour l'inventaire si c'est un traitement bouillie et si les calculs ont été modifiés
        if (['bbch', 'event_hour', 'remarque'].includes(field)) {
          this.updateInventoryForBouillieRecalculation(treatmentToUpdate);
        }
        
        // 8. Forcer la détection des changements
        this.cdr.detectChanges();
      },
      error: (error: any) => {
      }
    });
  }

  /**
   * Méthode unifiée et simplifiée pour mettre à jour une quantité et sauvegarder immédiatement
   */
  private updateQuantityAndSave(parcelId: number, field: string, value: number, eventId?: string, cropId?: string): void {

    // 1. Récupérer le traitement actuel selon le mode (modification ou création)
    const currentTreatments = this.getCurrentTreatment();
    if (!currentTreatments || currentTreatments.length === 0) {
      return;
    }

    // 2. En mode modification, utiliser directement le traitement en cours
    // En mode création, chercher par eventId si fourni, sinon prendre le premier  
    let treatmentToUpdate = currentTreatments[0];
    if (!this.isEditMode && eventId) {
      const foundTreatment = currentTreatments.find((t: any) => t.event_id === eventId);
      if (foundTreatment) {
        treatmentToUpdate = foundTreatment;
      }
    }

    if (!treatmentToUpdate) {
      return;
    }

    // 3. Mettre à jour la valeur dans le traitement en utilisant le binôme parcelle + culture
    if (treatmentToUpdate.parcels_concerned && treatmentToUpdate.parcels_concerned) {
      treatmentToUpdate.parcels_concerned = treatmentToUpdate.parcels_concerned.map((parcel: any) => {
        // Identifier précisément avec le binôme parcelle + culture
        const parcelMatch = parcel.parcel_id === parcelId;
        const cropMatch = !cropId || parcel.crop_id === cropId || parcel.crop_id === String(cropId);
        
        if (parcelMatch && cropMatch) {
          return { ...parcel, [field]: value };
        }
        return parcel;
      });
    }

    
    // S'assurer que le type est correctement défini dans le traitement
    if (!treatmentToUpdate.type) {
      treatmentToUpdate.type = this.getTreatmentType();
    }
    
    // 🔑 CORRECTION CRITIQUE MODE BOUILLIE : Ne PAS recalculer si modification manuelle de volume
    const isManualVolumeChange = field === 'treatment_volume_applied';
    const isBouillieMode = treatmentToUpdate.type === 'phyto_porridge_treatment';
    let result: any = { modified: false };
    
    if (isManualVolumeChange && isBouillieMode) {
      
      if (treatmentToUpdate.parcels_concerned?.length) {
        // Recalculer treatment_total_quantity_used basé sur les volumes manuels
        const totalUsed = treatmentToUpdate.parcels_concerned.reduce((sum: number, p: any) => {
          return sum + (parseFloat(p.treatment_volume_applied) || 0);
        }, 0);
        treatmentToUpdate.treatment_total_quantity_used = parseFloat(totalUsed.toFixed(2));
        
        // Recalculer les quantités de produits basées sur le nouveau volume total
        if (treatmentToUpdate.treatment_composition?.length) {
          treatmentToUpdate.treatment_composition.forEach((component: any) => {
            if (component.component_dose && component.component_dose_unit) {
              component.component_quantity = parseFloat((
                (parseFloat(component.component_dose) || 0) * totalUsed
              ).toFixed(2));
            }
          });
        }
        
      }
    } else if (field === 'parcel_surface_treated') {
      //  MODIFICATION DE SURFACE : Consolidation complète nécessaire
      result = this.calculationService.consolidateAllCalculations(treatmentToUpdate, false);
    } else {
      //  AUTRES MODIFICATIONS : Consolidation avec skip si volume manuel
      result = this.calculationService.consolidateAllCalculations(treatmentToUpdate, isManualVolumeChange);
    }

    // 5. Sauvegarder immédiatement sur le serveur avec le nouveau système
    const apiEndpoint = `${environment.apiRegistre}/phyto_treatments/${treatmentToUpdate.event_id}`;

    this.httpClient.put(apiEndpoint, treatmentToApi(treatmentToUpdate)).subscribe({
      next: (response: any) => {
        
        // Affichage détaillé des volumes appliqués après mise à jour
        if (treatmentToUpdate.parcels_concerned?.length) {
          treatmentToUpdate.parcels_concerned.forEach((p: any) => {
          });
        }
        
        // 6. En mode modification, mettre à jour DIRECTEMENT les références (pas de copie)
        if (this.isEditMode) {
          // 🔧 CORRECTION : treatmentToUpdate EST déjà currentTreatmentDraft (référence partagée)
          // Donc pas besoin de reassigner, les modifications sont déjà dans le draft
          this.editingTreatment = this.currentTreatmentDraft;
          
        } else {
          // 6. En mode création, mettre à jour le signal local  
          const allTreatments = this.getSignalTotalTrainement();
          const updatedTreatments = allTreatments.map((t: any) => 
            t.event_id === treatmentToUpdate.event_id ? treatmentToUpdate : t
          );
          this.http.signalGetTableauGeneralTraitement.set(updatedTreatments);
        }
        
        // 7. Mettre à jour l'inventaire si c'est un traitement bouillie et si les calculs ont été modifiés
        if (result.modified) {
          this.updateInventoryForBouillieRecalculation(treatmentToUpdate);
        }
        
        // 8. Forcer la détection des changements pour mettre à jour l'affichage
        this.cdr.detectChanges();
        
        // 🔧 NOUVEAU : Mise à jour explicite des données locales pour l'affichage
        if (isManualVolumeChange && field === 'treatment_volume_applied') {
          this.refreshLocalTreatmentData(treatmentToUpdate);
        }
      },
      error: (error: any) => {
        console.error('', error);
      }
    });
  }

  /**
   * Met à jour les données locales après modification backend pour forcer l'affichage
   */
  private refreshLocalTreatmentData(updatedTreatment: any): void {

    
    // Affichage des données parcellaires mises à jour
    if (updatedTreatment.parcels_concerned?.length) {
      updatedTreatment.parcels_concerned.forEach((p: any) => {
      });
    }
    
    // En mode modification, mettre à jour la référence locale
    if (this.isEditMode && this.editingTreatment) {
      this.editingTreatment = { ...updatedTreatment };
    } else {
      // En mode création, mettre à jour le signal
      const allTreatments = this.getSignalTotalTrainement();
      const updatedTreatments = allTreatments.map((t: any) => 
        t.event_id === updatedTreatment.event_id ? { ...updatedTreatment } : t
      );
      this.http.signalGetTableauGeneralTraitement.set(updatedTreatments);
    }
    
    // Forcer le rafraîchissement du template
    this.cdr.detectChanges();
  }

  /**
   * Met à jour une valeur de parcelle dans le signal local
   */
  private updateParcelInSignal(parcelId: number, field: string, value: number): void {
    const currentParcels = this.http.siganlService();
    const updatedParcels = currentParcels.map((parcel: any) => {
      if (parcel.parcel_id === parcelId) {
        return { ...parcel, [field]: value };
      }
      return parcel;
    });
    
    this.http.siganlService.set(updatedParcels);
  }

  /**
   * Met à jour une valeur de parcelle directement sur le serveur
   */
  private updateParcelValue(eventId: string, parcelId: number, field: string, value: number): void {
    
    // Récupérer le traitement actuel pour obtenir les parcelles
    const currentTreatment = this.getCurrentTreatment()[0];
    if (!currentTreatment) return;

    // Trouver et mettre à jour la parcelle
    const updatedTreatment = { ...currentTreatment };
    if (updatedTreatment.parcels_concerned && updatedTreatment.parcels_concerned) {
      updatedTreatment.parcels_concerned = updatedTreatment.parcels_concerned.map((parcel: any) => {
        if (parcel.parcel_id === parcelId) {
          return { ...parcel, [field]: value };
        }
        return parcel;
      });
    }

    // Envoyer la mise à jour au serveur
    const apiUrl = `${environment.apiRegistre}/phyto_treatments/${eventId}`;
    this.httpClient.put(apiUrl, treatmentToApi(updatedTreatment)).subscribe({
      next: (response) => {
        
        // Mettre à jour le signal local aussi
        this.updateLocalTreatmentSignal(updatedTreatment);
      },
      error: (error) => {
      }
    });
  }

  /**
   * NOUVELLE MÉTHODE : Recalcule automatiquement après changement de volume (mode bouillie)
   */
  private recalculateAfterVolumeChange(eventId: string, parcelId: number, newVolume: number): void {
    
    setTimeout(() => { // Délai pour laisser la première mise à jour se terminer
      const currentTreatment = this.getCurrentTreatment()[0];
      if (!currentTreatment) return;

      // 1. RECALCULER LE TOTAL DE VOLUME APPLIQUÉ
      let totalVolumeApplied = 0;
      if (currentTreatment.parcels_concerned && currentTreatment.parcels_concerned) {
        totalVolumeApplied = currentTreatment.parcels_concerned.reduce((total: number, parcel: any) => {
          return total + (parseFloat(parcel.treatment_volume_applied) || 0);
        }, 0);
      }
      

      // 2. RECALCULER LES QUANTITÉS DE PRODUITS basées sur le volume appliqué
      let updatedComponents: any[] = [];
      if (currentTreatment.treatment_composition && currentTreatment.treatment_composition) {
        updatedComponents = currentTreatment.treatment_composition.map((component: any) => {
          // Utiliser la proportion du volume appliqué par rapport au volume de bouillie original
          const originalVolumeTotal = parseFloat(currentTreatment.treatment_total_quantity) || 1;
          const ratio = totalVolumeApplied / originalVolumeTotal;
          const adjustedQuantity = (parseFloat(component.component_quantity) || 0) * ratio;
          
          
          return {
            ...component,
            component_quantity: adjustedQuantity
          };
        });
      }

      // 3. RECALCULER LE TOTAL DES QUANTITÉS UTILISÉES
      const totalQuantityUsed = updatedComponents.reduce((total: number, component: any) => {
        return total + (parseFloat(component.component_quantity) || 0);
      }, 0);
      

      // 4. PRÉPARER LE TRAITEMENT COMPLET RECALCULÉ
      const recalculatedTreatment = {
        ...currentTreatment,
        treatment_composition: updatedComponents,
        treatment_total_quantity_used: totalQuantityUsed,
        treatment_total_volume_applied: totalVolumeApplied,
        modified_at: new Date().toISOString(),
        recalculated: true
      };

      // 5. SAUVEGARDER LES NOUVEAUX CALCULS SUR LE SERVEUR
      const apiUrl = `${environment.apiRegistre}/phyto_treatments/${eventId}`;
      this.httpClient.put(apiUrl, treatmentToApi(recalculatedTreatment)).subscribe({
        next: (response) => {
          
          // 6. METTRE À JOUR L'INVENTAIRE POUR TRAITEMENT BOUILLIE
          this.updateInventoryForBouillieRecalculation(recalculatedTreatment);
          
          // 7. METTRE À JOUR LE SIGNAL LOCAL AVEC LES NOUVEAUX CALCULS
          this.updateLocalTreatmentSignal(recalculatedTreatment);
          
          // 8. FORCER LA DÉTECTION DES CHANGEMENTS
          this.cdr.detectChanges();
        },
        error: (error) => {
        }
      });
    }, 100);
  }

  /**
   * NOUVELLE MÉTHODE : Recalcule automatiquement après changement de surface
   */
  private recalculateAfterSurfaceChange(eventId: string, parcelId: number, newSurface: number): void {
    
    setTimeout(() => { // Délai pour laisser la première mise à jour se terminer
      const currentTreatment = this.getCurrentTreatment()[0];
      if (!currentTreatment) return;

      // 1. RECALCULER LE TOTAL DE SURFACE TRAITÉE
      let totalSurface = 0;
      if (currentTreatment.parcels_concerned && currentTreatment.parcels_concerned) {
        totalSurface = currentTreatment.parcels_concerned.reduce((total: number, parcel: any) => {
          return total + (parseFloat(parcel.parcel_surface_treated) || 0);
        }, 0);
      }
      

      // 2. RECALCULER LES QUANTITÉS DE PRODUITS (component_quantity)
      let updatedComponents: any[] = [];
      if (currentTreatment.treatment_composition && currentTreatment.treatment_composition) {
        updatedComponents = currentTreatment.treatment_composition.map((component: any) => {
          const standardDose = parseFloat(component.standard_component_dose) || 0;
          const newQuantity = standardDose * totalSurface;
          
          
          return {
            ...component,
            component_quantity: newQuantity
          };
        });
      }

      // 3. RECALCULER LE TOTAL DES QUANTITÉS UTILISÉES
      const totalQuantityUsed = updatedComponents.reduce((total: number, component: any) => {
        return total + (parseFloat(component.component_quantity) || 0);
      }, 0);
      

      // 4. RECALCULER LES VOLUMES APPLIQUÉS PAR PARCELLE
      let updatedParcels: any[] = [];
      if (currentTreatment.parcels_concerned && currentTreatment.parcels_concerned) {
        updatedParcels = currentTreatment.parcels_concerned.map((parcel: any) => {
          const parcelSurface = parseFloat(parcel.parcel_surface_treated) || 0;
          const volumeApplied = totalSurface > 0 ? totalQuantityUsed * (parcelSurface / totalSurface) : 0;
          
          
          return {
            ...parcel,
            treatment_volume_applied: volumeApplied
          };
        });
      }

      // 5. PRÉPARER LE TRAITEMENT COMPLET RECALCULÉ
      const recalculatedTreatment = {
        ...currentTreatment,
        treatment_composition: updatedComponents,
        treatment_total_quantity_used: totalQuantityUsed,
        parcels_concerned: updatedParcels,
        standard_total_surface_treated: totalSurface,
        modified_at: new Date().toISOString(),
        recalculated: true
      };


      // 6. SAUVEGARDER LES NOUVEAUX CALCULS SUR LE SERVEUR
      const apiUrl = `${environment.apiRegistre}/phyto_treatments/${eventId}`;
      this.httpClient.put(apiUrl, treatmentToApi(recalculatedTreatment)).subscribe({
        next: (response) => {

          // 7. METTRE À JOUR L'INVENTAIRE POUR TRAITEMENT BOUILLIE
          this.updateInventoryForBouillieRecalculation(recalculatedTreatment);
          
          // 8. METTRE À JOUR LE SIGNAL LOCAL AVEC LES NOUVEAUX CALCULS
          this.updateLocalTreatmentSignal(recalculatedTreatment);
          
          // 9. FORCER LA DÉTECTION DES CHANGEMENTS
          this.cdr.detectChanges();
        },
        error: (error) => {
        }
      });
    }, 500); // Délai de 500ms
  }

  /**
   * Met à jour le signal local avec le traitement modifié
   */
  private updateLocalTreatmentSignal(updatedTreatment: any): void {
    // Utiliser le signal des traitements généraux pour la mise à jour
    const currentTreatments = this.getSignalTotalTrainement();
    const updatedTreatments = currentTreatments.map((treatment: any) => {
      if (treatment.event_id === updatedTreatment.event_id) {
        return updatedTreatment;
      }
      return treatment;
    });
    
    this.http.signalGetTableauGeneralTraitement.set(updatedTreatments);
    
    // Si on est en mode modification, mettre à jour le traitement en cours d'édition
    if (this.isEditMode && this.editingTreatment && this.editingTreatment.event_id === updatedTreatment.event_id) {
      this.editingTreatment = updatedTreatment;
    }
    
  }

  // Méthode pour supprimer une parcelle d'un traitement
  removeParcelFromTreatment(eventId: string, parcelId: number): void {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette parcelle du traitement ?')) {
      this.http.removeParcelFromPhytoTreatment(eventId, parcelId).subscribe({
        next: () => {
          // Le signal est déjà mis à jour dans le service
        },
        error: (error: any) => {
          alert('Erreur lors de la suppression de la parcelle');
        }
      });
    }
  }

  /**
   *  NOUVEAU SYSTÈME : Supprime un produit du traitement (draft local uniquement)
   * La sauvegarde se fera lors de la validation finale
   */
  removeProductFromTreatment(componentId: string): void {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce produit du traitement ?')) {
      return;
    }

    // 1. Supprimer le produit du signal local (affichage immédiat)
    const currentProducts = this.getSignalDose();
    const updatedProducts = currentProducts.filter((product: any) => product.component_id !== componentId);
    this.http.signalGetDose.set(updatedProducts);
    
    // 2. Mettre à jour le draft local avec les produits filtrés
    if (this.currentTreatmentDraft) {
      this.currentTreatmentDraft.treatment_composition = updatedProducts;
      
      // Recalculer les quantités après suppression
      this.recalculateComponentQuantities();
      this.recalculateDistribution();
    }

    // 3. Si en mode édition, mettre à jour également editingTreatment
    if (this.isEditMode && this.editingTreatment?.treatment_composition?.length) {
      this.editingTreatment.treatment_composition = updatedProducts;
    }
    
    // 4. Émettre la validation pour mettre à jour le bouton "Valider"
    this.emitValidation();
    
    // 5. Forcer la détection des changements pour l'affichage
    this.cdr.detectChanges();
    

  }

  /**
   * Rouvre l'édition d'un produit déjà ajouté à la composition (surface ou bouillie)
   */
  /**
   * Fait correspondre une unité stockée en base (ex. "l/ha", tout en minuscules côté DB)
   * à la valeur EXACTE (casse comprise) utilisée par les <option> du menu déroulant
   * correspondant. Un <select> HTML n'affiche rien si la valeur qu'on lui donne ne
   * correspond à aucune de ses options — sans ça, "l/ha" ne matche pas "L/ha" et le menu
   * apparaît vide (uniquement pour les unités préfixées par "L", écrites en majuscule
   * dans surfaceUnitOptions/bouillieUnitOptions mais en minuscule en base).
   */
  private normalizeUnitForDropdown(rawUnit: string, mode: 'surface' | 'bouillie'): string {
    if (!rawUnit) return rawUnit;
    const groups = mode === 'bouillie' ? this.bouillieUnitOptions : this.surfaceUnitOptions;
    for (const group of groups) {
      for (const opt of group.options) {
        if (opt.value.toLowerCase() === rawUnit.toLowerCase()) {
          return opt.value;
        }
      }
    }
    return rawUnit;
  }

  editProductFromComposition(item: any, mode: 'surface' | 'bouillie' = 'surface'): void {
    const productId = item.component_id;

    // Retirer le produit du signal pour permettre la ré-édition
    const currentProducts = this.getSignalDose();
    const updatedProducts = currentProducts.filter((p: any) => p.component_id !== productId);
    this.http.signalGetDose.set(updatedProducts);

    // Ouvrir le formulaire d'édition
    if (mode === 'bouillie') {
      this.onAddDoseBouillie(productId);
    } else {
      this.onAddDose(productId);
    }

    // Pré-remplir le formulaire avec les valeurs existantes
    setTimeout(() => {
      const form = this.productForms.get(productId);
      if (form) {
        const rawUnit = item.component_dose_unit || item.component_quantity_unity || this.getDefaultUnit();
        form.patchValue({
          dose: item.component_dose || item.component_quantity || '',
          littre: this.normalizeUnitForDropdown(rawUnit, mode),
          quantity: item.component_quantity || '',
          target: item.target || ''
        });
        if (item.target) {
          // La cible enregistrée peut être une option connue (liste déroulante) OU une
          // saisie libre (ex. "cible 1, cible 2"). Un <select> ne peut afficher une valeur
          // absente de ses <option> : si la cible n'est pas dans la liste, il faut basculer
          // en mode texte libre, sinon le champ apparaît vide et écrase la cible au ré-ajout.
          const knownOptions = this.getTargetOptionsForProduct(productId);
          const isKnownOption = knownOptions.includes(item.target);
          this.targetFreeTextMap?.set(productId, !isKnownOption);
        }
        this.cdr.detectChanges();
      }
    }, 0);
  }

  /**
   * Met à jour les calculs des traitements existants après un changement de parcelles
   * Appelée quand les parcelles sont modifiées à l'étape "selection parcelles"
   */
  private updateTreatmentCalculationsAfterParcelChange(): void {
    
    // Récupérer tous les traitements existants
    const currentTreatments = this.getSignalTotalTrainement();
    
    if (!currentTreatments || currentTreatments.length === 0) {
      return;
    }

    // Mettre à jour chaque traitement avec les nouveaux calculs
    currentTreatments.forEach((treatment: any) => {
      if (treatment.event_id) {
        
        // Recalculer les totaux avec les nouvelles parcelles
        this.recalculateTreatmentTotals(treatment);
        
        // Mettre à jour sur le serveur
        this.http.updatePhytoTreatmentFinal(treatment.event_id, treatment).subscribe({
          next: (response: any) => {
          },
          error: (error: any) => {
          }
        });
      }
    });

    // Mettre à jour le signal local
    this.http.signalGetTableauGeneralTraitement.set([...currentTreatments]);
  }

  /**
   * Met à jour les données du traitement dans le fichier phyto_treatments_final.json
   * Appelée lorsque l'utilisateur modifie une quantité dans le tableau de répartition
   */
  updateTreatmentData(eventId: string): void {

    // Récupérer le traitement actuel selon le mode
    let treatmentToUpdate: any;
    
    if (this.isEditMode) {
      // En mode modification, utiliser directement le traitement en cours
      treatmentToUpdate = this.editingTreatment;
    } else {
      // En mode création, chercher dans les signaux
      const currentTreatments = this.getSignalTotalTrainement();
      treatmentToUpdate = currentTreatments.find((t: any) => t.event_id === eventId);
    }
    
    if (!treatmentToUpdate) {
      return;
    }

    // Recalculer les totaux et les données dérivées
    this.recalculateTreatmentTotals(treatmentToUpdate);

    // Envoyer les données mises à jour vers le serveur
    this.http.updatePhytoTreatmentFinal(eventId, treatmentToUpdate).subscribe({
      next: (response: any) => {

        
        // Affichage détaillé des totaux après recalcul
        if (treatmentToUpdate.parcels_concerned?.length) {
          treatmentToUpdate.parcels_concerned.forEach((p: any) => {
          });
        }
        
        // Mettre à jour l'inventaire après modification d'un traitement bouillie
        this.updateInventoryForBouillieRecalculation(treatmentToUpdate);
        
        // En mode modification, mettre à jour la référence locale
        if (this.isEditMode) {
          this.editingTreatment = treatmentToUpdate;
        } else {
          // En mode création, mettre à jour le signal local
          const currentTreatments = this.getSignalTotalTrainement();
          const updatedTreatments = currentTreatments.map((t: any) => 
            t.event_id === eventId ? treatmentToUpdate : t
          );
          this.http.signalGetTableauGeneralTraitement.set(updatedTreatments);
        }
      },
      error: (error: any) => {
        // Optionnel: afficher un message d'erreur à l'utilisateur
      }
    });
  }

  /**
   * Recalcule les totaux et les quantités dérivées d'un traitement
   */
  private recalculateTreatmentTotals(treatment: any): void {
    if (!treatment.parcels_concerned?.length) return;

    let totalSurface = 0;
    let totalVolumeApplied = 0;

    // Calculer les totaux des parcelles
    treatment.parcels_concerned.forEach((parcel: any) => {
      if (this.getTreatmentType() === 'phyto_surface_treatment' || this.getTreatmentType() === 'phyto_quantity_treatment') {
        totalSurface += parseFloat(parcel.parcel_surface_treated) || 0;
      } else {
        totalVolumeApplied += parseFloat(parcel.treatment_volume_applied) || 0;
      }
    });

    // Mettre à jour les totaux dans le traitement
    if (this.getTreatmentType() === 'phyto_surface_treatment' || this.getTreatmentType() === 'phyto_quantity_treatment') {
      treatment.standard_total_surface_treated = totalSurface;
      
      // Recalculer les quantités de produits basées sur la surface
      if (treatment.treatment_composition?.length) {
        let totalQuantityUsed = 0;
        
        treatment.treatment_composition.forEach((component: any) => {
          const standardDose = parseFloat(component.standard_component_dose) || 0;
          const newQuantity = standardDose * totalSurface;
          component.component_quantity = newQuantity;
          totalQuantityUsed += newQuantity;
        });
        
        treatment.treatment_total_quantity_used = totalQuantityUsed;
      }
    } else {
      // MODE BOUILLIE : préserver treatment_total_quantity_used s'il a une valeur manuelle
      const currentTotalUsed = parseFloat(treatment.treatment_total_quantity_used) || 0;
      
      // Seulement mettre à jour si pas de valeur manuelle ou si incohérent
      if (currentTotalUsed === 0 || Math.abs(currentTotalUsed - totalVolumeApplied) < 0.01) {
        treatment.treatment_total_quantity_used = totalVolumeApplied;
      } else {
      }
    }

  }

}
