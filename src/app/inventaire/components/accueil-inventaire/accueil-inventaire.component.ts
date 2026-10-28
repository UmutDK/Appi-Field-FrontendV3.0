import { Component, inject, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild, HostListener } from '@angular/core';
import { PpnuPpnvComponent } from "../ppnu-ppnv/ppnu-ppnv.component";
import { AchatDePppComponent } from "../achat-de-ppp/achat-de-ppp.component";
import { CorrectionStockComponent } from "../correction-stock/correction-stock.component";
import { ImportAchatsComponent } from "../import-achats/import-achats.component";
import { InventaireService, RealInventoryData, InventoryStock, EventHistory } from '../../services/inventaire.service';
import { RegistreService } from '../../../registre/services/registre.service';
import { Subject, takeUntil } from 'rxjs';
import { SharedModule } from '../../../shared/shared.module';
import { Chart, registerables } from 'chart.js';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

// Interface pour les données phytoweb
interface PhytowebProduct {
  product_id: string;
  product_name: string;
  product_numaut: string;
  product_type: string;
  user_group?: string;
  date_act?: string;
  // Statut calculé côté serveur (general.statut + dates.useToleranceDate) — voir productFromApi.
  authorization_status?: 'authorized' | 'withdrawing' | 'forbidden' | 'unknown';
  use_tolerance_date?: string;
}

declare function popTelechargerment():any;
declare function pourcentage():any;

// Enregistrer tous les éléments Chart.js
Chart.register(...registerables);

@Component({
  selector: 'app-accueil-inventaire',
  standalone: true,
  imports: [
    PpnuPpnvComponent, 
    AchatDePppComponent,
    CorrectionStockComponent,
    ImportAchatsComponent,
    SharedModule
  ],
  templateUrl: './accueil-inventaire.component.html',
  styleUrl: './accueil-inventaire.component.scss'
})
export class AccueilInventaireComponent implements OnInit, AfterViewInit, OnDestroy {
  // Unité d'affichage pour le dashboard
  displayUnit: 'L' | 'ml' | 'Kg' | 'g' = 'L';

  // Conversion d'une quantité selon l'unité d'affichage courante
  private convertQuantity(value: number): number {
    return (this.displayUnit === 'ml' || this.displayUnit === 'g') ? value * 1000 : value;
  }

  get convertedQuantityRemaining(): number {
    return this.selectedProduct ? this.convertQuantity(this.quantityRemaining) : 0;
  }
  get convertedQuantityBuyed(): number {
    return this.selectedProduct ? this.convertQuantity(this.quantityBuyed) : 0;
  }
  get convertedQuantityUsed(): number {
    return this.selectedProduct ? this.convertQuantity(this.quantityUsed) : 0;
  }
  get convertedQuantityPpnuPpnv(): number {
    return this.selectedProduct ? this.convertQuantity(this.quantityPpnuPpnv) : 0;
  }
  get convertedQuantityCorrection(): number {
    return this.selectedProduct ? this.convertQuantity(this.quantityCorrection) : 0;
  }

  // Affichage du label d'unité
  get displayUnitLabel(): string {
    return this.displayUnit;
  }

  // Switcher d'unité
  switchUnit(): void {
    if (!this.selectedProduct) return;
    if (this.selectedProduct.quantity_unit === 'L') {
      this.displayUnit = this.displayUnit === 'L' ? 'ml' : 'L';
    } else if (this.selectedProduct.quantity_unit === 'Kg') {
      this.displayUnit = this.displayUnit === 'Kg' ? 'g' : 'Kg';
    }
  }

  @ViewChild('chartCanvas', { static: false }) chartCanvas!: ElementRef<HTMLCanvasElement>;

  popInventaire!: string;
  // Produit à présélectionner dans le popup PPNU/PPNV ou Achat (boutons "pour ce produit")
  popupPreselectedProductId: string | null = null;

  // États de chargement
  isLoading: boolean = true;
  isEmpty: boolean = false;
  
  // Nouvelles propriétés pour les vraies données
  realInventoryData: RealInventoryData[] = [];
  sortedProducts: InventoryStock[] = [];
  selectedProduct: InventoryStock | null = null;
  productUsages: EventHistory[] = [];
  productPurchases: EventHistory[] = []; // Nouveaux achats
  productTreatments: EventHistory[] = []; // Nouvelles utilisations
  productPpnuPpnvEvents: EventHistory[] = []; // Nouveaux événements PPNU/PPNV
  chart: Chart | null = null;

