import { Component, OnInit, OnDestroy, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { InventaireService, ImportConfirmRow, ImportPreviewRow, ImportProduct, ImportRowIssue } from '../../services/inventaire.service';
import { PhytoProductService } from '../../services/phyto-product.service';
import { PhytoProduct } from '../../model/phyto-product.interface';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // même limite que le serveur

/** Ligne de la vérification, enrichie de l'état de la popup (corrections locales, inclusion, recherche). */
interface ReviewRow extends ImportPreviewRow {
  /** Champs en erreur dans le fichier : leurs contrôles de correction restent affichés. */
  errorFields: Set<string>;
  included: boolean;
  wasValid: boolean;
  /** Erreurs renvoyées par /confirm : la ligne reste en erreur tant qu'elle n'est pas modifiée. */
  serverErrors: ImportRowIssue[];
  searchTerm: string;
  searchResults: PhytoProduct[];
  isSearching: boolean;
  searchTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Popup « Importer des achats » (updateToDo/08) : 1. fichier → 2. vérification et correction
 * des lignes → 3. import en une fois. Les corrections sont faites en local (pas de nouvel appel
 * à /preview) ; seules les lignes incluses ET valides sont envoyées à /confirm.
 */
@Component({
  selector: 'app-import-achats',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './import-achats.component.html',
  styleUrl: './import-achats.component.scss'
})
export class ImportAchatsComponent implements OnInit, OnDestroy {
  @Output() closeForm = new EventEmitter<void>();
  /** Nombre d'achats importés : le parent affiche la confirmation. */
  @Output() imported = new EventEmitter<number>();

  private inventaireService = inject(InventaireService);
  private phytoProductService = inject(PhytoProductService);
  private destroy$ = new Subject<void>();

  step: 'file' | 'review' = 'file';
  readonly today = this.localToday();

  // Étape 1
  selectedFile: File | null = null;
  fileError = '';
  isDragOver = false;
  isDownloading = false;
  isChecking = false;

  // Étape 2
  rows: ReviewRow[] = [];
  onlyToFix = false;
  isImporting = false;
  importError = '';

  unitOptions: ('L' | 'Kg')[] = ['L', 'Kg'];

  ngOnInit(): void {
    document.body.classList.add('no-scroll');
  }

  ngOnDestroy(): void {
    document.body.classList.remove('no-scroll');
    this.rows.forEach(r => clearTimeout(r.searchTimer));
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ===== Étape 1 : fichier =====

  downloadTemplate(): void {
    if (this.isDownloading) return;
    this.isDownloading = true;
    this.fileError = '';
    this.inventaireService.downloadImportTemplate().pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.isDownloading = false,
      error: () => {
        this.isDownloading = false;
        this.fileError = "Le modèle n'a pas pu être téléchargé. Vérifiez votre connexion et réessayez.";
      }
    });
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setFile(input.files?.[0] || null);
    input.value = ''; // permet de redéposer le même fichier après correction
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    this.setFile(event.dataTransfer?.files?.[0] || null);
  }

  private setFile(file: File | null): void {
    this.fileError = '';
    this.selectedFile = null;
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.fileError = 'Le fichier doit être au format .xlsx (classeur Excel). Utilisez le modèle ci-dessus.';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      this.fileError = 'Le fichier est trop volumineux (2 Mo maximum).';
      return;
    }
    this.selectedFile = file;
  }

  removeFile(): void {
    this.selectedFile = null;
    this.fileError = '';
  }

  checkFile(): void {
    if (!this.selectedFile || this.isChecking) return;
    this.isChecking = true;
    this.fileError = '';
    this.inventaireService.previewImport(this.selectedFile).pipe(takeUntil(this.destroy$)).subscribe({
      next: preview => {
        this.isChecking = false;
        this.rows = (preview?.rows || []).map(r => this.toReviewRow(r));
        this.onlyToFix = false;
        this.importError = '';
        this.step = 'review';
      },
      error: err => {
        this.isChecking = false;
        this.fileError = err?.error?.error || "Le fichier n'a pas pu être vérifié. Vérifiez votre connexion et réessayez.";
      }
    });
  }

  private toReviewRow(r: ImportPreviewRow): ReviewRow {
    const row: ReviewRow = {
      ...r,
      errors: r.errors || [],
      warnings: r.warnings || [],
      suggestions: r.suggestions || [],
      errorFields: new Set((r.errors || []).map(e => e.field)),
      included: false,
      wasValid: false,
      serverErrors: [],
      searchTerm: '',
      searchResults: [],
      isSearching: false,
    };
    row.wasValid = this.isRowValid(row);
    row.included = row.wasValid; // ok / warning : inclus par défaut ; error : pas tant que non corrigée
    return row;
  }

  // ===== Étape 2 : vérification =====

  isRowValid(r: ReviewRow): boolean {
    return !!r.product?.productId && (r.quantity ?? 0) > 0
      && (r.quantityUnit === 'L' || r.quantityUnit === 'Kg')
      && !!r.operationDate && r.operationDate <= this.today
      && r.serverErrors.length === 0;
  }

  /** Le champ est-il (encore) invalide ? Sert à n'afficher l'erreur du fichier que tant qu'elle n'est pas corrigée. */
  isFieldInvalid(r: ReviewRow, field: string): boolean {
    switch (field) {
      case 'numAut': return !r.product?.productId;
      case 'quantity': return !((r.quantity ?? 0) > 0);
      case 'unit': return r.quantityUnit !== 'L' && r.quantityUnit !== 'Kg';
      case 'date': return !r.operationDate || r.operationDate > this.today;
      default: return true;
    }
  }

  fieldErrors(r: ReviewRow, field: string): ImportRowIssue[] {
    const fromFile = this.isFieldInvalid(r, field) ? r.errors.filter(e => e.field === field) : [];
    return [...fromFile, ...r.serverErrors.filter(e => e.field === field)];
  }

  /** Erreurs serveur sans champ reconnu (affichées en tête de la carte). */
  otherServerErrors(r: ReviewRow): ImportRowIssue[] {
    return r.serverErrors.filter(e => !['numAut', 'quantity', 'unit', 'date'].includes(e.field));
  }

  rowStatus(r: ReviewRow): 'ok' | 'warning' | 'error' {
    if (!this.isRowValid(r)) return 'error';
    return r.warnings.length > 0 ? 'warning' : 'ok';
  }

  rowStatusLabel(r: ReviewRow): string {
    const s = this.rowStatus(r);
    return s === 'ok' ? 'Prête' : s === 'warning' ? 'Avertissement' : 'À corriger';
  }

  /** Après chaque correction locale : une ligne qui devient valide est incluse automatiquement. */
  onRowChanged(r: ReviewRow): void {
    r.serverErrors = [];
    const valid = this.isRowValid(r);
    if (valid && !r.wasValid) r.included = true;
    if (!valid) r.included = false;
    r.wasValid = valid;
  }

  onQuantityChange(r: ReviewRow, value: number | null): void {
    r.quantity = value === null || (value as any) === '' ? null : Number(value);
    this.onRowChanged(r);
  }

  onUnitChange(r: ReviewRow, value: 'L' | 'Kg'): void {
    r.quantityUnit = value;
    this.onRowChanged(r);
  }

  onDateChange(r: ReviewRow, value: string): void {
    r.operationDate = value || null;
    this.onRowChanged(r);
  }

  selectProduct(r: ReviewRow, product: ImportProduct): void {
    r.product = { ...product };
    r.searchTerm = '';
    r.searchResults = [];
    this.onRowChanged(r);
  }

  selectSearchResult(r: ReviewRow, p: PhytoProduct): void {
    this.selectProduct(r, { productId: p.product_id, numAut: p.product_numaut, productName: p.product_name });
  }

  onSearchInput(r: ReviewRow): void {
    clearTimeout(r.searchTimer);
    const term = r.searchTerm.trim();
    if (term.length < 2) {
      r.searchResults = [];
      r.isSearching = false;
      return;
    }
    r.isSearching = true;
    r.searchTimer = setTimeout(() => {
      this.phytoProductService.searchProducts(term).pipe(takeUntil(this.destroy$)).subscribe(results => {
        if (r.searchTerm.trim() !== term) return; // une saisie plus récente a pris le relais
        r.searchResults = results.slice(0, 8);
        r.isSearching = false;
      });
    }, 300);
  }

  /** Autres lignes avec le même numéro non reconnu, encore sans produit. */
  sameNumAutRows(r: ReviewRow): ReviewRow[] {
    if (!r.errorFields.has('numAut') || !r.product) return [];
    const numAut = (r.input.numAut || '').trim();
    return this.rows.filter(o => o !== r && !o.product && (o.input.numAut || '').trim() === numAut && numAut !== '');
  }

  applyProductToSameNumAut(r: ReviewRow): void {
    if (!r.product) return;
    this.sameNumAutRows(r).forEach(o => this.selectProduct(o, r.product!));
  }

  toggleIncluded(r: ReviewRow, checked: boolean): void {
    r.included = checked && this.isRowValid(r);
  }

  get visibleRows(): ReviewRow[] {
    return this.onlyToFix ? this.rows.filter(r => this.rowStatus(r) === 'error') : this.rows;
  }

  get countOk(): number { return this.rows.filter(r => this.rowStatus(r) === 'ok').length; }
  get countWarning(): number { return this.rows.filter(r => this.rowStatus(r) === 'warning').length; }
  get countError(): number { return this.rows.filter(r => this.rowStatus(r) === 'error').length; }

  get rowsToImport(): ReviewRow[] {
    return this.rows.filter(r => r.included && this.isRowValid(r));
  }

  /** Lignes en erreur non corrigées : ignorées à l'import (sans bloquer les autres). */
  get ignoredErrorCount(): number {
    return this.countError;
  }

  /** Lignes valides mais décochées par l'utilisateur. */
  get excludedValidCount(): number {
    return this.rows.filter(r => !r.included && this.isRowValid(r)).length;
  }

  backToFile(): void {
    if (this.isImporting) return;
    this.step = 'file';
    this.importError = '';
  }

  // ===== Étape 3 : import =====

  confirmImport(): void {
    const rows = this.rowsToImport;
    if (rows.length === 0 || this.isImporting) return;
    this.isImporting = true;
    this.importError = '';
    const payload: ImportConfirmRow[] = rows.map(r => ({
      rowNumber: r.rowNumber,
      productId: r.product!.productId,
      quantity: r.quantity!,
      quantityUnit: r.quantityUnit!,
      operationDate: r.operationDate!,
    }));
    this.inventaireService.confirmImport(payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.isImporting = false;
        this.imported.emit(res?.created ?? payload.length);
        this.close();
      },
      error: err => {
        this.isImporting = false;
        const rowErrors: any[] = err?.error?.rowErrors || [];
        if (rowErrors.length) {
          // Rien n'a été enregistré : les lignes refusées repassent en erreur avec le message du serveur
          rowErrors.forEach(e => {
            const target = this.rows.find(r => r.rowNumber === e.rowNumber) ?? rows[e.index];
            if (!target) return;
            // Champs de /confirm → champs de la carte (et affichage du contrôle de correction)
            const field = ({ productId: 'numAut', quantityUnit: 'unit', operationDate: 'date' } as Record<string, string>)[e.field] || e.field || '';
            if (['numAut', 'quantity', 'unit', 'date'].includes(field)) target.errorFields.add(field);
            target.serverErrors.push({ field, message: e.message });
            target.included = false;
            target.wasValid = false;
          });
          this.onlyToFix = false;
        }
        this.importError = (err?.error?.error || "L'import n'a pas pu être effectué. Vérifiez votre connexion et réessayez.")
          + (rowErrors.length ? ' Corrigez ou excluez les lignes signalées, puis relancez l\'import.' : '');
      }
    });
  }

  close(): void {
    document.body.classList.remove('no-scroll');
    this.closeForm.emit();
  }

  private localToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
