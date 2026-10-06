import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Router } from '@angular/router';

@Injectable()
export class CreationCompteService {

  id!:any;
  id_user!:any;
  succes!:any;

  signalVerifCompte = signal<any[]>([]);
  signalId = signal<string>("");
  constructor(
    private http : HttpClient,
    private router : Router
  ) { }

  // Renvoie l'Observable (profil puis exploitation) pour que la page attende la réponse du
  // serveur avant de rediriger, et puisse afficher une erreur si l'enregistrement échoue.
  onPost(form:{id_user?: string, nom?: string, prenom?: string, phytolicence:string, exploiting_number:string, adress:string, postal:number, tva:string, name:string }): Observable<any>{

    const formulaire = {
      userId: form.id_user,
      exploitationName: form.name,
      exploitationAddress: form.adress,
      exploitationPostalCode: form.postal,
      vatNumber: form.tva,
      responsiblePhytolicence: form.phytolicence,
    };
    const userAddNews = {
      phytolicence: form.phytolicence,
      exploitingNumber: form.exploiting_number,
    };

    // POST /user_profile nécessite le Bearer (ajouté par l'intercepteur) ; POST /exploitations
    // est la route publique de bootstrap et prend userId directement dans le body.
    return this.http.post<any>(`${environment.apiRegistre}/user_profile`, userAddNews).pipe(
      switchMap(() => this.http.post<any>(`${environment.apiRegistre}/exploitations`, formulaire))
    );
  }

  onGet():Observable<any>{
    return this.http.get<any>(`${environment.apiRegistre}/user_profile`).pipe(
      tap(r => this.onUpdateSignal())
    );
  }

  onGetId(){}

  onPut(){}

  onDelet(){}

  getTokenValidation(token:any):Observable<any>{
    return this.http.get<any>(`${environment.apiUrl}/controllers/verification_token.php?token=${token}`);
  }

  onUpdateSignal(){
    this.http.get<any>(`${environment.apiRegistre}/user_profile`).pipe(
      tap(profile => {
        const list = profile ? [profile] : [];
        this.signalVerifCompte.set(list);
        if(list.length > 0){
          this.router.navigateByUrl('mes-preferences');
        }
      })
    ).subscribe();
  }

  getVerifCompte(id:any):any{
   this.signalId.set(id)
  }

}
