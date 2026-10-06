import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { SharedModule } from '../../../shared/shared.module';
import { RegistreService } from '../../services/registre.service';
import { CultureDetailPopupComponent } from '../culture-detail-popup/culture-detail-popup.component';
import { forkJoin } from 'rxjs';
import { take } from 'rxjs/operators';

interface ArchivedCrop {
  crop_id: string;
  crop_name: string;
  phytoweb_name: string;
  sowing_date: string;
  collection: string;
  is_archived: boolean;
  archivedAt?: string;
  parcels_id?: string[];
  interventions?: any[];
  [key: string]: any;
}

type SortColumn = 'collection' | 'crop_name' | 'phytoweb_name' | 'sowing_date';
type SortDirection = 'asc' | 'desc' | null;

@Component({
  selector: 'app-archives',
  standalone: true,
  imports: [SharedModule, CultureDetailPopupComponent],
  templateUrl: './archives.component.html',
  styleUrls: ['./archives.component.scss']
})
export class ArchivesComponent implements OnInit {
  
  private registreService = inject(RegistreService);
  private router = inject(Router);
  
  // Données
  archivedCrops = signal<ArchivedCrop[]>([]);
  isLoading = signal<boolean>(true);
  
  // Filtres
  searchTerm = signal<string>('');
  selectedCollection = signal<string>('');
  availableCollections = signal<string[]>([]);
  
  // Tri
  sortColumn = signal<SortColumn | null>(null);
  sortDirection = signal<SortDirection>(null);
  
  // Popup de détail
  showDetailPopup = signal<boolean>(false);
  selectedCultureForDetail = signal<ArchivedCrop | null>(null);
  
  // État du dropdown de collection
  isCollectionFilterOpen = false;
  
  // Cache des données pour construire les interventions
  private cachedTreatments: any[] = [];
  private cachedFieldWorks: any[] = [];
  
  constructor() {
    // Effect pour écouter le signal de rafraîchissement des archives
    effect(() => {
      if (this.registreService.needRefreshArchives()) {
        this.loadArchivedCrops();
        // Réinitialiser le signal après le rafraîchissement
        setTimeout(() => {
          this.registreService.needRefreshArchives.set(false);
        }, 100);
      }
    }, { allowSignalWrites: true });
  }
  
  // Cultures filtrées et triées
  filteredCrops = computed(() => {
    let crops = [...this.archivedCrops()];
    
    // Filtre par recherche
    const search = this.searchTerm().toLowerCase().trim();
    if (search) {
      crops = crops.filter(crop => 
        crop.crop_name?.toLowerCase().includes(search) ||
        crop.phytoweb_name?.toLowerCase().includes(search) ||
        crop.collection?.toLowerCase().includes(search)
      );
    }
    
    // Filtre par collection
    const collection = this.selectedCollection();
    if (collection) {
      crops = crops.filter(crop => crop.collection === collection);
    }
    
    // Tri
    const column = this.sortColumn();
    const direction = this.sortDirection();
    if (column && direction) {
      crops.sort((a, b) => {
        let valueA = a[column] || '';
        let valueB = b[column] || '';
        
        // Conversion en string pour comparaison
        valueA = String(valueA).toLowerCase();
        valueB = String(valueB).toLowerCase();
        
        if (valueA < valueB) return direction === 'asc' ? -1 : 1;
        if (valueA > valueB) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return crops;
  });
  
  ngOnInit(): void {
    this.loadArchivedCrops();
  }
  
  /**
   * Charge les cultures archivées depuis le serveur
   */
  loadArchivedCrops(): void {
    this.isLoading.set(true);
    
    this.registreService.getArchivedCrops().subscribe({
      next: (crops) => {
        this.archivedCrops.set(crops);
        
        // Extraire les collections uniques
        const collections = [...new Set(crops.map(c => c.collection).filter(c => c))];
        this.availableCollections.set(collections.sort());
        
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Erreur lors du chargement des archives:', error);
        this.isLoading.set(false);
      }
    });
  }
  
  /**
   * Gère le changement de terme de recherche
   */
  onSearchChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
  }
  
  /**
   * Gère le changement de collection sélectionnée
   */
  onCollectionChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedCollection.set(value);
  }
  
  /**
   * Toggle le dropdown de filtre par collection
   */
  toggleCollectionFilter(): void {
    this.isCollectionFilterOpen = !this.isCollectionFilterOpen;
  }
  
  /**
   * Ferme le dropdown de collection
   */
  closeCollectionFilter(): void {
    this.isCollectionFilterOpen = false;
  }
  
  /**
   * Sélectionne une collection
   */
  selectCollection(collection: string): void {
    this.selectedCollection.set(collection);
  }
  
  /**
   * Gère le tri par colonne
   */
  onSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      // Rotation: asc -> desc -> null
      if (this.sortDirection() === 'asc') {
        this.sortDirection.set('desc');
      } else if (this.sortDirection() === 'desc') {
        this.sortColumn.set(null);
        this.sortDirection.set(null);
      }
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }
  
