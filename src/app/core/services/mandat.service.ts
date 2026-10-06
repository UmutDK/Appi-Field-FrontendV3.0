import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Mandat {
  mandateId: string;
  mandateName: string;
  createdAt: string;
  modifiedAt: string;
  status: 'pending' | 'accepted' | 'refused';
  ownerUserId: string;
  ownerUserMail: string;
  mandateUserId: string | null;
  mandateUserMail: string;
}

@Injectable({ providedIn: 'root' })
export class MandatService {
  private readonly apiUrl = environment.apiRegistre + '/mandates';

  mandats = signal<Mandat[]>([]);
  isLoading = signal<boolean>(false);

  constructor(private http: HttpClient) {}

  /** Charge les mandats du user connecté (owner + mandaté) */
  loadMandats(): void {
    this.isLoading.set(true);
    this.http.get<Mandat[]>(this.apiUrl).subscribe({
      next: (data) => {
        this.mandats.set(data ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.mandats.set([]);
        this.isLoading.set(false);
      }
    });
  }

  /** Envoie une demande de mandat vers une adresse mail */
  createMandat(mandateUserMail: string): Observable<any> {
    return this.http.post<any>(this.apiUrl, { mandateUserMail });
  }

  /** Accepte ou refuse un mandat */
  updateMandatStatut(mandateId: string, status: 'accepted' | 'refused'): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${mandateId}`, { status });
  }

  /** Supprime un mandat */
  deleteMandat(mandateId: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${mandateId}`);
  }
}
