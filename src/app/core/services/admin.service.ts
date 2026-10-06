import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  // Signal pour stocker le statut admin
  isAdmin = signal<boolean>(false);

  constructor(private http: HttpClient) {
    this.checkAdminStatus();
  }

  /**
   * Vérifie si l'utilisateur connecté est admin (contrôle serveur, table `admins`)
   */
  checkAdminStatus(): void {
    const token = localStorage.getItem('Token');

    if (!token) {
      this.isAdmin.set(false);
      return;
    }

    this.getAdminStatus().subscribe({
      next: (isAdmin) => this.isAdmin.set(isAdmin),
      error: () => this.isAdmin.set(false)
    });
  }

  private getAdminStatus(): Observable<boolean> {
    return this.http.get<{ isAdmin: boolean }>(`${environment.apiRegistre}/admin/status`).pipe(
      map(response => !!response?.isAdmin),
      catchError(() => of(false))
    );
  }

  /**
   * Rafraîchit le statut admin (appelé après login/logout)
   */
  refreshAdminStatus(): void {
    this.checkAdminStatus();
  }
}