  /**
   * Retourne l'icône de tri pour une colonne
   */
  getSortIcon(column: SortColumn): string {
    if (this.sortColumn() !== column) return 'unfold_more';
    if (this.sortDirection() === 'asc') return 'keyboard_arrow_up';
    if (this.sortDirection() === 'desc') return 'keyboard_arrow_down';
    return 'unfold_more';
  }
  
  /**
   * Restaure une culture archivée
   */
  restoreCrop(crop: ArchivedCrop): void {
    if (confirm(`Voulez-vous restaurer la culture "${crop.crop_name}" ?`)) {
      this.registreService.restoreCrop(crop.crop_id).subscribe({
        next: (response) => {
          if (response.success) {
            alert(`Culture "${crop.crop_name}" restaurée avec succès !`);
            this.loadArchivedCrops();
          } else {
            alert('Erreur lors de la restauration : ' + (response.message || 'Erreur inconnue'));
          }
        },
        error: (error) => {
          console.error('Erreur lors de la restauration:', error);
          alert('Erreur lors de la restauration de la culture.');
        }
      });
    }
  }
  
  /**
   * Formate une date pour l'affichage
   */
  formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  }
  
  /**
   * Retourne au carnet de champ
   */
  goBack(): void {
    this.router.navigate(['/registre']);
  }
  
  /**
   * Ouvre la popup de détail pour une culture archivée
   */
  openCultureDetail(crop: ArchivedCrop): void {
    
    // Charger les traitements et travaux pour construire les interventions
    forkJoin({
      treatments: this.registreService.getAllTraitements().pipe(take(1)),
      fieldWorks: this.registreService.getAllTravauxChamps().pipe(take(1))
    }).subscribe({
      next: ({ treatments, fieldWorks }) => {
        this.cachedTreatments = treatments || [];
        this.cachedFieldWorks = fieldWorks || [];
        
        // Construire les interventions pour cette culture
        const cultureWithInterventions = this.buildInterventionsForCrop(crop);
        
        this.selectedCultureForDetail.set(cultureWithInterventions);
        this.showDetailPopup.set(true);
      },
      error: (error) => {
        console.error('Erreur lors du chargement des interventions:', error);
        // Afficher quand même la popup sans interventions
        const cultureWithEmptyInterventions = { ...crop, interventions: [] };
        this.selectedCultureForDetail.set(cultureWithEmptyInterventions);
        this.showDetailPopup.set(true);
      }
    });
  }
  
  /**
   * Construit les interventions pour une culture donnée
   */
  private buildInterventionsForCrop(crop: ArchivedCrop): ArchivedCrop {
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
          if (parcelle.crop_id !== crop.crop_id) return;
          // Pour chaque produit
          flatComps.forEach((prod: any) => {
            lignes.push({
              date: t.date || t.treatment_date || t.event_date || '',
              parcelle: parcelle.parcel_name || parcelle.parcels_name || parcelle.parcels,
              type: 'traitement',
              details: `${prod.component_name} (${prod.component_numaut}) - ${this.formatDoseValue(prod.component_dose)}${prod.component_dose_unit}`,
              operateur: t.operateur || '[BT_Laune]',
              bbch: t.bbch_target || 'Non spécifié',
              cibles: (t.target ?? t.ciblee) ? (Array.isArray(t.target ?? t.ciblee) ? (t.target ?? t.ciblee).join(', ') : (t.target ?? t.ciblee)) : 'Non spécifiée',
              originalData: t
            });
          });
      });
    });
    
    // Travaux au champ : une ligne par parcelle concernée
    (this.cachedFieldWorks || []).forEach(w => {
      if (!w.parcels_concerned || !Array.isArray(w.parcels_concerned)) return;
      
      w.parcels_concerned.forEach((parcelle: any) => {
        if (parcelle.crop_id !== crop.crop_id) return;
        
        let date = w.date || w.datee || w.dateDeLobservation || w.harvest_date || w.dateDeRecolte || '';
        let type = w.type || w.type_travaux_aux_champs || 'Travail';
        let details = '';
        
        if (type === 'Fertilisation') {
          details = [w.informations, w.tool || w.outil].filter(Boolean).join(' - ');
        } else if (type === 'Irrigation') {
          details = [w.dose, w.dose_unit || w.lha].filter(Boolean).join(' ');
        } else if (type === 'Récolte') {
          details = w.remark || w.remaques || '';
        } else if (type === 'Observation') {
          details = w.observation || '';
        } else if (type === 'Travail du sol') {
          const detailsParts = [];
          const fwType = w.field_work_type || w.travailtype;
          if (fwType && fwType.trim()) detailsParts.push(fwType.trim());
          if (w.description && w.description.trim()) detailsParts.push(w.description.trim());
          const fwRemark = w.remark || w.remaques;
          if (fwRemark && fwRemark.trim()) detailsParts.push(`Remarques: ${fwRemark.trim()}`);
          const fwTool = w.tool || w.outil;
          if (fwTool) detailsParts.push(`Outil: ${fwTool}`);
          details = detailsParts.join(', ') || '';
        }
        
        lignes.push({
          date,
          parcelle: parcelle.parcel_name || parcelle.parcels_name || parcelle.parcels_id,
          type,
          details,
          operateur: w.operateur || '[BT_Laune]',
          bbch: 'N/A',
          cibles: 'N/A',
          originalData: w
        });
      });
    });
    
    // Tri par date décroissante
    lignes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    
    return {
      ...crop,
      interventions: lignes
    };
  }
  
  /**
   * Ferme la popup de détail
   */
  closeCultureDetail(): void {
    this.showDetailPopup.set(false);
    this.selectedCultureForDetail.set(null);
  }
  
  /**
   * Restaure une culture depuis la popup de détail
   */
  onRestoreCultureFromPopup(crop: ArchivedCrop): void {
    this.closeCultureDetail();
    this.restoreCrop(crop);
  }
  
  /**
   * Supprime une culture archivée depuis la popup de détail
   */
  onDeleteCultureFromPopup(crop: ArchivedCrop): void {
    if (confirm(`Êtes-vous sûr de vouloir supprimer définitivement la culture archivée "${crop.crop_name}" ?`)) {
      this.closeCultureDetail();
      // Appeler le service pour supprimer la culture archivée
      this.registreService.deleteArchivedCrop(crop.crop_id).subscribe({
        next: (response) => {
          if (response.success) {
            alert(`Culture "${crop.crop_name}" supprimée avec succès !`);
            this.loadArchivedCrops();
          } else {
            alert('Erreur lors de la suppression : ' + (response.message || 'Erreur inconnue'));
          }
        },
        error: (error) => {
          console.error('Erreur lors de la suppression:', error);
          alert('Erreur lors de la suppression de la culture archivée.');
        }
      });
    }
  }

  /** Arrondit une dose à 2 décimales pour l'affichage (détails d'intervention sur la culture card). */
  private formatDoseValue(value: any): string {
    const n = parseFloat(value);
    return isNaN(n) ? (value ?? '') : n.toFixed(2);
  }
}
