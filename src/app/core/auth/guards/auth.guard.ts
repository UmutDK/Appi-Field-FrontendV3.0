import { Injectable } from "@angular/core";
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot } from "@angular/router";
import { AuthService } from "../services/auth.service";
import { Observable, of, map, catchError } from "rxjs";

@Injectable({
    providedIn:"root"
})

export class AuthGuard implements CanActivate{
    
    constructor(
        private auth: AuthService,
        private router: Router
    ){}

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> | boolean {
        
        const token = localStorage.getItem('Token');
        
        // Pas de token = accès refusé
        if (!token) {
            this.router.navigate(['/'], {
                queryParams: { returnUrl: state.url },
                queryParamsHandling: 'merge'
            });
            return false;
        }

        // Vérifier si c'est un JWT ou un token simple
        const parts = token.split('.');
        
        if (parts.length === 3) {
            // Token JWT : validation synchrone
            if (this.auth.isTokenValid()) {
                return true;
            } else {
                this.auth.clearAuth();
                this.router.navigate(['/'], {
                    queryParams: { returnUrl: state.url },
                    queryParamsHandling: 'merge'
                });
                return false;
            }
        } else {
            
            return this.auth.validateTokenViaAPI(token).pipe(
                map(isValid => {
                    if (isValid) {
                        return true;
                    } else {
                        this.auth.clearAuth();
                        this.router.navigate(['/'], {
                            queryParams: { sessionExpired: 'true' },
                            queryParamsHandling: 'merge'
                        });
                        return false;
                    }
                }),
                catchError(() => {
                    this.auth.clearAuth();
                    this.router.navigate(['/'], {
                        queryParams: { sessionExpired: 'true' }
                    });
                    return of(false);
                })
            );
        }
    }
}