  // Nouvelles propriétés pour les données phytoweb
  phytowebProducts: PhytowebProduct[] = [];
  selectedProductPhytoweb: PhytowebProduct | null = null;
  isLoadingPhytoweb: boolean = true;

  // Propriétés de pagination
  currentPage: number = 1;
  itemsPerPage: number = 10;

  // Propriétés calculées
  quantityBuyed: number = 0;
  quantityUsed: number = 0;
  quantityPpnuPpnv: number = 0;
  quantityCorrection: number = 0;
  quantityRemaining: number = 0;

  // Anciennes propriétés (garder pour compatibilité avec PPNU & PPNV)
  valeurJson: any[] = [];
  qte!: number;
  rest!: number;
  used!: number;
  ppnu!: number;
  ppnv!: number;

  private inventaireService = inject(InventaireService);
  private http = inject(HttpClient);
  private registreService = inject(RegistreService);
  private destroy$ = new Subject<void>();
  signal = this.inventaireService.signalInventaireServeur;

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
  // fermée au clic en dehors ou à la touche Échap (affichage uniquement).
  @HostListener('document:click')
  onDocumentClickCloseAddMenu(): void {
    this.isFabOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscapeCloseAddMenu(): void {
    this.isFabOpen = false;
    // Échap ferme aussi la popup PPNU / Achat ouverte (même action que la croix)
    if (this.popInventaire === 'PPNU - PPNV' || this.popInventaire === 'Achat de PPP' || this.popInventaire === 'Correction' || this.popInventaire === 'Import achats') this.onClose();
  }

  /** Message de confirmation affiché quelques secondes en bas de l'écran. */
  toastMessage = '';
  private toastTimer: any = null;

  showToast(message: string): void {
    this.toastMessage = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMessage = '', 4000);
  }

