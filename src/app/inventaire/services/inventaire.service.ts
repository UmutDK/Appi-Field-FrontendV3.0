import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Inventaire } from '../model/inventaire';
import { PpnuPpnvEntry } from '../model/ppnu-ppnv';
import { CorrectionEntry } from '../model/correction';
import { environment } from '../../../environments/environment';
import { Observable, tap, catchError, of, map, combineLatest } from 'rxjs';
import { MandatWorkspaceService } from '../../core/services/mandat-workspace.service';
import { RegistreService } from '../../registre/services/registre.service';

// Interface pour les données d'inventaire réelles
export interface RealInventoryData {
  inventory_id: string;
  exploitation_id: string;
  event_history: EventHistory[];
  inventory_stock: InventoryStock[];
}

export interface EventHistory {
  event_id: string;
  event_type: 'treatment' | 'purchase' | 'ppnu_entry' | 'ppnv_entry' | 'correction'; // Type d'événement : treatment, purchase, ppnu_entry, ppnv_entry ou correction
  correction_mode?: 'plus' | 'minus'; // Sens de la correction (quantité toujours positive)
  event_date: string;
  event_crop: string;
  product_id: string;
  product_name: string;
  product_numaut: string;
  quantity_used: number;
  quantity_used_unit?: string; // Unité de quantité (L, Kg, etc.)
  expiration_date?: string; // Date d'expiration (seulement pour les achats)
}

export interface InventoryStock {
  product_id: string;
  product_name: string;
  product_numaut: string;
  quantity_used: number;
  quantity_buyed: number;
  quantity_ppnu: number;
  quantity_ppnv: number;
  quantity_correction: number; // net signé des corrections (+ ajout, − retrait), calculé sur les quantités brutes
  quantity_unit: string;
  ppnu_ppnv: any[];
  entries?: PurchaseEntry[];
  current_stock?: number;
  total_purchased?: number;
  total_used?: number;
}

export interface PurchaseEntry {
  adding_date: string;
  quantity: number;
  quantity_unit: 'L' | 'Kg';
  expiration_date: string;
}

// ===== Import Excel d'achats (updateToDo/08) =====
export interface ImportRowIssue { field: string; message: string; }
export interface ImportProduct { productId: string; numAut: string; productName: string; }
export interface ImportPreviewRow {
  rowNumber: number;
  input: { numAut: string; productName: string; quantity: string; unit: string; date: string };
  product: ImportProduct | null;
  quantity: number | null;
  quantityUnit: 'L' | 'Kg' | null;
  operationDate: string | null;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
  suggestions: ImportProduct[];
  status: 'ok' | 'warning' | 'error';
}
export interface ImportPreview {
  rows: ImportPreviewRow[];
  summary: { total: number; ok: number; warning: number; error: number };
}
export interface ImportConfirmRow {
  rowNumber: number;
  productId: string;
  quantity: number;
  quantityUnit: 'L' | 'Kg';
  operationDate: string;
}

/** Traduit une opération d'inventaire API (operationType/operationDate/quantity...) vers EventHistory (legacy). */
function eventTypeFromApi(operationType: string): EventHistory['event_type'] {
  if (operationType === 'purchase') return 'purchase';
  if (operationType === 'ppnu') return 'ppnu_entry';
  if (operationType === 'ppnv') return 'ppnv_entry';
  if (operationType === 'correction') return 'correction';
  return 'treatment'; // treatment / loss / adjustment_out
}

function eventTypeToApi(eventType: string): string {
  if (eventType === 'purchase') return 'purchase';
  if (eventType === 'ppnu_entry') return 'ppnu';
  if (eventType === 'ppnv_entry') return 'ppnv';
  if (eventType === 'correction') return 'correction';
  return 'treatment';
}

/**
 * Normalise le nom d'unité renvoyé par le serveur ('l'/'kg', tel que stocké en base dans
 * unitsIndex.unitName) vers la casse affichée/attendue par les formulaires d'inventaire
 * ('L'/'Kg', cf. les <option> de ppnu-ppnv et achat-de-ppp) — sans quoi le select d'édition
 * ne pré-sélectionne rien (comparaison de valeur sensible à la casse).
 */
function normalizeQuantityUnit(unit: string | undefined | null): string {
  if (!unit) return 'L';
  const lower = unit.toLowerCase();
  if (lower === 'l') return 'L';
  if (lower === 'kg') return 'Kg';
  return unit;
}

@Injectable()
export class InventaireService {

