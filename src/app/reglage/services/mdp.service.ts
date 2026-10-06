import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, switchMap, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable()
export class MdpService {

  constructor(private http: HttpClient) {}

  post(form: { mdp_actuel: string; mdp_news: string; mdp_confirme: string }): Observable<any> {
    const mail = localStorage.getItem('Mail') || localStorage.getItem('user_email') || '';


    if (!mail) {
      return throwError(() => ({ error: { message: 'Impossible de récupérer votre adresse e-mail. Reconnectez-vous.' } }));
    }

    // Étape 1 : vérifier le mot de passe actuel via l'endpoint de connexion
    const loginForm = {
      login: mail,
      mdp: encodeURIComponent(form.mdp_actuel)
    };


    return this.http.post<any>(
      `${environment.apiUrl}/controllers/index.php?user=connexion`,
      loginForm
    ).pipe(
      catchError((err) => {
        console.error('❌ Erreur lors de la vérification:', err);
        return throwError(() => ({ error: { message: 'Mot de passe actuel incorrect.' } }));
      }),
      map((res: any) => {
        if (!res || !res.Etat || !res.Etat.Token) {
          throw { error: { message: 'Mot de passe actuel incorrect.' } };
        }
        return res;
      }),
      // Étape 2 : mot de passe actuel validé → réinitialiser avec le nouveau
      // On utilise encodeURIComponent sur le nouveau mot de passe car :
      // - HttpClient params URL-encode automatiquement => PHP reçoit encodeURIComponent(password)
      // - La connexion envoie aussi encodeURIComponent(password) => les deux formats correspondent
      switchMap(() =>
        this.http.get<any>(
          `${environment.apiUrl}/controllers/reinitialisation_mdp.php`,
          {
            params: {
              mail,
              mdp: encodeURIComponent(form.mdp_news),
              confirmation_mdp: encodeURIComponent(form.mdp_confirme)
            }
          }
        )
      )
    );
  }
}
