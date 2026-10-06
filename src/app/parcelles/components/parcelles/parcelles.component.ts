import { AfterViewInit, Component, inject, OnInit, OnDestroy, signal, computed, ChangeDetectorRef, HostListener, ViewChild, ElementRef } from '@angular/core';
import { parsePolygoneToLatLngs as parseLatlngs } from '../../../shared/utils/lambert72.util';
import { buildParcelPopupHtml } from '../../../shared/utils/parcel-popup.util';
import * as L from 'leaflet';
import { SharedModule } from '../../../shared/shared.module';
import { ParcellesService, Parcelle } from '../../services/parcelles-server.service';
import { RegistreService } from '../../../registre/services/registre.service';
import { map, Observable, Subject, takeUntil, tap } from 'rxjs';
import { AbstractControl, FormBuilder, FormGroup, NgForm, ValidationErrors, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

declare var M: any;

@Component({
  selector: 'app-parcelles',
  standalone: true,
  imports: [
    SharedModule
  ],
  providers: [
    ParcellesService
  ],
  templateUrl: './parcelles.component.html',
  styleUrl: './parcelles.component.scss'
})
export class ParcellesComponent implements OnInit, AfterViewInit, OnDestroy{

  private parcellesService: ParcellesService = inject(ParcellesService);
  // Inject central RegistreService to refresh global cache when parcels change
  private registreService: RegistreService = inject(RegistreService);
  private cdr = inject(ChangeDetectorRef);
  
  // Utiliser un signal Angular pour réactivité
  parcellesSignal = signal<any[]>([]);
  signalComponent = () => this.parcellesSignal();
  
  // Signal pour stocker les données de la parcelle à modifier
  parcelleToUpdate = signal<Parcelle | null>(null);
  signalUpdate = () => this.parcelleToUpdate();


  private formBuilder = inject(FormBuilder);

  
  userParcelle!: Observable<any[]>;
  

  map!:any;
  afficherCachet :boolean = false;
  modif : boolean = false;
  form!:FormGroup;

  // Propriétés pour le mode édition moderne (comme get-parcelles)
  editMode: boolean = false;
  
  // Properties for loading and empty state
  isLoading: boolean = true;
  isEmpty: boolean = false;
  selectedParcelForEdit: any = null;
  lat: any = null;
  lon: any = null;
  // Base de conversion (en hectares) pour la conversion automatique d'unité en édition
  private editAreaHa: number = 0;

  // Dropdown personnalisé pour l'unité de superficie
  isUnitDropdownOpen: boolean = false;
  readonly areaUnitOptions: { value: string; label: string }[] = [
    { value: 'ha', label: 'Ha' },
    { value: 'a', label: 'A' },
    { value: 'm2', label: 'M²' },
  ];

  parcel_name!:string;  
  parcel_area!:string;  
  parcel_area_unit_fr!:string;  
  parcel_address!:string;  
  parcel_category!:string;  
  id_parcel!:string;

  // Propriétés pour l'autocomplétion d'adresse
  addressSuggestions: any[] = [];
  showSuggestions: boolean = false;
  addressSearchTimeout: any;
  // true uniquement quand l'adresse en base provient d'une suggestion sélectionnée
  // (donc associée à un lat/lon fiable) - évite d'enregistrer des coordonnées 0/0
  addressCoordsConfirmed: boolean = false;

  // Validateur : bloque le formulaire si une adresse est saisie sans avoir été
  // sélectionnée dans le menu déroulant (donc sans lat/lon valides)
  private addressSelectedValidator = (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null; // le champ vide est déjà géré par Validators.required
    }
    return this.addressCoordsConfirmed ? null : { addressNotSelected: true };
  };

  // Liste fixe des catégories proposées dans les formulaires d'ajout/édition : plus de
  // création de catégorie personnalisée, uniquement ces 3 choix.
  availableParcelCategories = computed(() => ['Plein air', 'Sous-protection', 'Traitement de semences']);

  // Propriétés pour la pagination
  currentPage: number = 1;
  itemsPerPage: number = 20;
  totalItems: number = 0;
  totalPages: number = 0;

  // ============================================
  // Propriétés pour le tri, filtre et sélection
  // ============================================
  
  // Tri
  sortColumn: string = '';
  sortDirection: 'asc' | 'desc' | '' = '';
  
  // Filtre par nom de parcelle
  searchParcelName: string = '';
  showParcelNameSearch: boolean = false;
  
  // Filtre par catégorie
  selectedCategory: string = '';
  showCategoryFilter: boolean = false;
  availableCategories: string[] = ['Plein air', 'Sous abri', 'Verger', 'Prairie', 'Autre'];
  
  // Sélection multiple
  selectedParcelles: Set<string> = new Set();
  selectAll: boolean = false;
  isDeletingSelection: boolean = false;

  // Propriétés pour l'état de sauvegarde et message de succès
  isSaving: boolean = false;
  isDeleting: boolean = false;
  showSuccessMessage = signal(false);
  successMessageText: string = '';

  private httpClient = inject(HttpClient);

  private destroy$ = new Subject<void>();
  private _filteredCache: any[] | null = null;

  // Exposer Math pour le template
  Math = Math;

  /**
   * Créer une icône personnalisée sous forme de point rond
   */
  private createCustomIcon(color: string = '#03918a', borderColor: string = 'white'): L.DivIcon {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        background: ${color}; 
        border-radius: 50%; 
        width: 14px; 
        height: 14px; 
        border: 2px solid ${borderColor};
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        z-index: 1000;
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -7]
    });
  }

  constructor() {}

  // Charger les parcelles depuis l'API
  async loadParcelles(forceReload: boolean = false) {
    this.isLoading = true;
    this.isEmpty = false;
    
    try {
      await this.parcellesService.loadParcelles(forceReload);
      const parcelles = this.parcellesService.getAllParcelles();
      this.parcellesSignal.set(parcelles);
      this._filteredCache = null;

      // Vérifier si les parcelles sont vides
      this.isEmpty = parcelles.length === 0;
      
      // Mettre à jour les données de pagination
      this.updatePaginationData();
      

      // Mettre à jour la carte avec les nouvelles données
      this.displayParcelsOnMap();
      
      
      // Forcer la détection de changement
      this.cdr.detectChanges();
    } catch (error) {
      this.parcellesSignal.set([]); // S'assurer qu'on a un tableau vide en cas d'erreur
      this.isEmpty = true;
    } finally {
      this.isLoading = false;
      
      // Forcer la détection des changements pour mettre à jour l'interface
      this.cdr.detectChanges();
    }
  }

  /**
   * Ouvrir la popup de création de première parcelle
   */
  createFirstParcel(): void {
    this.afficherCachet = true;
  }

  // Méthodes de pagination
  updatePaginationData() {
    this.totalItems = this.getFilteredAndSortedParcelles().length;
    this.totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
    
    // S'assurer que currentPage ne dépasse pas totalPages
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }
  }

  // ============================================
  // Méthodes de filtrage et tri
  // ============================================

  getVisibleColumnCount(): number {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    if (w <= 500) return 3;
    if (w <= 650) return 4;
    if (w <= 1400) return 5;
    return 6;
  }

  /**
   * Obtenir les parcelles filtrées et triées
   */
  getFilteredAndSortedParcelles(): any[] {
    if (this._filteredCache !== null) return this._filteredCache;
    let parcelles = [...this.parcellesSignal()];
    
    // Filtrer par nom de parcelle
    if (this.searchParcelName.trim()) {
      const search = this.searchParcelName.toLowerCase().trim();
      parcelles = parcelles.filter(p => 
        (p.parcel_name || p.name || '').toLowerCase().includes(search)
      );
    }
    
    // Filtrer par catégorie
    if (this.selectedCategory) {
      parcelles = parcelles.filter(p => p.parcel_category === this.selectedCategory);
    }
    
    // Tri
    if (this.sortColumn && this.sortDirection) {
      parcelles.sort((a, b) => {
        let valA: any, valB: any;
        
        if (this.sortColumn === 'parcel_name') {
          valA = (a.parcel_name || a.name || '').toLowerCase();
          valB = (b.parcel_name || b.name || '').toLowerCase();
        } else if (this.sortColumn === 'parcel_area') {
          valA = parseFloat(a.parcel_area) || 0;
          valB = parseFloat(b.parcel_area) || 0;
        } else {
          valA = a[this.sortColumn] || '';
          valB = b[this.sortColumn] || '';
        }
        
        if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    this._filteredCache = parcelles;
    return this._filteredCache;
  }

  /**
   * Basculer le tri sur une colonne
   */
  toggleSort(column: string) {
    if (this.sortColumn === column) {
      // Cycle: asc -> desc -> none
      if (this.sortDirection === 'asc') {
        this.sortDirection = 'desc';
      } else if (this.sortDirection === 'desc') {
        this.sortDirection = '';
        this.sortColumn = '';
      }
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this._filteredCache = null;
    this.currentPage = 1;
    this.updatePaginationData();
  }

  /**
   * Obtenir l'icône de tri pour une colonne
   */
  getSortIcon(column: string): string {
    if (this.sortColumn !== column) return 'bi-arrow-down-up';
    if (this.sortDirection === 'asc') return 'bi-sort-alpha-down';
    if (this.sortDirection === 'desc') return 'bi-sort-alpha-up';
    return 'bi-arrow-down-up';
  }

  /**
   * Obtenir l'icône de tri pour la superficie
   */
  getSortIconArea(): string {
    if (this.sortColumn !== 'parcel_area') return 'bi-arrow-down-up';
    if (this.sortDirection === 'asc') return 'bi-sort-numeric-down';
    if (this.sortDirection === 'desc') return 'bi-sort-numeric-up';
    return 'bi-arrow-down-up';
  }

  /**
   * Basculer l'affichage de la recherche par nom
   */
  toggleParcelNameSearch() {
    this.showParcelNameSearch = !this.showParcelNameSearch;
    this.showCategoryFilter = false;
    if (!this.showParcelNameSearch) {
      this.searchParcelName = '';
      this._filteredCache = null;
      this.currentPage = 1;
      this.updatePaginationData();
    }
  }

  /**
   * Appliquer le filtre de nom de parcelle
   */
  applyParcelNameFilter() {
    this._filteredCache = null;
    this.currentPage = 1;
    this.updatePaginationData();
    this.updateSelectAllState();
  }

  /**
   * Effacer la recherche par nom
   */
  clearParcelNameSearch() {
    this.searchParcelName = '';
    this._filteredCache = null;
    this.currentPage = 1;
    this.updatePaginationData();
    this.updateSelectAllState();
  }

  /**
   * Basculer l'affichage du filtre par catégorie
   */
  toggleCategoryFilter() {
    this.showCategoryFilter = !this.showCategoryFilter;
    this.showParcelNameSearch = false;
  }

  /**
   * Appliquer le filtre par catégorie
   */
  applyCategoryFilter(category: string) {
    this.selectedCategory = this.selectedCategory === category ? '' : category;
    this._filteredCache = null;
    this.currentPage = 1;
    this.updatePaginationData();
    this.showCategoryFilter = false;
    this.updateSelectAllState();
  }

  /**
   * Effacer le filtre par catégorie
   */
  clearCategoryFilter() {
    this.selectedCategory = '';
    this._filteredCache = null;
    this.currentPage = 1;
    this.updatePaginationData();
    this.showCategoryFilter = false;
    this.updateSelectAllState();
  }

  // ============================================
  // Méthodes de sélection multiple
  // ============================================

  /**
   * Basculer la sélection d'une parcelle
   */
  toggleParcelSelection(parcelle: any) {
    const id = parcelle.id_parcel || parcelle.osm_id;
    if (this.selectedParcelles.has(id)) {
      this.selectedParcelles.delete(id);
    } else {
      this.selectedParcelles.add(id);
    }
    this.updateSelectAllState();
  }

  /**
   * Vérifier si une parcelle est sélectionnée
   */
  isParcelSelected(parcelle: any): boolean {
    const id = parcelle.id_parcel || parcelle.osm_id;
    return this.selectedParcelles.has(id);
  }

  /**
   * Basculer la sélection de toutes les parcelles visibles
   */
  toggleSelectAll() {
    const visibleParcelles = this.getPaginatedParcelles();
    
    if (this.selectAll) {
      // Désélectionner toutes les parcelles visibles
      visibleParcelles.forEach(p => {
        const id = p.id_parcel || p.osm_id;
        this.selectedParcelles.delete(id);
      });
    } else {
      // Sélectionner toutes les parcelles visibles
      visibleParcelles.forEach(p => {
        const id = p.id_parcel || p.osm_id;
        this.selectedParcelles.add(id);
      });
    }
    this.selectAll = !this.selectAll;
  }

  /**
   * Mettre à jour l'état de selectAll en fonction des sélections
   */
  updateSelectAllState() {
    const visibleParcelles = this.getPaginatedParcelles();
    if (visibleParcelles.length === 0) {
      this.selectAll = false;
      return;
    }
    this.selectAll = visibleParcelles.every(p => {
      const id = p.id_parcel || p.osm_id;
      return this.selectedParcelles.has(id);
    });
  }

  /**
   * Obtenir le nombre de parcelles sélectionnées
   */
  getSelectedCount(): number {
    return this.selectedParcelles.size;
  }

  /**
   * Supprimer les parcelles sélectionnées
   */
  async deleteSelectedParcelles() {
    if (this.selectedParcelles.size === 0 || this.isDeletingSelection) return;

    const count = this.selectedParcelles.size;
    const confirmDelete = confirm(`Êtes-vous sûr de vouloir supprimer définitivement ${count} parcelle${count > 1 ? 's' : ''} ?`);
    if (!confirmDelete) return;

    this.isDeletingSelection = true;
    try {
      const idsToDelete = Array.from(this.selectedParcelles);
      let successCount = 0;

      for (const id of idsToDelete) {
        const success = await this.parcellesService.deleteParcelle(id);
        if (success) {
          successCount++;
        }
      }

      // Réinitialiser la sélection
      this.selectedParcelles.clear();
      this.selectAll = false;

      // Recharger les données
      await this.loadParcelles(true);

      if (successCount < count) {
        alert(`${successCount} parcelle${successCount > 1 ? 's' : ''} supprimée${successCount > 1 ? 's' : ''} sur ${count}.`);
      }
    } catch (error) {
      alert('Erreur lors de la suppression des parcelles. Vérifiez la console pour plus de détails.');
    } finally {
      this.isDeletingSelection = false;
    }
  }

  // Obtenir les parcelles pour la page courante
  getPaginatedParcelles() {
    const filteredParcelles = this.getFilteredAndSortedParcelles();
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return filteredParcelles.slice(startIndex, endIndex);
  }

  // Navigation de pagination
  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  // Obtenir les numéros de pages à afficher
  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 5;
    
    if (this.totalPages <= maxVisiblePages) {
      // Si le nombre total de pages est petit, afficher toutes les pages
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Logique pour afficher les pages autour de la page courante
      const startPage = Math.max(1, this.currentPage - 2);
      const endPage = Math.min(this.totalPages, startPage + maxVisiblePages - 1);
      
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }
    }
    
    return pages;
  }

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

  @ViewChild('mapContainer', { static: true }) mapContainer?: ElementRef<HTMLElement>;

  // ============================================
  // En-tête : liste déroulante "Ajouter une parcelle"
  // ============================================
  isAddMenuOpen: boolean = false;

  toggleAddMenu(event: Event): void {
    event.stopPropagation();
    this.isAddMenuOpen = !this.isAddMenuOpen;
  }

  closeAddMenu(): void {
    this.isAddMenuOpen = false;
  }

  // Ferme la liste au clic en dehors ou à la touche Échap
  @HostListener('document:click')
  onDocumentClick(): void {
    this.isAddMenuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.isAddMenuOpen = false;
    // Échap ferme aussi la popup d'ajout / de modification de parcelle
    if (this.afficherCachet && !this.isSaving && !this.isDeleting) this.cachet();
  }

  /** La petite carte n'est créée que lorsqu'elle est visible (voir configMap). */
  @HostListener('window:resize')
  onResizeInitMap(): void {
    if (!this.map) this.configMap();
  }

  // ============================================
  // Tuiles de chiffres clés (calculées côté front sur les parcelles déjà chargées)
  // ============================================
  private static readonly HA_PER_UNIT: Record<string, number> = { ha: 1, a: 0.01, m2: 0.0001, 'm²': 0.0001 };

  getTotalAreaHa(): number {
    return this.parcellesSignal().reduce((sum, p) => {
      const area = parseFloat(p.parcel_area) || 0;
      const unit = String(p.parcel_area_unit_fr || 'ha').toLowerCase();
      return sum + area * (ParcellesComponent.HA_PER_UNIT[unit] ?? 1);
    }, 0);
  }

  /** Catégories réellement présentes dans les parcelles, avec leur nombre (pastilles de filtre + tuile). */
  getCategoryCounts(): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const p of this.parcellesSignal()) {
      const cat = p.parcel_category;
      if (cat && cat !== 'null') {
        counts.set(cat, (counts.get(cat) || 0) + 1);
      }
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }

  ngOnInit(): void {
    // Charger les parcelles et les afficher
    this.loadParcelles();

    this.form = this.formBuilder.group({
      parcel_name:[null, [Validators.required]],
      parcel_area:[null, [Validators.required]],
      parcel_area_unit_fr:['ha', [Validators.required]],
      parcel_address:[null, [Validators.required, this.addressSelectedValidator]],
      parcel_category:[null, [Validators.required]],
      sigec_code:[null] // Champ optionnel pour le code SIGEC
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.configMap(), 0);
    const elems = document.querySelectorAll('.fixed-action-btn');
    M.FloatingActionButton.init(elems, {
      direction: 'top',
      hoverEnabled: true
    });
  }

  configMap(): void {
    // Référence propre au composant (et non document.getElementById('map')) : pendant une
    // navigation, l'ancienne page (carte, accueil) peut rester brièvement dans le DOM avec son
    // propre #map, et Leaflet s'accrochait alors au mauvais élément (carte blanche).
    const mapContainer = this.mapContainer?.nativeElement;
    if (!mapContainer) return;
    if ((mapContainer as any)._leaflet_id) return; // déjà initialisée
    // Carte masquée (tablette/téléphone) : la créer dans une zone de taille 0 produisait des
    // dizaines d'erreurs « LatLng NaN ». Elle sera créée quand elle deviendra visible (resize).
    if (mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) return;

    this.map = L.map(mapContainer, { preferCanvas: true }).setView([50.5667, 4.7], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(this.map);
    this.map.invalidateSize();
    this.displayParcelsOnMap();
  }

  // Nouvelle méthode pour afficher les parcelles comme des pins sur la carte
  displayParcelsOnMap() {
    if (!this.map) return;
    // Nettoyer les anciens marqueurs et polygones
    this.map.eachLayer((layer: any) => {
      if (layer instanceof L.Marker || layer instanceof L.Polygon) {
        this.map.removeLayer(layer);
      }
    });

    const parcelles = this.parcellesService.getAllParcelles();
    const allLatLngs: L.LatLng[] = [];

    parcelles.forEach((parcelle: any) => {
      const popupContent = buildParcelPopupHtml(parcelle, { accentColor: '#03918a' });

      // Afficher le polygone si disponible
      if (parcelle.polygone) {
        try {
          const latlngs = this.parsePolygoneToLatLngs(parcelle.polygone);
          if (latlngs.length >= 3) {
            latlngs.forEach(ll => allLatLngs.push(ll));
            L.polygon(latlngs, {
              color: '#03918a',
              fillColor: '#03918a',
              fillOpacity: 0.25,
              weight: 2
            }).addTo(this.map).bindPopup(popupContent);
            return;
          }
        } catch (e) {}
      }

      if (parcelle.lat && parcelle.lon) {
        const lat = parseFloat(parcelle.lat);
        const lon = parseFloat(parcelle.lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          allLatLngs.push(L.latLng(lat, lon));
          L.marker([lat, lon], {
            icon: this.createCustomIcon('#03918a', 'white')
          }).addTo(this.map).bindPopup(popupContent);
        }
      }
    });

    // Centrer et zoomer sur toutes les parcelles avec animation
    const validLatLngs = allLatLngs.filter(ll => Number.isFinite(ll.lat) && Number.isFinite(ll.lng));
    if (validLatLngs.length > 0) {
      const bounds = L.latLngBounds(validLatLngs);
      setTimeout(() => {
        this.map.flyToBounds(bounds, { padding: [30, 30], maxZoom: 17, duration: 1.5 });
      }, 300);
    }
  }

  /**
   * Parse une chaîne JSON de polygone en tableau de LatLng Leaflet.
   * Gère deux formats :
   *  - GeoJSON  : [[[lon, lat], ...]]  (PAC on Web, import GML)
   *  - Interne  : [[lat, lon], ...]    (polygones dessinés dans l'appli)
   */
  private parsePolygoneToLatLngs(polygoneStr: string): L.LatLng[] {
    return parseLatlngs(polygoneStr).map(([lat, lon]) => L.latLng(lat, lon));
  }

  onSend(){
    if (this.form.valid && !this.isSaving) {
      // Empêcher les double-clics
      this.isSaving = true;
      
      // Sauvegarder le nom de la parcelle pour le message de succès
      const parcelName = this.form.value.parcel_name;
      
      // Fermer immédiatement la popup pour une meilleure UX
      this.afficherCachet = false;
      document.body.classList.remove('no-scroll');
      this.isFabOpen = false;
      
      // Préparer les données selon le format attendu par POST /parcels
      const parcelData = {
        latitude: this.lat || 0,
        longitude: this.lon || 0,
        parcelName: parcelName,
        parcelArea: parseFloat((this.form.value.parcel_area ?? '').toString().replace(',', '.')) || null,
        parcelAreaUnit: this.form.value.parcel_area_unit_fr,
        parcelAddress: this.form.value.parcel_address,
        parcelCategory: this.form.value.parcel_category,
        recordType: "Adress_parcel",
      };

      // Envoyer à l'API
      const apiUrl = environment.apiRegistre + '/parcels';

      this.httpClient.post(apiUrl, parcelData).pipe(takeUntil(this.destroy$)).subscribe({
        next: async (response) => {
          // Afficher le message de succès
          this.successMessageText = `La parcelle "${parcelName}" a été créée avec succès !`;
          this.showSuccessMessage.set(true);
          
          // Masquer le message après 3 secondes
          setTimeout(() => {
            this.showSuccessMessage.set(false);
          }, 3000);
          
          // Recharger les données pour mettre à jour le tableau et la carte
          await this.loadParcelles(true);

          // Mettre à jour le cache central des parcelles
          try {
            if (this.registreService && typeof this.registreService.refreshParcels === 'function') {
              await this.registreService.refreshParcels();
            }
          } catch (e) {
            console.warn('Impossible de rafraîchir le cache central des parcelles:', e);
          }
          
          // Réinitialiser le formulaire et les coordonnées
          this.form.reset({
            parcel_area_unit_fr: 'ha',
            parcel_category: null
          });
          
          this.lat = null;
          this.lon = null;
          this.addressSuggestions = [];
          this.showSuggestions = false;
          
          // Forcer l'invalidation de la taille de la carte
          setTimeout(() => {
            if (this.map) {
              this.map.invalidateSize();
            }
          }, 100);
          
          // Réactiver le bouton
          this.isSaving = false;
        },
        error: (error) => {
          this.isSaving = false;
          alert('Erreur lors de l\'ajout de la parcelle. Veuillez réessayer.');
        }
      });
    }
  }

  // Alias pour onSend pour la nouvelle popup - gère à la fois ajout et modification
  onSubmit() {
    if (this.editMode && this.selectedParcelForEdit) {
      // Mode édition : sauvegarder les modifications
      this.saveEditedParcel();
    } else {
      // Mode ajout : créer une nouvelle parcelle
      this.onSend();
    }
  }


  /**
   * Ouvrir le formulaire d'édition avec les données pré-remplies (version moderne)
   */
  async onUpdate(id: string | number){
    try {
      // Récupérer les données de la parcelle
      const parcelle = await this.parcellesService.getParcelle(id);
      if (!parcelle) {
        alert('Parcelle non trouvée !');
        return;
      }
      
      
      // Utiliser le nouveau système d'édition moderne
      this.openEditParcel(parcelle);
      
    } catch (error) {}
  }

  /**
   * Ouvrir le formulaire d'édition (méthode moderne comme get-parcelles)
   */
  openEditParcel(parcelle: any): void {
    // Désactiver le scroll du body quand la popup s'ouvre
    document.body.classList.add('no-scroll');
    
    this.selectedParcelForEdit = parcelle;
    this.editMode = true;
    this.afficherCachet = true;
   
    // Réinitialiser les suggestions d'adresse
    this.addressSuggestions = [];
    this.showSuggestions = false;
    
    // Pré-remplir le formulaire avec les données de la parcelle
    this.form.patchValue({
      parcel_name: parcelle.parcel_name || '',
      parcel_area: parcelle.parcel_area || '',
      parcel_area_unit_fr: parcelle.parcel_area_unit_fr || 'ha',
      parcel_address: parcelle.parcel_address || '',
      parcel_category: parcelle.parcel_category || null,
      sigec_code: parcelle.sigec_code || '' // Pré-remplir le code SIGEC s'il existe
    });

    // Base de conversion (en hectares) pour la conversion automatique d'unité en édition
    const currentArea = parseFloat(String(parcelle.parcel_area).replace(',', '.')) || 0;
    this.editAreaHa = this.areaUnitToHa(currentArea, parcelle.parcel_area_unit_fr || 'ha');

    // Si la parcelle a des coordonnées valides (différentes de 0/0), les conserver
    const hasValidCoords = !!parcelle.lat && !!parcelle.lon &&
      parseFloat(parcelle.lat) !== 0 && parseFloat(parcelle.lon) !== 0;
    if (hasValidCoords) {
      this.lat = parcelle.lat;
      this.lon = parcelle.lon;
    } else {
      this.lat = null;
      this.lon = null;
    }
    // L'adresse existante est considérée "confirmée" tant qu'elle n'est pas retapée
    this.addressCoordsConfirmed = hasValidCoords;

    // Ajuster les validateurs selon le type de parcelle
    const addressControl = this.form.get('parcel_address');
    if (parcelle.record_type === 'Point_parcel' ||
        parcelle.record_type === 'PAC_parcel' ||
        parcelle.imported_from_gml ||
        parcelle.imported_from_paconweb) {
      // Pour les parcelles créées par point GPS, PAC ou importées, l'adresse n'est pas obligatoire
      addressControl?.setValidators([]);
    } else {
      // Pour les autres types (adresse), l'adresse reste obligatoire et doit être confirmée
      addressControl?.setValidators([Validators.required, this.addressSelectedValidator]);
    }
    addressControl?.updateValueAndValidity();
    
  }

  /**
   * Fermer le formulaire d'édition
   */
  closeEditParcel(): void {
    // Réactiver le scroll du body quand la popup se ferme
    document.body.classList.remove('no-scroll');
    // Fermer le FAB si ouvert
    this.isFabOpen = false;
    
    this.editMode = false;
    this.selectedParcelForEdit = null;
    this.editAreaHa = 0;
    this.afficherCachet = false;

    // Réinitialiser le formulaire
    this.form.reset({
      parcel_area_unit_fr: 'ha',
      parcel_category: null
    });
    
    // Réinitialiser les coordonnées
    this.lat = null;
    this.lon = null;
    this.addressCoordsConfirmed = false;
  }

  /**
   * Convertit une superficie exprimée dans une unité donnée (ha/a/m2) vers des hectares.
   */
  private areaUnitToHa(area: number, unit: string): number {
    switch (unit) {
      case 'ha':  return area;
      case 'a':   return area / 100;
      case 'm2':  return area / 10000;
      default:    return area;
    }
  }

  /**
   * Convertit une superficie exprimée en hectares vers l'unité demandée (ha/a/m2).
   */
  private areaHaToUnit(areaHa: number, unit: string): number {
    switch (unit) {
      case 'ha':  return areaHa;
      case 'a':   return areaHa * 100;
      case 'm2':  return areaHa * 10000;
      default:    return areaHa;
    }
  }

  /**
   * Conversion automatique de la superficie lors du changement d'unité (formulaire d'édition d'une parcelle existante)
   */
  private onEditAreaUnitChange(newUnit: string): void {
    if (this.editAreaHa === 0) return;
    this.form.patchValue({ parcel_area: this.areaHaToUnit(this.editAreaHa, newUnit).toFixed(4) });
  }

  toggleUnitDropdown(): void {
    this.isUnitDropdownOpen = !this.isUnitDropdownOpen;
  }

  selectAreaUnit(unit: string): void {
    this.form.get('parcel_area_unit_fr')?.setValue(unit);
    this.isUnitDropdownOpen = false;
    if (this.editMode) {
      this.onEditAreaUnitChange(unit);
    }
  }

  getAreaUnitLabel(): string {
    const current = this.form?.get('parcel_area_unit_fr')?.value;
    return this.areaUnitOptions.find(o => o.value === current)?.label || 'Ha';
  }

  /**
   * Sauvegarder les modifications de la parcelle (version moderne)
   */
  async saveEditedParcel(): Promise<void> {
    if (!this.form.valid || !this.selectedParcelForEdit) {
      return;
    }

    try {
      
      const formData = {
        ...this.form.value,
        lat: this.lat || this.selectedParcelForEdit.lat,
        lon: this.lon || this.selectedParcelForEdit.lon,
        // Le PUT /parcels/:id remplace toutes les colonnes : il faut donc réenvoyer le
        // polygone et le recordType existants sous peine de les écraser à null (ex. parcelles GML/PAC).
        polygone: this.selectedParcelForEdit.polygone,
        record_type: this.selectedParcelForEdit.record_type
      };
      
      // S'assurer que sigec_code existe dans les données, même s'il est vide
      if (!formData.hasOwnProperty('sigec_code')) {
        formData.sigec_code = '';
      }
      
      // Utiliser updateParcelle du service
      const response = await this.parcellesService.updateParcelle(this.selectedParcelForEdit.id_parcel, formData);
      
      // Recharger la liste des parcelles pour mettre à jour le tableau et la carte
      await this.loadParcelles(true); // Force le rechargement
      
      // Fermer le formulaire d'édition
      this.closeEditParcel();
      
      
    } catch (error) {
      alert('Erreur lors de la sauvegarde. Veuillez réessayer.');
      // S'assurer que le scroll est réactivé même en cas d'erreur
      document.body.classList.remove('no-scroll');
    }
  }

  /**
   * Supprime la parcelle actuellement en cours de modification
   */
  async deleteEditedParcel(): Promise<void> {
    if (!this.selectedParcelForEdit || this.isDeleting) {
      return;
    }

    const parcelName = this.selectedParcelForEdit.parcel_name || 'cette parcelle';
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${parcelName}" ? Cette action est irréversible.`)) {
      return;
    }

    this.isDeleting = true;
    try {
      await this.parcellesService.deleteParcelle(this.selectedParcelForEdit.id_parcel);

      // Recharger la liste des parcelles pour mettre à jour le tableau et la carte
      await this.loadParcelles(true);

      // Fermer le formulaire d'édition
      this.closeEditParcel();
    } catch (error) {
      alert('Erreur lors de la suppression de la parcelle. Vérifiez la console pour plus de détails.');
      document.body.classList.remove('no-scroll');
    } finally {
      this.isDeleting = false;
    }
  }

  async onUpdateSend(form: NgForm){
    try {
      
      if (!form.valid) {
        alert('Veuillez remplir tous les champs obligatoires.');
        return;
      }
      
      const parcelleData = form.value;
      const id_parcel = parcelleData.id_parcel;
      
      if (!id_parcel) {
        alert('ID de la parcelle manquant.');
        return;
      }
      
      // Préparer les données de mise à jour (sans l'ID)
      const updateData: Partial<Parcelle> = {
        parcel_name: parcelleData.parcel_name,
        parcel_category: parcelleData.parcel_category,
        parcel_area: (parcelleData.parcel_area ?? '').toString().replace(',', '.'),
        parcel_area_unit_fr: parcelleData.parcel_area_unit_fr,
        parcel_address: parcelleData.parcel_address
      };
      
      // Effectuer la mise à jour via l'API
      const updatedParcelle = await this.parcellesService.updateParcelle(id_parcel, updateData);
      
      // Fermer le modal
      this.modif = false;
      this.parcelleToUpdate.set(null);
      
      // Recharger les données dans l'interface pour mettre à jour le tableau et la carte
      await this.loadParcelles(true); // Force le rechargement
      
      
    } catch (error) {
      alert('Erreur lors de la sauvegarde. Vérifiez la console pour plus de détails.');
    }
  }

  async onDel(id: string | number){
    try {
      
      // Demander confirmation
      const confirmDelete = confirm(`Êtes-vous sûr de vouloir supprimer définitivement cette parcelle ?`);
      if (!confirmDelete) {
        return;
      }
      
      // Effectuer la suppression
      const success = await this.parcellesService.deleteParcelle(id);
      
      if (success) {
        
        // Recharger les données dans l'interface pour mettre à jour le tableau et la carte
        await this.loadParcelles(true); // Force le rechargement
        
      } else {
        alert('Erreur lors de la suppression de la parcelle.');
      }
      
    } catch (error) {
      alert('Erreur lors de la suppression de la parcelle. Vérifiez la console pour plus de détails.');
    }
  }

  afficher(){
    // Désactiver le scroll du body quand la popup s'ouvre
    document.body.classList.add('no-scroll');
    
    // Mode ajout : réinitialiser l'état d'édition
    this.editMode = false;
    this.selectedParcelForEdit = null;
    this.afficherCachet = true;
   
    // Réinitialiser les coordonnées pour un nouveau ajout
    this.lat = null;
    this.lon = null;
    this.addressCoordsConfirmed = false;

    // Réinitialiser les suggestions d'adresse
    this.addressSuggestions = [];
    this.showSuggestions = false;


    // Réinitialiser le formulaire avec les valeurs par défaut
    this.form.reset({
      parcel_area_unit_fr: 'ha',
      parcel_category: null
    });

    // S'assurer que l'adresse redemande une sélection valide (au cas où setValidators
    // aurait été allégé lors d'une précédente édition)
    this.form.get('parcel_address')?.setValidators([Validators.required, this.addressSelectedValidator]);
    this.form.get('parcel_address')?.updateValueAndValidity();
  }
  
  cachet(){
    // Réactiver le scroll du body quand la popup se ferme
    document.body.classList.remove('no-scroll');
    // Fermer le FAB si ouvert
    this.isFabOpen = false;
    this.isUnitDropdownOpen = false;
    
    // Fermer la popup en fonction du mode
    if (this.editMode) {
      this.closeEditParcel();
    } else {
      this.afficherCachet = false;
      this.modif = false;
      this.parcelleToUpdate.set(null);
    }
  }

  // Import GML
  onImportGML() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.gml';
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.importGMLFile(file);
      }
    };
    fileInput.click();
  }

  onGMLFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.importGMLFile(file);
    }
  }

  importGMLFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.gml')) {
      alert('Veuillez sélectionner un fichier GML (.gml)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('Le fichier est trop volumineux (maximum 10 MB)');
      return;
    }

    const formData = new FormData();
    formData.append('gml_file', file);

    // L'intercepteur ajoute le Bearer automatiquement.
    this.httpClient.post(environment.apiRegistre + '/parcels/import_gml', formData).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (response: any) => {

        if (response.success) {
          //  Rafraîchir automatiquement le tableau et la carte
          await this.loadParcelles(true); // Force le rechargement complet

          //  Déclencher aussi le rafraîchissement dans le service registre pour mettre à jour le cache global
          this.registreService.refreshParcels();

          alert(`Import réussi ! ${response.imported || 0} parcelles importées.`);
        } else {
          alert('Erreur lors de l\'import: ' + (response.error || 'Erreur inconnue'));
        }
      },
      error: (error) => {
        
        if (error.status === 401) {
          alert('Erreur d\'authentification: Token invalide ou expiré. Veuillez vous reconnecter.');
        } else if (error.status === 400) {
          alert('Erreur dans le fichier GML: ' + (error.error?.error || 'Format invalide'));
        } else {
          alert('Erreur lors de l\'import du fichier GML. Vérifiez la console pour plus de détails.');
        }
      }
    });
  }

  // Méthodes pour l'autocomplétion d'adresse
  onAddressInput(event: any) {
    const query = event.target.value;

    // Toute frappe invalide la sélection précédente : il faut re-choisir
    // une suggestion pour obtenir des coordonnées valides
    this.addressCoordsConfirmed = false;
    this.lat = null;
    this.lon = null;

    // Annuler la recherche précédente si elle existe
    if (this.addressSearchTimeout) {
      clearTimeout(this.addressSearchTimeout);
    }

    // Si la requête est trop courte, masquer les suggestions
    if (query.length < 3) {
      this.addressSuggestions = [];
      this.showSuggestions = false;
      return;
    }

    // Attendre 300ms avant de lancer la recherche pour éviter trop de requêtes
    this.addressSearchTimeout = setTimeout(() => {
      this.searchAddresses(query);
    }, 300);
  }

  onAddressFocus() {
    // Afficher les suggestions si elles existent déjà
    if (this.addressSuggestions.length > 0) {
      this.showSuggestions = true;
    }
  }

  onAddressBlur() {
    // Attendre un peu avant de masquer pour permettre la sélection
    setTimeout(() => {
      this.showSuggestions = false;
    }, 200);
  }

  searchAddresses(query: string) {
    if (query.length < 3) return;

    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=be&limit=5&addressdetails=1`;

    this.httpClient.get<any[]>(nominatimUrl).pipe(takeUntil(this.destroy$)).subscribe({
      next: (results) => {
        this.addressSuggestions = results.map(result => ({
          display_name: result.display_name,
          lat: parseFloat(result.lat),
          lon: parseFloat(result.lon),
          place_id: result.place_id,
          address: result.address
        }));
        this.showSuggestions = true;
      },
      error: (error) => {
        this.addressSuggestions = [];
        this.showSuggestions = false;
      }
    });
  }

  selectAddressSuggestion(suggestion: any) {

    // Une suggestion a été choisie : l'adresse est désormais associée à des coordonnées fiables
    this.addressCoordsConfirmed = true;

    // Vérifier que le formulaire existe avant de l'utiliser
    if (this.form) {
      // Mettre à jour le champ d'adresse dans le formulaire
      this.form.patchValue({
        parcel_address: suggestion.display_name
      });
    }

    // 🎯 Mettre à jour les coordonnées en s'assurant qu'elles sont des nombres
    this.lat = typeof suggestion.lat === 'string' ? parseFloat(suggestion.lat) : suggestion.lat;
    this.lon = typeof suggestion.lon === 'string' ? parseFloat(suggestion.lon) : suggestion.lon;

    // Masquer les suggestions
    this.showSuggestions = false;
    this.addressSuggestions = [];

    // Optionnel : centrer la carte sur l'adresse sélectionnée si la carte est visible
    if (this.map) {
      this.map.setView([suggestion.lat, suggestion.lon], 16);
      
      // Ajouter un marqueur temporaire avec icône personnalisée
      L.marker([suggestion.lat, suggestion.lon], {
        icon: this.createCustomIcon('#03918a', 'white')
      })
        .addTo(this.map)
        .bindPopup(buildParcelPopupHtml(null, { titleOnly: suggestion.display_name, accentColor: '#03918a' }))
        .openPopup();
    }

  }

  /**
   * Générer un UUID v4
   */
  private generateUUID(): string {
    return crypto.randomUUID();
  }

  /**
   * Générer un place_id aléatoire (nombre entre 100000000 et 999999999)
   */
  private generateRandomPlaceId(): number {
    return Math.floor(Math.random() * (999999999 - 100000000 + 1)) + 100000000;
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    clearTimeout(this.addressSearchTimeout);

    // Réactiver le scroll du body si le composant est détruit avec popup ouverte
    document.body.classList.remove('no-scroll');

    // Nettoyer la carte Leaflet pour éviter les erreurs de réinitialisation
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

}
