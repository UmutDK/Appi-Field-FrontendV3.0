import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { FormationsService, Formation } from './formations.service';

@Component({
  selector: 'app-formations',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './formations.component.html',
  styleUrls: ['./formations.component.scss']
})
export class FormationsComponent implements OnInit {
  formations = signal<Formation[]>([]);
  formationForm: FormGroup;
  isEditing = signal<boolean>(false);
  editingFormationId = signal<string | null>(null);
  isLoading = signal<boolean>(false);
  message = signal<{ type: 'success' | 'error', text: string } | null>(null);

  constructor(
    private formationsService: FormationsService,
    private fb: FormBuilder
  ) {
    this.formationForm = this.fb.group({
      day: ['', Validators.required],
      month: ['', Validators.required],
      title: ['', Validators.required],
      location: ['', Validators.required],
      time: ['', Validators.required],
      link: ['', [Validators.required, Validators.pattern(/^(https?:\/\/|mailto:).+/)]]
    });
  }

  ngOnInit(): void {
    this.loadFormations();
  }

  /**
   * Charge toutes les formations
   */
  loadFormations(): void {
    this.isLoading.set(true);
    this.formationsService.getFormations().subscribe({
      next: (formations) => {
        this.formations.set(formations);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.showMessage('error', 'Erreur lors du chargement des formations');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Prépare le formulaire pour l'ajout d'une nouvelle formation
   */
  onAdd(): void {
    this.formationForm.reset();
    this.isEditing.set(false);
    this.editingFormationId.set(null);
  }

  /**
   * Prépare le formulaire pour l'édition d'une formation existante
   */
  onEdit(formation: Formation, index: number): void {
    this.formationForm.patchValue(formation);
    this.isEditing.set(true);
    this.editingFormationId.set(formation.formationId);
    // Scroll vers le formulaire
    document.getElementById('formationForm')?.scrollIntoView({ behavior: 'smooth' });
  }

  /**
   * Soumet le formulaire (création ou modification)
   */
  onSubmit(): void {
    if (this.formationForm.invalid) {
      this.showMessage('error', 'Veuillez remplir tous les champs correctement');
      return;
    }

    this.isLoading.set(true);
    const formation: Partial<Formation> = this.formationForm.value;

    if (this.isEditing() && this.editingFormationId() !== null) {
      // Modification
      this.formationsService.updateFormation(this.editingFormationId()!, formation).subscribe({
        next: () => {
          this.showMessage('success', 'Formation modifiée avec succès');
          this.loadFormations();
          this.onCancel();
        },
        error: () => {
          this.showMessage('error', 'Erreur lors de la modification');
          this.isLoading.set(false);
        }
      });
    } else {
      // Création
      this.formationsService.createFormation(formation).subscribe({
        next: () => {
          this.showMessage('success', 'Formation créée avec succès');
          this.loadFormations();
          this.onCancel();
        },
        error: () => {
          this.showMessage('error', 'Erreur lors de la création');
          this.isLoading.set(false);
        }
      });
    }
  }

  /**
   * Supprime une formation
   */
  onDelete(index: number): void {
    const formation = this.formations()[index];
    if (!formation) return;
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette formation ?')) {
      return;
    }

    this.isLoading.set(true);
    this.formationsService.deleteFormation(formation.formationId).subscribe({
      next: () => {
        this.showMessage('success', 'Formation supprimée avec succès');
        this.loadFormations();
      },
      error: () => {
        this.showMessage('error', 'Erreur lors de la suppression');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Annule l'édition en cours
   */
  onCancel(): void {
    this.formationForm.reset();
    this.isEditing.set(false);
    this.editingFormationId.set(null);
    this.isLoading.set(false);
  }

  /**
   * Déplace une formation vers le haut
   */
  onMoveUp(index: number): void {
    if (index === 0) return;
    const formation = this.formations()[index];
    if (!formation) return;

    this.isLoading.set(true);
    this.formationsService.moveFormation(formation.formationId, 'up').subscribe({
      next: () => {
        this.loadFormations();
      },
      error: () => {
        this.showMessage('error', 'Erreur lors du déplacement');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Déplace une formation vers le bas
   */
  onMoveDown(index: number): void {
    if (index === this.formations().length - 1) return;
    const formation = this.formations()[index];
    if (!formation) return;

    this.isLoading.set(true);
    this.formationsService.moveFormation(formation.formationId, 'down').subscribe({
      next: () => {
        this.loadFormations();
      },
      error: () => {
        this.showMessage('error', 'Erreur lors du déplacement');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Affiche un message temporaire
   */
  private showMessage(type: 'success' | 'error', text: string): void {
    this.message.set({ type, text });
    setTimeout(() => this.message.set(null), 5000);
  }
}
