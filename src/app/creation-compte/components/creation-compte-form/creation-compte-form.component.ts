import { Component, inject, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CreationCompteService } from '../../services/creation-compte.service';
import { BanniereComponent } from "../../../accueil/components/banniere/banniere.component";
import { map, tap } from 'rxjs';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-creation-compte-form',
  standalone: true,
  imports: [
    SharedModule,
    MatTooltipModule,
    // BanniereComponent
],
  templateUrl: './creation-compte-form.component.html',
  styleUrl: './creation-compte-form.component.scss'
})
export class CreationCompteFormComponent implements OnInit{

  form!: FormGroup;
  isLoading = false;
  isSubmitting = false;
  submitError = '';
  userFullName = ''; // Pour stocker Nom et Prénom

  constructor(
    private formBluider : FormBuilder,
    private route: Router,
    private http: CreationCompteService
  ){}

  hppt2 = inject(CreationCompteService);
  
  signalIf = this.hppt2.signalId;

  ngOnInit(): void {
    this.isLoading = true;
    
    // Créer d'abord le formulaire avec id_user vide
    this.form = this.formBluider.group({
      id_user : [null],
      phytolicence : [null, []],
      exploiting_number : [null],
      adress : [null, [Validators.required]],
      postal : [null, [Validators.required, Validators.pattern(/^\d{4}$/)]],
      tva : [null],
      name : [null, [Validators.required]]
    });

    // 🔍 Recherche prioritaire: D'abord la Ref (utilisateur après validation d'email)
    let userRef = localStorage.getItem('Ref');
    
    //  Si Ref est vide, chercher temp_id_user (enregistrement en cours)
    if (!userRef || userRef === 'null') {
      userRef = localStorage.getItem('temp_id_user');
    }
    
    if (userRef) {
      // Récupérer aussi les infos utilisateur stockées
      const userEmail = localStorage.getItem('user_email') || localStorage.getItem('temp_email') || '';
      const userNom = localStorage.getItem('user_nom') || localStorage.getItem('temp_nom') || '';
      const userPrenom = localStorage.getItem('user_prenom') || localStorage.getItem('temp_prenom') || '';
      
      this.userFullName = `${userPrenom} ${userNom}`.trim();
      
      this.form.patchValue({ id_user: userRef });
      this.isLoading = false;
      return;
    }

    // Sinon, chercher un Token valide (utilisateur connecté)
    const token = localStorage.getItem('Token');
    if (token && token !== 'null') {      this.validateTokenAndLoadUser();
    } else {
      this.isLoading = false;
    }
    
    this.http.onGet().subscribe();
  }

  validateTokenAndLoadUser(){
    const token = localStorage.getItem('Token');
    return this.http.getTokenValidation(token).pipe(
      map(s => s),
      map((r:any) => ({
        id_user: r.Id_User,
        nom: r.Nom,
        prenom: r.Prenom,
      })),
      tap(v => {
        const fullIdUser = localStorage.getItem('Ref');
        const idUserToUse = fullIdUser && fullIdUser !== 'null' ? fullIdUser : v.id_user;
        
        this.userFullName = `${v.prenom} ${v.nom}`.trim();
        this.form.patchValue({
          id_user: idUserToUse
        });
        //  NE PAS écraser localStorage['Ref'] avec la partie tronquée du token validation
        localStorage.setItem('user_nom', v.nom);
        localStorage.setItem('user_prenom', v.prenom);
        this.isLoading = false;
        this.onValuerCompte(idUserToUse);
      }),
      tap(null, error => {
        console.error('❌ Erreur lors de la validation du token:', error);
        this.isLoading = false;
      })
    ).subscribe();
  }

  onValuerCompte(idUser:any){
    this.http.getVerifCompte(idUser);
  }

  onSuivant(){
    
    //  MÉTHODE IDENTIQUE AUX PARCELLES: Vérifier que l'utilisateur est connecté (a un Token)
    const token = localStorage.getItem('Token');
    if (!token || token === 'null') {
      alert('Erreur: Vous devez être connecté pour créer votre compte. Veuillez vous connecter.');
      this.route.navigate(['/']);
      return;
    }
    
    // Attendre la réponse du serveur : redirection seulement si l'enregistrement a réussi
    this.isSubmitting = true;
    this.submitError = '';
    this.http.onPost({ ...this.form.value, postal: Number(this.form.value.postal) }).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.form.reset();
        // Rediriger vers la page de connexion avec un message de succès
        this.route.navigate(['/'], {
          queryParams: { accountCreated: 'true' }
        });
      },
      error: (error) => {
        console.error('Erreur lors de l\'enregistrement de l\'exploitation:', error);
        this.isSubmitting = false;
        this.submitError = "L'enregistrement n'a pas abouti. Vérifiez votre connexion puis réessayez.";
      }
    });
    
  }

  /** Code postal belge : chiffres uniquement, 4 au maximum. */
  onPostalCodeInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = value;
    this.form.get('postal')?.setValue(value, { emitEvent: false });
  }

  /** Champ obligatoire quitté vide (ou code postal invalide) → message sous le champ. */
  showError(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.touched && c.invalid;
  }

  onPhytolicenceInput(event: Event) {
  const input = event.target as HTMLInputElement;
  let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); // garde uniquement lettres et chiffres

  // Ajoute les points en suivant le pattern XX.X.XXXX
  if (value.length > 2) value = value.slice(0, 2) + '.' + value.slice(2);
  if (value.length > 4) value = value.slice(0, 4) + '.' + value.slice(4);

  input.value = value;
}

onNumeroTVAInput(event: Event) {
  const input = event.target as HTMLInputElement;

  // Supprime tout sauf chiffres
  let value = input.value.replace(/[^0-9]/g, '');

  // Ajoute l'espace BE + formate en 0123.456.789
  if (value.length > 4) value = value.slice(0, 4) + '.' + value.slice(4);
  if (value.length > 7) value = value.slice(0, 8) + '.' + value.slice(8);

  input.value = 'BE ' + value;
}

}

