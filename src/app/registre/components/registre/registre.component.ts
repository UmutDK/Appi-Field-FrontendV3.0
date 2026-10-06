import { AfterViewInit, Component, inject, OnInit, OnDestroy, effect, HostListener, ChangeDetectorRef, signal } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { SharedModule } from '../../../shared/shared.module';
import { RegistreGetComponent } from "../registre-get/registre-get.component";
import { RegistreGetVueGlobaleComponent } from "../registre-get-vue-globale/registre-get-vue-globale.component";
import { RegistreService } from '../../services/registre.service';
import { TravailAuChampComponent } from "../travail-au-champ/travail-au-champ.component";
import { CultureComponent } from "../culture/culture.component";
import { TraitementPhytoComponent } from "../traitement-phyto/traitement-phyto.component";
import { ExportPopupComponent, ExportFilters } from "../export-popup/export-popup.component";
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Router } from '@angular/router';

declare function popTelechargerment():any;

// Interfaces pour les filtres
interface DateFilters {
  startDate: string;
  endDate: string;
}

interface FilterData {
  searchTerm: string;
  dateFilters: DateFilters;
  parcelFilters: string[];
  cultureFilters: string[];
}

@Component({
  selector: 'app-registre',
  standalone: true,
  imports: [
    SharedModule,
    RegistreGetComponent,
    RegistreGetVueGlobaleComponent,
    TravailAuChampComponent,
    CultureComponent,
    TraitementPhytoComponent,
    ExportPopupComponent
],
  templateUrl: './registre.component.html',
  styleUrl: './registre.component.scss'
})
export class RegistreComponent implements AfterViewInit, OnInit, OnDestroy{

  vueParCulture:boolean = true;
  ajouter!:string;
  searchTerm: string = '';
  
  // Propriété pour gérer l'export
  isExporting: boolean = false;
  
  // Propriété pour gérer la modification de culture
  cultureToModify: any = null;
  
  // Propriété pour gérer la modification d'intervention
  interventionToModify: any = null;
  
  //  Signal pour l'animation de succès de création de culture
  showCultureSuccessAnimation = signal(false);
  
  //  Signal pour l'animation de succès de création de traitement
  showTreatmentSuccessAnimation = signal(false);
  treatmentSuccessData: any = null; // Données du traitement créé pour le débrief
  
  //  Signal pour l'animation de succès de création de travail au champ
  showFieldWorkSuccessAnimation = signal(false);
  fieldWorkSuccessData: any = null; // Données du travail créé pour le débrief
  
  //  Signal pour afficher la popup d'export avec filtres
  showExportPopup = signal(false);
  
  // Propriétés de filtrage
  dateFilters: DateFilters = {
    startDate: '',
    endDate: ''
  };
  parcelFilters: string[] = [];
  cultureFilters: string[] = [];
  
  // Données disponibles pour les filtres
  availableParcels: any[] = [];
  availableCultures: any[] = [];
  uniqueCultureCategories: any[] = [];
  
  // État de chargement
  culturesLoaded: boolean = false;
  
  // Variables d'état pour les menus de filtres (Angular natif)
  isViewMenuOpen: boolean = false;
  isDateFilterOpen: boolean = false;
  isParcelFilterOpen: boolean = false;
  isCultureFilterOpen: boolean = false;
  
  // Getter pour vérifier s'il y a plus de 10 parcelles
  get hasManyParcels(): boolean {
    return this.availableParcels.length > 10;
  }
  
  // Objet de filtres combinés
  get filterData(): FilterData {
    return {
      searchTerm: this.searchTerm,
      dateFilters: this.dateFilters,
      parcelFilters: this.parcelFilters,
      cultureFilters: this.cultureFilters
    };
  }

  private http = inject(RegistreService);
  private cdr = inject(ChangeDetectorRef);
  private httpClient = inject(HttpClient);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  private parcelUpdateEffect = effect(() => {
    if (this.http.parcelUpdated()) {
      this.loadFilterData();
    }
  });
  
