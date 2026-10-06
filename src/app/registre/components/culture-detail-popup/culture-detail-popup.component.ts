import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy, HostListener } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { RegistreService } from '../../services/registre.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-culture-detail-popup',
  standalone: true,
  imports: [SharedModule, FormsModule],
  templateUrl: './culture-detail-popup.component.html',
  styleUrls: ['./culture-detail-popup.component.scss']
})
export class CultureDetailPopupComponent implements OnInit, OnDestroy {
  @Input() culture: any;
  @Input() isArchived: boolean = false; // Mode archive : affiche "Restaurer" au lieu de "Archiver"
  @Output() close = new EventEmitter<void>();
  @Output() modifyCulture = new EventEmitter<any>();
  @Output() deleteCulture = new EventEmitter<any>();
  @Output() modifyIntervention = new EventEmitter<any>();
  @Output() deleteIntervention = new EventEmitter<any>();
  @Output() archiveCulture = new EventEmitter<{culture: any, collection: string}>();
  @Output() restoreCulture = new EventEmitter<any>(); // Pour restaurer une culture archivée

  private registreService = inject(RegistreService);

  // Propriétés pour la popup d'archivage
  showArchivePopup = false;
  availableCollections: string[] = [];
  selectedCollection = '';
  newCollectionName = '';
  showNewCollectionInput = false;

  // Propriétés pour l'édition des dates
  isEditingSowingDate = false;
  isEditingHarvestDate = false;
  tempSowingDate = '';
  tempHarvestDate = '';
  // Map id_parcel → parcel_name pour résolution des UUIDs dans parcels_id
  parcelMap = new Map<string, string>();

  /**
   * Échap : ferme d'abord la petite popup d'archivage si elle est ouverte, sinon la popup de
   * détail. Ignoré pendant l'édition d'une date (Échap y annule seulement la saisie).
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscapeClose(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.classList?.contains('date-input') || this.isEditingSowingDate || this.isEditingHarvestDate) return;
    if (this.showArchivePopup) { this.closeArchivePopup(); return; }
    this.onClose();
  }

  onClose(): void {
    // Remove body lock immediately when closing
    try { document.body.classList.remove('no-scroll'); } catch(e) {}
    this.close.emit();
  }

  ngOnInit(): void {
    // Lock background scroll when popup mounts
    try { document.body.classList.add('no-scroll'); } catch(e) {}
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

  ngOnDestroy(): void {
    // Ensure we remove the lock if component is destroyed
    try { document.body.classList.remove('no-scroll'); } catch(e) {}
  }

  onModifyCulture(): void {
    this.modifyCulture.emit(this.culture);
    this.close.emit();
  }

  onDeleteCulture(): void {
    if (confirm(`Êtes-vous sûr de vouloir supprimer la culture "${this.culture.crop_name}" ?`)) {
      this.deleteCulture.emit(this.culture);
      this.close.emit();
    }
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR');
  }

  getTypeBadgeClass(type: string): string {
    switch(type?.toLowerCase()) {
      case 'traitement': return 'badge-traitement';
      case 'fertilisation': return 'badge-fertilisation';
      case 'irrigation': return 'badge-irrigation';
      case 'récolte': return 'badge-recolte';
      case 'observation': return 'badge-observation';
      default: return 'badge-default';
    }
  }

  getOperateur(intervention: any): string {
    return intervention.operateur || '[BT_Laune]';
  }

  getBBCH(intervention: any): string {
    if (intervention.type?.toLowerCase() === 'traitement') {
      // Chercher d'abord dans originalData si disponible, sinon dans intervention directement
      const bbch = intervention.originalData?.bbch ?? intervention.bbch ?? '';
      return bbch || '/';
    }
    return '/';
  }

  getCibles(intervention: any): string {
    if (intervention.type?.toLowerCase() === 'traitement') {
      // Chercher d'abord dans originalData si disponible, sinon dans intervention directement
      const cibles = intervention.originalData?.target ?? intervention.originalData?.ciblee ?? intervention.originalData?.cibles ?? intervention.cibles ?? intervention.ciblee ?? '';
      return cibles || '/e';
    }
    return '/';
  }

  getTotalPages(): number {
    return Math.ceil(this.culture?.interventions?.length || 0);
  }

  /**
   * Modifier une intervention spécifique
   */
  onModifyIntervention(intervention: any, index: number): void {    
    // Créer un objet avec toutes les informations nécessaires pour la modification
    const interventionData = {
      intervention: intervention,
      culture: this.culture,
      index: index,
      type: intervention.type // 'traitement' ou 'travail'
    };
    
    this.modifyIntervention.emit(interventionData);
    // Note: On ne ferme pas la popup pour permettre à l'utilisateur de voir le changement
  }

