import { Component, OnInit, signal } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { MandatService, Mandat } from '../../../core/services/mandat.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-mandats',
  standalone: true,
  imports: [SharedModule, FormsModule],
  templateUrl: './mandats.component.html',
  styleUrl: './mandats.component.scss'
})
export class MandatsComponent implements OnInit {

  newMandatMail = '';
  sendSuccess = '';
  sendError = '';
  isSending = false;

  actionError = signal<string>('');
  actionSuccess = signal<string>('');

  constructor(public mandatService: MandatService) {}

  ngOnInit(): void {
    this.mandatService.loadMandats();
  }

  /** Mandats envoyés (je suis le owner) */
  get sentMandats(): Mandat[] {
    const myMail = (localStorage.getItem('Mail') ?? '').toLowerCase();
    return this.mandatService.mandats().filter(
      (m: Mandat) => m.ownerUserMail.toLowerCase() === myMail
    );
  }

  /** Mandats reçus en attente (je suis le mandaté, pas encore traités) */
  get pendingReceivedMandats(): Mandat[] {
    const myMail = (localStorage.getItem('Mail') ?? '').toLowerCase();
    return this.mandatService.mandats().filter(
      (m: Mandat) => m.status === 'pending'
        && m.mandateUserMail.toLowerCase() === myMail
    );
  }

  /** Mandats reçus acceptés (je suis le mandaté) */
  get acceptedReceivedMandats(): Mandat[] {
    const myMail = (localStorage.getItem('Mail') ?? '').toLowerCase();
    return this.mandatService.mandats().filter(
      (m: Mandat) => m.status === 'accepted'
        && m.mandateUserMail.toLowerCase() === myMail
    );
  }

  onSendMandat(): void {
    if (!this.newMandatMail.trim()) return;
    this.isSending = true;
    this.sendSuccess = '';
    this.sendError = '';

    this.mandatService.createMandat(this.newMandatMail.trim()).subscribe({
      next: () => {
        this.sendSuccess = 'Demande envoyée avec succès.';
        this.newMandatMail = '';
        this.isSending = false;
        this.mandatService.loadMandats();
      },
      error: (err: any) => {
        this.sendError = err?.error?.message ?? 'Une erreur est survenue.';
        this.isSending = false;
      }
    });
  }

  onAccept(mandat: Mandat): void {
    this.mandatService.updateMandatStatut(mandat.mandateId, 'accepted').subscribe({
      next: () => {
        this.actionSuccess.set('Mandat accepté.');
        this.mandatService.loadMandats();
      },
      error: () => this.actionError.set('Erreur lors de l\'acceptation.')
    });
  }

  onRefuse(mandat: Mandat): void {
    this.mandatService.updateMandatStatut(mandat.mandateId, 'refused').subscribe({
      next: () => {
        this.actionSuccess.set('Mandat refusé.');
        this.mandatService.loadMandats();
      },
      error: () => this.actionError.set('Erreur lors du refus.')
    });
  }

  onDelete(mandat: Mandat): void {
    this.mandatService.deleteMandat(mandat.mandateId).subscribe({
      next: () => {
        this.actionSuccess.set('Mandat supprimé.');
        this.mandatService.loadMandats();
      },
      error: () => this.actionError.set('Erreur lors de la suppression.')
    });
  }

  getStatutBadge(statut: string): string {
    return { pending: 'warning', accepted: 'success', refused: 'danger' }[statut] ?? 'secondary';
  }

  getStatutLabel(statut: string): string {
    return { pending: 'En attente', accepted: 'Accepté', refused: 'Refusé' }[statut] ?? statut;
  }
}
