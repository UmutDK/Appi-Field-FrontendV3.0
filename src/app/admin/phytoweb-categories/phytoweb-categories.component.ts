import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface PhytowebCrop {
  cropId: string;
  nameFr: string;
  initialCropId: string;
  visibleStatut?: boolean;
}

@Component({
  selector: 'app-phytoweb-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './phytoweb-categories.component.html',
  styleUrls: ['./phytoweb-categories.component.scss']
})
export class PhytowebCategoriesComponent implements OnInit {

  private readonly API_URL = `${environment.apiRegistre}/phytoweb_categories`;

  // ── State ────────────────────────────────────────────────────────────────
  allCategories = signal<PhytowebCrop[]>([]);
  isLoading     = signal(false);
  message       = signal<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Table ────────────────────────────────────────────────────────────────
  tableSearch    = signal('');
  showInitiales  = signal(false);
  editingCropId  = signal<string | null>(null);
  editNameFr     = '';

  // ── Create form ──────────────────────────────────────────────────────────
  createSearch   = signal('');
  selectedBase   = signal<PhytowebCrop | null>(null);
  newNameFr      = '';
  isCreating     = signal(false);
  showCreateForm = signal(false);

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadCategories();
  }

  // ── Computed ─────────────────────────────────────────────────────────────

  /** Résultats de recherche pour le formulaire de création (initiales seulement) */
  baseSearchResults = computed(() => {
    const q = this.createSearch().toLowerCase().trim();
    if (q.length < 3) return [];
    return this.allCategories()
      .filter(c => c.cropId === c.initialCropId)
      .filter(c => c.nameFr.toLowerCase().includes(q))
      .slice(0, 20);
  });

  /** Lignes affichées dans le tableau */
  filteredTable = computed(() => {
    const q         = this.tableSearch().toLowerCase().trim();
    const showInit  = this.showInitiales();
    return this.allCategories()
      .filter(c => showInit ? true : c.cropId !== c.initialCropId)
      .filter(c => !q || c.nameFr.toLowerCase().includes(q));
  });

  isInitiale(cat: PhytowebCrop): boolean {
    return cat.cropId === cat.initialCropId;
  }

  customCount(): number {
    return this.allCategories().filter(c => c.cropId !== c.initialCropId).length;
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  loadCategories(): void {
    this.isLoading.set(true);
    this.http.get<PhytowebCrop[]>(this.API_URL).subscribe({
      next: data => {
        this.allCategories.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.showMessage('error', 'Erreur lors du chargement des catégories');
        this.isLoading.set(false);
      }
    });
  }

  // ── Create ───────────────────────────────────────────────────────────────

  selectBase(cat: PhytowebCrop): void {
    this.selectedBase.set(cat);
    this.newNameFr = cat.nameFr;
    this.createSearch.set(cat.nameFr);
  }

  clearBase(): void {
    this.selectedBase.set(null);
    this.newNameFr = '';
    this.createSearch.set('');
  }

  onCreateSubmit(): void {
    const base = this.selectedBase();
    if (!base || !this.newNameFr.trim()) return;

    this.isCreating.set(true);
    const nameFr = this.newNameFr.trim();
    const payload = {
      nameFr,
      initialCropId: base.initialCropId,
    };

    this.http.post<any>(this.API_URL, payload).subscribe({
      next: res => {
        if (res.success) {
          this.allCategories.update(cats => [...cats, { cropId: res.cropId, nameFr, initialCropId: base.initialCropId, visibleStatut: true }]);
          this.showMessage('success', `Catégorie "${nameFr}" créée avec succès`);
          this.clearBase();
          this.showCreateForm.set(false);
        } else {
          this.showMessage('error', res.error || 'Erreur lors de la création');
        }
        this.isCreating.set(false);
      },
      error: () => {
        this.showMessage('error', 'Erreur lors de la création');
        this.isCreating.set(false);
      }
    });
  }

  // ── Edit ─────────────────────────────────────────────────────────────────

  startEdit(cat: PhytowebCrop): void {
    this.editingCropId.set(cat.cropId);
    this.editNameFr = cat.nameFr;
  }

  cancelEdit(): void {
    this.editingCropId.set(null);
    this.editNameFr = '';
  }

  saveEdit(cat: PhytowebCrop): void {
    if (!this.editNameFr.trim()) return;

    this.http.put<any>(`${this.API_URL}/${encodeURIComponent(cat.cropId)}`, {
      nameFr: this.editNameFr.trim()
    }).subscribe({
      next: res => {
        if (res.success) {
          this.allCategories.update(cats =>
            cats.map(c => c.cropId === cat.cropId ? { ...c, nameFr: this.editNameFr.trim() } : c)
          );
          this.showMessage('success', 'Catégorie modifiée avec succès');
          this.cancelEdit();
        } else {
          this.showMessage('error', res.error || 'Erreur lors de la modification');
        }
      },
      error: () => this.showMessage('error', 'Erreur lors de la modification')
    });
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  onDelete(cat: PhytowebCrop): void {
    if (!confirm(`Supprimer la catégorie "${cat.nameFr}" ?`)) return;

    this.http.delete<any>(`${this.API_URL}/${encodeURIComponent(cat.cropId)}`).subscribe({
      next: res => {
        if (res.success) {
          this.allCategories.update(cats => cats.filter(c => c.cropId !== cat.cropId));
          this.showMessage('success', `Catégorie "${cat.nameFr}" supprimée`);
        } else {
          this.showMessage('error', res.error || 'Erreur lors de la suppression');
        }
      },
      error: () => this.showMessage('error', 'Erreur lors de la suppression')
    });
  }

  // ── Toggle visibility (initiales only) ─────────────────────────────────

  toggleVisibility(cat: PhytowebCrop): void {
    const newValue = !(cat.visibleStatut ?? true);
    this.http.put<any>(`${this.API_URL}/${encodeURIComponent(cat.cropId)}`, {
      visibleStatut: newValue
    }).subscribe({
      next: res => {
        if (res.success) {
          this.allCategories.update(cats =>
            cats.map(c => c.cropId === cat.cropId ? { ...c, visibleStatut: newValue } : c)
          );
        } else {
          this.showMessage('error', res.error || 'Erreur lors de la mise à jour');
        }
      },
      error: () => this.showMessage('error', 'Erreur lors de la mise à jour de la visibilité')
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private showMessage(type: 'success' | 'error', text: string): void {
    this.message.set({ type, text });
    setTimeout(() => this.message.set(null), 4000);
  }
}
