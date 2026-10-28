import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { SharedModule } from '../../../shared/shared.module';
import { Parcelle, ParcellesService } from '../../services/parcelles-server.service';

type SortColumn = 'parcel_name' | 'parcel_category' | 'parcel_area' | 'sigec_code' | 'renewed_by';
type SortDirection = 'asc' | 'desc' | null;

interface ArchivedParcelRow extends Parcelle {
  /** Nom de la parcelle active qui la remplace (renouvellement), sinon ''. */
  renewed_by: string;
}

/**
 * Mes parcelles archivées (updateToDo/07 § 2.4) : même structure et mêmes styles que
 * Mes archives du carnet de champ (registre/components/archives), avec un bouton Restaurer.
 */
@Component({
  selector: 'app-archives-parcelles',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './archives-parcelles.component.html',
  styleUrls: ['./archives-parcelles.component.scss']
})
export class ArchivesParcellesComponent implements OnInit {

  private parcellesService = inject(ParcellesService);
  private router = inject(Router);

  // Données
  archivedParcels = signal<ArchivedParcelRow[]>([]);
  isLoading = signal<boolean>(true);
  loadError = signal<boolean>(false);
  restoringId = signal<string | null>(null);
  successMessage = signal<string>('');

  // Filtres
  searchTerm = signal<string>('');
  selectedCategory = signal<string>('');
  availableCategories = signal<string[]>([]);
  isCategoryFilterOpen = false;

  // Tri
  sortColumn = signal<SortColumn | null>(null);
  sortDirection = signal<SortDirection>(null);

  filteredParcels = computed(() => {
    let parcels = [...this.archivedParcels()];

    const search = this.searchTerm().toLowerCase().trim();
    if (search) {
      parcels = parcels.filter(p =>
        p.parcel_name?.toLowerCase().includes(search) ||
        p.sigec_code?.toLowerCase().includes(search)
      );
    }

    const category = this.selectedCategory();
    if (category) {
      parcels = parcels.filter(p => p.parcel_category === category);
    }

    const column = this.sortColumn();
    const direction = this.sortDirection();
    if (column && direction) {
      parcels.sort((a, b) => {
        let cmp: number;
        if (column === 'parcel_area') {
          cmp = (parseFloat(a.parcel_area) || 0) - (parseFloat(b.parcel_area) || 0);
        } else {
          cmp = String(a[column] || '').toLowerCase().localeCompare(String(b[column] || '').toLowerCase());
        }
        return direction === 'asc' ? cmp : -cmp;
      });
    }

    return parcels;
  });

  ngOnInit(): void {
    this.loadArchivedParcels();
  }

  async loadArchivedParcels(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(false);
    try {
      // Toutes les parcelles (actives comprises) pour retrouver la version renouvelée
      const [archived] = await Promise.all([
        this.parcellesService.getArchivedParcelles(),
        this.parcellesService.loadParcelles(true),
      ]);
      const all = this.parcellesService.getAllParcelles();
      const rows = archived.map(p => ({
        ...p,
        renewed_by: all.find(a => a.prev_parcel_id === p.id_parcel && !a.is_archived)?.parcel_name || '',
      }));
      this.archivedParcels.set(rows);
      this.availableCategories.set([...new Set(rows.map(p => p.parcel_category).filter(Boolean))].sort());
    } catch (error) {
      console.error('Erreur lors du chargement des parcelles archivées:', error);
      this.loadError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  onSearchChange(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  toggleCategoryFilter(): void {
    this.isCategoryFilterOpen = !this.isCategoryFilterOpen;
  }

  closeCategoryFilter(): void {
    this.isCategoryFilterOpen = false;
  }

  selectCategory(category: string): void {
    this.selectedCategory.set(category);
  }

  onSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      // Rotation: asc -> desc -> null
      if (this.sortDirection() === 'asc') {
        this.sortDirection.set('desc');
      } else if (this.sortDirection() === 'desc') {
        this.sortColumn.set(null);
        this.sortDirection.set(null);
      }
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  getSortIcon(column: SortColumn): string {
    if (this.sortColumn() !== column) return 'unfold_more';
    if (this.sortDirection() === 'asc') return 'keyboard_arrow_up';
    if (this.sortDirection() === 'desc') return 'keyboard_arrow_down';
    return 'unfold_more';
  }

  formatArea(p: Parcelle): string {
    const n = parseFloat(p.parcel_area);
    return isNaN(n) ? '-' : `${n.toLocaleString('fr-BE', { maximumFractionDigits: 2 })} ${p.parcel_area_unit_fr || 'ha'}`;
  }

  async restoreParcel(parcel: ArchivedParcelRow): Promise<void> {
    if (this.restoringId()) return;
    const renewedNote = parcel.renewed_by
      ? `\n\nSa version renouvelée « ${parcel.renewed_by} » restera active : les deux parcelles seront actives.`
      : '';
    if (!confirm(`Voulez-vous restaurer la parcelle « ${parcel.parcel_name} » ?${renewedNote}`)) return;

    this.restoringId.set(parcel.id_parcel);
    try {
      await this.parcellesService.unarchiveParcelle(parcel.id_parcel);
      this.successMessage.set(`« ${parcel.parcel_name} » a été restaurée dans Mes parcelles.`);
      setTimeout(() => this.successMessage.set(''), 4000);
      await this.loadArchivedParcels();
    } catch (err: any) {
      alert(err?.error?.error || 'Erreur lors de la restauration de la parcelle.');
    } finally {
      this.restoringId.set(null);
    }
  }

  goBack(): void {
    this.router.navigate(['/parcelles']);
  }
}
