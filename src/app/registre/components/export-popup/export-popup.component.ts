import { Component, EventEmitter, Input, Output, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter, take, timeout, catchError } from 'rxjs/operators';
import { EMPTY, Subject } from 'rxjs';
import { RegistreService } from '../../services/registre.service';

export interface ExportFilters {
  years: string[];
  cropNames: string[];
  archiveStatus: 'all' | 'archived' | 'not-archived';
  parcels: string[];
  format: 'excel' | 'pdf';
}

@Component({
  selector: 'app-export-popup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './export-popup.component.html',
  styleUrl: './export-popup.component.scss'
})
export class ExportPopupComponent implements OnInit, OnDestroy {
  @Output() close = new EventEmitter<void>();
  @Output() export = new EventEmitter<ExportFilters>();

  private registreService = inject(RegistreService);

  // Données disponibles pour les filtres
  availableYears: string[] = [];
  availableCropNames: { name: string; count: number }[] = [];
  availableParcels: { name: string; count: number }[] = [];

  // Filtres sélectionnés
  selectedYears: string[] = [];
  selectedCropNames: string[] = [];
  selectedParcels: string[] = [];
  archiveStatus: 'all' | 'archived' | 'not-archived' = 'all';
  exportFormat: 'excel' | 'pdf' = 'excel';

  // États des dropdowns
  isYearDropdownOpen = signal(false);
  isCropDropdownOpen = signal(false);
  isParcelDropdownOpen = signal(false);

  // Chargement
  isLoading = signal(true);
  private destroy$ = new Subject<void>();

  // Signal pour vérifier si des filtres sont actifs
  // Méthode (et non computed()) : les filtres sont des propriétés simples, pas des signals —
  // un computed() n'était jamais recalculé et les pastilles ne s'affichaient jamais.
  hasActiveFilters(): boolean {
    return this.selectedYears.length > 0 ||
           this.selectedCropNames.length > 0 ||
           this.selectedParcels.length > 0 ||
           this.archiveStatus !== 'all';
  }

  // Signal pour vérifier s'il y a des données disponibles
  hasNoData = computed(() => {
    return !this.isLoading() && 
           this.availableYears.length === 0 && 
           this.availableCropNames.length === 0 && 
           this.availableParcels.length === 0;
  });