  ngOnInit(): void {
    if (typeof popTelechargerment === 'function') { popTelechargerment(); }
    
    // Charger les données phytoweb
    this.loadPhytowebData();
    
    // Charger les vraies données d'inventaire
    this.loadRealInventoryData();
    
    // Garder l'ancien système pour PPNU & PPNV
    this.inventaireService.getInventaire().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.valeurJson = data;
        this.qte = this.TotalQte();
        this.rest = this.TotalReste();
        this.used = this.TotalUsed();
        this.ppnu = this.TotalPpnu();
        this.ppnv = this.TotalPpnv();
      }
    });
  }

  loadPhytowebData(): void {
    this.isLoadingPhytoweb = true;
    this.registreService.getVolumeDeBouillipreparer()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (data) => {
        this.phytowebProducts = data;
        this.isLoadingPhytoweb = false;
        
        // Si un produit est déjà sélectionné, mettre à jour ses données phytoweb
        if (this.selectedProduct) {
          this.selectedProductPhytoweb = this.phytowebProducts.find(
            p => p.product_numaut === this.selectedProduct!.product_numaut
          ) || null;
        }
      },
      error: (error) => {
        this.isLoadingPhytoweb = false;
      }
    });
  }

  ngAfterViewInit(): void { }

  loadRealInventoryData(): void {
    this.isLoading = true;
    this.isEmpty = false;
    
    // Sauvegarder le product_id du produit actuellement sélectionné
    const currentSelectedProductId = this.selectedProduct?.product_id;
    
    this.inventaireService.getRealInventoryData().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.realInventoryData = data;
        this.isLoading = false;
        
        if (data.length > 0 && data[0].inventory_stock.length > 0) {
          // Trier les produits par ordre alphabétique
          this.sortedProducts = this.inventaireService.getSortedProducts(data[0].inventory_stock);
          
          // Si un produit était sélectionné, essayer de le resélectionner
          if (currentSelectedProductId) {
            const previouslySelectedProduct = this.sortedProducts.find(
              p => p.product_id === currentSelectedProductId
            );
            
            if (previouslySelectedProduct) {
              // Trouver l'index du produit et calculer la page correspondante
              const productIndex = this.sortedProducts.findIndex(p => p.product_id === currentSelectedProductId);
              if (productIndex !== -1) {
                this.currentPage = Math.floor(productIndex / this.itemsPerPage) + 1;
              }
              
              // Resélectionner le produit précédent
              this.selectProduct(previouslySelectedProduct);
              this.isEmpty = false;
            } else {
              // Si le produit n'existe plus (cas rare), sélectionner le premier
              if (this.sortedProducts.length > 0) {
                this.currentPage = 1;
                this.selectProduct(this.sortedProducts[0]);
                this.isEmpty = false;
              } else {
                this.isEmpty = true;
              }
            }
          } else {
            // Aucun produit n'était sélectionné, sélectionner le premier
            if (this.sortedProducts.length > 0) {
              this.currentPage = 1;
              this.selectProduct(this.sortedProducts[0]);
              this.isEmpty = false;
            } else {
              this.isEmpty = true;
            }
          }
        } else {
          this.isEmpty = true;
          this.sortedProducts = [];
        }
      },
      error: (error) => {
        this.isLoading = false;
        this.isEmpty = true;
      }
    });
  }

  selectProduct(product: InventoryStock): void {
    this.selectedProduct = product;
    this.inventaireService.selectProduct(product);
    
    // Trouver les données phytoweb correspondantes
    this.selectedProductPhytoweb = this.phytowebProducts.find(
      p => p.product_numaut === product.product_numaut
    ) || null;
    
    // Réinitialiser l'unité d'affichage selon le produit
    if (product.quantity_unit === 'L') {
      this.displayUnit = 'L';
    } else if (product.quantity_unit === 'Kg') {
      this.displayUnit = 'Kg';
    } else {
      this.displayUnit = product.quantity_unit as any;
    }
    // Calculer les statistiques
    this.calculateStatistics();
    // Mettre à jour les utilisations
    this.updateProductUsages();
    // Mettre à jour le graphique avec un délai pour s'assurer que le DOM est prêt
    setTimeout(() => {
      this.updateChart();
    }, 100);
  }

  // Méthode helper pour obtenir le statut traduit
  getStatusLabel(status: string | undefined): string {
    switch(status) {
      case 'authorized': return 'Autorisé';
      case 'withdrawing': return 'Autorisation en cours de retrait';
      case 'forbidden': return 'Interdit';
      default: return '';
    }
  }

  // Méthode helper pour obtenir la couleur du statut
  getStatusColor(status: string | undefined): string {
    switch(status) {
      case 'authorized': return '#28a745'; // Vert
      case 'withdrawing': return '#fd7e14'; // Orange
      case 'forbidden': return '#dc3545'; // Rouge
      default: return '#6c757d'; // Gris par défaut
    }
  }

  // Méthode helper pour obtenir les données phytoweb d'un produit
  getProductPhytowebData(product: InventoryStock): PhytowebProduct | null {
    return this.phytowebProducts.find(
      p => p.product_numaut === product.product_numaut
    ) || null;
  }

  // ============================================================================
  // Filtre actif sur la liste des produits
  activeFilter: 'all' | 'positive' | 'negative' | 'empty' = 'all';

  // Getter pour les produits filtrés selon le filtre actif
  get filteredProducts(): InventoryStock[] {
    switch (this.activeFilter) {
      case 'positive':
        return this.sortedProducts.filter(p =>
          this.inventaireService.getRemainingQuantity(p) > 0
        );
      case 'negative':
        return this.sortedProducts.filter(p =>
          this.inventaireService.getRemainingQuantity(p) < 0
        );
      case 'empty':
        return this.sortedProducts.filter(p =>
          this.inventaireService.getRemainingQuantity(p) === 0
        );
      default:
        return this.sortedProducts;
    }
  }

  setFilter(filter: 'all' | 'positive' | 'negative' | 'empty'): void {
    this.activeFilter = filter;
    this.currentPage = 1;
  }

  get countPositive(): number {
    return this.sortedProducts.filter(p =>
      this.inventaireService.getRemainingQuantity(p) > 0
    ).length;
  }

  get countNegative(): number {
    return this.sortedProducts.filter(p =>
      this.inventaireService.getRemainingQuantity(p) < 0
    ).length;
  }

  get countEmpty(): number {
    return this.sortedProducts.filter(p =>
      this.inventaireService.getRemainingQuantity(p) === 0
    ).length;
  }

  // MÉTHODES DE PAGINATION
  // ============================================================================

  // Getter pour obtenir les produits de la page courante
  get paginatedProducts(): InventoryStock[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return this.filteredProducts.slice(startIndex, endIndex);
  }

  // Getter pour obtenir le nombre total de pages
  get totalPages(): number {
    return Math.ceil(this.filteredProducts.length / this.itemsPerPage);
  }

  // Getter pour savoir si on peut aller à la page précédente
  get canGoPrevious(): boolean {
    return this.currentPage > 1;
  }

  // Getter pour savoir si on peut aller à la page suivante
  get canGoNext(): boolean {
    return this.currentPage < this.totalPages;
  }

  // Aller à la page précédente
  goToPreviousPage(): void {
    if (this.canGoPrevious) {
      this.currentPage--;
    }
  }

  // Aller à la page suivante
  goToNextPage(): void {
    if (this.canGoNext) {
      this.currentPage++;
    }
  }

  // Obtenir le texte de pagination (ex: "1-10 sur 22")
  get paginationText(): string {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage + 1;
    const endIndex = Math.min(this.currentPage * this.itemsPerPage, this.filteredProducts.length);
    return `${startIndex}-${endIndex} sur ${this.filteredProducts.length}`;
  }

  calculateStatistics(): void {
    if (!this.selectedProduct) return;

    // 05b1af Appliquer les nouveaux calculs selon les spécifications
    // Quantité restante = acheté - utilisé - PPNU - PPNV + corrections (formule unique du service)
    this.quantityRemaining = this.inventaireService.getRemainingQuantity(this.selectedProduct);

    // Quantité achetée = quantity_used (selon spécification utilisateur)
    this.quantityBuyed = this.selectedProduct.quantity_buyed;

    // Utilisation = quantity_used
    this.quantityUsed = this.selectedProduct.quantity_used;

    // PPNU + PPNV = quantity_ppnu + quantity_ppnv
    this.quantityPpnuPpnv = this.selectedProduct.quantity_ppnu + this.selectedProduct.quantity_ppnv;

    // Corrections : net signé (+ ajout, − retrait)
    this.quantityCorrection = this.selectedProduct.quantity_correction || 0;
  }

  // 05b1af Nouvelle méthode pour détecter les produits "vides"
  isProductEmpty(product: InventoryStock | null): boolean {
    if (!product) return false;
    
    return product.quantity_buyed === 0 &&
           product.quantity_ppnu === 0 &&
           product.quantity_ppnv === 0 &&
           (product.quantity_correction || 0) === 0 &&
           product.quantity_used === 0 &&
           (product.total_used === 0 || product.total_used === undefined);
  }

  // 05b1af Getter pour vérifier si le produit sélectionné est vide
  get isSelectedProductEmpty(): boolean {
    return this.isProductEmpty(this.selectedProduct);
  }

  updateProductUsages(): void {
    if (!this.selectedProduct || this.realInventoryData.length === 0) return;

    // Récupérer tous les événements du produit SAUF les PPNU/PPNV pour le tableau historique
    const allEvents = this.inventaireService.getProductUsages(
      this.selectedProduct.product_id,
      this.realInventoryData[0].event_history
    );
    
    // Filtrer les événements PPNU/PPNV pour le tableau historique "Tout"
    this.productUsages = allEvents.filter(event => 
      event.event_type !== 'ppnu_entry' && event.event_type !== 'ppnv_entry'
    );

    // Séparer les achats et les utilisations
    this.productPurchases = this.inventaireService.getProductPurchases(
      this.selectedProduct.product_id,
      this.realInventoryData[0].event_history
    );

    this.productTreatments = this.inventaireService.getProductTreatments(
      this.selectedProduct.product_id,
      this.realInventoryData[0].event_history
    );

    // Récupérer les événements PPNU/PPNV
    this.productPpnuPpnvEvents = this.realInventoryData[0].event_history.filter(event => 
      event.product_id === this.selectedProduct!.product_id && 
      (event.event_type === 'ppnu_entry' || event.event_type === 'ppnv_entry')
    );
  }

  private buildChartData(): { data: number[]; labels: string[]; colors: string[] } {
    if (this.quantityRemaining === 0) {
      return { data: [1], labels: ['Stock épuisé'], colors: ['#cccccc'] };
    }
    const correctionOut = Math.max(0, -this.quantityCorrection);
    if (this.quantityRemaining < 0) {
      return {
        data:   [this.quantityUsed, this.quantityPpnuPpnv, correctionOut, 0, Math.abs(this.quantityRemaining)],
        labels: ['Utilisé', 'PPNU + PPNV', 'Corrections (−)', 'Restant', 'Négatif'],
        colors: ['#cccccc', '#cccccc', '#cccccc', '#cccccc', '#cf3514']
      };
    }
    return {
      data:   [this.quantityUsed, this.quantityPpnuPpnv, correctionOut, this.quantityRemaining],
      labels: ['Utilisé', 'PPNU + PPNV', 'Corrections (−)', 'Restant'],
      colors: ['#05b1af', '#b2b221', '#a3301a', '#0f113b']
    };
  }

  createChart(): void {
    if (!this.chartCanvas || !this.selectedProduct) return;

    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    if (this.chart) {
      this.chart.destroy();
    }

    const { data, labels, colors } = this.buildChartData();

    this.chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      } as any
    });
    (this.chart as any).options.cutout = '60%';
    this.chart.update();
  }

  updateChart(): void {
    if (!this.chart) {
      this.createChart();
      return;
    }

    const { data, labels, colors } = this.buildChartData();
    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = data;
    this.chart.data.datasets[0].backgroundColor = colors;
    this.chart.update();
  }

  // Anciennes méthodes (garder pour compatibilité PPNU & PPNV)
  TotalQte() {
    return this.valeurJson.reduce((total, valeur) => total + (valeur.quantity_buyed || 0), 0);
  }

  TotalReste() {
    return this.TotalQte() - this.TotalUsed();
  }

  TotalUsed() {
    return this.valeurJson.reduce((total, valeur) => total + (valeur.quantity_used || 0), 0);
  }

  TotalPpnu() {
    return this.valeurJson.reduce((total, valeur) => total + (valeur.quantity_ppnu || 0), 0);
  }

  TotalPpnv() {
    return this.valeurJson.reduce((total, valeur) => total + (valeur.quantity_ppnv || 0), 0);
  }

  onAddPpnu() {
    this.popupPreselectedProductId = null;
    this.popInventaire = "PPNU - PPNV";
  }

  onAddAchatPpp() {
    this.popupPreselectedProductId = null;
    this.popInventaire = "Achat de PPP";
  }

  // Boutons "pour ce produit" en haut des cadres PPNU/PPNV et Historique
  onAddPpnuForSelectedProduct(): void {
    if (!this.selectedProduct) return;
    this.popupPreselectedProductId = this.selectedProduct.product_id;
    this.popInventaire = "PPNU - PPNV";
  }

  onAddAchatForSelectedProduct(): void {
    if (!this.selectedProduct) return;
    this.popupPreselectedProductId = this.selectedProduct.product_id;
    this.popInventaire = "Achat de PPP";
  }

  onAddCorrection(): void {
    this.popupPreselectedProductId = null;
    this.popInventaire = "Correction";
  }

  // Bouton « Corriger le stock » de la fiche produit
  onAddCorrectionForSelectedProduct(): void {
    if (!this.selectedProduct) return;
    this.popupPreselectedProductId = this.selectedProduct.product_id;
    this.popInventaire = "Correction";
  }

  onCloseCorrectionForm(): void {
    this.onClose();
  }

  // Import Excel d'achats (updateToDo/08)
  onImportAchats(): void {
    this.popupPreselectedProductId = null;
    this.popInventaire = "Import achats";
  }

  onAchatsImported(count: number): void {
    this.showToast(`${count} achat${count > 1 ? 's' : ''} importé${count > 1 ? 's' : ''} dans votre inventaire.`);
  }

  onClose(): void {
    this.popInventaire = "";
    this.popupPreselectedProductId = null;
    this.isFabOpen = false;
    this.loadRealInventoryData();
  }

  onCloseAchatForm() {
    this.onClose();
  }

  onClosePpnuForm() {
    this.onClose();
  }

  onValeurAjouter() {
    return this.popInventaire;
  }

  // ============================================================================
  // NOUVELLES MÉTHODES POUR LA GESTION DES ACTIONS (MODIFIER/SUPPRIMER)
  // ============================================================================

  // Méthodes pour PPNU/PPNV événements
  onEditPpnuPpnvEvent(event: EventHistory): void {
    
    if (!this.selectedProduct) return;
    
    // Convertir l'événement en format attendu par le composant de modification
    const entry = {
      date: event.event_date,
      type: event.event_type === 'ppnu_entry' ? 'PPNU' : 'PPNV',
      quantity: event.quantity_used,
      unit: this.selectedProduct.quantity_unit
    };
    
    // Sauvegarder l'événement pour la modification (utiliser event_id au lieu d'index)
    this.inventaireService.setEditingPpnuPpnvEvent(entry, event.event_id, this.selectedProduct.product_id);
    
    // Ouvrir la popup de modification avec les données pré-complétées
    this.popInventaire = "PPNU - PPNV";
  }

  onDeletePpnuPpnvEvent(event: EventHistory): void {
    
    if (!this.selectedProduct) return;
    
    const eventTypeLabel = event.event_type === 'ppnu_entry' ? 'PPNU' : 'PPNV';
    const eventDate = new Date(event.event_date).toLocaleDateString();
    
    if (confirm(`Voulez-vous vraiment supprimer cet événement ${eventTypeLabel} du ${eventDate} ?`)) {
      this.inventaireService.deletePpnuPpnvEventById(this.selectedProduct.product_id, event.event_id).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          // Recharger les données pour refléter les changements
          this.loadRealInventoryData();
        },
        error: (error: any) => {
          alert('Erreur lors de la suppression de l\'événement. Veuillez réessayer.');
        }
      });
    }
  }

  // Méthodes pour les corrections de stock
  onEditCorrectionEvent(event: EventHistory): void {
    if (!this.selectedProduct) return;
    this.inventaireService.setEditingCorrectionEvent({
      date: event.event_date,
      mode: event.correction_mode === 'plus' ? 'plus' : 'minus',
      quantity: event.quantity_used,
      unit: event.quantity_used_unit || this.selectedProduct.quantity_unit,
    }, event.event_id, this.selectedProduct.product_id);
    this.popupPreselectedProductId = null;
    this.popInventaire = "Correction";
  }

  onDeleteCorrectionEvent(event: EventHistory): void {
    if (!this.selectedProduct) return;
    if (confirm(`Supprimer la correction du ${new Date(event.event_date).toLocaleDateString('fr-BE')} ?`)) {
      this.inventaireService.deleteCorrectionById(event.event_id).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => this.loadRealInventoryData(),
        error: () => alert('Erreur lors de la suppression de la correction. Veuillez réessayer.')
      });
    }
  }

  // Méthodes pour les événements d'achat
  onEditPurchaseEvent(purchase: EventHistory): void {
    
    // Sauvegarder l'événement pour la modification
    this.inventaireService.setEditingPurchaseEvent(purchase);
    
    // Ouvrir la popup de modification avec les données pré-complétées
    this.popInventaire = "Achat de PPP";
  }

  onDeletePurchaseEvent(purchase: EventHistory): void {
    
    if (confirm(`Voulez-vous vraiment supprimer cet achat du ${new Date(purchase.event_date).toLocaleDateString()} ?`)) {
      this.inventaireService.deletePurchaseEvent(purchase.event_id).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          // Recharger les données pour refléter les changements
          this.loadRealInventoryData();
        },
        error: (error: any) => {
          alert('Erreur lors de la suppression de l\'achat. Veuillez réessayer.');
        }
      });
    }
  }

  // 05b1af Nouvelle méthode pour supprimer un produit vide de l'inventory_stock
  onDeleteEmptyProduct(): void {
    if (!this.selectedProduct || !this.isSelectedProductEmpty) {
      return;
    }

    const productName = this.selectedProduct.product_name;
    if (confirm(`Voulez-vous vraiment supprimer "${productName}" de votre inventaire ? Cette action supprimera uniquement ce produit de votre stock car toutes ses quantités sont à zéro.`)) {
      this.inventaireService.deleteEmptyProductFromStock(this.selectedProduct.product_id).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          // Réinitialiser la sélection
          this.selectedProduct = null;
          // Recharger les données pour refléter les changements
          this.loadRealInventoryData();
        },
        error: (error: any) => {
          alert('Erreur lors de la suppression du produit. Veuillez réessayer.');
        }
      });
    }
  }

  // ============================================================================
  // EXPORT INVENTAIRE EXCEL
  // ============================================================================
  
  isExporting = false;

  exportInventaireExcel(): void {
    if (this.isExporting) {
      return; // Éviter les doubles clics
    }

    this.isExporting = true;
    
    this.inventaireService.exportInventaireExcel().pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        this.isExporting = false;
      },
      error: (error: any) => {
        alert('Erreur lors de l\'export de l\'inventaire: ' + (error.message || 'Erreur inconnue'));
        this.isExporting = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.chart) {
      this.chart.destroy();
      this.chart = null as any;
    }
  }
}