  // Propriétés pour gérer l'état de la culture en temps réel
  currentCultureProgress: number = 33; // Commence à 33% (première étape)
  currentCultureValidation: boolean = false;

  // Propriétés pour gérer l'état du travail au champ en temps réel
  currentTravailProgress: number = 25; // Commence à 25% (première étape sur 4)
  currentTravailValidation: boolean = false;

  // Propriétés pour gérer l'état du traitement phytosanitaire en temps réel
  currentTraitementProgress: number = 25; // Commence à 25% (première étape)
  currentTraitementValidation: boolean = false;

  // Propriété pour gérer l'état du bouton FAB
  isFabOpen: boolean = false;

  // Méthode pour basculer l'état du FAB
  toggleFab(): void {
    this.isFabOpen = !this.isFabOpen;
  }

  // Fermer le FAB (utilisé quand on clique sur une option)
  closeFab(): void {
    this.isFabOpen = false;
  }

  // isFabOpen pilote désormais la liste déroulante "Ajouter ▾" de l'en-tête (desktop) :
  // fermée au clic en dehors ou à la touche Échap (affichage uniquement — n'interfère pas avec
  // onGlobalClick/onDocumentClick, qui gèrent les menus de filtre).
  @HostListener('document:click')
  onDocumentClickCloseAddMenu(): void {
    this.isFabOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscapeCloseAddMenu(): void {
    this.isFabOpen = false;
    // Échap ferme aussi la popup « Travail au champ » (même action que sa croix)
    if (this.onValeurAjouter() === 'Travail au champ' || this.onValeurAjouter() === 'Traitement Phyto') this.onClose();
  }

  // Bouton "retour en haut" affiché au-dessus du fab-main dès qu'on a assez scrollé.
  // C'est <body> qui scrolle ici (pas la fenêtre — confirmé : window.scrollY reste à 0
  // pendant que document.body.scrollTop change), d'où l'écoute sur 'body:scroll' plutôt
  // que 'window:scroll'.
  showScrollTop: boolean = false;

  @HostListener('body:scroll')
  onBodyScroll(): void {
    this.showScrollTop = document.body.scrollTop > 300;
  }

  scrollToTop(): void {
    document.body.scrollTo({ top: 0, behavior: 'smooth' });
  }

  ngOnInit(): void {
    // PRÉCHARGEMENT : Charger immédiatement les données critiques au démarrage
    this.preloadCriticalData();
    this.loadFilterData();
  }

  // Préchauffer le cache pour les données non chargées par loadFilterData
  private preloadCriticalData(): void {
    this.http.getAllTraitements().pipe(takeUntil(this.destroy$)).subscribe();
    this.http.getAllFieldWorks().pipe(takeUntil(this.destroy$)).subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.body.classList.remove('no-scroll');
  }

  ngAfterViewInit(): void {
    setTimeout(() => popTelechargerment(), 100);
  }

  // Gestionnaire global de clic pour fermer les menus
  @HostListener('document:click', ['$event'])
  onGlobalClick(event: Event): void {
    this.onDocumentClick(event);
  }

  onVueGlobale(): void {
    this.vueParCulture = !this.vueParCulture;
  }

  /**
   * Navigation vers la page des archives
   */
  goToArchives(): void {
    this.router.navigate(['/registre/archives']);
  }

  async onCulture(){
    // Avant d'ouvrir le formulaire de culture, forcer le rafraîchissement
    // des parcelles dans le cache central pour que le sélecteur affiche
    // immédiatement les parcelles nouvellement créées.
    try {
      await this.http.refreshParcels();
    } catch (err) {
    }

    this.ajouter = "Culture";
    // Bloquer le scroll de l'arrière-plan
    document.body.classList.add('no-scroll');
  }
  onTravail(){
    this.ajouter = "Travail au champ";
    // Bloquer le scroll de l'arrière-plan
    document.body.classList.add('no-scroll');
  }

  onTraitement(){
    this.ajouter = "Traitement Phyto";
    // Bloquer le scroll de l'arrière-plan
    document.body.classList.add('no-scroll');
  }

  onClose(){
    this.ajouter = "";
    // Débloquer le scroll de l'arrière-plan
    document.body.classList.remove('no-scroll');
    // Fermer le FAB si ouvert
    this.isFabOpen = false;
    // Réinitialiser la culture à modifier
    this.cultureToModify = null;
    // Réinitialiser l'intervention à modifier
    this.interventionToModify = null;
  }

  // Nouvelle méthode pour fermer avec rafraîchissement après validation réussie
  onCloseWithRefresh(){
    this.onClose(); // Fermer normalement
    this.refreshDashboard(); // Rafraîchir les données
  }

  // Nouvelle méthode spécifique pour le rafraîchissement des cultures modifiées
  onCultureUpdated(){
    // PAS d'animation de succès pour la modification (uniquement pour la création)
    // Rafraîchir instantanément les cultures
    this.http.refreshCulturesOnly();
    
    //  Attendre un peu que le cache soit rechargé avant de recharger les filtres
    setTimeout(() => {
      // 🔄 Recharger les filtres pour mettre à jour availableCultures
      this.loadFilterData();
      // Fermer le modal de modification
      this.onClose();
    }, 300);
  }

  // ✨ Méthode pour afficher l'animation de succès (appelée par cultureCreated)
  onCultureCreated(){
    // Activer l'animation de succès
    this.showCultureSuccessAnimation.set(true);
    // Rafraîchir instantanément les cultures
    this.http.refreshCulturesOnly();
    
    // ⏳ Attendre un peu que le cache soit rechargé avant de recharger les filtres
    setTimeout(() => {
      // 🔄 Recharger les filtres pour mettre à jour availableCultures et basculer en mode "avec culture"
      this.loadFilterData();
      // ✅ Forcer le mode "vue par culture" pour afficher les données immédiatement
      this.vueParCulture = true;
    }, 300);
  }

  // ✨ Ferme l'animation de succès et retourne au registre
  closeSuccessAnimation(): void {
    this.showCultureSuccessAnimation.set(false);
    this.onClose(); // Juste fermer, le rafraîchissement a déjà été fait
  }

  // ✨ Méthode pour afficher l'animation de succès de traitement
  onTreatmentCreated(treatmentData: any){
    // Stocker les données du traitement pour le débrief
    this.treatmentSuccessData = treatmentData;
    // Activer l'animation de succès
    this.showTreatmentSuccessAnimation.set(true);
  }

  // ✨ Ferme l'animation de succès de traitement et retourne au registre
  closeTreatmentSuccessAnimation(): void {
    this.showTreatmentSuccessAnimation.set(false);
    this.treatmentSuccessData = null;
    this.onCloseWithRefresh();
  }

  // 🔢 Compte le nombre de produits dans le traitement créé
  getTreatmentProductCount(): number {
    if (!this.treatmentSuccessData || !this.treatmentSuccessData.treatment_composition) {
      return 0;
    }
    // treatment_composition is flat (backward-compat unwrap)
    const comp = this.treatmentSuccessData.treatment_composition;
    const products = (Array.isArray(comp[0]) && Array.isArray(comp[0][0])) ? comp[0] : comp;
    return products.length;
  }

  // 📋 Récupère la liste des noms de produits
  getTreatmentProducts(): string[] {
    if (!this.treatmentSuccessData || !this.treatmentSuccessData.treatment_composition) {
      return [];
    }
    const comp = this.treatmentSuccessData.treatment_composition;
    const products = (Array.isArray(comp[0]) && Array.isArray(comp[0][0])) ? comp[0] : comp;
    return products.map((p: any) => {
      // Le nom du produit est dans component_name
      return p.component_name || p.product_name || p.productName || p.name || 'Produit inconnu';
    });
  }

  // 🌾 Compte le nombre de parcelles traitées
  getTreatmentParcelCount(): number {
    if (!this.treatmentSuccessData || !this.treatmentSuccessData.parcels_concerned) {
      return 0;
    }
    // parcels_concerned is flat (backward-compat unwrap)
    const pc = this.treatmentSuccessData.parcels_concerned;
    const parcels = (Array.isArray(pc[0]) && Array.isArray(pc[0][0])) ? pc[0] : pc;
    return parcels.length;
  }

  // ✨ Méthode pour afficher l'animation de succès de travail au champ
  onFieldWorkCreated(fieldWorkData: any){
    // Stocker les données du travail pour le débrief
    this.fieldWorkSuccessData = fieldWorkData;
    // Activer l'animation de succès
    this.showFieldWorkSuccessAnimation.set(true);
    // Rafraîchir instantanément les travaux au champ
    this.http.refreshFieldWorksOnly();
  }

  // ✨ Ferme l'animation de succès de travail au champ et retourne au registre
  closeFieldWorkSuccessAnimation(): void {
    this.showFieldWorkSuccessAnimation.set(false);
    this.fieldWorkSuccessData = null;
    this.onClose(); // Juste fermer, le rafraîchissement a déjà été fait
  }

  // 🌾 Compte le nombre de parcelles concernées par le travail
  getFieldWorkParcelCount(): number {
    if (!this.fieldWorkSuccessData || !this.fieldWorkSuccessData.parcels_concerned) {
      return 0;
    }
    return this.fieldWorkSuccessData.parcels_concerned.length;
  }

  // 📋 Récupère la liste des noms de parcelles
  getFieldWorkParcels(): string[] {
    if (!this.fieldWorkSuccessData || !this.fieldWorkSuccessData.parcels_concerned) {
      return [];
    }
    return this.fieldWorkSuccessData.parcels_concerned.map((p: any) => {
      return p.parcels_name || p.parcel_name || 'Parcelle inconnue';
    });
  }

  // Méthode optimisée pour rafraîchir uniquement les traitements
  private refreshDashboard(): void {
    this.http.refreshTreatmentsOnly();
  }

  onValeurAjouter(): string {
    return this.ajouter;
  }

  // === MÉTHODES DE CONTRÔLE DES MENUS DROPDOWN NATIFS ===
  
  // Fermer tous les menus
  closeAllMenus(): void {
    this.isViewMenuOpen = false;
    this.isDateFilterOpen = false;
    this.isParcelFilterOpen = false;
    this.isCultureFilterOpen = false;
  }

  // Basculer le menu vue
  toggleViewMenu(): void {
    this.closeAllMenus();
    this.isViewMenuOpen = !this.isViewMenuOpen;
  }

  // Basculer le menu filtres par date
  toggleDateFilter(): void {
    this.closeAllMenus();
    this.isDateFilterOpen = !this.isDateFilterOpen;
  }

  // Basculer le menu filtres par parcelles
  toggleParcelFilter(): void {
    this.closeAllMenus();
    this.isParcelFilterOpen = !this.isParcelFilterOpen;
  }

  // Basculer le menu filtres par cultures
  toggleCultureFilter(): void {
    this.closeAllMenus();
    this.isCultureFilterOpen = !this.isCultureFilterOpen;
  }

  // Gestionnaire de clic extérieur pour fermer les menus
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    const isClickInsideMenu = target.closest('.dropdown-container');

    if (!isClickInsideMenu) {
      this.closeAllMenus();
    }
  }