  ngOnInit(): void {
    this.loadFilterData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadFilterData(): void {
    this.isLoading.set(true);

    this.registreService.getAllTraitements().pipe(
      filter((treatments: any[]) => treatments != null && treatments.length > 0),
      take(1),
      timeout(15000),
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      })
    ).subscribe({
      next: (treatments: any[]) => {
        const yearsSet = new Set<string>();
        const cropNamesMap = new Map<string, number>();
        const parcelsMap = new Map<string, number>();

        treatments.forEach((treatment: any) => {
          const dateStr = treatment.date || treatment.treatment_date || treatment.event_date;
          if (dateStr) {
            const year = new Date(dateStr).getFullYear().toString();
            yearsSet.add(year);
          }

          if (treatment.parcels_concerned && Array.isArray(treatment.parcels_concerned)) {
            treatment.parcels_concerned.forEach((parcel: any) => {
              if (parcel.crop_name) {
                cropNamesMap.set(parcel.crop_name, (cropNamesMap.get(parcel.crop_name) || 0) + 1);
              }
              const parcelName = parcel.parcel_name || parcel.parcels;
              if (parcelName) {
                parcelsMap.set(parcelName, (parcelsMap.get(parcelName) || 0) + 1);
              }
            });
          }
        });

        this.availableYears = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));
        this.availableCropNames = Array.from(cropNamesMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));
        this.availableParcels = Array.from(parcelsMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));

        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('❌ Export popup - Erreur chargement:', err);
        this.isLoading.set(false);
      }
    });
  }

  // === Gestion des dropdowns ===
  toggleYearDropdown(): void {
    const wasOpen = this.isYearDropdownOpen();
    this.closeAllDropdowns();
    if (!wasOpen) {
      this.isYearDropdownOpen.set(true);
    }
  }

  toggleCropDropdown(): void {
    const wasOpen = this.isCropDropdownOpen();
    this.closeAllDropdowns();
    if (!wasOpen) {
      this.isCropDropdownOpen.set(true);
    }
  }

  toggleParcelDropdown(): void {
    const wasOpen = this.isParcelDropdownOpen();
    this.closeAllDropdowns();
    if (!wasOpen) {
      this.isParcelDropdownOpen.set(true);
    }
  }

  closeAllDropdowns(): void {
    this.isYearDropdownOpen.set(false);
    this.isCropDropdownOpen.set(false);
    this.isParcelDropdownOpen.set(false);
  }

  // === Gestion des sélections ===
  isYearSelected(year: string): boolean {
    return this.selectedYears.includes(year);
  }

  toggleYear(year: string): void {
    if (this.isYearSelected(year)) {
      this.selectedYears = this.selectedYears.filter(y => y !== year);
    } else {
      this.selectedYears.push(year);
    }
  }

  selectAllYears(): void {
    this.selectedYears = [...this.availableYears];
  }

  clearYears(): void {
    this.selectedYears = [];
  }

  isCropSelected(cropName: string): boolean {
    return this.selectedCropNames.includes(cropName);
  }

  toggleCrop(cropName: string): void {
    if (this.isCropSelected(cropName)) {
      this.selectedCropNames = this.selectedCropNames.filter(c => c !== cropName);
    } else {
      this.selectedCropNames.push(cropName);
    }
  }

  selectAllCrops(): void {
    this.selectedCropNames = this.availableCropNames.map(c => c.name);
  }

  clearCrops(): void {
    this.selectedCropNames = [];
  }

  isParcelSelected(parcelName: string): boolean {
    return this.selectedParcels.includes(parcelName);
  }

  toggleParcel(parcelName: string): void {
    if (this.isParcelSelected(parcelName)) {
      this.selectedParcels = this.selectedParcels.filter(p => p !== parcelName);
    } else {
      this.selectedParcels.push(parcelName);
    }
  }

  selectAllParcels(): void {
    this.selectedParcels = this.availableParcels.map(p => p.name);
  }

  clearParcels(): void {
    this.selectedParcels = [];
  }

  // === Méthodes utilitaires ===
  getSelectedYearsText(): string {
    if (this.selectedYears.length === 0) {
      return 'Toutes les années';
    }
    if (this.selectedYears.length === 1) {
      return this.selectedYears[0];
    }
    return `${this.selectedYears.length} années sélectionnées`;
  }

  getSelectedCropsText(): string {
    if (this.selectedCropNames.length === 0) {
      return 'Toutes les cultures';
    }
    if (this.selectedCropNames.length === 1) {
      return this.selectedCropNames[0];
    }
    return `${this.selectedCropNames.length} cultures sélectionnées`;
  }

  getSelectedParcelsText(): string {
    if (this.selectedParcels.length === 0) {
      return 'Toutes les parcelles';
    }
    if (this.selectedParcels.length === 1) {
      return this.selectedParcels[0];
    }
    return `${this.selectedParcels.length} parcelles sélectionnées`;
  }

  getExportButtonText(): string {
    const formatLabel = this.exportFormat === 'pdf' ? 'PDF' : 'Excel';
    if (this.selectedYears.length > 0 ||
        this.selectedCropNames.length > 0 ||
        this.selectedParcels.length > 0 ||
        this.archiveStatus !== 'all') {
      return `Exporter en ${formatLabel}`;
    }
    return `Exporter en ${formatLabel}`;
  }

  // === Actions ===
  onClose(): void {
    this.close.emit();
  }

  onExport(): void {
    const filters: ExportFilters = {
      years: this.selectedYears,
      cropNames: this.selectedCropNames,
      archiveStatus: this.archiveStatus,
      parcels: this.selectedParcels,
      format: this.exportFormat
    };
    this.export.emit(filters);
  }

  resetFilters(): void {
    this.selectedYears = [];
    this.selectedCropNames = [];
    this.selectedParcels = [];
    this.archiveStatus = 'all';
  }
}
