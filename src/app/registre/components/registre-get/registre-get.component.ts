import { Component, OnInit, inject, effect, Input, OnChanges, Output, EventEmitter, ChangeDetectorRef, HostListener } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { RegistreService } from '../../services/registre.service';
import { Observable, forkJoin, of, combineLatest } from 'rxjs';
import { map, filter } from 'rxjs/operators';
import { CultureDetailPopupComponent } from '../culture-detail-popup/culture-detail-popup.component';
import { Router } from '@angular/router';

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
  selector: 'app-registre-get',
  standalone: true,
  imports: [
    SharedModule,
    CultureDetailPopupComponent
  ],
  providers: [
  ],
  templateUrl: './registre-get.component.html',
  styleUrl: './registre-get.component.scss'
})
export class RegistreGetComponent implements OnInit, OnChanges {

  @Input() filterData: FilterData = {
    searchTerm: '',
    dateFilters: { startDate: '', endDate: '' },
    parcelFilters: [],
    cultureFilters: []
  };

  @Output() modifyCultureRequested = new EventEmitter<any>();

  registre!: Observable<any[]>;
  interventionsParCulture: any[] = [];
  filteredInterventionsParCulture: any[] = [];
  isLoading: boolean = true;

  // Répartition déterministe des cartes entre les 2 colonnes (voir le template :
  // évite l'algorithme d'équilibrage de CSS column-count, qui pouvait désaligner
  // verticalement le haut des 2 colonnes).
  get leftColumnCultures(): any[] {
    return this.filteredInterventionsParCulture.filter((_, i) => i % 2 === 0);
  }

  get rightColumnCultures(): any[] {
    return this.filteredInterventionsParCulture.filter((_, i) => i % 2 === 1);
  }
  
  // Popup state
  showDetailPopup: boolean = false;
  selectedCultureForDetail: any = null;

  // Infobulle "parcelles associées" : ouverte au clic plutôt qu'au survol uniquement
  // (le hover seul ne se déclenche pas de façon fiable sur tous les appareils/trackpads).
  openParcellesTooltipId: string | null = null;

  toggleParcellesTooltip(cultureId: string, event: Event): void {
    event.stopPropagation();
    this.openParcellesTooltipId = this.openParcellesTooltipId === cultureId ? null : cultureId;
  }

  @HostListener('document:click')
  closeParcellesTooltip(): void {
    this.openParcellesTooltipId = null;
  }
  
  // Pagination
  readonly ITEMS_PER_PAGE = 5;
  currentPages: { [key: string]: number } = {}; // Page actuelle pour chaque culture
  
