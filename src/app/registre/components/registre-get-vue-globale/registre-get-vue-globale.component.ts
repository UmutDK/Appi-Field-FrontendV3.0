import { Component, Input, OnInit, Output, EventEmitter, OnChanges, SimpleChanges, effect } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { RegistreService } from '../../services/registre.service';
import { forkJoin, combineLatest } from 'rxjs';
import { filter } from 'rxjs/operators';

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

// Interface unifiée pour tous les événements
interface UnifiedEvent {
  date: string;
  culture: string;
  categoriePhyToweb: string;
  eppo: string;
  bbch: string;
  parcelle: string;
  type: string;
  cible: string;
  operateur: string;
  details: string;
  eventType: 'traitement' | 'travail'; // Pour distinguer le type d'événement
  originalData: any; // Données originales pour référence
}

@Component({
  selector: 'app-registre-get-vue-globale',
  standalone: true,
  imports: [
    SharedModule
  ],
  templateUrl: './registre-get-vue-globale.component.html',
  styleUrl: './registre-get-vue-globale.component.scss'
})
export class RegistreGetVueGlobaleComponent implements OnInit, OnChanges {

  @Input() filterData: FilterData = {
    searchTerm: '',
    dateFilters: { startDate: '', endDate: '' },
    parcelFilters: [],
    cultureFilters: []
  };

  @Output() modifyEvent = new EventEmitter<any>();

  // Données unifiées
  unifiedEvents: UnifiedEvent[] = [];
  filteredEvents: UnifiedEvent[] = [];
  loading = true;
  
  // 🚀 Cache pour optimisation
  private cachedCultures: any[] = [];
  private cachedTreatments: any[] = [];
  private cachedFieldWorks: any[] = [];

