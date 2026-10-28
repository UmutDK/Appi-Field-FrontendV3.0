import { Component, EventEmitter, inject, OnInit, OnDestroy, Output, Input, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { BehaviorSubject, combineLatest, concatMap, map, Observable, shareReplay, Subject, take, takeUntil } from 'rxjs';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RegistreService } from '../../services/registre.service';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { trigger, transition, animate } from '@angular/animations';

@Component({
  selector: 'app-travail-au-champ',
  standalone: true,
  imports: [
    SharedModule,
],
  templateUrl: './travail-au-champ.component.html',
  styleUrl: './travail-au-champ.component.scss',
  animations: [
    trigger('slideStep', [
      // Simplement détecter les changements pour trigger le callback
      transition('* => *', [
        animate('1ms')
      ])
    ])
  ]
})
export class TravailAuChampComponent implements OnInit, OnDestroy{

  @Output() closePopup = new EventEmitter<void>();
  @Output() closePopupWithRefresh = new EventEmitter<void>();
  @Output() progressChange = new EventEmitter<number>();
  @Output() validationChange = new EventEmitter<boolean>();
  @Output() fieldWorkCreated = new EventEmitter<any>(); // Nouvel événement pour l'animation

  // Méthode helper pour émettre closePopupWithRefresh avec rafraîchissement optimisé
  private emitCloseWithRefresh(): void {
    // Réactiver le scroll du background
    document.body.classList.remove('no-scroll');
    
    // 🚀 Rafraîchir instantanément uniquement les travaux au champ
    this.http.refreshFieldWorksOnly();
    
    this.closePopupWithRefresh.emit();
  }

  // Méthode pour calculer et émettre la progression
  private calculateAndEmitProgress(): void {
    const progress = this.getProgressValue();
    this.progressChange.emit(progress);
    this.validationChange.emit(progress === 100);
  }

  // Méthode pour calculer la valeur de progression basée sur l'étape actuelle
  private getProgressValue(): number {
    const progressSteps: { [key: string]: number } = {
      // État initial: Popup ouverte, sélection du type de travail (première étape visuelle)
      '': 25,
      // Étape 1: Type de travail sélectionné, sélection des parcelles (deuxième étape)
      'Fertilisation': 50,
      'Irrigation': 50,
      'Récolte': 50,
      'Observation': 50,
      'Travail du sol': 50,
      // Étape 2: Saisie des détails (troisième étape)
      'FertilisationAdd': 75,
      'IrrigationAdd': 75,
      'RécolteAdd': 75,
      'ObservationAdd': 75,
      'Travail du solAdd': 75
      // 100% sera émis lors de la validation finale
    };

    return progressSteps[this.travailAuChamp] || 0;
  }
  
  // Nouvelle propriété d'entrée pour recevoir les données de modification
  @Input() modificationData: any = null;

  private _travailAuChamp: string = "";
  // Setter plutôt qu'une propriété simple : garantit le reset du scroll à CHAQUE changement
  // d'étape/d'écran, sans devoir modifier chacun des appels this.travailAuChamp = "..." dans
  // le fichier (comportement identique à traitement.component.ts, même mécanisme).
  get travailAuChamp(): string {
    return this._travailAuChamp;
  }
  set travailAuChamp(value: string) {
    this._travailAuChamp = value;
    if (this.scrollableContentRef) {
      this.scrollableContentRef.nativeElement.scrollTop = 0;
    }
  }

  getExploitation!: Observable<any[]>;
  form!: FormGroup;
  
  // Variables pour la modification
  isModificationMode = false;
  workToModify: any = null;
  
  // Nouveau système d'associations parcelle+culture (même que traitement phyto)
  selectedParcelCultureAssociations: any[] = [];
  // Cache BehaviorSubject pour éviter les rechargements (même pattern que traitement-phyto)
  private parcelCultureGroupsCache$ = new BehaviorSubject<any[]>([]);
  public isLoadingParcelCultures = false;
  public hasTriedToLoadParcelCultures = false;
  private cachedParcelles$: Observable<any[]> | null = null;

  // Mode de regroupement des parcelles
  groupByMode: 'phytoweb' | 'culture' | 'parcelle' = 'phytoweb';
  private rawAssociations: any[] = [];
  private displayGroupsSubject = new BehaviorSubject<any[]>([]);
  displayGroups$ = this.displayGroupsSubject.asObservable();

  // 📱 Set pour tracker les groupes de cultures ouverts/fermés sur mobile
  expandedGroupsOnMobile: Set<string> = new Set();

  // ── Dropdown "Unité" (irrigation) — même pattern .dropdown-container/.dropdown-btn que le
  // dropdown "Cible" de traitement-phyto (voir src/styles/_popup-system.scss) ──
  isDoseUnitDropdownOpen = false;

  toggleDoseUnitDropdown(): void {
    this.isDoseUnitDropdownOpen = !this.isDoseUnitDropdownOpen;
  }

  selectDoseUnit(value: string): void {
    this.irrigation.get('dose_unit')?.setValue(value);
    this.isDoseUnitDropdownOpen = false;
  }

  http = inject(RegistreService);
  httpClient = inject(HttpClient);
  formBuilder = inject(FormBuilder);
  router = inject(Router);
  route = inject(ActivatedRoute);

