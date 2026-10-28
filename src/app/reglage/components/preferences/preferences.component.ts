import { Component, OnInit, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SharedModule } from '../../../shared/shared.module';
import { DefaultTreatmentType, UserPreferences, UserPreferencesService } from '../../services/user-preferences.service';

type PreferenceKey = Exclude<keyof UserPreferences, 'defaultEventType'>;

/**
 * Mon compte > Préférences : préférences d'encodage des traitements (voir updateToDo/04_preferences.md).
 * Enregistrement automatique à chaque changement : un PUT avec uniquement le champ modifié ;
 * la réponse du serveur fait foi. En cas d'erreur, la valeur précédente est remise.
 */
@Component({
  selector: 'app-preferences',
  standalone: true,
  imports: [SharedModule, MatTooltipModule],
  templateUrl: './preferences.component.html',
  styleUrl: './preferences.component.scss'
})
export class PreferencesComponent implements OnInit {

  readonly treatmentTypeOptions: { value: DefaultTreatmentType; label: string; icon: string }[] = [
    { value: 'surface',  label: 'Surface',  icon: 'bi-rulers' },
    { value: 'porridge', label: 'Bouillie', icon: 'bi-droplet-half' },
    { value: 'quantity', label: 'Quantité', icon: 'bi-speedometer2' },
  ];

  isLoading = signal(true);
  loadError = signal(false);
  prefs = signal<UserPreferences>({
    erRiWarningFlag: false,
    spe8HourWarningFlag: true,
    bbchWarningFlag: true,
    defaultTreatmentType: 'surface',
  });
  /** Message bref après un enregistrement (« Préférences enregistrées ») ou une erreur. */
  feedback = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  saving = signal(false);

  private feedbackTimer?: ReturnType<typeof setTimeout>;

  constructor(private preferencesService: UserPreferencesService) {}

  ngOnInit(): void {
    this.preferencesService.get().subscribe({
      next: prefs => {
        this.prefs.set(prefs);
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  save<K extends PreferenceKey>(key: K, value: UserPreferences[K]): void {
    const previous = this.prefs();
    if (previous[key] === value) return;
    // Affichage immédiat, puis la réponse du serveur remplace l'état local
    this.prefs.set({ ...previous, [key]: value });
    this.saving.set(true);
    this.preferencesService.update({ [key]: value } as Partial<UserPreferences>).subscribe({
      next: updated => {
        this.prefs.set(updated);
        this.saving.set(false);
        this.showFeedback('success', 'Préférences enregistrées');
      },
      error: () => {
        this.prefs.set(previous);
        this.saving.set(false);
        this.showFeedback('error', "La préférence n'a pas pu être enregistrée. Vérifiez votre connexion et réessayez.");
      }
    });
  }

  private showFeedback(kind: 'success' | 'error', text: string): void {
    clearTimeout(this.feedbackTimer);
    this.feedback.set({ kind, text });
    this.feedbackTimer = setTimeout(() => this.feedback.set(null), kind === 'success' ? 2500 : 6000);
  }
}
