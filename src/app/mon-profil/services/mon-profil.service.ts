import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MonProfil } from '../model/mon-profil';

@Injectable()
export class MonProfilService {

  userSignal = signal<MonProfil | any>(null);

  constructor(
    private http: HttpClient
  ) { }

  getMonProfil():Observable<any> {
    // Lire depuis le localStorage (déjà stocké à la connexion) pour éviter un appel CORS vers userkey
    const profil = {
      Token:   localStorage.getItem('Token'),
      Id_User: localStorage.getItem('Ref'),
      Nom:     localStorage.getItem('Nom'),
      Prenom:  localStorage.getItem('Prenom'),
      Mail:    localStorage.getItem('Mail'),
      Attribut:localStorage.getItem('Compte'),
    };
    this.userSignal.set(profil);
    return new Observable(obs => { obs.next(profil); obs.complete(); });
  }

  /**
   * Met à jour nom/prénom sur le serveur de comptes. Renvoie la requête (au lieu de l'envoyer
   * sans attendre la réponse) : l'appelant n'affiche le succès que si le serveur a répondu OK.
   */
  updateMonProfil(form:{userMail:string, userNom:string, userPrenom:string}): Observable<any> {

    const formulaire = {
      ...form,
      Id_User : this.userSignal()?.Id_User ?? localStorage.getItem('Ref')
    }

    return this.http.put<any>(`${environment.apiUrl}/controllers/profil/put.php`, formulaire);
  }

}
