import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Mode d'encodage préféré : valeurs API (jamais les libellés « Surface / Bouillie / Quantité »). */
export type DefaultTreatmentType = 'surface' | 'porridge' | 'quantity';

/** Préférences d'encodage des traitements (GET/PUT /user_preferences, voir updateToDo/04_preferences.md). */
export interface UserPreferences {
  erRiWarningFlag: boolean;
  spe8HourWarningFlag: boolean;
  bbchWarningFlag: boolean;
  /** L'utilisateur déclare ses parcelles à la PAC : code SIGEC et « Archiver et renouveler » proposés. */
  pacDeclarationFlag: boolean;
  defaultTreatmentType: DefaultTreatmentType;
  /** Valeur `type` correspondante du formulaire de traitement. Lecture seule : jamais envoyée. */
  defaultEventType?: string;
}

/**
 * Préférences de l'utilisateur connecté. `providedIn: 'root'` car le formulaire de traitement
 * s'en sert aussi (type d'encodage présélectionné, voir 05_warnings.md).
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private http = inject(HttpClient);
  private url = `${environment.apiRegistre}/user_preferences`;

  /** Toujours un objet complet (valeurs par défaut si l'utilisateur n'a jamais rien enregistré). */
  get(): Observable<UserPreferences> {
    return this.http.get<UserPreferences>(this.url);
  }

  /** Mise à jour partielle : n'envoyer que les champs modifiés. Renvoie les préférences complètes à jour. */
  update(changes: Partial<Omit<UserPreferences, 'defaultEventType'>>): Observable<UserPreferences> {
    return this.http.put<UserPreferences>(this.url, changes);
  }

  /** En cas d'erreur ou de réponse incomplète, on garde le comportement actuel (champ affiché). */
  declaresToPac(): Observable<boolean> {
    return this.get().pipe(
      map(prefs => prefs.pacDeclarationFlag !== false),
      catchError(() => of(true))
    );
  }
}