  http = inject(HttpClient);
  private mandatWorkspace = inject(MandatWorkspaceService);
  private registreService = inject(RegistreService);
  signalInventaireServeur = signal<Inventaire[]>([]);

  // Nouveaux signaux pour les vraies données
  realInventorySignal = signal<RealInventoryData[]>([]);
  selectedProductSignal = signal<InventoryStock | null>(null);

  /** @deprecated Écran legacy sans affichage réel — conservé en no-op pour compatibilité d'appel. */
  getInventaire(): Observable<Inventaire[]> {
    return of([]);
  }

  /**
   * Récupère l'inventaire (GET /inventories, déjà pré-agrégé côté serveur par produit :
   * stock utilisable, ppnuStock, ppnvStock, historique des mouvements) et le traduit
   * vers la forme legacy (event_history / inventory_stock) attendue par les composants.
   * Résout les noms de produits (non stockés sur les mouvements côté serveur) via le
   * catalogue Phytoweb + les produits personnels.
   */
  getRealInventoryData(): Observable<RealInventoryData[]> {
    return combineLatest([
      this.http.get<any[]>(`${environment.apiRegistre}/inventories`),
      this.http.get<any[]>(`${environment.apiRegistre}/personal_products`).pipe(catchError(() => of([]))),
      this.registreService.getVolumeDeBouillipreparer().pipe(catchError(() => of([])))
    ]).pipe(
      map(([products, personalProducts, phytowebProducts]) => {
        const nameById = new Map<string, { name: string; numaut: string }>();
        (personalProducts || []).forEach((p: any) => nameById.set(p.productId, { name: p.productName, numaut: '' }));
        (phytowebProducts || []).forEach((p: any) => nameById.set(p.product_id, { name: p.product_name, numaut: p.product_numaut }));

        return this.mapToRealInventoryData(products || [], nameById);
      }),
      tap(data => {
        this.realInventorySignal.set(data);

        if (data[0]?.inventory_stock?.length) {
          const sorted = this.getSortedProducts(data[0].inventory_stock);
          if (sorted.length > 0) {
            this.selectedProductSignal.set(sorted[0]);
          }
        }
      })
    );
  }

  private mapToRealInventoryData(
    products: any[],
    nameById: Map<string, { name: string; numaut: string }>
  ): RealInventoryData[] {
    const eventHistory: EventHistory[] = [];

    const inventoryStock: InventoryStock[] = products.map(p => {
      const info = nameById.get(p.productId);
      // p.productName vient de phytoTreatmentsComposition (dénormalisé à l'écriture du traitement) :
      // fiable même quand productId ne correspond à aucun catalogue (Phytoweb ou personnel) résolu ici.
      const productName = p.productName || info?.name || 'Produit inconnu';
      const productNumaut = p.productNumAut || info?.numaut || '';

      let quantityBuyed = 0;
      let quantityUsed = 0;
      let quantityCorrection = 0;
      let quantityUnit = 'L';

      (p.operations || []).forEach((op: any) => {
        quantityUnit = normalizeQuantityUnit(op.quantityUnit) || quantityUnit;
        eventHistory.push({
          event_id: op.inventoryOperationId,
          event_type: eventTypeFromApi(op.operationType),
          event_date: op.operationDate,
          event_crop: '',
          product_id: p.productId,
          product_name: productName,
          product_numaut: productNumaut,
          quantity_used: op.quantity,
          quantity_used_unit: normalizeQuantityUnit(op.quantityUnit),
          correction_mode: op.correctionMode || undefined,
        });

        if (op.operationType === 'purchase') {
          quantityBuyed += op.quantity || 0;
        } else if (op.operationType === 'correction') {
          // Pas p.correctionStock : le serveur le calcule en quantités standardisées, l'écran en quantités brutes
          const qty = op.quantity || 0;
          quantityCorrection += op.correctionMode === 'plus' ? qty : -qty;
        } else if (op.operationType !== 'ppnu' && op.operationType !== 'ppnv') {
          quantityUsed += op.quantity || 0;
        }
      });

      return {
        product_id: p.productId,
        product_name: productName,
        product_numaut: productNumaut,
        quantity_used: quantityUsed,
        quantity_buyed: quantityBuyed,
        quantity_ppnu: p.ppnuStock || 0,
        quantity_ppnv: p.ppnvStock || 0,
        quantity_correction: quantityCorrection,
        quantity_unit: quantityUnit,
        ppnu_ppnv: [],
        current_stock: p.stock, // calculé côté serveur, exclut déjà PPNU/PPNV
        total_purchased: quantityBuyed,
        total_used: quantityUsed,
      };
    });

    return [{
      inventory_id: 'consolidated',
      exploitation_id: 'default',
      event_history: eventHistory,
      inventory_stock: inventoryStock,
    }];
  }