  loadFilterData(): void {
    this.http.getParcelles().pipe(takeUntil(this.destroy$)).subscribe(parcelles => {
      this.availableParcels = parcelles;
    });

    this.http.get().pipe(takeUntil(this.destroy$)).subscribe(cultures => {
      this.availableCultures = cultures;
      this.culturesLoaded = true;

      const cultureMap = new Map();
      cultures.forEach(culture => {
        const key = culture.phytoweb_name || culture.nomPhytoweb_crops_id;
        if (key && !cultureMap.has(key)) {
          cultureMap.set(key, {
            phytoweb_name: key,
            crop_name: culture.crop_name
          });
        }
      });

      this.uniqueCultureCategories = Array.from(cultureMap.values())
        .sort((a, b) => a.phytoweb_name.localeCompare(b.phytoweb_name));
    });
  }

  // === FILTRES PAR DATE ===
  clearDateFilter(): void {
    this.dateFilters = { startDate: '', endDate: '' };
  }

  // === FILTRES PAR PARCELLES ===
  onParcelFilterChange(parcelName: string, event: any): void {
    if (event.target.checked) {
      if (!this.parcelFilters.includes(parcelName)) {
        this.parcelFilters.push(parcelName);
      }
    } else {
      this.parcelFilters = this.parcelFilters.filter(p => p !== parcelName);
    }
  }

