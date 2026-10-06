import { Component, OnInit, AfterViewInit, OnDestroy, Input, Output, EventEmitter, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { InventaireService, RealInventoryData } from '../../services/inventaire.service';
import { InventoryStock } from '../../model/inventory-entry';
import { PpnuPpnvEntry } from '../../model/ppnu-ppnv';

@Component({
  selector: 'app-ppnu-ppnv',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ppnu-ppnv.component.html',
  styleUrl: './ppnu-ppnv.component.scss'
})
export class PpnuPpnvComponent implements OnInit, AfterViewInit, OnDestroy {
  /** Produit à présélectionner à l'ouverture (ex. ouverture depuis la page d'un produit). */
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
  selectedType: 'PPNU' | 'PPNV' = 'PPNU';
  selectedDate: string = '';
  quantity: number = 0;
  selectedUnit: string = 'L';
  
  // État du formulaire
  isSubmitting: boolean = false;

  isEditMode: boolean = false;
  editingEntryIndex: number = -1;
  editingEventId: string = ''; // Nouveau: pour les événements
  
  // Date max pour l'input (aujourd'hui)
  maxDate: string = new Date().toISOString().split('T')[0];
  
  // Options disponibles
  typeOptions = [
    { value: 'PPNU', label: 'PPNU' },
    { value: 'PPNV', label: 'PPNV' }
  ];
  
  unitOptions = [
    { value: 'L', label: 'Litres (L)' },
    { value: 'Kg', label: 'Kilogrammes (Kg)' }
  ];

  // État des dropdowns custom (remplacent les <select> natifs, même pattern que
  // parcelles.component — voir src/styles/_popup-system.scss pour le style partagé).
  isProductDropdownOpen: boolean = false;
  isTypeDropdownOpen: boolean = false;
  isUnitDropdownOpen: boolean = false;

  toggleProductDropdown(): void {
    this.isProductDropdownOpen = !this.isProductDropdownOpen;
    this.isTypeDropdownOpen = false;
    this.isUnitDropdownOpen = false;
  }

  selectProductOption(productId: string): void {
    this.selectedProductId = productId;
    this.isProductDropdownOpen = false;
  }

  get selectedProductLabel(): string {
    const product = this.selectedProduct;
    return product ? `${product.product_name} - ${product.product_numaut}` : '-- Sélectionner un produit --';
  }

  toggleTypeDropdown(): void {
    this.isTypeDropdownOpen = !this.isTypeDropdownOpen;
    this.isProductDropdownOpen = false;
    this.isUnitDropdownOpen = false;
  }

  selectTypeOption(value: 'PPNU' | 'PPNV'): void {
    this.selectedType = value;
    this.isTypeDropdownOpen = false;
  }

  get selectedTypeLabel(): string {
    return this.typeOptions.find(o => o.value === this.selectedType)?.label || '';
  }

  toggleUnitDropdown(): void {
    this.isUnitDropdownOpen = !this.isUnitDropdownOpen;
    this.isProductDropdownOpen = false;
    this.isTypeDropdownOpen = false;
  }

  selectUnitOption(value: string): void {
    this.selectedUnit = value;
    this.isUnitDropdownOpen = false;
  }

  get selectedUnitLabel(): string {
    return this.unitOptions.find(o => o.value === this.selectedUnit)?.label || '';
  }

  ngOnInit() {
    // Désactiver le scroll du body quand la popup s'ouvre
    document.body.classList.add('no-scroll');
    
    this.loadInventoryProducts();
    // Définir la date d'aujourd'hui par défaut
    this.selectedDate = new Date().toISOString().split('T')[0];


    // Vérifier s'il y a des données d'édition
    this.checkForEditMode();

    // Présélectionner le produit si on arrive depuis la page d'un produit spécifique
    if (!this.isEditMode && this.preselectedProductId) {
      this.selectedProductId = this.preselectedProductId;
    }
  }

  ngOnDestroy() {
    document.body.classList.remove('no-scroll');
    if (this.isEditMode) {
      if (this.editingEventId) {
        this.inventaireService.clearEditingPpnuPpnvEvent();
      } else {
        this.inventaireService.clearEditingPpnuPpnv();
      }
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
      const maxHeight = window.innerHeight * 0.85; // 85vh en pixels pour les composants spécifiques
      
      if (element.scrollHeight > maxHeight) {
        element.classList.add('scroll-needed');
      } else {
        element.classList.remove('scroll-needed');
      }
    }
  }
  
  private checkForEditMode() {
    // Vérifier d'abord le nouveau format avec event_id
    const editingEventData = this.inventaireService.getEditingPpnuPpnvEvent();
    if (editingEventData) {
      
      this.isEditMode = true;
      this.editingEventId = editingEventData.eventId;
      
      // Pré-completer les champs avec les données existantes
      this.selectedProductId = editingEventData.productId;
      this.selectedType = editingEventData.entry.type;
      this.selectedDate = editingEventData.entry.date;
      this.quantity = editingEventData.entry.quantity;
      this.selectedUnit = editingEventData.entry.unit || 'L';
      return;
    }

    // Fallback vers l'ancien format avec index (compatibilité)
    const editingData = this.inventaireService.getEditingPpnuPpnv();
    if (editingData) {
      
      this.isEditMode = true;
      this.editingEntryIndex = editingData.index;
      
      // Pré-completer les champs avec les données existantes
      this.selectedProductId = editingData.productId;
      this.selectedType = editingData.entry.type;
      this.selectedDate = editingData.entry.date;
      this.quantity = editingData.entry.quantity;
      this.selectedUnit = editingData.entry.unit || 'L';
    }
  }

  private loadInventoryProducts() {
    this.inventaireService.getRealInventoryData().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data: RealInventoryData[]) => {
        if (data && data.length > 0 && data[0].inventory_stock) {
          this.inventoryProducts = data[0].inventory_stock;
        }
      },
      error: () => {}
    });
  }

  get selectedProduct(): InventoryStock | undefined {
    return this.inventoryProducts.find(p => p.product_id === this.selectedProductId);
  }

  get isFormValid(): boolean {
    return this.selectedProductId !== '' && 
           this.selectedDate !== '' && 
           this.quantity > 0 && 
           this.selectedUnit !== '';
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

    const ppnuPpnvEntry: PpnuPpnvEntry = {
      date: this.selectedDate,
      type: this.selectedType,
      quantity: this.quantity,
      unit: this.selectedUnit,
      // Inclure les informations du produit pour éviter "Produit inconnu"
      product_name: selectedProduct.product_name,
      product_numaut: selectedProduct.product_numaut
    };


    if (this.isEditMode) {
      
      if (this.editingEventId) {
        // Nouveau format : mise à jour par event_id
        this.inventaireService.updatePpnuPpnvEventById(selectedProduct.product_id, this.editingEventId, ppnuPpnvEntry).pipe(takeUntil(this.destroy$)).subscribe({
          next: (response: any) => {
            this.inventaireService.clearEditingPpnuPpnvEvent();
            this.resetForm();
            this.closePopup();
          },
          error: (error: any) => {
            this.isSubmitting = false;
          }
        });
      } else {
        // Ancien format : mise à jour par index (fallback)
        this.inventaireService.updatePpnuPpnvEntry(selectedProduct.product_id, this.editingEntryIndex, ppnuPpnvEntry).pipe(takeUntil(this.destroy$)).subscribe({
          next: (response: any) => {
            this.inventaireService.clearEditingPpnuPpnv();
            this.resetForm();
            this.closePopup();
          },
          error: (error: any) => {
            this.isSubmitting = false;
          }
        });
      }
    } else {
      // Mode ajout : créer une nouvelle entrée
      this.inventaireService.addPpnuPpnvEntry(selectedProduct.product_id, ppnuPpnvEntry).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          this.resetForm();
          this.closePopup();
        },
        error: (error: any) => {
          this.isSubmitting = false;
        }
      });
    }
  }

  private resetForm() {
    this.selectedProductId = '';
    this.selectedType = 'PPNU';
    this.selectedDate = new Date().toISOString().split('T')[0];
    this.quantity = 0;
    this.selectedUnit = 'L';
    this.isSubmitting = false;
    this.isEditMode = false;
    this.editingEntryIndex = -1;
    this.editingEventId = '';
  }

  onCancel() {
    // Nettoyer les données d'édition si on annule
    if (this.isEditMode) {
      if (this.editingEventId) {
        this.inventaireService.clearEditingPpnuPpnvEvent();
      } else {
        this.inventaireService.clearEditingPpnuPpnv();
      }
    }
    this.resetForm();
    this.closePopup();
  }

  private closePopup() {
    // Réactiver le scroll du body avant de fermer
    document.body.classList.remove('no-scroll');
    this.closeForm.emit();
  }
}