  // Trier les produits par ordre alphabétique
  getSortedProducts(products: InventoryStock[]): InventoryStock[] {
    if (!products || !Array.isArray(products)) {
      return [];
    }

    return products
      .filter(product =>
        product &&
        product.product_id &&
        product.product_id.trim() !== '' &&
        product.product_name &&
        product.product_name !== 'Produit inconnu' &&
        product.product_name.trim() !== ''
      )
      .sort((a, b) => a.product_name.localeCompare(b.product_name));
  }

  // Sélectionner un produit
  selectProduct(product: InventoryStock) {
    this.selectedProductSignal.set(product);
  }

  // Obtenir les utilisations pour un produit spécifique (tous les événements par défaut)
  getProductUsages(productId: string, eventHistory: EventHistory[], eventType?: EventHistory['event_type']): EventHistory[] {
    return eventHistory.filter(event =>
      event.product_id === productId &&
      event.event_date &&
      event.quantity_used > 0 &&
      (!eventType || event.event_type === eventType)
    );
  }

  getProductPurchases(productId: string, eventHistory: EventHistory[]): EventHistory[] {
    return this.getProductUsages(productId, eventHistory, 'purchase');
  }

  getProductTreatments(productId: string, eventHistory: EventHistory[]): EventHistory[] {
    return this.getProductUsages(productId, eventHistory, 'treatment');
  }

  getProductPpnuEvents(productId: string, eventHistory: EventHistory[]): EventHistory[] {
    return this.getProductUsages(productId, eventHistory, 'ppnu_entry');
  }

  getProductPpnvEvents(productId: string, eventHistory: EventHistory[]): EventHistory[] {
    return this.getProductUsages(productId, eventHistory, 'ppnv_entry');
  }

  // Calculer la quantité restante — le serveur la fournit déjà (current_stock)
  calculateRemainingQuantity(product: InventoryStock): number {
    if (typeof product.current_stock === 'number') {
      return product.current_stock;
    }
    return product.quantity_buyed - product.quantity_used;
  }

  /**
   * Quantité restante affichée par l'écran inventaire (quantités brutes, PPNU/PPNV déduits,
   * corrections incluses). À utiliser partout plutôt que calculateRemainingQuantity, qui
   * renvoie le stock serveur sans déduction des PPNU/PPNV.
   */
  getRemainingQuantity(p: InventoryStock): number {
    return p.quantity_buyed - p.quantity_used - p.quantity_ppnu - p.quantity_ppnv + (p.quantity_correction || 0);
  }

  // Sauvegarder un achat de PPP sur le serveur
  saveProductPurchase(productId: string, productName: string, productNumaut: string, purchase: PurchaseEntry): Observable<any> {
    if (!productId || !productName || !purchase.quantity || purchase.quantity <= 0) {
      throw new Error('Données invalides pour l\'achat de PPP');
    }

    return this.http.post(`${environment.apiRegistre}/inventories`, {
      productId,
      operationType: 'purchase',
      operationDate: purchase.adding_date,
      quantity: purchase.quantity,
      quantityUnit: purchase.quantity_unit,
    }).pipe(
      tap(() => this.getRealInventoryData().subscribe()),
      catchError((error: any) => { throw error; })
    );
  }

  public manualCleanInventory(): void {
    // Sans objet : le stock est toujours recalculé à partir des mouvements réels côté serveur.
  }

  // Ajouter une entrée PPNU/PPNV pour un produit spécifique
  addPpnuPpnvEntry(productId: string, entry: PpnuPpnvEntry): Observable<any> {
    return this.http.post(`${environment.apiRegistre}/inventories`, {
      productId,
      operationType: entry.type === 'PPNU' ? 'ppnu' : 'ppnv',
      operationDate: entry.date,
      quantity: entry.quantity,
      quantityUnit: entry.unit,
    }).pipe(
      tap(() => this.getRealInventoryData().subscribe()),
      catchError((error: any) => { throw error; })
    );
  }

