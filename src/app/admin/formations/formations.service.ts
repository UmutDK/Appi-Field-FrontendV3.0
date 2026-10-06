import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Formation {
  formationId: string;
  day: string;
  month: string;
  title: string;
  location: string;
  time: string;
  link: string;
}

@Injectable({
  providedIn: 'root'
})
export class FormationsService {
  private readonly API_URL = `${environment.apiRegistre}/formations`;

  constructor(private http: HttpClient) {}

  /**
   * Récupère toutes les formations
   */
  getFormations(): Observable<Formation[]> {
    return this.http.get<Formation[]>(this.API_URL);
  }

  /**
   * Crée une nouvelle formation
   */
  createFormation(formation: Partial<Formation>): Observable<any> {
    return this.http.post(this.API_URL, formation);
  }

  /**
   * Met à jour une formation existante
   */
  updateFormation(formationId: string, formation: Partial<Formation>): Observable<any> {
    return this.http.put(`${this.API_URL}/${formationId}`, formation);
  }

  /**
   * Supprime une formation
   */
  deleteFormation(formationId: string): Observable<any> {
    return this.http.delete(`${this.API_URL}/${formationId}`);
  }

  /**
   * Déplace une formation (monter ou descendre)
   */
  moveFormation(formationId: string, direction: 'up' | 'down'): Observable<any> {
    return this.http.put(`${this.API_URL}/${formationId}/move`, { direction });
  }
}