  clearParcelFilter(): void {
    this.parcelFilters = [];
  }

  selectAllParcels(): void {
    this.parcelFilters = this.availableParcels.map(p => p.parcel_name);
  }

  // === FILTRES PAR CULTURES ===
  onCultureFilterChange(cultureId: string, event: any): void {
    if (event.target.checked) {
      if (!this.cultureFilters.includes(cultureId)) {
        this.cultureFilters.push(cultureId);
      }
    } else {
      this.cultureFilters = this.cultureFilters.filter(c => c !== cultureId);
    }
  }

  clearCultureFilter(): void {
    this.cultureFilters = [];
  }

  selectAllCultures(): void {
    this.cultureFilters = this.uniqueCultureCategories.map(c => c.phytoweb_name);
  }

  /**
   * Gère la demande de modification depuis le composant enfant
   */
  onModifyCultureRequested(data: any): void {
    
    // Vérifier si c'est une modification d'intervention ou de culture
    if (data.mode === 'modification' && data.originalData) {
      // Cas 1: Modification d'intervention
      this.handleInterventionModification(data);
    } else {
      // Cas 2: Modification de culture (comportement existant)
      
      // Stocker la culture à modifier
      this.cultureToModify = data;
      // Ouvrir le formulaire de culture en mode modification
      this.ajouter = "Culture";
      // Bloquer le scroll de l'arrière-plan
      document.body.classList.add('no-scroll');
    }
  }