  private registreService = inject(RegistreService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  // 🚀 Cache des données pour éviter les rechargements complets
  private cachedCultures: any[] = [];
  private cachedTreatments: any[] = [];
  private cachedFieldWorks: any[] = [];
  // Map id_parcel → parcel_name pour résolution des UUIDs dans parcels_id
  private parcelMap = new Map<string, string>();

  constructor() {
    // 🎯 Effect optimisé pour rafraîchir UNIQUEMENT les traitements
    effect(() => {
      if (this.registreService.needRefreshTreatments()) {
        this.registreService.getAllTraitements().subscribe({
          next: (treatments) => {
            this.cachedTreatments = treatments;
            this.rebuildInterventionsWithCache();
            setTimeout(() => {
              this.registreService.needRefreshTreatments.set(false);
            }, 100);
          }
        });
      }
    }, { allowSignalWrites: true });

    // 🎯 Effect pour rafraîchir UNIQUEMENT les cultures
    effect(() => {
      if (this.registreService.needRefreshCultures()) {
        this.registreService.get().subscribe({
          next: (cultures) => {
            this.cachedCultures = cultures;
            this.rebuildInterventionsWithCache();
            setTimeout(() => {
              this.registreService.needRefreshCultures.set(false);
            }, 100);
          }
        });
      }
    }, { allowSignalWrites: true });

    // 🎯 Effect pour rafraîchir UNIQUEMENT les travaux
    effect(() => {
      if (this.registreService.needRefreshFieldWorks()) {
        this.registreService.getAllTravauxChamps().subscribe({
          next: (works) => {
            this.cachedFieldWorks = works;
            this.rebuildInterventionsWithCache();
            setTimeout(() => {
              this.registreService.needRefreshFieldWorks.set(false);
            }, 100);
          }
        });
      }
    }, { allowSignalWrites: true });

    // Effect pour surveiller les changements de recherche et filtres
    effect(() => {
      this.applyAllFilters();
    });
  }

  ngOnInit(): void {
    // 🚀 OPTIMISATION : Utiliser directement le cache du service au lieu de recharger
    this.loadDataFromCache();
    // Charger les parcelles pour résoudre les UUIDs dans parcels_id
    this.registreService.getParcelles().subscribe({
      next: (parcelles) => {
        this.parcelMap.clear();
        parcelles.forEach((p: any) => {
          if (p.id_parcel) this.parcelMap.set(p.id_parcel, p.parcel_name || p.id_parcel);
        });
      }
    });
  }

  ngOnChanges(): void {
    // Réappliquer le filtre quand les données de filtre changent depuis le parent
    this.applyAllFilters();
  }

  /**
   * 🚀 Chargement optimisé depuis le cache du service (instantané)
   */
  private loadDataFromCache(): void {
    // Utiliser combineLatest pour recevoir les mises à jour en temps réel
    // et filter pour ignorer les tableaux vides initiaux
    combineLatest({
      cultures: this.registreService.get(),
      traitements: this.registreService.getAllTraitements(),
      travaux: this.registreService.getAllTravauxChamps()
    }).pipe(
      // Attendre que les cultures soient chargées (pas vides)
      filter(({ cultures }) => cultures.length > 0)
    ).subscribe({
      next: ({ cultures, traitements, travaux }) => {
        // 🚀 Mettre en cache les données
        this.cachedCultures = cultures;
        this.cachedTreatments = traitements;
        this.cachedFieldWorks = travaux;

        // Reconstruire les interventions
        this.rebuildInterventionsWithCache();
        this.isLoading = false;
    },
    error: (error) => {
        this.isLoading = false;
    }
    });
  }

  /**
   * @deprecated Utiliser loadDataFromCache() à la place
   * Conservé pour compatibilité si appelé ailleurs
   */
  private loadData(): void {
    this.loadDataFromCache();
  }

  /**
   * 🚀 Reconstruction optimisée des interventions à partir du cache
   */
  private rebuildInterventionsWithCache(): void {
    // Pour chaque culture, fusionner les interventions liées
      this.interventionsParCulture = this.cachedCultures.map(culture => {
        const lignes: any[] = [];
        // Traitements : une ligne par parcelle concernée ET par produit
        (this.cachedTreatments || []).forEach(t => {
          if (!t.parcels_concerned || !t.treatment_composition) return;
          // Flat structure, backward-compat unwrap
          const flatParcels: any[] = (Array.isArray(t.parcels_concerned[0]) && Array.isArray(t.parcels_concerned[0][0]))
            ? t.parcels_concerned[0] : t.parcels_concerned;
          const flatComps: any[] = (Array.isArray(t.treatment_composition[0]) && Array.isArray(t.treatment_composition[0][0]))
            ? t.treatment_composition[0] : t.treatment_composition;
          flatParcels.forEach((parcelle: any) => {
              if (parcelle.crop_id !== culture.crop_id) return;
              // Pour chaque produit
              flatComps.forEach((prod: any) => {
                lignes.push({
                  date: t.date || t.treatment_date || t.event_date || '',
                  parcelle: parcelle.parcel_name || parcelle.parcels_name || parcelle.parcels,
                  type: 'traitement',
                  details: `${prod.component_name} (${prod.component_numaut}) - ${this.formatDoseValue(prod.component_dose)}${prod.component_dose_unit}`,
                  // Données supplémentaires pour la popup détaillée
                  operateur: t.operateur || '[BT_Laune]',
                  bbch: t.bbch_target || 'Non spécifié',
                  cibles: (t.target ?? t.ciblee) ? (Array.isArray(t.target ?? t.ciblee) ? (t.target ?? t.ciblee).join(', ') : (t.target ?? t.ciblee)) : 'Non spécifiée',
                  originalData: t // Garder référence aux données complètes
                });
              });
          });
        });
        // Travaux au champ : une ligne par parcelle concernée
        (this.cachedFieldWorks || []).forEach(w => {
          if (!w.parcels_concerned || !Array.isArray(w.parcels_concerned)) return;
          
          // Traiter directement le tableau d'associations (nouveau système)
          w.parcels_concerned.forEach((parcelle: any) => {
            if (parcelle.crop_id !== culture.crop_id) return;
            
            // Date selon type
            let date = w.date || w.datee || w.dateDeLobservation || w.harvest_date || w.dateDeRecolte || '';
            
            // Type de travail
            let type = w.type || w.type_travaux_aux_champs || 'Travail';
            
            // Détail selon type
            let details = '';
            if (type === 'Fertilisation') {
              details = [w.informations, w.tool || w.outil].filter(Boolean).join(' - ');
            } else if (type === 'Irrigation') {
              details = [w.dose, w.dose_unit || w.lha].filter(Boolean).join(' ');
            } else if (type === 'Récolte') {
              details = w.remark || w.remaques || ''; // Le rendement est maintenant dans remark
            } else if (type === 'Observation') {
              // Le serveur range le texte de l'observation dans eventInfo (→ informations)
              details = w.observation || w.informations || '';
            } else if (type === 'Travail du sol') {
              // Pour les travaux du sol : afficher prioritairement le field_work_type
              const detailsParts = [];
              const fwType = w.field_work_type || w.travailtype;
              if (fwType && fwType.trim()) {
                detailsParts.push(fwType.trim());
              }
              if (w.description && w.description.trim()) {
                detailsParts.push(w.description.trim());
              }
              const fwRemark = w.remark || w.remaques;
              if (fwRemark && fwRemark.trim()) {
                detailsParts.push(`Remarques: ${fwRemark.trim()}`);
              }
              const fwTool = w.tool || w.outil;
              if (fwTool) {
                detailsParts.push(`Outil: ${fwTool}`);
              }
              details = detailsParts.join(', ') || '';
            }
            
            lignes.push({
              date,
              parcelle: parcelle.parcel_name || parcelle.parcels_name || parcelle.parcels_id,
              type,
              details,
              // Données supplémentaires pour la popup détaillée
              operateur: w.operateur || '[BT_Laune]',
              bbch: 'N/A', // Les travaux au champ n'ont pas de BBCH
              cibles: 'N/A', // Les travaux au champ n'ont pas de cibles
              originalData: w // Garder référence aux données complètes
            });
          });
        });
        // Tri par date décroissante (dates au format ISO ou vide)
        lignes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return {
          ...culture,
          interventions: lignes
        };
      });
      
      // Initialiser les pages pour chaque culture
      this.interventionsParCulture.forEach(culture => {
        this.currentPages[culture.crop_id] = 0;
      });
      
      // Appliquer tous les filtres
      this.applyAllFilters();
      
      // 🚀 Forcer la détection de changements pour affichage immédiat
      this.cdr.detectChanges();
  }

  /**
   * Applique tous les filtres combinés
   */
  applyAllFilters(): void {
    let filtered = [...this.interventionsParCulture];

    // 1. Filtre par recherche textuelle
    filtered = this.applySearchFilter(filtered);

    // 2. Filtre par cultures
    filtered = this.applyCultureFilter(filtered);

    // 3. Filtre par parcelles  
    filtered = this.applyParcelFilter(filtered);

    // 4. Filtre par dates
    filtered = this.applyDateFilter(filtered);

    this.filteredInterventionsParCulture = filtered;

    
    // Réinitialiser les pages pour les cultures filtrées
    this.filteredInterventionsParCulture.forEach(culture => {
      if (!(culture.crop_id in this.currentPages)) {
        this.currentPages[culture.crop_id] = 0;
      }
    });
  }

  /**
   * Filtre par recherche textuelle (cultures et parcelles)
   */
  private applySearchFilter(cultures: any[]): any[] {
    if (!this.filterData.searchTerm || this.filterData.searchTerm.trim() === '') {
      return cultures;
    }

    const searchLower = this.filterData.searchTerm.toLowerCase().trim();
    
    return cultures.filter(culture => {
      // Rechercher dans le nom de la culture
      const cultureMatch = culture.crop_name?.toLowerCase().includes(searchLower);
      
      // Rechercher dans les parcelles de la culture
      const parcels = Array.isArray(culture.parcels_id) ? culture.parcels_id : [culture.parcels_id].filter(Boolean);
      const parcelNames = parcels.map((id: string) => this.parcelMap.get(id) || id);
      const parcelsText = parcelNames.join(' ').toLowerCase();
      const parcelMatch = parcelsText.includes(searchLower);
      
      return cultureMatch || parcelMatch;
    });
  }

  /**
   * Filtre par cultures (nomPhytoweb_crops_id)
   */
  private applyCultureFilter(cultures: any[]): any[] {
    if (!this.filterData.cultureFilters || this.filterData.cultureFilters.length === 0) {
      return cultures;
    }

    
    return cultures.filter(culture => 
      this.filterData.cultureFilters.includes(culture.phytoweb_name || culture.nomPhytoweb_crops_id)
    );
  }

  /**
   * Filtre par parcelles
   */
  private applyParcelFilter(cultures: any[]): any[] {
    if (!this.filterData.parcelFilters || this.filterData.parcelFilters.length === 0) {
      return cultures;
    }


    
    return cultures.filter(culture => {
      // Vérifier si au moins une parcelle de la culture correspond aux filtres
      const parcels = Array.isArray(culture.parcels_id) ? culture.parcels_id : [culture.parcels_id];
      return parcels.some((parcel: string) => 
        // Le filtre contient des NOMS de parcelles, la culture des identifiants : on convertit
        // l'identifiant en nom (même table que la recherche texte, voir applySearchFilter).
        this.filterData.parcelFilters.includes(this.parcelMap.get(parcel) || parcel)
      );
    });
  }

  /**
   * Filtre par dates des interventions
   */
  private applyDateFilter(cultures: any[]): any[] {
    if (!this.filterData.dateFilters.startDate && !this.filterData.dateFilters.endDate) {
      return cultures;
    }

    
    const startDate = this.filterData.dateFilters.startDate ? new Date(this.filterData.dateFilters.startDate) : null;
    const endDate = this.filterData.dateFilters.endDate ? new Date(this.filterData.dateFilters.endDate) : null;

    return cultures.map(culture => {
      // Filtrer les interventions de chaque culture selon les dates
      const filteredInterventions = culture.interventions.filter((intervention: any) => {
        if (!intervention.date) return false;
        
        const interventionDate = new Date(intervention.date);
        
        // Vérifier les contraintes de dates
        if (startDate && interventionDate < startDate) return false;
        if (endDate && interventionDate > endDate) return false;
        
        return true;
      });

      // Retourner la culture avec les interventions filtrées
      return {
        ...culture,
        interventions: filteredInterventions
      };
    }).filter(culture => culture.interventions.length > 0); // Ne garder que les cultures avec des interventions dans la période
  }

  /**
   * Formate une date ISO (ou parsable) en format court DD/MM pour l'affichage.
   */
  formatDateShort(date: string): string {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
  }

  /**
   * Obtient les lignes d'interventions paginées pour une culture
   */
  getPaginatedInterventions(culture: any): any[] {
    const startIndex = this.currentPages[culture.crop_id] * this.ITEMS_PER_PAGE;
    const endIndex = startIndex + this.ITEMS_PER_PAGE;
    return culture.interventions.slice(startIndex, endIndex);
  }
  
  /**
   * Obtient le nombre total de pages pour une culture
   */
  getTotalPages(culture: any): number {
    return Math.ceil(culture.interventions.length / this.ITEMS_PER_PAGE);
  }
  
  /**
   * Vérifie s'il y a une page précédente
   */
  hasPreviousPage(culture: any): boolean {
    return this.currentPages[culture.crop_id] > 0;
  }
  
  /**
   * Vérifie s'il y a une page suivante
   */
  hasNextPage(culture: any): boolean {
    const currentPage = this.currentPages[culture.crop_id];
    const totalPages = this.getTotalPages(culture);
    return currentPage < totalPages - 1;
  }
  
  /**
   * Va à la page précédente
   */
  previousPage(culture: any): void {
    if (this.hasPreviousPage(culture)) {
      this.currentPages[culture.crop_id]--;
    }
  }
  
  /**
   * Va à la page suivante
   */
  nextPage(culture: any): void {
    if (this.hasNextPage(culture)) {
      this.currentPages[culture.crop_id]++;
    }
  }
  
  /**
   * Obtient les informations de pagination pour une culture
   */
  getPaginationInfo(culture: any): string {
    const currentPage = this.currentPages[culture.crop_id] + 1;
    const totalPages = this.getTotalPages(culture);
    const startItem = this.currentPages[culture.crop_id] * this.ITEMS_PER_PAGE + 1;
    const endItem = Math.min(startItem + this.ITEMS_PER_PAGE - 1, culture.interventions.length);
    
    return `${startItem}-${endItem} sur ${culture.interventions.length}`;
  }

  /**
   * Ouvre la popup de détail pour une culture
   */
  openCultureDetail(culture: any): void {
    this.selectedCultureForDetail = { ...culture };
    this.showDetailPopup = true;
  }

  /**
   * Ferme la popup de détail
   */
  closeCultureDetail(): void {
    this.showDetailPopup = false;
    this.selectedCultureForDetail = null;
  }

  /**
   * Gère la modification d'une culture
   */
  onModifyCulture(culture: any): void {
    // Émettre l'événement vers le composant parent pour ouvrir le formulaire de modification
    this.modifyCultureRequested.emit(culture);
    // Fermer la popup de détail
    this.closeCultureDetail();
  }

  /**
   * Gère la suppression d'une culture
   */
  onDeleteCulture(culture: any): void {
    
    // Confirmation de suppression
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer la culture "${culture.crop_name}" ?\n\nCette action est irréversible et supprimera également tous les traitements et travaux associés à cette culture.`;
    
    if (confirm(confirmMessage)) {
      // Appeler le service pour supprimer la culture
      this.registreService.deleteCulture(culture.crop_id).subscribe({
        next: () => {
          // Fermer la popup
          this.closeCultureDetail();
          // Recharger les données
          this.loadData();
          // Notification utilisateur
          alert('Culture supprimée avec succès !');
        },
        error: (error) => {
          alert('Erreur lors de la suppression de la culture. Veuillez réessayer.');
        }
      });
    }
  }

  /**
   * Gère l'archivage d'une culture
   */
  onArchiveCulture(data: {culture: any, collection: string}): void {
    const { culture, collection } = data;
    
    // Appeler le service pour archiver la culture
    this.registreService.archiveCrop(culture.crop_id, collection).subscribe({
      next: (response) => {
        if (response.success) {
          // Fermer la popup
          this.closeCultureDetail();
          // Recharger les données
          this.loadData();
          // Notification utilisateur
          alert(`Culture "${culture.crop_name}" archivée dans la collection "${collection}" avec succès !`);
        } else {
          alert('Erreur lors de l\'archivage de la culture : ' + (response.message || 'Erreur inconnue'));
        }
      },
      error: (error) => {
        console.error('Erreur lors de l\'archivage:', error);
        alert('Erreur lors de l\'archivage de la culture. Veuillez réessayer.');
      }
    });
  }

  /**
   * Modifier une intervention spécifique - Émet un événement pour le parent
   */
  onModifyIntervention(interventionData: any): void {
    
    const intervention = interventionData.intervention;
    const culture = interventionData.culture;
    const originalData = intervention.originalData; // Les données complètes originales
    
    if (!originalData) {
      alert('Erreur : Données d\'intervention incomplètes. Impossible de modifier.');
      return;
    }
        
    const type = this.determineInterventionType(originalData, intervention.type);
    
    // Fermer la popup actuelle
    this.showDetailPopup = false;
    
    // Préparer les données pour le formulaire de modification
    const modificationRequest = {
      originalData: originalData,
      culture: culture,
      type: type,
      mode: 'modification',
      intervention: intervention
    };
    
    
    // Émettre l'événement vers le composant parent
    this.modifyCultureRequested.emit(modificationRequest);
    
  }

  /**
   * Supprimer une intervention spécifique d'une culture - Version simplifiée avec debug renforcé
   */
  onDeleteIntervention(deleteData: any): void {
    
    const intervention = deleteData.intervention;
    const culture = deleteData.culture;
    const originalData = intervention.originalData; // Les données complètes originales
    
    if (!originalData) {
      alert('Erreur : Données d\'intervention incomplètes. Impossible de supprimer.');
      return;
    }
    
    
    const type = this.determineInterventionType(originalData, intervention.type);
    
    // Demander confirmation à l'utilisateur
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer cette intervention ${type === 'traitement' ? 'de traitement phytosanitaire' : 'de travail au champ'} ?\n\nCette action retirera la culture "${culture.crop_name}" de cette intervention.`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    
    // Vérifier combien de parcelles/cultures sont concernées
    let totalEntries = 0;
    
    if (type === 'traitement') {
      const pc = originalData.parcels_concerned || [];
      const parcelsConcerned = (Array.isArray(pc[0]) && Array.isArray(pc[0][0])) ? pc[0] : pc;
      totalEntries = parcelsConcerned.length;
    } else {
      const parcelsConcerned = originalData.parcels_concerned || [];
      totalEntries = parcelsConcerned.length;
    }
    
    
    if (totalEntries <= 1) {
      // Une seule entrée, supprimer complètement l'intervention
      this.deleteCompleteIntervention(originalData, type);
    } else {
      // Plusieurs entrées, suppression granulaire
      this.removeParcelFromIntervention(originalData, culture, type);
    }
  }

  /**
   * Détermine le type d'intervention (traitement ou travail)
   */
  private determineInterventionType(intervention: any, hintType?: string): 'traitement' | 'travail' {
    
    // Utiliser le type suggéré en priorité s'il est fiable
    if (hintType) {
      if (hintType.toLowerCase() === 'traitement' || hintType.toLowerCase().includes('traitement')) {
        return 'traitement';
      }
      if (hintType.toLowerCase() !== 'traitement') {
        // Si ce n'est pas explicitement 'traitement', c'est probablement un travail
        return 'travail';
      }
    }
    
    // Vérifier les propriétés spécifiques aux traitements phytosanitaires
    if (intervention.event_id || 
        intervention.treatment_composition || 
        intervention.parcels_concerned?.[0]?.[0]?.treatment_volume_applied !== undefined ||
        intervention.type?.includes('phyto') ||
        intervention.type?.includes('treatment') ||
        intervention.bbch !== undefined ||
        (intervention.target ?? intervention.ciblee) !== undefined) {
      return 'traitement';
    }
    
    // Vérifier les propriétés spécifiques aux travaux au champ
    if (intervention.travaux_aux_champs_id || 
        intervention.type_travaux_aux_champs || 
        intervention.tool !== undefined ||
        intervention.outil !== undefined ||
        intervention.informations !== undefined ||
        intervention.observation !== undefined) {
      return 'travail';
    }
    
    // Par défaut, essayer de deviner selon le contenu
    if (intervention.type && typeof intervention.type === 'string') {
      const typeStr = intervention.type.toLowerCase();
      if (typeStr.includes('traitement') || typeStr.includes('phyto') || typeStr.includes('fongicide') || typeStr.includes('herbicide') || typeStr.includes('insecticide')) {
        return 'traitement';
      }
      
      if (typeStr.includes('fertilisation') || typeStr.includes('irrigation') || typeStr.includes('observation') || typeStr.includes('récolte') || typeStr.includes('travaux')) {
        return 'travail';
      }
    }
    
    // Dernier recours : analyser la structure des données
    if (intervention.parcels_concerned) {
      // If first element is an object (not array-of-array), it's a flat treatment or field work
      if (Array.isArray(intervention.parcels_concerned) && intervention.parcels_concerned[0] && typeof intervention.parcels_concerned[0] === 'object') {
        // Check if it has treatment-specific keys
        if (intervention.event_id || intervention.treatment_composition) {
          return 'traitement';
        }
        return 'travail';
      }
    }
    
    // Par défaut, retourner 'travail' si on ne peut pas déterminer
    return 'travail';
  }

  /**
   * Supprime complètement l'intervention
   */
  private deleteCompleteIntervention(originalData: any, type: 'traitement' | 'travail'): void {
    
    this.registreService.deleteIntervention(originalData, type).subscribe({
      next: (response: any) => {
        
        // Recharger les données
        this.loadData();
        
        // Rafraîchir la popup avec délai pour permettre le rechargement
        setTimeout(() => this.refreshCultureDetail(), 1000);
        
        alert(`${type === 'traitement' ? 'Traitement' : 'Travail au champ'} supprimé avec succès !`);
      },
      error: (error: any) => {
        const errorMessage = error.error?.error || error.message || 'Erreur inconnue lors de la suppression';
        alert(`Erreur lors de la suppression : ${errorMessage}`);
      }
    });
  }

  /**
   * Supprime seulement l'entrée de cette culture/parcelle de l'intervention
   */
  private removeParcelFromIntervention(originalData: any, culture: any, type: 'traitement' | 'travail'): void {
    
    // Construire l'objet parcelle à supprimer avec les bonnes clés
    // IMPORTANT: Nous devons utiliser le parcels_id pour la suppression, PAS le crop_id
    let parcelId: number;
    
    // Pour les interventions, nous devons identifier la parcelle à supprimer
    // Dans le contexte du dashboard, nous avons accès aux informations de la culture affichée
    // Il faut extraire le parcels_id correspondant à cette culture dans l'intervention
    
    
    // Chercher dans les données de l'intervention pour trouver la parcelle qui correspond à cette culture
    if (type === 'traitement' && originalData.parcels_concerned) {
      // Flat structure with backward-compat
      const pc = originalData.parcels_concerned;
      const parcels = (Array.isArray(pc[0]) && Array.isArray(pc[0][0])) ? pc[0] : pc;
      const matchingParcel = parcels.find((p: any) => p.crop_id === culture.crop_id);
      if (matchingParcel) {
        parcelId = matchingParcel.parcel_id ?? matchingParcel.parcels_id;
      } else {
        alert('Erreur: Impossible de trouver la parcelle à supprimer');
        return;
      }
    } else if (type === 'travail' && originalData.parcels_concerned) {
      // Pour les travaux au champ : parcels_concerned est directement un tableau
      const parcels = originalData.parcels_concerned;
      const matchingParcel = parcels.find((p: any) => p.crop_id === culture.crop_id);
      if (matchingParcel) {
        parcelId = matchingParcel.parcels_id;
      } else {
        alert('Erreur: Impossible de trouver la parcelle à supprimer');
        return;
      }
    } else {
      alert('Erreur: Structure de données incorrecte');
      return;
    }
    
    const parcelToRemove = {
      parcels_id: parcelId, // UNIQUEMENT parcels_id
      // Garder les autres infos pour les logs
      crop_id: culture.crop_id,
      parcel_name: culture.crop_name || 'Culture inconnue',
      parcels_name: culture.crop_name || 'Culture inconnue'
    };
    
    
    this.registreService.removeParcelFromIntervention(originalData, parcelToRemove).subscribe({
      next: (response: any) => {
        
        // Recharger les données
        this.loadData();
        
        // Rafraîchir la popup avec délai pour permettre le rechargement
        setTimeout(() => this.refreshCultureDetail(), 1000);
        
        alert(`Cette culture a été retirée de l'intervention. L'intervention reste active pour les autres cultures.`);
      },
      error: (error: any) => {
        const errorMessage = error.error?.error || error.message || 'Erreur inconnue lors de la suppression';
        alert(`Erreur lors de la suppression : ${errorMessage}`);
      }
    });
  }

  /**
   * Rafraîchir les données de la popup de détail
   */
  private refreshCultureDetail(): void {
    if (this.selectedCultureForDetail && this.showDetailPopup) {
      // Trouver la culture mise à jour dans les nouvelles données
      const updatedCulture = this.interventionsParCulture.find(
        culture => culture.crop_id === this.selectedCultureForDetail.crop_id
      );
      
      if (updatedCulture) {
        this.selectedCultureForDetail = updatedCulture;
      } else {
        // Si la culture n'existe plus, fermer la popup
        this.closeCultureDetail();
      }
    }
  }

  /**
   * Limite l'affichage des parcelles avec ellipsis si trop long
   */
  getTruncatedParcels(parcels: string | string[], maxLength: number = 40): string {
    let parcelText = '';
    
    if (Array.isArray(parcels)) {
      parcelText = parcels.join(', ');
    } else {
      parcelText = parcels || '';
    }
    
    if (parcelText.length > maxLength) {
      return parcelText.substring(0, maxLength) + '...';
    }
    
    return parcelText;
  }

  /**
   * Retourne le nombre de parcelles
   */
  getParcelCount(parcels: string | string[]): number {
    if (Array.isArray(parcels)) {
      return parcels.length;
    } else if (parcels) {
      return parcels.split(',').map(p => p.trim()).filter(p => p.length > 0).length;
    }
    return 0;
  }

  /**
   * Retourne la liste des parcelles sous forme de tableau (résout les UUIDs en noms)
   */
  getParcelList(parcels: string | string[]): string[] {
    const ids: string[] = Array.isArray(parcels)
      ? parcels
      : parcels ? parcels.split(',').map(p => p.trim()).filter(p => p.length > 0) : [];
    return ids.map(id => this.parcelMap.get(id) || id);
  }

  /** Arrondit une dose à 2 décimales pour l'affichage (détails d'intervention sur la culture card). */
  private formatDoseValue(value: any): string {
    const n = parseFloat(value);
    return isNaN(n) ? (value ?? '') : n.toFixed(2);
  }
}
