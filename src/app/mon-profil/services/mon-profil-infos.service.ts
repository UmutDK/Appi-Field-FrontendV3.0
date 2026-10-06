import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MonProfilInfos } from '../model/mon-profil-infos';

@Injectable()
export class MonProfilInfosService {
  constructor(private http: HttpClient) {}

  /** L'intercepteur ajoute le Bearer ; le serveur renvoie déjà le profil du bon utilisateur. */
  getInfosByUserId(): Observable<MonProfilInfos | undefined> {
    return this.http.get<MonProfilInfos | null>(`${environment.apiRegistre}/user_profile`) as Observable<MonProfilInfos | undefined>;
  }

  updateInfos(infos: MonProfilInfos): Observable<any> {
    return this.http.post(`${environment.apiRegistre}/user_profile`, infos);
  }
}