  // Ajouter une correction de stock (quantité toujours > 0, le sens est porté par correctionMode)
  addCorrection(productId: string, entry: CorrectionEntry): Observable<any> {
    return this.http.post(`${environment.apiRegistre}/inventories`, {
      productId,
      operationType: 'correction',
      correctionMode: entry.mode,
      operationDate: entry.date,
      quantity: entry.quantity,
      quantityUnit: entry.unit,
    }).pipe(
      tap(() => this.getRealInventoryData().subscribe()),
      catchError((error: any) => { throw error; })
    );
  }

  updateCorrectionById(productId: string, eventId: string, entry: CorrectionEntry): Observable<any> {
    return this.http.put(`${environment.apiRegistre}/inventories/${eventId}`, {
      productId,
      operationType: 'correction',
      correctionMode: entry.mode,
      operationDate: entry.date,
      quantity: entry.quantity,
      quantityUnit: entry.unit,
    }).pipe(
      tap(() => this.getRealInventoryData().subscribe()),
      catchError((error: any) => { throw error; })
    );
  }

  deleteCorrectionById(eventId: string): Observable<any> {
    return this.deleteInventoryOperation(eventId);
  }

  // ============================================================================
  // GESTION DE L'ÉDITION (état local, pas d'appel serveur)
  // ============================================================================

  private editingPpnuPpnvData: { entry: any; index: number; productId: string } | null = null;
  private editingPpnuPpnvEvent: { entry: any; eventId: string; productId: string } | null = null;
  private editingPurchaseEvent: EventHistory | null = null;
  private editingCorrectionEvent: { entry: CorrectionEntry; eventId: string; productId: string } | null = null;

  setEditingCorrectionEvent(entry: CorrectionEntry, eventId: string, productId: string): void {
    this.editingCorrectionEvent = { entry, eventId, productId };
  }

  getEditingCorrectionEvent(): { entry: CorrectionEntry; eventId: string; productId: string } | null {
    return this.editingCorrectionEvent;
  }

  clearEditingCorrectionEvent(): void {
    this.editingCorrectionEvent = null;
  }

  /** @deprecated Chemin de compatibilité sans event_id réel — utiliser *Event(). */
  setEditingPpnuPpnv(entry: any, index: number, productId: string | undefined): void {
    if (!productId) return;
    this.editingPpnuPpnvData = { entry, index, productId };
  }

  getEditingPpnuPpnv(): { entry: any; index: number; productId: string } | null {
    return this.editingPpnuPpnvData;
  }

  clearEditingPpnuPpnv(): void {
    this.editingPpnuPpnvData = null;
  }

  setEditingPpnuPpnvEvent(entry: any, eventId: string, productId: string): void {
    this.editingPpnuPpnvEvent = { entry, eventId, productId };
  }

  getEditingPpnuPpnvEvent(): { entry: any; eventId: string; productId: string } | null {
    return this.editingPpnuPpnvEvent;
  }

  clearEditingPpnuPpnvEvent(): void {
    this.editingPpnuPpnvEvent = null;
  }

  /** @deprecated Les mouvements ont désormais un inventoryOperationId réel — utiliser deletePpnuPpnvEventById. */
  deletePpnuPpnvEntry(productId: string, entryIndex: number): Observable<any> {
    return of({ success: false, error: 'Obsolète : utiliser deletePpnuPpnvEventById' });
  }

  /** @deprecated Les mouvements ont désormais un inventoryOperationId réel — utiliser updatePpnuPpnvEventById. */
  updatePpnuPpnvEntry(productId: string, entryIndex: number, updatedEntry: PpnuPpnvEntry): Observable<any> {
    return of({ success: false, error: 'Obsolète : utiliser updatePpnuPpnvEventById' });
  }

  deletePpnuPpnvEventById(productId: string, eventId: string): Observable<any> {
    return this.deleteInventoryOperation(eventId);
  }

  updatePpnuPpnvEventById(productId: string, eventId: string, updatedEntry: PpnuPpnvEntry): Observable<any> {
    return this.http.put(`${environment.apiRegistre}/inventories/${eventId}`, {
      productId,
      operationType: updatedEntry.type === 'PPNU' ? 'ppnu' : 'ppnv',
      operationDate: updatedEntry.date,
      quantity: updatedEntry.quantity,
      quantityUnit: updatedEntry.unit,
    }).pipe(
      tap(() => this.getRealInventoryData().subscribe()),
      catchError((error: any) => { throw error; })
    );
  }

