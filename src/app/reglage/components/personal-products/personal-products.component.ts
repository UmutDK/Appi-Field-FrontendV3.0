import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, catchError, of, takeUntil } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-personal-products',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './personal-products.component.html',
  styleUrl: './personal-products.component.scss'
})
export class PersonalProductsComponent implements OnInit, OnDestroy {

  private httpClient = inject(HttpClient);
  private destroy$ = new Subject<void>();

  private readonly apiUrl = `${environment.apiRegistre}/personal_products`;

  products: any[] = [];
  isLoading = false;

  showProductForm = false;
  editingProduct: any = null;
  productForm = { product_name: '', product_type: '' };
  productSaving = false;
  productError = '';

  // Autocomplete for product_type
  readonly knownTypes: string[] = ['Engrais', 'Amendement', 'Biostimulant', 'Autre'];
  filteredTypeOptions: string[] = [];
  showTypeSuggestions = false;

  ngOnInit(): void {
    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadProducts(): void {
    this.isLoading = true;
    this.httpClient.get<any[]>(this.apiUrl).pipe(
      takeUntil(this.destroy$),
      catchError(() => of([]))
    ).subscribe(products => {
      this.products = (products || []).map(p => ({ product_id: p.productId, product_name: p.productName, product_type: p.productType }));
      this.isLoading = false;
    });
  }

  get existingTypes(): string[] {
    const all = this.products.map((p: any) => p.product_type).filter(Boolean);
    return [...new Set(all)] as string[];
  }

  openProductForm(): void {
    this.editingProduct = null;
    this.productForm = { product_name: '', product_type: '' };
    this.productError = '';
    this.filteredTypeOptions = [];
    this.showTypeSuggestions = false;
    this.showProductForm = true;
    document.body.classList.add('no-scroll');
  }

  editProduct(product: any): void {
    this.editingProduct = product;
    this.productForm = {
      product_name: product.product_name || '',
      product_type: product.product_type || ''
    };
    this.productError = '';
    this.filteredTypeOptions = [];
    this.showTypeSuggestions = false;
    this.showProductForm = true;
    document.body.classList.add('no-scroll');
  }

  closeProductForm(): void {
    this.showProductForm = false;
    this.editingProduct = null;
    this.productSaving = false;
    this.productError = '';
    this.showTypeSuggestions = false;
    document.body.classList.remove('no-scroll');
  }

  onTypeFocus(): void {
    this.filteredTypeOptions = this.getAllTypeOptions().filter(t =>
      !this.productForm.product_type || t.toLowerCase().includes(this.productForm.product_type.toLowerCase().trim())
    );
    this.showTypeSuggestions = true;
  }

  onTypeInput(event: Event): void {
    const term = (event.target as HTMLInputElement).value.toLowerCase().trim();
    this.filteredTypeOptions = this.getAllTypeOptions().filter(t => !term || t.toLowerCase().includes(term));
    this.showTypeSuggestions = true;
  }

  onTypeBlur(): void {
    // Delay to allow mousedown on suggestion to fire first
    setTimeout(() => { this.showTypeSuggestions = false; }, 150);
  }

  selectType(type: string): void {
    this.productForm.product_type = type;
    this.showTypeSuggestions = false;
    this.filteredTypeOptions = [];
  }

  private getAllTypeOptions(): string[] {
    const combined = [...new Set([...this.knownTypes, ...this.existingTypes])];
    return combined;
  }

  saveProduct(): void {
    if (!this.productForm.product_name.trim()) {
      this.productError = 'Le nom du produit est obligatoire.';
      return;
    }
    this.productSaving = true;
    this.productError = '';

    const payload = {
      productName: this.productForm.product_name.trim(),
      productType: this.productForm.product_type.trim() || 'Autre'
    };

    if (this.editingProduct) {
      const url = `${this.apiUrl}/${encodeURIComponent(this.editingProduct.product_id)}`;
      this.httpClient.put<any>(url, payload).pipe(
        catchError(() => {
          this.productError = 'Erreur lors de la mise à jour. Veuillez réessayer.';
          this.productSaving = false;
          return of(null);
        })
      ).subscribe(response => {
        if (response?.success) {
          const idx = this.products.findIndex(p => p.product_id === this.editingProduct.product_id);
          if (idx !== -1) {
            this.products[idx] = { ...this.products[idx], product_name: payload.productName, product_type: payload.productType };
            this.products = [...this.products];
          }
          this.closeProductForm();
        }
      });
    } else {
      this.httpClient.post<any>(this.apiUrl, payload).pipe(
        catchError(() => {
          this.productError = 'Erreur lors de la création. Veuillez réessayer.';
          this.productSaving = false;
          return of(null);
        })
      ).subscribe(response => {
        if (response?.success) {
          this.products = [...this.products, { product_id: response.productId, product_name: payload.productName, product_type: payload.productType }];
          this.closeProductForm();
        }
      });
    }
  }

  deleteProduct(product: any): void {
    if (!confirm(`Supprimer "${product.product_name}" ? Cette action est irréversible.`)) return;
    const url = `${this.apiUrl}/${encodeURIComponent(product.product_id)}`;
    this.httpClient.delete<any>(url).pipe(
      catchError(() => {
        alert('Erreur lors de la suppression. Veuillez réessayer.');
        return of(null);
      })
    ).subscribe(response => {
      if (response?.success) {
        this.products = this.products.filter(p => p.product_id !== product.product_id);
      }
    });
  }
}
