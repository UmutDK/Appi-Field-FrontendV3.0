import { Component, OnInit, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import { SharedModule } from '../../../../shared/shared.module';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { catchError, map, of, tap } from 'rxjs';
import { BanniereComponent } from "../../../../accueil/components/banniere/banniere.component";

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [
    SharedModule,
    BanniereComponent
],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.scss'
})
export class AuthComponent implements OnInit{

  form!: FormGroup;
  mailRegex!:RegExp;
  token = signal("");
  sessionExpiredMessage = signal<string | null>(null);
  returnUrl: string = '/back-office';
  showPassword = false;
  shakeError = signal(false);
  errorMessage = signal<string | null>(null);
  
  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private formBuilder: FormBuilder,
    private http: AuthService,
    private authService: AuthService
  ){}

  ngOnInit(): void {
    // Regex email qui accepte majuscules et minuscules (case insensitive)
    this.mailRegex = /^[_a-zA-Z0-9-]+(\.[_a-zA-Z0-9-]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(\.[a-zA-Z]{2,})$/i;
    this.form = this.formBuilder.group({
      login: [null,[Validators.required, Validators.pattern(this.mailRegex)]],
      mdp: [null,[Validators.required]]
    });

    // � Détecter si l'utilisateur vient de la page de création avec un email existant
    const existingEmail = localStorage.getItem('existing_account_email');
    const existingMessage = localStorage.getItem('existing_account_message');
    if (existingEmail && existingMessage) {
      // Pré-remplir l'email
      this.form.patchValue({ login: existingEmail });
      // Afficher le message
      this.errorMessage.set(existingMessage);
      // Nettoyer le localStorage
      localStorage.removeItem('existing_account_email');
      localStorage.removeItem('existing_account_message');
    }

    // �🔐 Détecter si l'utilisateur a été redirigé pour cause de session expirée
    this.route.queryParams.subscribe(params => {
      if (params['sessionExpired'] === 'true') {
        this.sessionExpiredMessage.set('⚠️ Votre session a expiré. Veuillez vous reconnecter.');
        
        // Cacher le message après 8 secondes
        setTimeout(() => {
          this.sessionExpiredMessage.set(null);
        }, 8000);
      }
      
      // Sauvegarder l'URL de destination après connexion
      if (params['returnUrl']) {
        this.returnUrl = params['returnUrl'];
      }
    });
  }

  onConnexion(){
    // Convertir l'email en minuscules avant l'envoi
    const mail = this.form.value.login?.toLowerCase().trim();
    const formData = {
      login: mail,
      mdp: this.form.value.mdp
    };
    
    
    this.http.post(formData).pipe(
      map(r => {
        return r;
      }),
      map((s:any) => ({
        Token : s.Etat.Token,
        Id : s.Etat.Id_User,
        Attribut : s.Etat.Statuss,
        Nom : s.Etat.Nom,
        Prenom : s.Etat.Prenom,
        Mail : s.Etat.Mail,
      })),
      tap(v => {
        if(v.Token){
          if(v.Mail === mail){
            this.token.set(v.Token);
            this.setValuer(v.Id, v.Nom, v.Prenom, v.Mail, v.Attribut, v.Token);
            //  Reset le formulaire uniquement si la connexion réussit
            this.form.reset();
          }else{
            this.triggerShake();
          }
        }else{
          this.triggerShake();
        }
      }),
      catchError(()=> of(this.erreurMdp(false)))
    ).subscribe();
  }

  setValuer(id:string, nom:string, Prenom:string, mail:string, attribut:string, token:string){
    localStorage.setItem('Ref', id);
    localStorage.setItem('Nom', nom);
    localStorage.setItem('Prenom', Prenom);
    localStorage.setItem('Mail', mail);
    localStorage.setItem('Compte', attribut);
    localStorage.setItem('Token', token);
    
    //  MÉTHODE IDENTIQUE AUX PARCELLES: Vérifier si la création de compte est en attente
    const accountCreationPending = localStorage.getItem('account_creation_pending');
    if (accountCreationPending === 'true') {
      localStorage.removeItem('account_creation_pending');
      localStorage.removeItem('validation_pending');
      // Rediriger vers le formulaire de création de compte (l'id_user sera ajouté par le serveur via le token)
      this.router.navigateByUrl('creation-compte/creation-compte-info-personel');
      return;
    }
    
    const validationPending = localStorage.getItem('validation_pending');
    if (validationPending === 'true') {
      this.createOperatorOnFirstLogin(id, nom, Prenom);
      localStorage.removeItem('validation_pending');
    }
    
    // Rediriger vers l'URL de destination sauvegardée
    this.router.navigateByUrl(this.returnUrl);
  }

  /**
   * Crée automatiquement l'entrée opérateur lors de la première connexion
   */
  private createOperatorOnFirstLogin(id_user: string, nom: string, prenom: string) {
    // Récupérer les infos de l'utilisateur
    this.authService.getUserInfos().subscribe({
      next: (userInfos: any) => {
        const phytolicence = userInfos?.phytolicence || '';

        // Créer l'entrée opérateur
        const operatorEntry = {
          operatorName: `${nom} ${prenom}`,
          operatorPhytolicence: phytolicence,
        };

        this.authService.createOperator(operatorEntry).subscribe({
          next: () => console.log(''),
          error: (err: any) => console.error('Erreur création opérateur:', err)
        });
      },
      error: (err: any) => console.error('Erreur récupération infos utilisateur:', err)
    });
  }

  erreurMdp(valeur:boolean){
    if(valeur === false){
      this.triggerShake();
    }
  }

  private triggerShake() {
    this.shakeError.set(true);
    this.errorMessage.set("L'adresse mail ou le mot de passe mentionné n'est pas correct");
    setTimeout(() => this.shakeError.set(false), 500);
  }

  onUdpate(){
    this.router.navigateByUrl('/connexion/mis_a_jour');
  }
}
