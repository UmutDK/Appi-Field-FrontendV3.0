import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
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

  showRenewStep = false;
  renewSigecCode = '';
  isArchiving = false;
  errorMessage = '';

  close(): void {
    if (!this.isArchiving) this.closed.emit();
  }

  async archiveOnly(): Promise<void> {
    await this.run('archived', () => this.parcellesService.archiveParcelle(this.parcel.id_parcel));
  }

  async archiveAndRenew(): Promise<void> {
    const code = this.renewSigecCode.trim();
    if (!code) return;
    await this.run('renewed', () => this.parcellesService.renewParcelle(this.parcel.id_parcel, code));
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