  /**
   * Supprimer une intervention spécifique d'une culture
   */
  onDeleteIntervention(intervention: any, index: number): void {
    const interventionName = intervention.details || `intervention du ${this.formatDate(intervention.date)}`;
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer cette intervention "${interventionName}" de la culture "${this.culture.crop_name}" ?`;
    
    if (confirm(confirmMessage)) {
      // Créer un objet avec toutes les informations nécessaires pour la suppression
      const deleteData = {
        intervention: intervention,
        culture: this.culture,
        index: index,
        type: intervention.type // 'traitement' ou 'travail'
      };
      
      this.deleteIntervention.emit(deleteData);
      // Note: On ne ferme pas la popup pour permettre à l'utilisateur de voir le changement
    }
  }

  // ============================================
  // MÉTHODES POUR L'ARCHIVAGE
  // ============================================

  /**
   * Ouvrir la popup d'archivage
   */
  onArchiveCulture(): void {
    this.showArchivePopup = true;
    this.loadCollections();
  }

  /**
   * Charger les collections disponibles
   */
  loadCollections(): void {
    this.registreService.getCollections().subscribe({
      next: (collections: string[]) => {
        // Le service retourne directement un tableau de strings
        this.availableCollections = collections || [];
        
        // Pré-sélectionner la collection actuelle si elle existe
        if (this.culture.collection) {
          this.selectedCollection = this.culture.collection;
        }
      },
      error: () => {
        this.availableCollections = [];
      }
    });
  }

  /**
   * Gérer le changement de sélection de collection
   */
  onCollectionChange(): void {
    this.showNewCollectionInput = this.selectedCollection === '__new__';
    if (!this.showNewCollectionInput) {
      this.newCollectionName = '';
    }
  }

  /**
   * Fermer la popup d'archivage
   */
  closeArchivePopup(): void {
    this.showArchivePopup = false;
    this.selectedCollection = '';
    this.newCollectionName = '';
    this.showNewCollectionInput = false;
  }

  /**
   * Vérifier si on peut archiver
   */
  canArchive(): boolean {
    if (this.showNewCollectionInput) {
      return this.newCollectionName.trim().length > 0;
    }
    return this.selectedCollection !== '' && this.selectedCollection !== '__new__';
  }

  /**
   * Confirmer l'archivage
   */
  confirmArchive(): void {
    if (!this.canArchive()) return;

    const collection = this.showNewCollectionInput 
      ? this.newCollectionName.trim() 
      : this.selectedCollection;

    this.archiveCulture.emit({
      culture: this.culture,
      collection: collection
    });

    this.closeArchivePopup();
    this.close.emit();
  }

  // ============================================
  // MÉTHODES POUR LES PARCELLES
  // ============================================

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

  // ============================================
  // MÉTHODES POUR LES DATES
  // ============================================

  /**
   * Formate une date ou retourne "Non précisé"
   */
  formatDateOrDefault(dateStr: string): string {
    if (!dateStr || dateStr.trim() === '') {
      return 'Non précisé';
    }
    
    // Vérifier si c'est une vraie date
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return 'Non précisé';
    }
    
    return date.toLocaleDateString('fr-FR');
  }

  /**
   * Active l'édition de la date de semis
   */
  startEditSowingDate(): void {
    this.isEditingSowingDate = true;
    this.tempSowingDate = this.culture.sowing_date || '';
  }

  /**
   * Active l'édition de la date de récolte
   */
  startEditHarvestDate(): void {
    this.isEditingHarvestDate = true;
    this.tempHarvestDate = this.culture.harvest_date || '';
  }

  /**
   * Annule l'édition de la date de semis
   */
  cancelEditSowingDate(): void {
    this.isEditingSowingDate = false;
    this.tempSowingDate = '';
  }

  /**
   * Annule l'édition de la date de récolte
   */
  cancelEditHarvestDate(): void {
    this.isEditingHarvestDate = false;
    this.tempHarvestDate = '';
  }

  /**
   * Sauvegarde la date de semis
   */
  saveSowingDate(): void {
    if (!this.tempSowingDate) {
      this.cancelEditSowingDate();
      return;
    }

    const updatedCulture = {
      ...this.culture,
      sowing_date: this.tempSowingDate,
      // Le serveur lit le champ camelCase (sinon l'ancienne valeur recopiée est réenregistrée)
      sowingDate: this.tempSowingDate
    };

    this.registreService.updateCulture(updatedCulture).subscribe({
      next: () => {
        this.culture.sowing_date = this.tempSowingDate;
        // Garder aussi le champ lu par le serveur à jour : sinon un enregistrement suivant
        // (ex. date de récolte) renverrait l'ancienne date de semis et l'écraserait.
        this.culture.sowingDate = this.tempSowingDate;
        this.isEditingSowingDate = false;
        this.tempSowingDate = '';
      },
      error: (error) => {
        console.error('Erreur lors de la mise à jour de la date de semis:', error);
        alert('Erreur lors de la mise à jour de la date de semis');
        this.cancelEditSowingDate();
      }
    });
  }

  /**
   * Sauvegarde la date de récolte
   */
  saveHarvestDate(): void {
    if (!this.tempHarvestDate) {
      this.cancelEditHarvestDate();
      return;
    }

    const updatedCulture = {
      ...this.culture,
      harvest_date: this.tempHarvestDate,
      // Le serveur lit le champ camelCase (sinon l'ancienne valeur recopiée est réenregistrée)
      harvestDate: this.tempHarvestDate
    };

    this.registreService.updateCulture(updatedCulture).subscribe({
      next: () => {
        this.culture.harvest_date = this.tempHarvestDate;
        // Idem : sinon modifier ensuite la date de semis effaçait la date de récolte.
        this.culture.harvestDate = this.tempHarvestDate;
        this.isEditingHarvestDate = false;
        this.tempHarvestDate = '';
      },
      error: (error) => {
        console.error('Erreur lors de la mise à jour de la date de récolte:', error);
        alert('Erreur lors de la mise à jour de la date de récolte');
        this.cancelEditHarvestDate();
      }
    });
  }
}
