import { Component, OnInit, AfterViewInit, OnDestroy, Input, Output, EventEmitter, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { InventaireService, InventoryStock, RealInventoryData } from '../../services/inventaire.service';
import { CorrectionEntry } from '../../model/correction';

/**
 * Popup « Correction de stock » (voir updateToDo/01_inventoryCorrection.md) : ramène le stock
 * restant affiché d'un produit à 0 — quantité et sens proposés par défaut, modifiables.
 * Même structure que ppnu-ppnv, sans le choix du type et sans l'ancienne édition par index.
 */
@Component({
  selector: 'app-correction-stock',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './correction-stock.component.html',
  styleUrl: './correction-stock.component.scss'
})
export class CorrectionStockComponent implements OnInit, AfterViewInit, OnDestroy {
  /** Produit à présélectionner à l'ouverture (ex. bouton « Corriger le stock » de la fiche produit). */
  @Input() preselectedProductId: string | null = null;
  @Output() closeForm = new EventEmitter<void>();
  @ViewChild('popupContent') popupContent!: ElementRef;

  private inventaireService = inject(InventaireService);
  private destroy$ = new Subject<void>();
  private resizeObserver: ResizeObserver | null = null;

  // Liste des produits disponibles dans l'inventaire
  inventoryProducts: InventoryStock[] = [];

  // Formulaire
  selectedProductId: string = '';
  selectedMode: 'plus' | 'minus' = 'minus';
  selectedDate: string = '';
  quantity: number | null = 0;
  selectedUnit: string = 'L';

  // État du formulaire
  isSubmitting: boolean = false;
  submitError: string = '';

  isEditMode: boolean = false;
  editingEventId: string = '';
  /** Correction telle qu'enregistrée, pour l'aperçu « après correction » en modification. */
  private originalEntry: CorrectionEntry | null = null;

  readonly Math = Math;

  // Date max pour l'input (aujourd'hui)
  maxDate: string = new Date().toISOString().split('T')[0];

  modeOptions: { value: 'plus' | 'minus'; label: string; icon: string }[] = [
    { value: 'minus', label: 'Moins (retirer du stock)', icon: 'bi-dash-circle' },
    { value: 'plus',  label: 'Plus (ajouter au stock)',  icon: 'bi-plus-circle' },
  ];

  unitOptions = [
    { value: 'L', label: 'Litres (L)' },
    { value: 'Kg', label: 'Kilogrammes (Kg)' }
  ];

  // État des dropdowns custom (même pattern que ppnu-ppnv)
  isProductDropdownOpen: boolean = false;
  isUnitDropdownOpen: boolean = false;

  toggleProductDropdown(): void {
    this.isProductDropdownOpen = !this.isProductDropdownOpen;
    this.isUnitDropdownOpen = false;
  }

  selectProductOption(productId: string): void {
    this.selectedProductId = productId;
    this.isProductDropdownOpen = false;
    this.applyDefaults();
  }

  get selectedProductLabel(): string {
    const product = this.selectedProduct;
    return product ? `${product.product_name} - ${product.product_numaut}` : '-- Sélectionner un produit --';
  }

  selectMode(value: 'plus' | 'minus'): void {
    this.selectedMode = value;
  }

  toggleUnitDropdown(): void {
    this.isUnitDropdownOpen = !this.isUnitDropdownOpen;
    this.isProductDropdownOpen = false;
  }

  selectUnitOption(value: string): void {
    this.selectedUnit = value;
    this.isUnitDropdownOpen = false;
  }

  ngOnInit() {
    // Désactiver le scroll du body quand la popup s'ouvre
    document.body.classList.add('no-scroll');

    // Date d'aujourd'hui par défaut
    this.selectedDate = new Date().toISOString().split('T')[0];

    this.checkForEditMode();

    if (!this.isEditMode && this.preselectedProductId) {
      this.selectedProductId = this.preselectedProductId;
    }

    // Chargement asynchrone : les valeurs par défaut sont appliquées à la réception des produits
    this.loadInventoryProducts();
  }

  ngOnDestroy() {
    document.body.classList.remove('no-scroll');
    if (this.isEditMode) {
      this.inventaireService.clearEditingCorrectionEvent();
    }
    this.resizeObserver?.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewInit() {
    this.checkScrollNeeded();

    this.resizeObserver = new ResizeObserver(() => {
      this.checkScrollNeeded();
    });

    if (this.popupContent) {
      this.resizeObserver.observe(this.popupContent.nativeElement);
    }
  }

  private checkScrollNeeded() {
    if (this.popupContent && this.popupContent.nativeElement) {
      const element = this.popupContent.nativeElement;
      const maxHeight = window.innerHeight * 0.85;

      if (element.scrollHeight > maxHeight) {
        element.classList.add('scroll-needed');
      } else {
        element.classList.remove('scroll-needed');
      }
    }
  }

  private checkForEditMode() {
    const editing = this.inventaireService.getEditingCorrectionEvent();
    if (!editing) return;

    this.isEditMode = true;
    this.editingEventId = editing.eventId;
    this.originalEntry = { ...editing.entry };

    // Valeurs enregistrées, jamais les valeurs par défaut
    this.selectedProductId = editing.productId;
    this.selectedMode = editing.entry.mode;
    this.selectedDate = editing.entry.date;
    this.quantity = editing.entry.quantity;
    this.selectedUnit = editing.entry.unit || 'L';
  }

  private loadInventoryProducts() {
    this.inventaireService.getRealInventoryData().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data: RealInventoryData[]) => {
        if (data && data.length > 0 && data[0].inventory_stock) {
          // Le service recharge l'inventaire après chaque enregistrement : ne préremplir qu'une fois
          const firstLoad = this.inventoryProducts.length === 0;
          this.inventoryProducts = data[0].inventory_stock;
          if (firstLoad) this.applyDefaults();
        }
      },
      error: () => {}
    });
  }

  /** Propose le sens et la quantité qui ramènent le stock restant affiché à 0. */
  private applyDefaults(): void {
    if (this.isEditMode) return; // ne jamais écraser une correction existante
    const p = this.selectedProduct;
    if (!p) return;
    const remaining = this.inventaireService.getRemainingQuantity(p);
    this.selectedMode = remaining < 0 ? 'plus' : 'minus';
    this.quantity = Math.round(Math.abs(remaining) * 100) / 100; // évite les 2.9999999
    this.selectedUnit = p.quantity_unit || 'L';
  }

  get selectedProduct(): InventoryStock | undefined {
    return this.inventoryProducts.find(p => p.product_id === this.selectedProductId);
  }

  /** Stock restant actuel du produit choisi (avant la correction en cours de saisie). */
  get currentRemaining(): number | null {
    const p = this.selectedProduct;
    return p ? this.inventaireService.getRemainingQuantity(p) : null;
  }

  /** Le produit est déjà à 0 (message affiché en création uniquement). */
  get isAlreadyZero(): boolean {
    return !this.isEditMode && this.currentRemaining !== null && Math.abs(this.currentRemaining) < 0.005;
  }

  get remainingAfter(): number | null {
    const p = this.selectedProduct;
    if (!p) return null;
    let base = this.inventaireService.getRemainingQuantity(p);
    // En modification, retirer l'effet de la correction en cours d'édition
    if (this.isEditMode && this.originalEntry) {
      base -= this.originalEntry.mode === 'plus' ? this.originalEntry.quantity : -this.originalEntry.quantity;
    }
    const qty = this.quantity || 0;
    return base + (this.selectedMode === 'plus' ? qty : -qty);
  }

  get isLargeNegativeCorrection(): boolean {
    return this.selectedMode === 'minus' && this.selectedUnit === 'L' && (this.quantity || 0) > 5;
  }

  get isFormValid(): boolean {
    return this.selectedProductId !== '' &&
           this.selectedDate !== '' &&
           (this.quantity || 0) > 0 &&
           this.selectedUnit !== '' &&
           !!this.selectedMode;
  }

  onSubmit() {
    if (!this.isFormValid || this.isSubmitting) {
      return;
    }

    const selectedProduct = this.selectedProduct;
    if (!selectedProduct) {
      return;
    }

    this.isSubmitting = true;
    this.submitError = '';

    const entry: CorrectionEntry = {
      date: this.selectedDate,
      mode: this.selectedMode,
      quantity: this.quantity || 0,
      unit: this.selectedUnit,
    };

    const request$ = this.isEditMode
      ? this.inventaireService.updateCorrectionById(selectedProduct.product_id, this.editingEventId, entry)
      : this.inventaireService.addCorrection(selectedProduct.product_id, entry);

    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        if (this.isEditMode) this.inventaireService.clearEditingCorrectionEvent();
        this.resetForm();
        this.closePopup();
      },
      error: () => {
        this.isSubmitting = false;
        this.submitError = "La correction n'a pas pu être enregistrée. Vérifiez votre connexion et réessayez.";
      }
    });
  }

  private resetForm() {
    this.selectedProductId = '';
    this.selectedMode = 'minus';
    this.selectedDate = new Date().toISOString().split('T')[0];
    this.quantity = 0;
    this.selectedUnit = 'L';
    this.isSubmitting = false;
    this.isEditMode = false;
    this.editingEventId = '';
    this.originalEntry = null;
  }

  onCancel() {
    if (this.isEditMode) {
      this.inventaireService.clearEditingCorrectionEvent();
    }
    this.resetForm();
    this.closePopup();
  }

  private closePopup() {
    document.body.classList.remove('no-scroll');
    this.closeForm.emit();
  }
}
