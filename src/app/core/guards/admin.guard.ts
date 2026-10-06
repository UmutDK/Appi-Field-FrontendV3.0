import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AdminService } from '../services/admin.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {
  constructor(
    private adminService: AdminService,
    private router: Router
  ) {}

  canActivate(): boolean {
    if (this.adminService.isAdmin()) {
      return true;
    }
    
    // Rediriger vers la page d'accueil si non admin
    this.router.navigate(['/']);
    return false;
  }
}