  private handleInterventionModification(interventionRequest: any): void {
    const { originalData, culture, type } = interventionRequest;
    
    if (type === 'traitement') {
      
      // Stocker les données pour préremplir le formulaire
      this.interventionToModify = {
        originalData: originalData,
        culture: culture,
        type: 'traitement'
      };
      
      // Ouvrir le formulaire de traitement
      this.ajouter = "Traitement Phyto";
      // Bloquer le scroll de l'arrière-plan
      document.body.classList.add('no-scroll');

    } else if (type === 'travail') {

      // Stocker les données pour préremplir le formulaire
      this.interventionToModify = {
        originalData: originalData,
        culture: culture,
        type: 'travail'
      };

      // Ouvrir le formulaire de travail au champ
      this.ajouter = "Travail au champ";
      // Bloquer le scroll de l'arrière-plan
      document.body.classList.add('no-scroll');
    }
  }

  onModifyGlobalEvent(eventData: any): void {
    const { event, eventType, originalData, eventId } = eventData;
    
    // Stocker les données pour préremplir le formulaire
    this.interventionToModify = {
      originalData: originalData,
      type: eventType,
      eventId: eventId,
      eventData: event
    };
    
    // Ouvrir le bon formulaire selon le type
    if (eventType === 'traitement') {
      this.ajouter = "Traitement Phyto";
    } else if (eventType === 'travail') {
      this.ajouter = "Travail au champ";
    }
    // Bloquer le scroll de l'arrière-plan
    document.body.classList.add('no-scroll');
  }

  // Méthode pour récupérer le pourcentage de progression de la culture
  getCultureProgress(): number {
    return this.currentCultureProgress;
  }

  // Méthode pour récupérer le pourcentage de progression du travail au champ
  getTravailProgress(): number {
    return this.currentTravailProgress;
  }

  // Méthode pour récupérer le pourcentage de progression du traitement phytosanitaire
  getTraitementProgress(): number {
    return this.currentTraitementProgress;
  }

