import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Observable, tap } from 'rxjs';

@Injectable()
export class ReglageService {

  signal = signal<any[]>([]);

  constructor(
    private http: HttpClient
  ) { }

  onPost(form: { name: string, phytolicence: string }) {
    const payload = { operatorName: form.name, operatorPhytolicence: form.phytolicence };
    this.http.post<any>(`${environment.apiRegistre}/operators`, payload).pipe(
      tap(() => this.onGet().subscribe())
    ).subscribe();
  }

  onGet(): Observable<any[]> {
    return this.http.get<any[]>(`${environment.apiRegistre}/operators`).pipe(
      tap(r => this.signal.set(r))
    );
  }

  onDelet(id: string) {
    this.http.delete<any>(`${environment.apiRegistre}/operators/${id}`).pipe(
      tap(() => this.onGet().subscribe())
    ).subscribe();
  }

  onPut(id: string, data: { name: string, phytolicence: string }): Observable<any> {
    return this.http.put<any>(
      `${environment.apiRegistre}/operators/${id}`,
      { operatorName: data.name, operatorPhytolicence: data.phytolicence }
    ).pipe(
      tap(() => this.onGet().subscribe())
    );
  }

}