  constructor(private registreService: RegistreService) {
    // 🎯 Effect optimisé pour rafraîchir UNIQUEMENT les cultures
    effect(() => {
      if (this.registreService.needRefreshCultures()) {
        this.registreService.get().subscribe({
          next: (cultures) => {
            this.cachedCultures = cultures;
            this.rebuildUnifiedEventsFromCache();
            setTimeout(() => {
              this.registreService.needRefreshCultures.set(false);
            }, 100);
          }
        });
      }
    }, { allowSignalWrites: true });

    // 🎯 Effect optimisé pour rafraîchir UNIQUEMENT les traitements
    effect(() => {
      if (this.registreService.needRefreshTreatments()) {
        this.registreService.getAllTraitements().subscribe({
          next: (treatments) => {
            this.cachedTreatments = treatments;
            this.rebuildUnifiedEventsFromCache();
            setTimeout(() => {
              this.registreService.needRefreshTreatments.set(false);
            }, 100);
          }
        });
      }
    }, { allowSignalWrites: true });

    // 🎯 Effect optimisé pour rafraîchir UNIQUEMENT les travaux
    effect(() => {
      if (this.registreService.needRefreshFieldWorks()) {
        this.registreService.getAllFieldWorks().subscribe({
          next: (works) => {
            this.cachedFieldWorks = works;
            this.rebuildUnifiedEventsFromCache();
            setTimeout(() => {
              this.registreService.needRefreshFieldWorks.set(false);
            }, 100);
          }
        });
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    // 🚀 OPTIMISATION : Utiliser directement le cache du service au lieu de recharger
    this.loadAllEventsFromCache();
  }

  ngOnChanges(changes: SimpleChanges) {
    // Réagir aux changements des filtres
    if (changes['filterData'] && !changes['filterData'].firstChange) {
      this.applyFilters();
    }
  }

  /**
   * 🚀 Charge les événements depuis le cache du service (affichage instantané)
   * Le service a déjà préchargé les données via les BehaviorSubject au démarrage de l'app
   */
  private loadAllEventsFromCache() {
    this.loading = true;
    
    // Utiliser combineLatest pour recevoir les mises à jour en temps réel
    // et filter pour ignorer les tableaux vides initiaux
    combineLatest({
      cultures: this.registreService.get(),
      traitements: this.registreService.getAllTraitements(),
      travaux: this.registreService.getAllFieldWorks()
    }).pipe(
      // Attendre que les cultures soient chargées (pas vides)
      filter(({ cultures }) => cultures.length > 0)
    ).subscribe({
      next: (data) => {
        // 🚀 Mettre en cache les données
        this.cachedCultures = data.cultures || [];
        this.cachedTreatments = data.traitements || [];
        this.cachedFieldWorks = data.travaux || [];
        
        this.rebuildUnifiedEventsFromCache();
        this.loading = false;
        
      },
      error: (error) => {
        this.loading = false;
      }
    });
  }

  /**
   * @deprecated Utiliser loadAllEventsFromCache() à la place
   * Charge tous les événements (traitements + travaux au champ) et les unifie
   */
  loadAllEvents() {
    this.loadAllEventsFromCache();
  }

  /**
   * 🚀 Reconstruction optimisée des événements à partir du cache
   */
  private rebuildUnifiedEventsFromCache() {
    // Convertir les traitements en événements unifiés
    const traitementEvents = this.convertTraitementsToUnified(this.cachedTreatments);
    
    // Convertir les travaux au champ en événements unifiés
    const travauxEvents = this.convertTravauxToUnified(this.cachedFieldWorks);
    
    // Combiner et trier par date (plus récent en premier)
    this.unifiedEvents = [...traitementEvents, ...travauxEvents]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    this.applyFilters();
  }

  /**
   * Convertit les traitements phyto en événements unifiés
   * Crée une ligne par combinaison parcelle × produit
   */
  private convertTraitementsToUnified(traitements: any[]): UnifiedEvent[] {
    const events: UnifiedEvent[] = [];
    
    traitements.forEach(traitement => {
      // Récupérer les parcelles et les produits
      const parcelles = Array.isArray(traitement.parcels_concerned) ? traitement.parcels_concerned : [];
      const produits = Array.isArray(traitement.treatment_composition) ? traitement.treatment_composition : [];
      
      if (parcelles.length > 0 && produits.length > 0) {
        // Double boucle : une ligne par combinaison parcelle × produit
        parcelles.forEach((parcel: any) => {
          produits.forEach((produit: any) => {
            events.push({
              date: this.formatDate(traitement.date || traitement.event_date),
              culture: parcel.crop_name || 'N/A',
              categoriePhyToweb: parcel.phytoweb_name || 'N/A',
              eppo: parcel.EPPOCode || parcel.eppo_code || parcel.eppo || 'N/A', // EPPOCode spécifique à cette parcelle
              bbch: traitement.bbch || 'N/A',
              parcelle: parcel.parcel_name || parcel.parcels_name || parcel.parcels || 'N/A',
              type: this.getTraitementType(traitement.type || traitement.treatment_type),
              cible: traitement.target || traitement.ciblee || 'N/A',
              operateur: this.formatOperateur(traitement), // Détails spécifiques à ce produit
              details: this.buildProduitDetails(produit), // Détails spécifiques à ce produit
              eventType: 'traitement',
              originalData: {
                ...traitement,
                currentParcel: parcel, // Référence à la parcelle courante
                currentProduct: produit // Référence au produit courant
              }
            });
          });
        });
      } else if (parcelles.length > 0) {
        // Traitement avec parcelles mais sans produits spécifiques
        parcelles.forEach((parcel: any) => {
          events.push({
            date: this.formatDate(traitement.date || traitement.event_date),
            culture: parcel.crop_name || 'N/A',
            categoriePhyToweb: parcel.nomPhytoweb_crops_id || 'N/A',
            eppo: parcel.EPPOCode || parcel.eppo_code || parcel.code_eppo || 'N/A',
            bbch: traitement.bbch || 'N/A',
            parcelle: parcel.parcel_name || parcel.parcels_name || parcel.parcels || 'N/A',
            type: this.getTraitementType(traitement.type || traitement.treatment_type),
            cible: traitement.target || traitement.ciblee || 'N/A',
            operateur: this.formatOperateur(traitement),
            details: this.buildTraitementDetails(traitement),
            eventType: 'traitement',
            originalData: {
              ...traitement,
              currentParcel: parcel
            }
          });
        });
      } else if (produits.length > 0) {
        // Traitement avec produits mais sans parcelles spécifiques
        produits.forEach((produit: any) => {
          events.push({
            date: this.formatDate(traitement.date || traitement.event_date),
            culture: 'N/A',
            categoriePhyToweb: 'N/A',
            eppo: 'N/A',
            bbch: traitement.bbch || 'N/A',
            parcelle: 'N/A',
            type: this.getTraitementType(traitement.type || traitement.treatment_type),
            cible: traitement.target || traitement.ciblee || 'N/A',
            operateur: this.formatOperateur(traitement),
            details: this.buildProduitDetails(produit),
            eventType: 'traitement',
            originalData: {
              ...traitement,
              currentProduct: produit
            }
          });
        });
      } else {
        // Traitement sans parcelle ni produit spécifique
        events.push({
          date: this.formatDate(traitement.date || traitement.event_date),
          culture: 'N/A',
          categoriePhyToweb: 'N/A',
          eppo: 'N/A',
          bbch: traitement.bbch || 'N/A',
          parcelle: 'N/A',
          type: this.getTraitementType(traitement.type || traitement.treatment_type),
          cible: traitement.target || traitement.ciblee || 'N/A',
          operateur: this.formatOperateur(traitement),
          details: 'N/A',
          eventType: 'traitement',
          originalData: traitement
        });
      }
    });
    
    return events;
  }

  /**
   * Convertit les travaux au champ en événements unifiés
   */
  private convertTravauxToUnified(travaux: any[]): UnifiedEvent[] {
    const events: UnifiedEvent[] = [];
    
    travaux.forEach(travail => {
      // Parcourir les parcelles concernées
      if (travail.parcels_concerned && Array.isArray(travail.parcels_concerned)) {
        travail.parcels_concerned.forEach((parcel: any) => {
          events.push({
            date: this.formatDate(travail.date || travail.datee || travail.harvest_date || travail.dateDeRecolte || travail.dateDeLobservation),
            culture: parcel.crop_name || 'N/A',
            categoriePhyToweb: parcel.phytoweb_name || parcel.nomPhytoweb_crops_id || 'N/A',
            eppo: parcel.eppo || parcel.EPPOCode || parcel.eppo_code || parcel.code_eppo || 'N/A',
            bbch: 'N/A',
            parcelle: parcel.parcel_name || parcel.parcels_name || parcel.parcels || 'N/A',
            type: travail.type || travail.type_travaux_aux_champs || 'Travail au champ',
            cible: 'N/A', // Les travaux au champ n'ont pas de cible
            operateur: this.formatOperateur(travail),
            details: this.buildTravauxDetails(travail),
            eventType: 'travail',
            originalData: travail
          });
        });
      } else {
        // Travail sans parcelle spécifique
        events.push({
          date: this.formatDate(travail.date || travail.datee || travail.harvest_date || travail.dateDeRecolte || travail.dateDeLobservation),
          culture: 'N/A',
          categoriePhyToweb: 'N/A',
          eppo: 'N/A',
          bbch: 'N/A',
          parcelle: 'N/A',
          type: travail.type || travail.type_travaux_aux_champs || 'Travail au champ',
          cible: 'N/A',
          operateur: this.formatOperateur(travail),
          details: this.buildTravauxDetails(travail),
          eventType: 'travail',
          originalData: travail
        });
      }
    });
    
    return events;
  }

  /**
   * Formate une date au format DD/MM/YYYY
   */
  private formatDate(dateString: string): string {
    if (!dateString) return 'N/A';
    
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('fr-FR');
    } catch {
      return dateString;
    }
  }

  /**
   * Formate les données d'opérateur en concaténant le nom et la licence
   */
  private formatOperateur(data: any): string {
    if (data.operator_name && (data.operator_phytolicence || data.operator_pl)) {
      return `${data.operator_name} (${data.operator_phytolicence || data.operator_pl})`;
    } else if (data.operator_name) {
      return data.operator_name;
    } else if (data.operateur) {
      return data.operateur;
    }
    return 'N/A';
  }



  /**
   * Obtient le type de traitement formaté
   */
  private getTraitementType(type: string): string {
    if (!type) return 'Traitement phyto';
    
    const typeMap: { [key: string]: string } = {
      'phyto_volume_treatment': 'Traitement phyto (volume)',
      'phyto_surface_treatment': 'Traitement phyto (surface)',
      'traitement_phytosanitaire': 'Traitement phyto'
    };
    
    return typeMap[type] || type;
  }

  /** Arrondit une dose à 2 décimales pour l'affichage. */
  private formatDoseValue(value: any): string {
    const n = parseFloat(value);
    return isNaN(n) ? (value ?? '') : n.toFixed(2);
  }

  /**
   * Construit les détails d'un produit spécifique
   */
  private buildProduitDetails(produit: any): string {
    if (!produit || !produit.component_name) return 'N/A';
    
    let detail = produit.component_name;
    
    // Ajouter le numéro d'autorisation si disponible
    if (produit.component_numaut) {
      detail += ` (${produit.component_numaut})`;
    }
    
    // Ajouter la dose et l'unité si disponibles
    if (produit.component_dose) {
      detail += ` - ${this.formatDoseValue(produit.component_dose)}`;
      if (produit.component_dose_unit) {
        detail += ` ${produit.component_dose_unit}`;
      }
    }
    
    // Ajouter la quantité si disponible
    if (produit.component_quantity) {
      detail += ` (Qté: ${produit.component_quantity})`;
    }
    
    return detail;
  }

  /**
   * Construit les détails d'un traitement (ancienne méthode pour compatibilité)
   */
  private buildTraitementDetails(traitement: any): string {
    const details: string[] = [];
    
    if (traitement.treatment_composition && Array.isArray(traitement.treatment_composition)) {
      traitement.treatment_composition.forEach((component: any) => {
        if (component.component_name) {
          let detail = component.component_name;
          
          // Ajouter le numéro d'autorisation si disponible
          if (component.component_numaut) {
            detail += ` (${component.component_numaut})`;
          }
          
          // Ajouter la dose et l'unité si disponibles
          if (component.component_dose) {
            detail += ` - ${this.formatDoseValue(component.component_dose)}`;
            if (component.component_dose_unit) {
              detail += ` ${component.component_dose_unit}`;
            }
          }
          
          details.push(detail);
        }
      });
    }
    
    return details.length > 0 ? details.join(', ') : 'N/A';
  }

  /**
   * Construit les détails d'un travail au champ selon son type
   */
  private buildTravauxDetails(travail: any): string {
    const typeTravail = travail.type || travail.type_travaux_aux_champs;
    const details: string[] = [];
    
    switch (typeTravail) {
      case 'Observation':
        // Le serveur range le texte de l'observation dans eventInfo (→ informations)
        const observationText = travail.observation || travail.informations;
        if (observationText && observationText.trim()) {
          details.push(observationText.trim());
        }
        break;
        
      case 'Récolte':
        const recolteRemark = travail.remark || travail.remaques;
        if (recolteRemark && recolteRemark.trim()) {
          details.push(recolteRemark.trim());
        }
        if (travail.Rendement) {
          details.push(`Rendement: ${travail.Rendement}`);
        }
        break;
        
      case 'Travail du sol':
        const fwType = travail.field_work_type || travail.travailtype;
        if (fwType && fwType.trim()) {
          details.push(fwType.trim());
        }
        if (travail.description && travail.description.trim()) {
          details.push(travail.description.trim());
        }
        const solRemark = travail.remark || travail.remaques;
        if (solRemark && solRemark.trim()) {
          details.push(`Remarques: ${solRemark.trim()}`);
        }
        const fwTool = travail.tool || travail.outil;
        if (fwTool) {
          details.push(`Outil: ${fwTool}`);
        }
        break;
        
      default:
        const defTool = travail.tool || travail.outil;
        if (defTool) details.push(`Outil: ${defTool}`);
        if (travail.informations) details.push(travail.informations);
        if (travail.dose) details.push(`Dose: ${travail.dose}`);
        if (travail.Rendement) details.push(`Rendement: ${travail.Rendement}`);
        if (travail.observation) details.push(`Observation: ${travail.observation}`);
        if (travail.Observation) details.push(`Observation: ${travail.Observation}`);
        // Gérer les deux variantes d'orthographe pour remarques
        if (travail.remaques) details.push(`Remarques: ${travail.remaques}`);
        if (travail.remarques) details.push(`Remarques: ${travail.remarques}`);
        break;
    }
    
    return details.length > 0 ? details.join(', ') : 'N/A';
  }

  /**
   * Applique les filtres aux événements
   */
  applyFilters() {
    this.filteredEvents = this.unifiedEvents.filter(event => {
      // Filtre par terme de recherche
      if (this.filterData.searchTerm && this.filterData.searchTerm.trim()) {
        const searchTerm = this.filterData.searchTerm.toLowerCase().trim();
        const searchableText = [
          event.culture,
          event.parcelle,
          event.type,
          event.cible,
          event.operateur,
          event.details,
          event.categoriePhyToweb,
          event.eppo
        ].join(' ').toLowerCase();
        
        if (!searchableText.includes(searchTerm)) {
          return false;
        }
      }
      
      // Filtre par date
      if (this.filterData.dateFilters.startDate || this.filterData.dateFilters.endDate) {
        // Extraire la date de l'événement selon son type
        let eventDateStr = '';
        if (event.eventType === 'traitement') {
          eventDateStr = event.originalData.date || event.originalData.event_date;
        } else {
          eventDateStr = event.originalData.datee || event.originalData.dateDeRecolte || event.originalData.dateDeLobservation || event.originalData.date;
        }
        
        if (eventDateStr) {
          const eventDate = new Date(eventDateStr);
          
          if (this.filterData.dateFilters.startDate) {
            const startDate = new Date(this.filterData.dateFilters.startDate);
            if (eventDate < startDate) return false;
          }
          
          if (this.filterData.dateFilters.endDate) {
            const endDate = new Date(this.filterData.dateFilters.endDate);
            endDate.setHours(23, 59, 59, 999); // Inclure toute la journée de fin
            if (eventDate > endDate) return false;
          }
        }
      }
      
      // Filtre par parcelle
      if (this.filterData.parcelFilters.length > 0) {
        if (!this.filterData.parcelFilters.some(parcel => 
          event.parcelle && event.parcelle.toLowerCase().includes(parcel.toLowerCase())
        )) {
          return false;
        }
      }
      
      // Filtre par culture (utiliser la catégorie phytoweb car c'est ce qui est utilisé dans les filtres)
      if (this.filterData.cultureFilters.length > 0) {
        const eventCultureCategory = event.categoriePhyToweb;
        const eventCultureName = event.culture;
        
        if (!this.filterData.cultureFilters.some(filter => 
          (eventCultureCategory && eventCultureCategory.includes(filter)) ||
          (eventCultureName && eventCultureName.toLowerCase().includes(filter.toLowerCase()))
        )) {
          return false;
        }
      }
      
      return true;
    });
    
  }

  /**
   * Retourne le nombre total de traitements affichés
   */
  getTotalTraitements(): number {
    return this.filteredEvents.filter(event => event.eventType === 'traitement').length;
  }

  /**
   * Retourne le nombre total de travaux affichés
   */
  getTotalTravaux(): number {
    return this.filteredEvents.filter(event => event.eventType === 'travail').length;
  }

  /**
   * Gère la modification d'un événement
   */
  onModifyEvent(event: UnifiedEvent): void {
    
    // Préparer les données pour la modification selon le type d'événement
    const modificationData = {
      event: event,
      eventType: event.eventType,
      originalData: event.originalData,
      eventId: event.originalData.event_id || event.originalData.travaux_aux_champs_id
    };
    
    // Émettre l'événement pour que le composant parent gère la modification
    this.modifyEvent.emit(modificationData);
  }

}