  formFertilisation!: FormGroup;
  irrigation!: FormGroup;
  recolte!: FormGroup;
  observation!: FormGroup;
  travailDuSol!: FormGroup;

  // Pour la gestion des opérateurs
  operators: any[] = [];
  selectedOperator: any = null;

  // Variables pour l'animation de slide entre étapes
  public slideDirection: 'forward' | 'backward' | 'none' = 'none';
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  // Méthode pour charger les données du travail à modifier directement depuis les données fournies
  loadWorkForModificationFromData(workData: any): void {
    
    this.workToModify = workData;
    
    // Pré-remplir les associations parcelle+culture avec les données existantes
    if (workData.parcels_concerned && Array.isArray(workData.parcels_concerned)) {
      this.selectedParcelCultureAssociations = workData.parcels_concerned.map((parcel: any) => ({
        uniqueId: `${parcel.parcel_id || parcel.parcels_id}_${parcel.crop_id}`,
        parcel_id: parcel.parcel_id || parcel.parcels_id,
        parcel_name: parcel.parcel_name || parcel.parcels_name,
        parcel_area: parcel.parcel_surface || parcel.parcel_area,
        parcel_area_unit_fr: parcel.surface_unit || parcel.parcel_area_unit_fr || 'ha',
        crop_id: parcel.crop_id,
        crop_name: parcel.crop_name,
        phytoweb_name: parcel.phytoweb_name || parcel.nomPhytoweb_crops_id || ''
      }));
      
    } else {
      this.selectedParcelCultureAssociations = [];
    }
    
    // Pré-remplir les formulaires selon le type, mais avec les parcelles existantes pré-sélectionnées
    // IMPORTANT: Définir travailAuChamp AVANT le pré-remplissage pour assurer l'affichage correct
    const workType = workData.type || workData.type_travaux_aux_champs;
    switch (workType) {
      case 'Fertilisation':

      this.travailAuChamp = 'Fertilisation';
        setTimeout(() => this.prefillFertilisationForm(workData), 0);
        break;
      case 'Irrigation':
        this.travailAuChamp = 'Irrigation';
        setTimeout(() => this.prefillIrrigationForm(workData), 0);
        break;
      case 'Récolte':
        this.travailAuChamp = 'Récolte';
        setTimeout(() => this.prefillRecolteForm(workData), 0);
        break;
      case 'Observation':
        this.travailAuChamp = 'Observation';
        setTimeout(() => this.prefillObservationForm(workData), 0);
        break;
      case 'Travail du sol':
        this.travailAuChamp = 'Travail du sol';
        setTimeout(() => this.prefillTravailDuSolForm(workData), 0);
        break;
      default:
        this.isModificationMode = false;
        return;
    }
  }

