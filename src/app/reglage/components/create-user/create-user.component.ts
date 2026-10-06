import { Component, inject, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { ReglageService } from '../../services/reglage.service';


@Component({
  selector: 'app-create-user',
  standalone: true,
  imports: [
    SharedModule
  ],
  templateUrl: './create-user.component.html',
  styleUrl: './create-user.component.scss'
})
export class CreateUserComponent implements OnInit {

  private http = inject(ReglageService);

  signalGet = this.http.signal;

  showOperateurForm = false;
  editingOperateur: any = null;
  operateurForm = { name: '', phytolicence: '' };
  operateurSaving = false;
  operateurError = '';

  ngOnInit(): void {
    this.http.onGet().subscribe();
  }

  onDEl(id: string) {
    // Même confirmation que sur l'accueil (back-office) avant de supprimer un opérateur
    const op = (this.signalGet() || []).find((o: any) => o.operatorId === id);
    const nom = op?.operatorName ? ` « ${op.operatorName} »` : '';
    if (!confirm(`Supprimer l'opérateur${nom} ?`)) return;
    this.http.onDelet(id);
  }

  openOperateurForm(): void {
    this.editingOperateur = null;
    this.operateurForm = { name: '', phytolicence: '' };
    this.operateurError = '';
    this.showOperateurForm = true;
  }

  editOperateur(op: any): void {
    this.editingOperateur = op;
    this.operateurForm = {
      name: op.operatorName || '',
      phytolicence: op.operatorPhytolicence || ''
    };
    this.operateurError = '';
    this.showOperateurForm = true;
  }

  closeOperateurForm(): void {
    this.showOperateurForm = false;
    this.editingOperateur = null;
    this.operateurSaving = false;
    this.operateurError = '';
  }

  saveOperateur(): void {
    if (!this.operateurForm.name.trim()) {
      this.operateurError = 'Le nom et prénom est obligatoire.';
      return;
    }
    this.operateurSaving = true;
    this.operateurError = '';

    if (this.editingOperateur) {
      this.http.onPut(
        this.editingOperateur.operatorId,
        {
          name: this.operateurForm.name.trim(),
          phytolicence: this.operateurForm.phytolicence.trim()
        }
      ).subscribe({
        next: () => this.closeOperateurForm(),
        error: () => {
          this.operateurError = 'Erreur lors de la mise à jour.';
          this.operateurSaving = false;
        }
      });
    } else {
      this.http.onPost({
        name: this.operateurForm.name.trim(),
        phytolicence: this.operateurForm.phytolicence.trim()
      });
      this.closeOperateurForm();
    }
  }

  onPhytolicenceInput(event: Event) {
    const input = event.target as HTMLInputElement;
    let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (value.length > 2) value = value.slice(0, 2) + '.' + value.slice(2);
    if (value.length > 4) value = value.slice(0, 4) + '.' + value.slice(4);

    input.value = value;
    this.operateurForm.phytolicence = value;
  }

}

