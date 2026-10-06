import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Observable, tap } from 'rxjs';
import { GestionDesOperations } from '../model/gestion-des-operations';

@Injectable()
export class GestionDesOperationsService {

  signal = signal<GestionDesOperations[]>([]);

  constructor(
    private http:HttpClient,
  ) { }

  onPost(form:{name:string, phytolicence:string}){
    const payload = { operatorName: form.name, operatorPhytolicence: form.phytolicence };
    this.http.post<any>(`${environment.apiRegistre}/operators`, payload).pipe(
      tap(() => this.onGet().subscribe())
    ).subscribe();
  }

  onGet():Observable<GestionDesOperations[]> {
    return this.http.get<GestionDesOperations[]>(`${environment.apiRegistre}/operators`).pipe(
      tap(r => this.signal.set(r))
    );
  }

  onDelet(id:string){
    this.http.delete<any>(`${environment.apiRegistre}/operators/${id}`).pipe(
      tap(() => this.onGet().subscribe())
    ).subscribe();
  }
}
