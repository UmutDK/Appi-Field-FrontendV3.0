import { Component, inject, OnInit, OnDestroy, Input, Output, EventEmitter, ElementRef, ViewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { debounceTime, distinctUntilChanged, of, catchError, takeUntil, Subject } from 'rxjs';
import { PhytoProductService } from '../../services/phyto-product.service';
import { InventaireService, PurchaseEntry } from '../../services/inventaire.service';
import { PhytoProduct } from '../../model/phyto-product.interface';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-achat-de-ppp',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule
  ],
  templateUrl: './achat-de-ppp.component.html',
  styleUrl: './achat-de-ppp.component.scss'
})
export class AchatDePppComponent implements OnInit, OnDestroy {
  /** Produit à présélectionner à l'ouverture (ex. ouverture depuis la page d'un produit). */
  @Input() preselectedProductId: string | null = null;
  @Output() closeForm = new EventEmitter<void>();
  /** Message de confirmation affiché par la page (au lieu d'une alerte du navigateur). */
  @Output() saved = new EventEmitter<string>();
  @ViewChild('popupContent') popupContent!: ElementRef;

  private fb = inject(FormBuilder);
  private phytoProductService = inject(PhytoProductService);
  private inventaireService = inject(InventaireService);
  private httpClient = inject(HttpClient);
  private destroy$ = new Subject<void>();

  purchaseForm!: FormGroup;
  searchForm!: FormGroup;
  
  // Mode: PPP phytoweb ou produits personnels
  productMode: 'phyto' | 'personal' = 'phyto';

  // Données pour l'autocomplétion phyto
  allProducts: PhytoProduct[] = [];
  productSuggestions: PhytoProduct[] = [];
  selectedProduct: PhytoProduct | null = null;
  showSuggestions = false;
  isLoading = false;
  searchError = false;

  // Produits personnels
  personalProducts: any[] = [];
  filteredPersonalProducts: any[] = [];
  selectedPersonalProduct: any | null = null;
  personalProductSearchControl = new FormControl('');
  showNewPersonalProductForm = false;
  showPersonalSuggestions = false;
  personalProductForm!: FormGroup;
  isSavingPersonalProduct = false;
  filteredTypeOptions: string[] = [];
  showTypeSuggestions = false;

  // Dropdown custom pour l'unité (remplace le <select> natif, même pattern que
  // parcelles.component — voir src/styles/_popup-system.scss pour le style partagé).
  isUnitDropdownOpen = false;
  unitOptions = [
    { value: 'L', label: 'Litres (L)' },
    { value: 'Kg', label: 'Kilogrammes (Kg)' }
  ];

  get existingProductTypes(): string[] {
    const all = this.personalProducts.map((p: any) => p.product_type).filter(Boolean);
    return [...new Set(all)] as string[];
  }

  // Support de l'édition
  isEditMode = false;
  editingEventId: string = '';

  ngOnInit() {
    // Désactiver le scroll du body quand la popup s'ouvre
    document.body.classList.add('no-scroll');
    
    this.initializeForms();
    this.loadAllProducts();
    this.setupProductSearch();
    this.setupPersonalProductSearch();
    this.setupPersonalTypeSearch();
    this.loadPersonalProducts();
    this.checkForEditMode();
  }

