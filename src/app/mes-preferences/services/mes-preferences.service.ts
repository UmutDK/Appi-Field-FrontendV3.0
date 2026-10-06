import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Observable, tap } from 'rxjs';

@Injectable()
export class MesPreferencesService {

  signalGetAll = signal<any[]>([]);
  signalGetId = signal<string>('');

  constructor(private http: HttpClient) { }

    get():Observable<any>{
      return this.http.get<any>(`${environment.apiRegistre}/preferences`).pipe(
        tap((prefs) => this.signalGetAll.set(prefs ? [prefs] : []))
      )
    }

    onPost(form:{encodageDuTraitement:string, typeDePulverisateur:string, maraichage:string, grandesCultures:string, culturesFourrageres:string, plantesOrnementales:string, arboriculture:string, pepinieresForestieresEtViticultureSapinsDeNoel:string}){
      const payload = {
        sprayerType: form.typeDePulverisateur,
        treatmentEncodingMode: form.encodageDuTraitement,
        trackLargeCrops: !!form.grandesCultures,
        trackMarketGardening: !!form.maraichage,
        trackForageCrops: !!form.culturesFourrageres,
        trackOrnamentalPlants: !!form.plantesOrnementales,
        trackArboriculture: !!form.arboriculture,
        trackNurseriesViticultureChristmasTrees: !!form.pepinieresForestieresEtViticultureSapinsDeNoel,
      };

      this.http.post<any>(`${environment.apiRegistre}/preferences`, payload).pipe(
        tap(() => this.signalGetAll.set([payload]))
      ).subscribe();
    }

    getTokenValidation(token:any):Observable<any>{
      return this.http.get<any>(`${environment.apiUrl}/controllers/verification_token.php?token=${token}`);
    }

    onGetId(id:string){
      this.signalGetId.set(id);
    }
}