  // Méthode pour vérifier si la validation de la culture est possible
  isCultureValidationEnabled(): boolean {
    return this.currentCultureValidation;
  }

  // Méthode pour vérifier si la validation du travail au champ est possible
  isTravailValidationEnabled(): boolean {
    return this.currentTravailValidation;
  }

  // Méthode pour vérifier si la validation du traitement phytosanitaire est possible
  isTraitementValidationEnabled(): boolean {
    return this.currentTraitementValidation;
  }

  // Gestionnaires d'événements du composant culture
  onCultureProgressChange(progress: number): void {
    this.currentCultureProgress = progress;
  }

  onCultureValidationChange(isValid: boolean): void {
    this.currentCultureValidation = isValid;
  }

  // Gestionnaires d'événements du composant travail au champ
  onTravailProgressChange(progress: number): void {
    this.currentTravailProgress = progress;
  }

  onTravailValidationChange(isValid: boolean): void {
    this.currentTravailValidation = isValid;
  }

  // Gestionnaires d'événements du composant traitement phytosanitaire
  onTraitementProgressChange(progress: number): void {
    this.currentTraitementProgress = progress;
  }

  onTraitementValidationChange(isValid: boolean): void {
    this.currentTraitementValidation = isValid;
  }

  // Méthode pour exporter le carnet de champ en Excel
exportCarnetChamp(): void {
  // Ouvrir la popup d'export avec les filtres
  this.showExportPopup.set(true);
  document.body.classList.add('no-scroll');
}

// Fermer la popup d'export
closeExportPopup(): void {
  this.showExportPopup.set(false);
  document.body.classList.remove('no-scroll');
}

// Effectuer l'export avec les filtres sélectionnés
performExportWithFilters(filters: ExportFilters): void {
  if (this.isExporting) {
    return; // Éviter les doubles clics
  }

  this.isExporting = true;
  this.closeExportPopup();

  const exportData = {
    filters: {
      years: filters.years,
      cropNames: filters.cropNames,
      archiveStatus: filters.archiveStatus,
      parcels: filters.parcels
    }
  };

  // Déterminer le format d'export
  const format = filters.format || 'excel';
  this.proceedWithRealExport(exportData, format);
}

  private proceedWithRealExport(exportData: any, format: 'excel' | 'pdf' = 'excel'): void {
    const exportUrl = `${environment.apiRegistre}/exports/registre?format=${format}`;

    const mimeType = format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const fileExtension = format === 'pdf' ? 'pdf' : 'xlsx';

    // L'intercepteur ajoute le Bearer et, le cas échéant, X-Workspace-UserId.
    this.httpClient.post(exportUrl, exportData, {
      responseType: 'blob',
      observe: 'response'
    }).subscribe({
      next: (response) => {
        const blob = new Blob([response.body as Blob], { type: mimeType });

        let filename = `Registre_${new Date().toISOString().split('T')[0]}.${fileExtension}`;
        const contentDisposition = response.headers.get('content-disposition');
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="(.+)"/);
          if (filenameMatch) filename = filenameMatch[1];
        }

        const downloadLink = document.createElement('a');
        const url = window.URL.createObjectURL(blob);
        downloadLink.href = url;
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        window.URL.revokeObjectURL(url);

        this.isExporting = false;
      },
      error: (error) => {
        let errorMessage = 'Erreur lors de l\'export du registre phytosanitaire';

        if (error.status === 401) {
          errorMessage = 'Erreur d\'authentification (401). Token invalide ou expiré. Veuillez vous reconnecter.';
          if (error.error?.error) errorMessage += '\nDétail: ' + error.error.error;
        } else if (error.status === 500) {
          errorMessage = 'Erreur serveur 500. Vérifiez les logs du serveur.';
        } else if (error.error?.error) {
          errorMessage = error.error.error;
        }

        alert(errorMessage);
        this.isExporting = false;
      }
    });
  }

} // Fermeture de la classe RegistreComponent
