import { Component, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Parcelle, ParcellesService } from '../../services/parcelles-server.service';

/**
 * Popup de choix « Archiver » / « Archiver et renouveler » d'une parcelle (updateToDo/07 § 2.3).
 * Ouverte depuis le formulaire de modification, dans la vue liste comme dans la vue carte.
 * Utilise l'instance de ParcellesService fournie par le composant parent.
 */
@Component({
  selector: 'app-parcel-archive-choice',
  standalone: true,
  imports: [FormsModule, MatTooltipModule],
  templateUrl: './parcel-archive-choice.component.html',
  styleUrl: './parcel-archive-choice.component.scss'
})
export class ParcelArchiveChoiceComponent {
  @Input({ required: true }) parcel!: Parcelle;
  /** Archivage ou renouvellement réussi : le parent ferme son formulaire et recharge sa liste. */
  @Output() done = new EventEmitter<'archived' | 'renewed'>();
  @Output() closed = new EventEmitter<void>();

  private parcellesService = inject(ParcellesService);

  readonly areaUnitOptions = [
    { value: 'ha', label: 'ha' },
    { value: 'a', label: 'a' },
    { value: 'm2', label: 'm²' },
  ]; // mêmes options que le formulaire de parcelle

  showRenewStep = false;
  renewName = '';
  renewArea: number | null = null;
  renewUnit = 'ha';
  renewSigecCode = '';
  isUnitDropdownOpen = false;
  isArchiving = false;
  errorMessage = '';

  close(): void {
    if (!this.isArchiving) this.closed.emit();
  }

  @HostListener('document:click')
  closeUnitDropdown(): void {
    this.isUnitDropdownOpen = false;
  }

  /** Étape « renouveler » : préremplie à partir de la parcelle, sauf le code SIGEC. */
  openRenewStep(): void {
    this.renewName = `${this.parcel.parcel_name || ''} (1)`;
    const area = parseFloat(String(this.parcel.parcel_area ?? '').replace(',', '.'));
    this.renewArea = isNaN(area) ? null : area;
    const unit = String(this.parcel.parcel_area_unit_fr || 'ha').toLowerCase().replace('m²', 'm2');
    this.renewUnit = this.areaUnitOptions.some(o => o.value === unit) ? unit : 'ha';
    this.renewSigecCode = '';
    this.errorMessage = '';
    this.showRenewStep = true;
  }

  get renewUnitLabel(): string {
    return this.areaUnitOptions.find(o => o.value === this.renewUnit)?.label || 'ha';
  }

  selectRenewUnit(value: string): void {
    this.renewUnit = value;
    this.isUnitDropdownOpen = false;
  }

  get canSubmitRenew(): boolean {
    return !!this.renewName.trim() && (this.renewArea ?? 0) > 0 && !!this.renewUnit && !!this.renewSigecCode.trim();
  }

  async archiveOnly(): Promise<void> {
    await this.run('archived', () => this.parcellesService.archiveParcelle(this.parcel.id_parcel));
  }

  async archiveAndRenew(): Promise<void> {
    if (!this.canSubmitRenew) return;
    await this.run('renewed', () => this.parcellesService.renewParcelle(this.parcel.id_parcel, {
      sigecCode: this.renewSigecCode.trim(),
      parcelName: this.renewName.trim(),
      parcelArea: this.renewArea!,
      parcelAreaUnit: this.renewUnit,
    }));
  }

  private async run(kind: 'archived' | 'renewed', action: () => Promise<unknown>): Promise<void> {
    if (this.isArchiving) return; // double clic
    this.isArchiving = true;
    this.errorMessage = '';
    try {
      await action();
      this.done.emit(kind);
    } catch (err: any) {
      // 400 (code SIGEC manquant), 404 (introuvable), 409 (déjà archivée) : message du serveur
      this.errorMessage = err?.error?.error || "L'opération n'a pas pu être effectuée. Vérifiez votre connexion et réessayez.";
    } finally {
      this.isArchiving = false;
    }
  }
}
