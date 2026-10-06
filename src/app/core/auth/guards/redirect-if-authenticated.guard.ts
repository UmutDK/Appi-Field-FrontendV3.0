import { Injectable } from "@angular/core";
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot } from "@angular/router";

@Injectable({
    providedIn: "root"
})
export class RedirectIfAuthenticatedGuard implements CanActivate {
    
    constructor(
        private router: Router
    ) {}

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
        const token = localStorage.getItem('Token');
        
        // Si l'utilisateur a un token, rediriger vers back-office
        if (token) {
            this.router.navigate(['/back-office']);
            return false;
        }
        
        // Sinon, permettre l'accès à la page d'accueil
        return true;
    }
}
