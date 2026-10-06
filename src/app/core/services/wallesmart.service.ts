import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface WallesmartStatus {
  linked: boolean;
  mail: string | null;
}

@Injectable({ providedIn: 'root' })
export class WallesmartService {
  private readonly apiUrl = environment.apiRegistre + '/wallesmart/status';
  readonly connectUrl = 'https://portail.wallesmart.be/apps';

  constructor(private http: HttpClient) {}

  getStatus(): Observable<WallesmartStatus> {
    return this.http.get<WallesmartStatus>(this.apiUrl);
  }
}
