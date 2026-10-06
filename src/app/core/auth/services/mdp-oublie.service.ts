import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, Observable, of, pipe } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Injectable()
export class MdpOublieService {

  mail!:any;

  constructor(
    private http:HttpClient
  ) { }

  onGet(mail: any): Observable<any> {
    const headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    return this.http.post<any>(`${environment.apiUrl}/controllers/index.php?user=mdp`, mail, { headers });
  }

  onInitMdp(code:string):Observable<any>{
    return this.http.get<any>(`${environment.apiUrl}/controllers/verification_mdp_oublie.php?code=${code}`).pipe(
      catchError(()=> of(false))
    );
  }

  getValeurMail(mail:any){
    this.mail = mail;
  }

  onModifMdp(mdp:string, confirmation_mdp:string):Observable<any>{
    const mail = this.mail;
    // encodeURIComponent est nécessaire car HttpClient encode à nouveau les params (double encodage)
    // PHP $_GET décode une fois → obtient encodeURIComponent(mdp), identique au format stocké lors de la création
    return this.http.get<any>(
      `${environment.apiUrl}/controllers/reinitialisation_mdp.php`,
      {
        params: {
          mail,
          mdp: encodeURIComponent(mdp),
          confirmation_mdp: encodeURIComponent(confirmation_mdp)
        }
      }
    );
  }
}
