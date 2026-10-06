import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { environment } from '../../../../../environments/environment';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sso',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sso.component.html',
})
export class SsoComponent implements OnInit {

  errorMessage = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private adminService: AdminService,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/panel';

    if (!token) {
      this.router.navigateByUrl('/');
      return;
    }

    // Vider l'ancien état auth pour éviter les conflits avec une session existante
    //this.authService.clearAuth();

    this.http.get<any>(
      `${environment.apiUrl}/controllers/verification_token.php?token=${encodeURIComponent(token)}`
    ).subscribe({
      next: (response) => {
        if (!response || !response.Id_User) {
          this.errorMessage = 'Token invalide ou expiré.';
          return;
        }

        localStorage.setItem('Token',  token);
        localStorage.setItem('Ref',    response.Id_User ?? '');
        localStorage.setItem('Nom',    response.Nom     ?? '');
        localStorage.setItem('Prenom', response.Prenom  ?? '');
        localStorage.setItem('Mail',   response.Mail    ?? '');
        // 'Compte' sert de simple marqueur "connecté" (isConnect()) — le rôle admin réel
        // est vérifié séparément côté serveur via AdminService (GET /admin/status).
        localStorage.setItem('Compte', token);
        this.adminService.refreshAdminStatus();

        this.router.navigateByUrl(returnUrl);
      },
      error: () => {
        this.errorMessage = 'Impossible de valider le token. Veuillez réessayer.';
      }
    });
  }
}
