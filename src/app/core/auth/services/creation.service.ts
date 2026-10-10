import { HttpClient } from '@angular/common/http';
import { generateUUID } from '../../../shared/utils/uuid.util';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Creation } from '../model/creation';
import { environment } from '../../../../environments/environment';

@Injectable()
export class CreationService {

  id_User!:string;
  token!:string;

  constructor(
    private http : HttpClient
  ) { 
    // ⭐ GÉNÉRATION DE L'ID_USER COMPLET AU FORMAT: NUMBER-UUIDNOHYPHENS-NUMBER
    // Génération du premier nombre (4 chiffres)
    const startNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    // Génération de l'UUID SANS LES TIRETS pour éviter les problèmes de parsing
    const uuidWithHyphens = generateUUID();
    const uuidNoHyphens = uuidWithHyphens.replace(/-/g, '');
    // Génération du dernier nombre (4 chiffres)
    const endNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    // Formatage complet: STARTNUM-UUIDNOHYPHENS-ENDNUM (exemple: 9366-4020c9dda1204c2db26e5e2a0b5f1e9a-1205)
    this.id_User = `${startNum}-${uuidNoHyphens}-${endNum}`;
    
    this.token = generateUUID().substring(0,99);
  }

  postGreate(form:{ Prenom:string, Nom:string, Mail:string, Confirmation_Mail:string, Mot_De_Passe:string, Confirmation_Mot_De_Passe:string, Date_De_Naissance:string, Sex:string }):Observable<Creation[]>{
    const formValeur = {
      ...form,
      // Encoder les mots de passe pour gérer les caractères spéciaux (&, +, =)
      Mot_De_Passe: encodeURIComponent(form.Mot_De_Passe),
      Confirmation_Mot_De_Passe: encodeURIComponent(form.Confirmation_Mot_De_Passe),
      Id_User: this.id_User,
      Token: this.token,
      Statuss: '0000',
      Date_De_Creation: new Date(),
    }
    
    // Pour user=compte, le serveur lit php://input avec json_decode, donc envoyer en JSON
    return this.http.post<Creation[]>(`${environment.apiUrl}/controllers/index.php?user=compte`, formValeur);
  }
}
