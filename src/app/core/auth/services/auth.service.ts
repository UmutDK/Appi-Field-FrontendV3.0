import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, tap} from 'rxjs';
import { environment } from '../../../../environments/environment';

@Injectable()
export class AuthService {

  token!:any;

  // Cache client du dernier token "simple" validé avec succès — évite de relancer un aller-retour
  // réseau (validateTokenViaAPI) à chaque navigation. Sans ça, cliquer plusieurs fois vite dans la
  // sidebar déclenche plusieurs vérifications asynchrones qui se chevauchent, et le Router Angular
  // reste bloqué en attente de l'une d'elles (navigation qui ne répond plus après 2-3 clics rapides).
  private validatedSimpleToken: { token: string; timestamp: number } | null = null;
  private readonly SIMPLE_TOKEN_CACHE_TTL_MS = 60_000;

  constructor(
    private http:HttpClient,
  ) { }

  getToken():any{
    return this.token = localStorage.getItem("Token");
  }

  /**
   * 🔐 Vérifie si le token est valide (présent et non expiré)
   * Pour les tokens JWT : vérifie l'expiration localement
   * Pour les tokens simples : fait un appel API
   * @returns true si le token est valide, false sinon
   */
  isTokenValid(): boolean {
    const token = this.getToken();
    
    
    if (!token) {
      return false;
    }

    // Vérifier si le token est un JWT (format: header.payload.signature)
    const parts = token.split('.');
    
    if (parts.length === 3) {
      try {
        // Décoder le payload (partie centrale du JWT)
        const payload = JSON.parse(atob(parts[1]));
        
        // Vérifier l'expiration (exp est en secondes, Date.now() en millisecondes)
        if (payload.exp) {
          const expirationDate = new Date(payload.exp * 1000);
          const now = new Date();
          const isExpired = payload.exp * 1000 < Date.now();
          
          
          if (isExpired) {
            this.clearAuth();
            return false;
          }
        }
        
        return true;
      } catch (error) {
        this.clearAuth();
        return false;
      }
    }
    
    
    // Pour éviter de bloquer la navigation, on retourne true ici
    // La validation réelle se fera via l'intercepteur ou les composants
    return true;
  }

  /**
   * 🔐 Vérifie la validité du token via l'API (pour tokens simples)
   * @returns Observable<boolean> true si le token est valide, false sinon
   */
  validateTokenViaAPI(token: string): Observable<boolean> {
    // Token déjà validé récemment : on répond immédiatement (Observable déjà résolu), sans repartir
    // en réseau. Évite d'empiler plusieurs vérifications asynchrones en vol quand on navigue vite
    // (chaque navigation vers une route protégée appelle cette méthode).
    if (
      this.validatedSimpleToken?.token === token &&
      (Date.now() - this.validatedSimpleToken.timestamp) < this.SIMPLE_TOKEN_CACHE_TTL_MS
    ) {
      return of(true);
    }

    return this.http.get<any>(`${environment.apiRegistre}/session/verify`).pipe(
      map(response => !!(response && response.valid)),
      tap(isValid => {
        if (isValid) {
          this.validatedSimpleToken = { token, timestamp: Date.now() };
        }
      }),
      catchError(() => {
        // Erreur réseau / serveur indisponible ≠ token invalide.
        // On garde l'utilisateur connecté : le serveur validera à chaque requête de données.
        return of(true);
      })
    );
  }

  /**
   * 🧹 Nettoie toutes les données d'authentification
   */
  clearAuth(): void {
    localStorage.removeItem('Token');
    localStorage.removeItem('Ref');
    localStorage.removeItem('Nom');
    localStorage.removeItem('Prenom');
    localStorage.removeItem('Mail');
    localStorage.removeItem('Compte');
  }

  /**
   * 🔓 Déconnexion complète
   */
  logout(): void {
    this.clearAuth();
  }

  post(form : {login:string, mdp:string}):Observable<any>{
    // Encoder le mot de passe pour gérer les caractères spéciaux (&, +, =)
    const encodedForm = {
      login: form.login,
      mdp: encodeURIComponent(form.mdp)
    };
    return this.http.post<any>(`${environment.apiUrl}/controllers/index.php?user=connexion`, encodedForm);
  }

  /**
   * Récupère le profil déclaratif (phytolicence, n° exploitant) de l'utilisateur connecté
   */
  getUserInfos(): Observable<any> {
    return this.http.get<any>(`${environment.apiRegistre}/user_profile`);
  }

  /**
   * Crée une entrée opérateur
   */
  createOperator(operatorData: { operatorName: string; operatorPhytolicence?: string; exploitationId?: string }): Observable<any> {
    return this.http.post<any>(`${environment.apiRegistre}/operators`, operatorData);
  }

}