  ngOnDestroy() {
    // Réactiver le scroll du body quand la popup se ferme
    document.body.classList.remove('no-scroll');
    // Nettoyer les subscriptions
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkForEditMode() {
    const editingEvent = this.inventaireService.getEditingPurchaseEvent();
    if (editingEvent) {
      
      this.isEditMode = true;
      this.editingEventId = editingEvent.event_id;

      // Détecter si c'est un produit personnel
      if (editingEvent.product_id?.startsWith('perso-')) {
        this.productMode = 'personal';
        this.selectedPersonalProduct = {
          product_id: editingEvent.product_id,
          product_name: editingEvent.product_name,
          product_type: ''
        };
      } else {
        this.productMode = 'phyto';
        // Créer un objet PhytoProduct à partir des données de l'événement
        this.selectedProduct = {
          product_id: editingEvent.product_id,
          product_name: editingEvent.product_name,
          product_numaut: editingEvent.product_numaut || ''
        } as PhytoProduct;
        
        // Pré-compléter le formulaire de recherche
        this.searchForm.patchValue({
          searchTerm: this.selectedProduct ? this.phytoProductService.formatProductDisplay(this.selectedProduct) : ''
        });
      }
      
      // Pré-compléter le formulaire d'achat avec les données existantes
      this.purchaseForm.patchValue({
        adding_date: editingEvent.event_date,
        quantity: editingEvent.quantity_used,
        quantity_unit: editingEvent.quantity_used_unit || 'L',
        expiration_date: editingEvent.expiration_date || ''
      });
    }
  }

  private initializeForms() {
    // Formulaire de recherche de produit
    this.searchForm = this.fb.group({
      searchTerm: ['', Validators.minLength(2)]
    });

    // Formulaire d'achat
    this.purchaseForm = this.fb.group({
      adding_date: ['', Validators.required],
      quantity: ['', [Validators.required, Validators.min(0.001)]],
      quantity_unit: ['L', Validators.required],
      expiration_date: [''] // Retiré Validators.required - champ optionnel
    });

    // Formulaire de création de produit personnel
    this.personalProductForm = this.fb.group({
      product_name: ['', Validators.required],
      product_type: ['', Validators.required]
    });

    // Définir la date d'aujourd'hui par défaut
    const today = new Date().toISOString().split('T')[0];
    this.purchaseForm.patchValue({ adding_date: today });
  }

  private loadAllProducts(): void {
    this.isLoading = true;
    this.phytoProductService.getAllProducts().pipe(
      takeUntil(this.destroy$),
      catchError(() => {
        this.searchError = true;
        this.isLoading = false;
        return of([]);
      })
    ).subscribe(products => {
      this.allProducts = products;
      this.isLoading = false;
      this.applyPreselectedProductIfNeeded();
    });
  }

  /** Présélectionne le produit passé en @Input (ouverture depuis la page d'un produit). */
  private applyPreselectedProductIfNeeded(): void {
    if (this.isEditMode || !this.preselectedProductId || this.selectedProduct || this.selectedPersonalProduct) {
      return;
    }
    if (this.preselectedProductId.startsWith('perso-')) {
      const product = this.personalProducts.find(p => p.product_id === this.preselectedProductId);
      if (product) {
        this.productMode = 'personal';
        this.selectPersonalProduct(product);
      }
    } else {
      const product = this.allProducts.find(p => p.product_id === this.preselectedProductId);
      if (product) {
        this.productMode = 'phyto';
        this.selectProduct(product);
      }
    }
  }

  private setupProductSearch() {
    this.searchForm.get('searchTerm')?.valueChanges.pipe(
      takeUntil(this.destroy$),
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(term => {
      this.searchError = false;

      if (!term || term.length < 2) {
        this.productSuggestions = [];
        this.showSuggestions = false;
        return;
      }

      const searchLower = term.toLowerCase();
      this.productSuggestions = this.allProducts
        .filter(p =>
          p.product_name.toLowerCase().includes(searchLower) ||
          p.product_numaut.toLowerCase().includes(searchLower)
        )
        .slice(0, 15);

      this.showSuggestions = !this.selectedProduct;
    });
  }

  selectProduct(product: PhytoProduct) {
    this.selectedProduct = product;
    this.searchForm.get('searchTerm')?.setValue(product.product_name + ' - ' + product.product_numaut);
    this.showSuggestions = false;
    this.productSuggestions = [];
  }

  clearProductSelection() {
    this.selectedProduct = null;
    this.searchForm.get('searchTerm')?.setValue('');
    this.showSuggestions = false;
    this.productSuggestions = [];
  }

  onSearchFocus(): void {
    if (this.productSuggestions.length > 0) {
      this.showSuggestions = true;
    }
  }

  onSearchBlur(): void {
    // Attendre un peu avant de masquer pour permettre le clic sur une suggestion
    setTimeout(() => { this.showSuggestions = false; }, 200);
  }

  // ---- Personal product methods ----

  toggleProductMode(mode: 'phyto' | 'personal'): void {
    this.productMode = mode;
    this.selectedProduct = null;
    this.selectedPersonalProduct = null;
    this.showNewPersonalProductForm = false;
    this.personalProductForm.reset();
    if (mode === 'personal') {
      this.filterPersonalProducts();
    }
  }

  private setupPersonalProductSearch(): void {
    this.personalProductSearchControl.valueChanges.pipe(
      takeUntil(this.destroy$),
      debounceTime(200),
      distinctUntilChanged()
    ).subscribe(() => this.filterPersonalProducts());
  }

  private setupPersonalTypeSearch(): void {
    this.personalProductForm.get('product_type')!.valueChanges.pipe(
      takeUntil(this.destroy$),
      debounceTime(150),
      distinctUntilChanged()
    ).subscribe(value => {
      const term = (typeof value === 'string' ? value : '').toLowerCase().trim();
      const all = this.existingProductTypes;
      this.filteredTypeOptions = term ? all.filter(t => t.toLowerCase().includes(term)) : all;
    });
  }

  private loadPersonalProducts(): void {
    const url = `${environment.apiRegistre}/personal_products`;
    this.httpClient.get<any[]>(url).pipe(
      takeUntil(this.destroy$),
      catchError(() => of([]))
    ).subscribe(products => {
      this.personalProducts = (products || []).map(p => ({ product_id: p.productId, product_name: p.productName, product_type: p.productType }));
      this.filterPersonalProducts();
      this.filteredTypeOptions = this.existingProductTypes;
      this.applyPreselectedProductIfNeeded();
    });
  }

  private filterPersonalProducts(): void {
    const raw = this.personalProductSearchControl.value;
    const term = (typeof raw === 'string' ? raw : '').toLowerCase().trim();
    if (!term) {
      this.filteredPersonalProducts = [...this.personalProducts];
    } else {
      this.filteredPersonalProducts = this.personalProducts.filter(p =>
        p.product_name?.toLowerCase().includes(term) ||
        p.product_type?.toLowerCase().includes(term)
      );
    }
  }

  selectPersonalProduct(product: any): void {
    this.selectedPersonalProduct = product;
    this.showNewPersonalProductForm = false;
    this.showPersonalSuggestions = false;
    this.personalProductSearchControl.setValue('', { emitEvent: false });
  }

  clearPersonalProductSelection(): void {
    this.selectedPersonalProduct = null;
    this.personalProductSearchControl.setValue('', { emitEvent: false });
  }

  onPersonalSearchFocus(): void {
    this.showPersonalSuggestions = true;
  }

  onPersonalSearchBlur(): void {
    setTimeout(() => { this.showPersonalSuggestions = false; }, 200);
  }

  onTypeFocus(): void {
    this.showTypeSuggestions = true;
  }

  onTypeBlur(): void {
    setTimeout(() => { this.showTypeSuggestions = false; }, 200);
  }

  selectTypeOption(type: string): void {
    this.personalProductForm.get('product_type')?.setValue(type);
    this.showTypeSuggestions = false;
  }

  toggleUnitDropdown(): void {
    this.isUnitDropdownOpen = !this.isUnitDropdownOpen;
  }

  selectUnitOption(value: string): void {
    this.purchaseForm.get('quantity_unit')?.setValue(value);
    this.isUnitDropdownOpen = false;
  }

  get selectedUnitLabel(): string {
    const value = this.purchaseForm.get('quantity_unit')?.value;
    return this.unitOptions.find(o => o.value === value)?.label || '';
  }

  saveNewPersonalProduct(): void {
    if (this.personalProductForm.invalid || this.isSavingPersonalProduct) return;
    this.isSavingPersonalProduct = true;

    const productName = this.personalProductForm.get('product_name')?.value;
    const productType = this.personalProductForm.get('product_type')?.value;

    const url = `${environment.apiRegistre}/personal_products`;
    this.httpClient.post<any>(url, { productName, productType }).pipe(
      takeUntil(this.destroy$),
      catchError(() => {
        alert('Erreur lors de la création du produit. Veuillez réessayer.');
        return of(null);
      })
    ).subscribe(response => {
      this.isSavingPersonalProduct = false;
      if (response?.success) {
        const product = { product_id: response.productId, product_name: productName, product_type: productType };
        this.personalProducts.push(product);
        this.filterPersonalProducts();
        this.filteredTypeOptions = this.existingProductTypes;
        this.showNewPersonalProductForm = false;
        this.personalProductForm.reset();
        this.selectPersonalProduct(product);
      }
    });
  }

  cancelNewPersonalProduct(): void {
    this.showNewPersonalProductForm = false;
    this.personalProductForm.reset();
  }

  onSubmit() {
    const hasProduct = this.productMode === 'phyto' ? !!this.selectedProduct : !!this.selectedPersonalProduct;
    if (!hasProduct) {
      alert('Veuillez sélectionner un produit avant de continuer.');
      return;
    }

    if (this.purchaseForm.invalid) {
      alert('Veuillez remplir tous les champs requis.');
      return;
    }

    const purchaseData: PurchaseEntry = {
      adding_date: this.purchaseForm.get('adding_date')?.value,
      quantity: parseFloat(this.purchaseForm.get('quantity')?.value),
      quantity_unit: this.purchaseForm.get('quantity_unit')?.value,
      expiration_date: this.purchaseForm.get('expiration_date')?.value
    };

    // Déterminer l'identifiant et le nom du produit selon le mode
    const productId = this.productMode === 'phyto'
      ? this.selectedProduct!.product_id
      : this.selectedPersonalProduct!.product_id;
    const productName = this.productMode === 'phyto'
      ? this.selectedProduct!.product_name
      : this.selectedPersonalProduct!.product_name;
    const productNumaut = this.productMode === 'phyto'
      ? this.selectedProduct!.product_numaut
      : '';

    if (this.isEditMode) {
      this.inventaireService.updatePurchaseEvent(this.editingEventId, {
        event_date: purchaseData.adding_date,
        product_id: productId,
        product_name: productName,
        product_numaut: productNumaut,
        quantity: purchaseData.quantity,
        quantity_unit: purchaseData.quantity_unit,
        expiration_date: purchaseData.expiration_date
      }).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.saved.emit('Achat modifié avec succès.');
          this.inventaireService.clearEditingPurchaseEvent();
          this.resetForm();
          this.closePopup();
        },
        error: () => {
          alert('Erreur lors de la modification de l\'achat. Veuillez réessayer.');
        }
      });
    } else {
      this.inventaireService.saveProductPurchase(
        productId,
        productName,
        productNumaut,
        purchaseData
      ).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.saved.emit(`Achat de « ${productName} » ajouté à votre inventaire.`);
          this.resetForm();
          this.closePopup();
        },
        error: () => {
          alert('Erreur lors de la sauvegarde de l\'achat. Veuillez réessayer.');
        }
      });
    }
  }

  onCancel() {
    // Nettoyer les données d'édition si on annule
    if (this.isEditMode) {
      this.inventaireService.clearEditingPurchaseEvent();
    }
    this.closePopup();
  }

  private closePopup() {
    // Réactiver le scroll du body avant de fermer
    document.body.classList.remove('no-scroll');
    this.closeForm.emit();
  }

  private resetForm() {
    this.selectedProduct = null;
    this.selectedPersonalProduct = null;
    this.productMode = 'phyto';
    this.showNewPersonalProductForm = false;
    this.personalProductSearchControl.setValue('');
    this.personalProductForm.reset();
    this.searchForm.reset();
    this.purchaseForm.reset();
    const today = new Date().toISOString().split('T')[0];
    this.purchaseForm.patchValue({ 
      adding_date: today,
      quantity_unit: 'L'
    });
    this.showSuggestions = false;
    this.isEditMode = false;
    this.editingEventId = '';
  }

  // Utilitaires pour le template
  formatProductDisplay(product: PhytoProduct): string {
    return this.phytoProductService.formatProductDisplay(product);
  }
}