  // Méthodes pour les événements d'achat
  setEditingPurchaseEvent(purchaseEvent: EventHistory): void {
    this.editingPurchaseEvent = purchaseEvent;
  }

  getEditingPurchaseEvent(): EventHistory | null {
    return this.editingPurchaseEvent;
  }

  clearEditingPurchaseEvent(): void {
    this.editingPurchaseEvent = null;
  }

  private deleteInventoryOperation(eventId: string): Observable<any> {
    return this.http.delete(`${environment.apiRegistre}/inventories`, { params: { inventoryOperationId: eventId } }).pipe(
      tap(() => this.getRealInventoryData().subscribe()),
      catchError((error: any) => { throw error; })
    );
  }

  deletePurchaseEvent(eventId: string): Observable<any> {
    return this.deleteInventoryOperation(eventId);
  }

  updatePurchaseEvent(eventId: string, updatedEventData: any): Observable<any> {
    return this.http.put(`${environment.apiRegistre}/inventories/${eventId}`, {
      productId: updatedEventData.product_id,
      operationType: 'purchase',
      operationDate: updatedEventData.event_date,
      quantity: updatedEventData.quantity,
      quantityUnit: updatedEventData.quantity_unit,
    }).pipe(
      tap(() => this.getRealInventoryData().subscribe()),
      catchError((error: any) => { throw error; })
    );
  }

  // ============================================================================
  // IMPORT EXCEL D'ACHATS
  // ============================================================================

  /** Modèle Excel vierge : via HttpClient (le token est requis, un simple lien recevrait un 401). */
  downloadImportTemplate(): Observable<Blob> {
    return this.http.get(`${environment.apiRegistre}/inventories/import/template`, { responseType: 'blob' }).pipe(
      tap(blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'modele_import_achats.xlsx';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      })
    );
  }

  /** Vérifie le fichier sans rien enregistrer. Pas de Content-Type : le navigateur ajoute le boundary. */
  previewImport(file: File): Observable<ImportPreview> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ImportPreview>(`${environment.apiRegistre}/inventories/import/preview`, formData);
  }

  /** Enregistre les achats validés, tout ou rien (400 + rowErrors si une ligne est refusée). */
  confirmImport(rows: ImportConfirmRow[]): Observable<{ success: boolean; created: number; inventoryOperationIds: string[] }> {
    return this.http.post<any>(`${environment.apiRegistre}/inventories/import/confirm`, { rows }).pipe(
      tap(() => this.getRealInventoryData().subscribe())   // rafraîchit l'inventaire affiché
    );
  }

  // ============================================================================
  // EXPORT INVENTAIRE EXCEL
  // ============================================================================

  exportInventaireExcel(): Observable<any> {
    const workspaceHeader = this.mandatWorkspace.getWorkspaceHeader();
    const headers: Record<string, string> = {};
    if (workspaceHeader) {
      headers['X-Workspace-UserId'] = workspaceHeader;
    }

    return this.http.post(`${environment.apiRegistre}/exports/inventaire`, {}, {
      headers,
      responseType: 'blob',
      observe: 'response'
    }).pipe(
      tap((response: any) => {
        if (!response.body || response.body.size === 0) {
          throw new Error('Fichier Excel vide reçu du serveur');
        }

        const blob = new Blob([response.body], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        let filename = `Inventaire_${new Date().toISOString().split('T')[0]}.xlsx`;
        const disposition = response.headers.get('content-disposition');
        if (disposition) {
          const filenameMatch = disposition.match(/filename="(.+)"/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        }

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      }),
      catchError((error: any) => {
        if (error.error instanceof Blob && error.error.type === 'application/json') {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const errorObj = JSON.parse(reader.result as string);
                reject(new Error(errorObj.error || 'Erreur lors de l\'export inventaire'));
              } catch (e) {
                reject(new Error('Erreur lors de l\'export inventaire'));
              }
            };
            reader.readAsText(error.error);
          });
        }

        let errorMessage = 'Erreur lors de l\'export inventaire';
        if (error.status === 500) errorMessage += ' (erreur serveur)';
        else if (error.status === 0) errorMessage += ' (connexion refusée)';
        else errorMessage += ': ' + (error.message || 'Erreur inconnue');

        throw new Error(errorMessage);
      })
    );
  }

  /** @deprecated Il n'existe plus d'entrées "vides" à nettoyer — le stock est toujours dérivé des mouvements réels. */
  deleteEmptyProductFromStock(productId: string): Observable<any> {
    return of({ success: true });
  }
}
