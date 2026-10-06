import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of, catchError, timeout } from 'rxjs';
import { PhytoProduct } from '../model/phyto-product.interface';
import { RegistreService } from '../../registre/services/registre.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class PhytoProductService {
  private registreService = inject(RegistreService);
  private http = inject(HttpClient);

  /**
   * Récupérer tous les produits (catalogue complet des produits actuellement homologués)
   * @deprecated Utiliser searchProducts() à la place — beaucoup plus rapide
   */
  getAllProducts(): Observable<PhytoProduct[]> {
    return this.registreService.getVolumeDeBouillipreparer();
  }

  /**
   * Rechercher des produits par nom ou numéro d'autorisation.
   * Filtrage effectué côté serveur (GET /index/phytoweb_products/search).
   */
  searchProducts(searchTerm: string): Observable<PhytoProduct[]> {
    if (!searchTerm || searchTerm.length < 2) {
      return of([]);
    }

    return this.http.get<any[]>(`${environment.apiRegistre}/index/phytoweb_products/search`, {
      params: { q: searchTerm, limit: '15' }
    }).pipe(
      map(products => (products || []).map(p => this.mapToPhytoProduct(p))),
      catchError(error => {
        console.error('Erreur recherche produits:', error);
        return of([]);
      })
    );
  }

  /**
   * Mapper les données de l'API vers l'interface PhytoProduct.
   * Accepte à la fois la forme brute du serveur (idAct/numAut/productName) et la
   * forme déjà traduite par RegistreService (product_id/product_name/product_numaut).
   */
  private mapToPhytoProduct(apiProduct: any): PhytoProduct {
    return {
      product_id: apiProduct.product_id || apiProduct.idAct || '',
      product_name: apiProduct.product_name || apiProduct.productName || '',
      product_numaut: apiProduct.product_numaut || apiProduct.numAut || '',
      product_statut: '',
      product_type: apiProduct.product_type || apiProduct.productType || '',
      list_sa: [],
      user_group: '',
      bio: false,
      global_max_app: 0,
      surf_global_rate_max: '',
      surf_global_rate_max_unit: '',
      vol_global_rate_max: '',
      vol_global_rate_max_unit: '',
      date_act: '',
      date_act_to: '',
      use_tolerated_to: '',
      crop_use: []
    };
  }

  /**
   * Récupérer un produit par son ID
   */
  getProductById(productId: string): Observable<PhytoProduct | undefined> {
    return this.getAllProducts().pipe(
      timeout(30000),
      map(products => products.find(product => product.product_id === productId)),
      catchError(error => {
        console.error('Erreur récupération produit:', error);
        return of(undefined);
      })
    );
  }

  /**
   * Formater l'affichage d'un produit pour les suggestions
   */
  formatProductDisplay(product: PhytoProduct): string {
    return `${product.product_name} - ${product.product_numaut}`;
  }
}
