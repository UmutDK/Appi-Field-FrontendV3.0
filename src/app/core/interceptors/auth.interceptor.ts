import { HttpEvent, HttpHandler, HttpHeaders, HttpInterceptor, HttpRequest, HttpErrorResponse } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable, throwError } from "rxjs";
import { catchError } from 'rxjs/operators';
import { Router } from "@angular/router";
import { AuthService } from "../auth/services/auth.service";
import { MandatWorkspaceService } from "../services/mandat-workspace.service";
import { environment } from "../../../environments/environment";

@Injectable()

export class AuthInterceptor implements HttpInterceptor{

    constructor(
        private authService : AuthService,
        private router: Router,
        private mandatWorkspace: MandatWorkspaceService
    ){}

    intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        // ⚠️ Endpoints qui ne nécessitent PAS d'authentification (vérification email, création user avant login)
        const publicEndpoints = [
            'user=verification_mail',
            'user=creation_user',
            'user=compte',      // Création de compte
            'user=connexion',   // Connexion
            'verify_session.php' // Proxy SSO — le token est dans l'URL, pas le Bearer
        ];

        // Vérifier si la requête est vers un endpoint public
        const isPublicEndpoint = publicEndpoints.some(endpoint => req.url.includes(endpoint));

        // Si c'est un endpoint public, ne pas ajouter le token
        if (isPublicEndpoint) {
            return next.handle(req).pipe(
                catchError((error: HttpErrorResponse) => {
                    return throwError(() => error);
                })
            );
        }

        // Pour tous les autres endpoints, ajouter le token (y compris les POST pour exploitations et users_infos)
        const token = this.authService.getToken();

        // Ne pas envoyer "Bearer null" ou "Bearer undefined" — PHP recevrait une chaîne invalide
        // et retournerait 401 même si l'utilisateur est en cours de connexion.
        if (!token || token === 'null' || token === 'undefined') {
            return next.handle(req).pipe(
                catchError((error: HttpErrorResponse) => throwError(() => error))
            );
        }

        let headers = new HttpHeaders().append('Authorization', `Bearer ${token}`);

        // Ajouter le header X-Workspace-UserId si on est dans l'espace d'un autre utilisateur
        // (uniquement pour les requêtes vers l'API registre, et jamais depuis /reglage)
        const workspaceUserId = this.mandatWorkspace.getWorkspaceHeader();
        const isReglageRoute = this.router.url.startsWith('/reglage');
        if (workspaceUserId && req.url.startsWith(environment.apiRegistre) && !isReglageRoute) {
            headers = headers.append('X-Workspace-UserId', workspaceUserId);
        }

        const modifiedReq = req.clone({ headers });

        return next.handle(modifiedReq).pipe(
            catchError((error: HttpErrorResponse) => {
                // 🔐 Détecter les erreurs d'authentification (401 Unauthorized)
                if (error.status === 401) {
                    const tokenBeforeError = this.authService.getToken();
                    // Ne rediriger que s'il y avait réellement un token valide :
                    // évite d'éjecter l'utilisateur quand Bearer null génère un 401
                    // (ex: header charge mandats_handler.php pendant le flow SSO)
                    if (tokenBeforeError && tokenBeforeError !== 'null' && tokenBeforeError !== 'undefined') {
                        this.authService.clearAuth();
                        this.router.navigate(['/'], {
                            queryParams: {
                                sessionExpired: 'true',
                                returnUrl: this.router.url
                            }
                        });
                    }
                }

                // Relancer l'erreur pour que les composants puissent la gérer
                return throwError(() => error);
            })
        );
    }
}