  ngOnInit(): void {
    // Bloquer le scroll du background
    document.body.classList.add('no-scroll');
    
    
    // Vérifier si on est en mode modification via les propriétés d'entrée ou les paramètres de route
    if (this.modificationData && this.modificationData.originalData) {
      this.isModificationMode = true;
      this.workToModify = this.modificationData.originalData;
      
      // Charger directement les données pour modification
      this.loadWorkForModificationFromData(this.modificationData.originalData);
      
    } else {
      // Vérifier les paramètres de route (méthode existante)
      this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
        if (params['modify'] && params['workId']) {
          this.isModificationMode = true;
          this.loadWorkForModification(params['workId']);
        }
      });
    }

    this.getExploitation = this.http.getExploitation();
    // Force le chargement des cultures dans le signal au démarrage
    this.http.get().pipe(take(1)).subscribe(() => {
    });

    // Charger les opérateurs
    this.loadOperators();

    // Charger les associations parcelle+culture (même logique que traitement-phyto)
    this.loadParcelCultureGroupsOptimized();

    // 📅 Obtenir la date du jour au format YYYY-MM-DD
    const today = this.getTodayDate();

    this.form = this.formBuilder.group({
      parcels_id: this.formBuilder.array([]) ,
    });

    this.formFertilisation = this.formBuilder.group({
      date : [today,[Validators.required]], // 📅 Date du jour par défaut
      informations : [null,[Validators.required]],
      tool : [null,[Validators.required]],
      remark : [null],
    });

    this.irrigation = this.formBuilder.group({
      date : [today,[Validators.required]], // 📅 Date du jour par défaut
      dose : [null,[Validators.required]],
      dose_unit : ['L',[Validators.required]], // 🔧 Valeur par défaut "L"
      remark : [null],
    });

    this.recolte = this.formBuilder.group({
      harvest_date : [today,[Validators.required]], // 📅 Date du jour par défaut
      Rendement : [null,[Validators.required]],
    });

    this.observation = this.formBuilder.group({
      dateDeLobservation : [today,[Validators.required]], // 📅 Date du jour par défaut
      Observation : [null,[Validators.required]],
    });

    this.travailDuSol = this.formBuilder.group({
      date : [today,[Validators.required]], // 📅 Date du jour par défaut
      field_work_type : [null,[Validators.required]],
      remark : [null],
      description : [null],
      tool : [null],
    });

    // Émettre la progression initiale
    this.calculateAndEmitProgress();
  }

  // 📅 Méthode utilitaire pour obtenir la date du jour au format YYYY-MM-DD
  private getTodayDate(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // ── Chargement optimisé des groupes parcelle+culture (même pattern que traitement-phyto) ──

  private loadParcelCultureGroupsOptimized(): void {
    // Si des données sont déjà en cache, les utiliser directement
    if (this.parcelCultureGroupsCache$.value.length > 0) {
      this.isLoadingParcelCultures = false;
      this.hasTriedToLoadParcelCultures = true;
      if (this.displayGroupsSubject.value.length === 0 && this.rawAssociations.length === 0) {
        this.rawAssociations = this.parcelCultureGroupsCache$.value.flatMap((g: any) => g.associations);
        this.displayGroupsSubject.next(this.buildDisplayGroups(this.rawAssociations, this.groupByMode));
      }
      return;
    }

    this.isLoadingParcelCultures = true;

    // ⚠️ this.http.getExploitation() passe par un cache (signal/localStorage) qui retombe,
    // en cas de cache vide, sur l'ancien endpoint PHP index.php?file=crops/crops.json —
    // mort sur le backend Flask actuel. testCropsLoading() tape /crops (endpoint réel) et
    // adapte correctement les champs (cropFromApi) — même source que traitement-phyto.
    const exploitation$ = this.http.testCropsLoading().pipe(shareReplay(1));
    const parcelles$ = this.getParcellesCached();

    combineLatest([exploitation$, parcelles$]).pipe(
      take(1),
      map(([cultures, parcelles]: [any[], any[]]) => {
        const parcelMap = new Map(
          (parcelles || []).map((p: any) => [p.id_parcel, p])
        );

        const associations: any[] = [];

        cultures.forEach((culture: any) => {
          if (culture.parcels_id && Array.isArray(culture.parcels_id)) {
            culture.parcels_id.forEach((parcelId: string) => {
              const parcelInfo = parcelMap.get(parcelId);
              if (parcelInfo && !parcelInfo.is_archived) { // parcelle archivée : jamais proposée
                associations.push({
                  uniqueId: `${parcelInfo.id_parcel}_${culture.crop_id}`,
                  parcel_id: parcelInfo.id_parcel,
                  parcel_name: parcelInfo.parcel_name,
                  parcel_area: parcelInfo.parcel_area,
                  parcel_area_unit_fr: parcelInfo.parcel_area_unit_fr,
                  crop_id: culture.crop_id,
                  crop_name: culture.crop_name,
                  phytoweb_name: culture.phytoweb_name || culture.nomPhytoweb_crops_id || '',
                  eppo: culture.eppo || culture.EPPOCode || culture.eppo_code || culture.code_eppo || ''
                });
              }
            });
          }
        });

        const groupsMap = new Map<string, any>();
        associations.forEach((association: any) => {
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

        // Modification : associations liées archivées, affichées verrouillées (hors cache)
        return { groups: Array.from(groupsMap.values()), locked: this.buildLockedArchivedAssociations(parcelles, cultures) };
      })
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ groups, locked }) => {
        this.parcelCultureGroupsCache$.next(groups);
        this.rawAssociations = [...groups.flatMap((g: any) => g.associations), ...locked];
        this.displayGroupsSubject.next(this.buildDisplayGroups(this.rawAssociations, this.groupByMode));
        this.isLoadingParcelCultures = false;
        this.hasTriedToLoadParcelCultures = true;
      },
      error: () => {
        this.parcelCultureGroupsCache$.next([]);
        this.isLoadingParcelCultures = false;
        this.hasTriedToLoadParcelCultures = true;
      }
    });
  }

  /**
   * Associations du travail modifié dont la parcelle ou la culture est archivée : visibles,
   * cochées mais verrouillées (updateToDo/07 § 2.5). Jamais ajoutées au cache des groupes,
   * sinon elles seraient proposées à la création suivante.
   */
  private buildLockedArchivedAssociations(parcelles: any[], activeCrops: any[]): any[] {
    if (!this.isModificationMode) return [];
    const parcelById = new Map<string, any>((parcelles || []).map((p: any) => [p.id_parcel, p]));
    const activeCropIds = new Set((activeCrops || []).map((c: any) => String(c.crop_id)));

    return (this.workToModify?.parcels_concerned || [])
      .map((stored: any) => {
        const parcelId = stored.parcel_id ?? stored.parcels_id;
        const parcel = parcelById.get(parcelId);
        const parcelArchived = !!parcel?.is_archived;
        const cropArchived = !activeCropIds.has(String(stored.crop_id)); // /crops ne renvoie que les actives
        if (!parcelArchived && !cropArchived) return null;      // association normale, déjà proposée
        return {
          uniqueId: `${parcelId}_${stored.crop_id}`,
          parcel_id: parcelId,
          parcel_name: stored.parcel_name || stored.parcels_name || parcel?.parcel_name,
          parcel_area: parcel?.parcel_area ?? stored.parcel_surface,
          parcel_area_unit_fr: parcel?.parcel_area_unit_fr || stored.surface_unit || 'ha',
          crop_id: stored.crop_id,
          crop_name: stored.crop_name,
          phytoweb_name: stored.phytoweb_name || '',
          eppo: '',
          parcel_archived: parcelArchived,
          is_archived: cropArchived,
          locked: true,
        };
      })
      .filter(Boolean);
  }

  private getParcellesCached(): Observable<any[]> {
    if (!this.cachedParcelles$) {
      this.cachedParcelles$ = this.http.getParcelles().pipe(shareReplay(1));
    }
    return this.cachedParcelles$;
  }

  public get parcelCultureGroupsData(): any[] {
    return this.displayGroupsSubject.value;
  }

  public get shouldShowEmptyState(): boolean {
    return !this.isLoadingParcelCultures &&
           this.parcelCultureGroupsData.length === 0 &&
           this.hasTriedToLoadParcelCultures;
  }

  // Nouvelle méthode pour gérer la sélection d'association parcelle+culture (même logique que traitement phyto)
  onCheckedParcelCulture(event: any, association: any) {
    // Parcelle ou culture archivée : le lien est conservé tel quel
    if (association.locked) { event.target.checked = this.isParcelCultureSelected(association); return; }
    if (event.target.checked) {
      // Ajouter l'association
      this.selectedParcelCultureAssociations.push(association);
    } else {
      // Retirer l'association
      const index = this.selectedParcelCultureAssociations.findIndex(
        item => item.uniqueId === association.uniqueId
      );
      if (index > -1) {
        this.selectedParcelCultureAssociations.splice(index, 1);
      }
    }
    
  }

  setGroupByMode(mode: 'phytoweb' | 'culture' | 'parcelle'): void {
    this.groupByMode = mode;
    this.expandedGroupsOnMobile.clear();
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

  isGroupFullySelected(group: any): boolean {
    const selectable = (group.associations || []).filter((a: any) => !a.locked);
    if (selectable.length === 0) return false;
    return selectable.every((a: any) => this.isParcelCultureSelected(a));
  }

  toggleGroupSelection(group: any, event: any): void {
    const select = event.target.checked;
    for (const association of group.associations) {
      if (association.locked) continue; // jamais modifiée par « Tout sélectionner »
      if (select && !this.isParcelCultureSelected(association)) {
        this.selectedParcelCultureAssociations.push(association);
      } else if (!select && this.isParcelCultureSelected(association)) {
        const idx = this.selectedParcelCultureAssociations.findIndex(a => a.uniqueId === association.uniqueId);
        if (idx > -1) this.selectedParcelCultureAssociations.splice(idx, 1);
      }
    }
  }

  // Méthode pour vérifier si une association parcelle+culture est déjà sélectionnée
  isParcelCultureSelected(association: any): boolean {
    const isSelected = this.selectedParcelCultureAssociations.some(selected => {
      // Comparaison par uniqueId (méthode préférée)
      if (selected.uniqueId === association.uniqueId) {
        return true;
      }
      
      // Comparaison par parcel_id et crop_id avec conversion de type pour éviter les problèmes string/number
      const selectedParcelId = String(selected.parcel_id);
      const associationParcelId = String(association.parcel_id);
      const selectedCropId = String(selected.crop_id);
      const associationCropId = String(association.crop_id);
      
      return (selectedParcelId === associationParcelId && selectedCropId === associationCropId);
    });
    

    
    return isSelected;
  }

  // Méthode pour vérifier si au moins une parcelle est sélectionnée (pour le bouton sticky)
  hasSelectedParcels(): boolean {
    return this.selectedParcelCultureAssociations.length > 0;
  }

  /**
   * 📱 Toggle l'expansion d'un groupe de cultures sur mobile
   */
  toggleGroupOnMobile(groupId: string): void {
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
    return this.expandedGroupsOnMobile.has(groupId);
  }

  // Méthode pour déterminer si le bouton Valider fixe devrait être visible
  shouldShowValidateButton(): boolean {
    // Le bouton devrait être visible lors de la sélection des parcelles (étapes sans "Add")
    const parcelSelectionSteps = ['Fertilisation', 'Irrigation', 'Récolte', 'Observation', 'Travail du sol'];
    const formSteps = ['FertilisationAdd', 'IrrigationAdd', 'RécolteAdd', 'ObservationAdd', 'Travail du solAdd'];
    
    // Pour les étapes de sélection, vérifier qu'il y a des parcelles sélectionnées
    if (parcelSelectionSteps.includes(this.travailAuChamp)) {
      return this.hasSelectedParcels();
    }
    
    // Pour les étapes de formulaire, toujours afficher le bouton
    if (formSteps.includes(this.travailAuChamp)) {
      return true;
    }
    
    return false;
  }

  // Méthode pour la validation complète (combines hasSelectedParcels + isFormValid)
  canProceedToNext(): boolean {
    return this.isFormValid();
  }

  /**
   * 🔙 Retourne à l'étape précédente avec animation
   */
  goToPreviousStep(): void {
    const stepMap: { [key: string]: string } = {
      'Fertilisation': '', 'Irrigation': '', 'Récolte': '',
      'Observation': '', 'Travail du sol': '',
      'FertilisationAdd': 'Fertilisation', 'IrrigationAdd': 'Irrigation',
      'RécolteAdd': 'Récolte', 'ObservationAdd': 'Observation',
      'Travail du solAdd': 'Travail du sol'
    };
    const target = stepMap[this.travailAuChamp];
    if (target !== undefined) {
      this.navigateTo(target, 'backward');
    }
  }

  /**
   * Callback appelé à la fin de l'animation de slide
   */
  // Référence à la zone scrollable actuellement affichée (un seul des @if est rendu à la fois),
  // pour la remettre en haut à chaque changement d'étape.
  @ViewChild('scrollableContent', { static: false }) scrollableContentRef?: ElementRef<HTMLDivElement>;

  onSlideAnimationDone(): void {
    // Animation terminée
  }

  /**
   * ✅ Vérifie si le bouton Précédent doit être affiché
   */
  canGoToPreviousStep(): boolean {
    // Le bouton précédent n'apparaît PAS sur la première étape (choix du type)
    return this.travailAuChamp !== '';
  }

  /**
   * Méthode commune de navigation avec animation
   */
  private navigateTo(step: string, direction: 'forward' | 'backward'): void {
    this.slideDirection = direction;
    this.cdr.detectChanges();
    this.travailAuChamp = step;
    this.calculateAndEmitProgress();
    setTimeout(() => {
      this.slideDirection = 'none';
      this.cdr.detectChanges();
    }, 700);
  }

  onFertilisation(): void { this.navigateTo('Fertilisation', 'forward'); }
  onFertilisationAdd(): void { this.navigateTo('FertilisationAdd', 'forward'); }
  onIrrigation(): void { this.navigateTo('Irrigation', 'forward'); }
  onIrrigationAdd(): void { this.navigateTo('IrrigationAdd', 'forward'); }
  onRecolte(): void { this.navigateTo('Récolte', 'forward'); }
  onRecolteAddAdd(): void { this.navigateTo('RécolteAdd', 'forward'); }
  onObservation(): void { this.navigateTo('Observation', 'forward'); }
  ObservationAdd(): void { this.navigateTo('ObservationAdd', 'forward'); }
  onTravailDuSol(): void { this.navigateTo('Travail du sol', 'forward'); }
  TravailDuSolAdd(): void { this.navigateTo('Travail du solAdd', 'forward'); }

  onFertilisationsSend(){
    // Vérifier qu'au moins une association parcelle+culture est sélectionnée
    if (this.selectedParcelCultureAssociations.length === 0) {
      alert('Veuillez sélectionner au moins une parcelle avec sa culture');
      return;
    }

    
    // Préparer les données pour l'enregistrement 
    const parcellesFormatted = this.selectedParcelCultureAssociations.map(association => ({
      parcel_id: association.parcel_id,
      parcel_name: association.parcel_name,
      parcel_surface: parseFloat(association.parcel_area) || 0,
      surface_unit: association.parcel_area_unit_fr || 'ha',
      standard_surface: (parseFloat(association.parcel_area) || 0) * this.http.onReference(association.parcel_area_unit_fr || 'ha'),
      crop_id: association.crop_id,
      crop_name: association.crop_name,
      phytoweb_name: association.phytoweb_name || association.nomPhytoweb_crops_id || '',
      eppo: association.eppo || association.EPPOCode || association.eppo_code || association.code_eppo || ''
    }));

    // Préparer les données avec l'ID existant en mode modification
    const baseFormData = {
      event_id: this.isModificationMode && this.workToModify ? 
        (this.workToModify.event_id || this.workToModify.travaux_aux_champs_id) : 
        crypto.randomUUID().substring(0, 8),
      type: "Fertilisation",
      date: this.formFertilisation.value.date,
      informations: this.formFertilisation.value.informations,
      tool: this.formFertilisation.value.tool,
      remark: this.formFertilisation.value.remark,
      parcels_concerned: parcellesFormatted
    };

    // Enrichir avec les données d'opérateur
    const formData = this.enrichWithOperatorData(baseFormData);

    
    // Choisir entre création et modification
    const originalId = this.workToModify?.event_id || this.workToModify?.travaux_aux_champs_id;
    const operation$ = this.isModificationMode ? 
      this.http.finalizeModifiedWork(formData, originalId) : 
      this.http.postTravailAuxChamps(formData);
    
    operation$.pipe(take(1)).subscribe({
      next: (result: any) => {
        this.formFertilisation.reset();
        this.selectedParcelCultureAssociations = [];
        // Émettre 100% de progression avant la fermeture
        this.progressChange.emit(100);
        this.validationChange.emit(true);

        // En mode création, émettre l'événement pour l'animation de succès
        if (!this.isModificationMode) {
          this.fieldWorkCreated.emit(result);
        } else {
          // En mode modification, fermer normalement avec rafraîchissement
          this.emitCloseWithRefresh();
        }
        
        this.router.navigate(['/registre']);
      },
      error: (error: any) => {
        alert('Erreur lors de l\'enregistrement');
      }
    });
  }

  

  

  onIrrigationSend(){
    // Vérifier qu'au moins une association parcelle+culture est sélectionnée
    if (this.selectedParcelCultureAssociations.length === 0) {
      alert('Veuillez sélectionner au moins une parcelle avec sa culture');
      return;
    }

    
    // Préparer les données pour l'enregistrement 
    const parcellesFormatted = this.selectedParcelCultureAssociations.map(association => ({
      parcel_id: association.parcel_id,
      parcel_name: association.parcel_name,
      parcel_surface: parseFloat(association.parcel_area) || 0,
      surface_unit: association.parcel_area_unit_fr || 'ha',
      standard_surface: (parseFloat(association.parcel_area) || 0) * this.http.onReference(association.parcel_area_unit_fr || 'ha'),
      crop_id: association.crop_id,
      crop_name: association.crop_name,
      phytoweb_name: association.phytoweb_name || association.nomPhytoweb_crops_id || '',
      eppo: association.eppo || association.EPPOCode || association.eppo_code || association.code_eppo || ''
    }));

    const formData = {
      event_id: this.isModificationMode && this.workToModify ? 
        (this.workToModify.event_id || this.workToModify.travaux_aux_champs_id) : 
        crypto.randomUUID().substring(0, 8),
      type: "Irrigation",
      date: this.irrigation.value.date,
      dose: this.irrigation.value.dose,
      dose_unit: this.irrigation.value.dose_unit,
      remark: this.irrigation.value.remark,
      parcels_concerned: parcellesFormatted
    };

    // Choisir entre création et modification
    const originalId = this.workToModify?.event_id || this.workToModify?.travaux_aux_champs_id;
    const operation$ = this.isModificationMode ? 
      this.http.finalizeModifiedWork(formData, originalId) : 
      this.http.postTravailAuxChamps(formData);

    operation$.pipe(take(1)).subscribe({
      next: (result: any) => {
        this.irrigation.reset();
        this.selectedParcelCultureAssociations = [];
        // Émettre 100% de progression avant la fermeture
        this.progressChange.emit(100);
        this.validationChange.emit(true);

        // En mode création, émettre l'événement pour l'animation de succès
        if (!this.isModificationMode) {
          this.fieldWorkCreated.emit(result);
        } else {
          // En mode modification, fermer normalement avec rafraîchissement
          this.emitCloseWithRefresh();
        }
        
        this.router.navigate(['/registre']);
      }
    });
  }

  

  

  onRecolteSend(){
    if (this.selectedParcelCultureAssociations.length === 0) {
      alert('Veuillez sélectionner au moins une parcelle avec sa culture');
      return;
    }

    const parcellesFormatted = this.selectedParcelCultureAssociations.map(association => ({
      parcel_id: association.parcel_id,
      parcel_name: association.parcel_name,
      parcel_surface: parseFloat(association.parcel_area) || 0,
      surface_unit: association.parcel_area_unit_fr || 'ha',
      standard_surface: (parseFloat(association.parcel_area) || 0) * this.http.onReference(association.parcel_area_unit_fr || 'ha'),
      crop_id: association.crop_id,
      crop_name: association.crop_name,
      phytoweb_name: association.phytoweb_name || association.nomPhytoweb_crops_id || '',
      eppo: association.eppo || association.EPPOCode || association.eppo_code || association.code_eppo || ''
    }));

    const formData = {
      event_id: this.isModificationMode && this.workToModify ? 
        (this.workToModify.event_id || this.workToModify.travaux_aux_champs_id) : 
        crypto.randomUUID().substring(0, 8),
      type: "Récolte",
      date: this.recolte.value.harvest_date,
      harvest_date: this.recolte.value.harvest_date,
      remark: this.recolte.value.Rendement,
      parcels_concerned: parcellesFormatted
    };

    // Choisir entre création et modification
    const originalId = this.workToModify?.event_id || this.workToModify?.travaux_aux_champs_id;
    const operation$ = this.isModificationMode ? 
      this.http.finalizeModifiedWork(formData, originalId) : 
      this.http.postTravailAuxChamps(formData);

    operation$.pipe(take(1)).subscribe({
      next: (result: any) => {
        this.recolte.reset();
        this.selectedParcelCultureAssociations = [];
        // Émettre 100% de progression avant la fermeture
        this.progressChange.emit(100);
        this.validationChange.emit(true);

        // En mode création, émettre l'événement pour l'animation de succès
        if (!this.isModificationMode) {
          this.fieldWorkCreated.emit(result);
        } else {
          // En mode modification, fermer normalement avec rafraîchissement
          this.emitCloseWithRefresh();
        }
        
        this.router.navigate(['/registre']);
      }
    });
  }

  
  
  
  
  onObservationSend(){
    if (this.selectedParcelCultureAssociations.length === 0) {
      alert('Veuillez sélectionner au moins une parcelle avec sa culture');
      return;
    }

    const parcellesFormatted = this.selectedParcelCultureAssociations.map(association => ({
      parcel_id: association.parcel_id,
      parcel_name: association.parcel_name,
      parcel_surface: parseFloat(association.parcel_area) || 0,
      surface_unit: association.parcel_area_unit_fr || 'ha',
      standard_surface: (parseFloat(association.parcel_area) || 0) * this.http.onReference(association.parcel_area_unit_fr || 'ha'),
      crop_id: association.crop_id,
      crop_name: association.crop_name,
      phytoweb_name: association.phytoweb_name || association.nomPhytoweb_crops_id || '',
      eppo: association.eppo || association.EPPOCode || association.eppo_code || association.code_eppo || ''
    }));

    const formData = {
      event_id: this.isModificationMode && this.workToModify ? 
        (this.workToModify.event_id || this.workToModify.travaux_aux_champs_id) : 
        crypto.randomUUID().substring(0, 8),
      type: "Observation",
      date: this.observation.value.dateDeLobservation,
      observation: this.observation.value.Observation,
      parcels_concerned: parcellesFormatted
    };

    // Choisir entre création et modification
    const originalId = this.workToModify?.event_id || this.workToModify?.travaux_aux_champs_id;
    const operation$ = this.isModificationMode ? 
      this.http.finalizeModifiedWork(formData, originalId) : 
      this.http.postTravailAuxChamps(formData);

    operation$.pipe(take(1)).subscribe({
      next: (result: any) => {
        this.observation.reset();
        this.selectedParcelCultureAssociations = [];
        // Émettre 100% de progression avant la fermeture
        this.progressChange.emit(100);
        this.validationChange.emit(true);

        // En mode création, émettre l'événement pour l'animation de succès
        if (!this.isModificationMode) {
          this.fieldWorkCreated.emit(result);
        } else {
          // En mode modification, fermer normalement avec rafraîchissement
          this.emitCloseWithRefresh();
        }
        
        this.router.navigate(['/registre']);
      }
    });
  }

  
  
  
  
  onTravailDuSolSend(){
    if (this.selectedParcelCultureAssociations.length === 0) {
      alert('Veuillez sélectionner au moins une parcelle avec sa culture');
      return;
    }

    const parcellesFormatted = this.selectedParcelCultureAssociations.map(association => ({
      parcel_id: association.parcel_id,
      parcel_name: association.parcel_name,
      parcel_surface: parseFloat(association.parcel_area) || 0,
      surface_unit: association.parcel_area_unit_fr || 'ha',
      standard_surface: (parseFloat(association.parcel_area) || 0) * this.http.onReference(association.parcel_area_unit_fr || 'ha'),
      crop_id: association.crop_id,
      crop_name: association.crop_name,
      phytoweb_name: association.phytoweb_name || association.nomPhytoweb_crops_id || '',
      eppo: association.eppo || association.EPPOCode || association.eppo_code || association.code_eppo || ''
    }));

    const baseFormData = {
      event_id: this.isModificationMode && this.workToModify ? 
        (this.workToModify.event_id || this.workToModify.travaux_aux_champs_id) : 
        crypto.randomUUID().substring(0, 8),
      type: "Travail du sol",
      date: this.travailDuSol.value.date,
      field_work_type: this.travailDuSol.value.field_work_type,
      description: this.travailDuSol.value.description,
      tool: this.travailDuSol.value.tool,
      remark: this.travailDuSol.value.remark,
      parcels_concerned: parcellesFormatted
    };

    // Enrichir avec les données d'opérateur
    const formData = this.enrichWithOperatorData(baseFormData);

    // Choisir entre création et modification
    const originalId = this.workToModify?.event_id || this.workToModify?.travaux_aux_champs_id;
    const operation$ = this.isModificationMode ? 
      this.http.finalizeModifiedWork(formData, originalId) : 
      this.http.postTravailAuxChamps(formData);

    operation$.pipe(take(1)).subscribe({
      next: (result: any) => {
        this.travailDuSol.reset();
        this.selectedParcelCultureAssociations = [];
        // Émettre 100% de progression avant la fermeture
        this.progressChange.emit(100);
        this.validationChange.emit(true);

        // En mode création, émettre l'événement pour l'animation de succès
        if (!this.isModificationMode) {
          this.fieldWorkCreated.emit(result);
        } else {
          // En mode modification, fermer normalement avec rafraîchissement
          this.emitCloseWithRefresh();
        }
        
        this.router.navigate(['/registre']);
      }
    });
  }

  // Méthodes pour la gestion des opérateurs
  /**
   * Charge la liste des opérateurs depuis l'API
   */
  loadOperators(): void {
    this.httpClient.get<any[]>(environment.apiRegistre + '/operators').pipe(
      take(1)
    ).subscribe({
      next: (operators) => {
        this.operators = operators || [];
      },
      error: (error) => {
        this.operators = [];
      }
    });
  }

  /**
   * Sélectionne un opérateur
   */
  selectOperator(operator: any): void {
    this.selectedOperator = operator;
  }

  /**
   * Retourne l'opérateur actuellement sélectionné
   */
  getSelectedOperator(): any {
    return this.selectedOperator;
  }

  /**
   * Enrichit les données du formulaire avec les informations d'opérateur
   */
  private enrichWithOperatorData(formData: any): any {
    return {
      ...formData,
      // Ajouter les informations d'opérateur si disponible
      ...(this.selectedOperator && {
        operator_id: this.selectedOperator.operatorId,
        operator_name: this.selectedOperator.operatorName,
        operator_phytolicence: this.selectedOperator.operatorPhytolicence
      })
    };
  }

  // Méthode pour charger les données du travail à modifier
  loadWorkForModification(workId: string): void {
    this.http.resetFieldWorkParcels(workId).pipe(
      concatMap(() => this.http.loadWorkForModification(workId)),
      take(1),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (work) => {
        if (!work) { this.isModificationMode = false; return; }

        this.workToModify = work;
        this.selectedParcelCultureAssociations = [];

        const workType = work.type || work.type_travaux_aux_champs;
        const prefillMap: { [key: string]: () => void } = {
          'Fertilisation': () => this.prefillFertilisationForm(work),
          'Irrigation':    () => this.prefillIrrigationForm(work),
          'Récolte':       () => this.prefillRecolteForm(work),
          'Observation':   () => this.prefillObservationForm(work),
          'Travail du sol':() => this.prefillTravailDuSolForm(work)
        };
        const prefill = prefillMap[workType];
        if (!prefill) { this.isModificationMode = false; return; }

        this.travailAuChamp = workType;
        prefill();
      },
      error: () => { this.isModificationMode = false; }
    });
  }

  // Méthodes de pré-remplissage des formulaires
  prefillFertilisationForm(work: any): void {
    this.formFertilisation.patchValue({
      date: work.date || work.datee || null,
      informations: work.informations || work.information || null,
      tool: work.tool || work.outil || null,
      remark: work.remark || work.remaques || work.remarque || work.remarques || null
    });
  }

  prefillIrrigationForm(work: any): void {
    this.irrigation.patchValue({
      date: work.date || work.datee || null,
      dose: work.dose || null,
      dose_unit: work.dose_unit || work.lha || work.lha_value || null,
      remark: work.remark || work.remaques || work.remarque || work.remarques || null
    });
  }

  prefillRecolteForm(work: any): void {
    this.recolte.patchValue({
      harvest_date: work.harvest_date || work.dateDeRecolte || work.date_recolte || work.date || work.datee || null,
      // Le rendement est enregistré dans « remark » (voir onRecolteSend) : le relire de là aussi
      Rendement: work.Rendement || work.rendement || work.remark || work.remaques || null
    });
  }

  prefillObservationForm(work: any): void {
    this.observation.patchValue({
      dateDeLobservation: work.dateDeLobservation || work.date_observation || work.datee || work.date || null,
      Observation: work.Observation || work.observation_text || work.observation || work.informations || null
    });
  }

  // Méthode pour supprimer une parcelle d'un travail au champ
  removeParcelFromFieldWork(work: any, parcel: any): void {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer la parcelle "${parcel.parcel_name || parcel.parcels_name || parcel.parcels}" de ce travail au champ ?`)) {
      return;
    }

    const workId = work.event_id || work.travaux_aux_champs_id;
    const parcelId = parcel.parcel_id || parcel.parcels_id;
    this.http.removeParcelFromFieldWork(workId, parcelId).subscribe({
      next: () => {
        // Les données seront automatiquement rafraîchies grâce au signal dans le service
        alert('Parcelle supprimée avec succès');
      },
      error: (error) => {
        alert('Erreur lors de la suppression de la parcelle');
      }
    });
  }

  // Méthodes pour le template
  isFormValid(): boolean {
    switch (this.travailAuChamp) {
      case 'Fertilisation':
      case 'Irrigation':
      case 'Récolte':
      case 'Observation':
      case 'Travail du sol':
        return this.selectedParcelCultureAssociations.length > 0;
      case 'FertilisationAdd':
        return this.formFertilisation.valid;
      case 'IrrigationAdd':
        return this.irrigation.valid;
      case 'RécolteAdd':
        return this.recolte.valid;
      case 'ObservationAdd':
        return this.observation.valid;
      case 'Travail du solAdd':
        return this.travailDuSol.valid;
      default:
        return true;
    }
  }

  executeAction(): void {
    switch (this.travailAuChamp) {
      case 'Fertilisation':
        this.onFertilisationAdd();
        break;
      case 'Irrigation':
        this.onIrrigationAdd();
        break;
      case 'Récolte':
        this.onRecolteAddAdd();
        break;
      case 'Observation':
        this.ObservationAdd();
        break;
      case 'Travail du sol':
        this.TravailDuSolAdd();
        break;
      case 'FertilisationAdd':
        this.onFertilisationsSend();
        break;
      case 'IrrigationAdd':
        this.onIrrigationSend();
        break;
      case 'RécolteAdd':
        this.onRecolteSend();
        break;
      case 'ObservationAdd':
        this.onObservationSend();
        break;
      case 'Travail du solAdd':
        this.onTravailDuSolSend();
        break;
      default:
        console.warn('');
    }
  }

  // Méthodes prefill manquantes  
  prefillTravailDuSolForm(work: any): void {
    this.travailDuSol.patchValue({
      date: work.date || work.datee || null,
      field_work_type: work.field_work_type || work.travailtype || work.type_travail || null,
      remark: work.remark || work.remaques || work.remarque || work.remarques || null,
      description: work.description || work.informations || null,
      tool: work.tool || work.outil || null
    });
  }

  /**
   * Supprime le travail au champ en mode modification
   */
  onDeleteWork(): void {
    
    const deleteId = this.workToModify?.event_id || this.workToModify?.travaux_aux_champs_id;
    if (!this.isModificationMode || !deleteId) {
      alert('Impossible de supprimer : pas en mode modification ou données manquantes');
      return;
    }

    if (confirm('Êtes-vous sûr de vouloir supprimer ce travail au champ ? Cette action est irréversible.')) {
      
      this.http.deleteFieldWork(deleteId).subscribe({
        next: () => {
          alert('Travail au champ supprimé avec succès');

          // 🚀 Fermer avec rafraîchissement instantané des travaux au champ
          this.emitCloseWithRefresh();
        },
        error: (error: any) => {
          alert('Erreur lors de la suppression du travail au champ');
        }
      });
    }
  }

  onClose(): void {
    
    // Réactiver le scroll du background
    document.body.classList.remove('no-scroll');
    
    // Nettoyer les fichiers temporaires si on était en mode modification
    if (this.isModificationMode) {
      this.http.cleanupAfterTreatmentModification();
    }
    
    this.closePopup.emit();
  }

  ngOnDestroy(): void {
    // R�activer le scroll du background
    document.body.classList.remove('no-scroll');
    // Compl�ter le Subject de destruction pour d�clencher takeUntil
    this.destroy$.next();
    this.destroy$.complete();
    // Compl�ter les BehaviorSubjects internes
    this.parcelCultureGroupsCache$.complete();
    this.displayGroupsSubject.complete();
    // Nettoyer le cache local
    this.cachedParcelles$ = null;
  }
}
