import { Component, OnInit, signal } from '@angular/core';
import { SharedModule } from '../../../../shared/shared.module';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { CreationService } from '../../services/creation.service';
import { map, tap, catchError } from 'rxjs';
import { of } from 'rxjs';

@Component({
  selector: 'app-creation',
  standalone: true,
  imports: [
    SharedModule
  ],
  templateUrl: './creation.component.html',
  styleUrl: './creation.component.scss'
})
export class CreationComponent implements OnInit{

  form!: FormGroup;
  mailRegex!: RegExp;
  verificateur = "Création du compte efffectué avec success.";

  passwordValid = false;
  passwordTouched = false;
  passwordHasLength = false;
  passwordHasDigit = false;
  passwordHasSpecial = false;

  emailMatch = true;
  passwordMatch = true;
  
  // Système de feedback d'erreur
  shakeError = signal(false);
  errorMessage = signal<string | null>(null);
  isSubmitting = signal(false);

  constructor(
    private route : Router,
    private formbuilder: FormBuilder,
    private http: CreationService
  ){}

  /** Date du jour au format yyyy-mm-dd : borne max du champ date de naissance. */
  readonly maxBirthDate = new Date().toISOString().slice(0, 10);

  /** Refuse une date de naissance dans le futur (le champ date accepte sinon n'importe quelle date saisie au clavier). */
  static notInFutureValidator(control: AbstractControl): ValidationErrors | null {
    if (!control.value) return null;
    const today = new Date().toISOString().slice(0, 10);
    return control.value > today ? { futureDate: true } : null;
  }

  static strongPasswordValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value || '';
    // Au moins 8 caractères, 1 chiffre, 2 caractères spéciaux
    const regex = /^(?=(?:[^\d]*\d){1,})(?=(?:[^!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]){2,}).{8,}$/;
    return regex.test(value) ? null : { strongPassword: true };
  }

  ngOnInit(): void {
    // Regex email qui accepte majuscules et minuscules (case insensitive avec flag 'i')
    this.mailRegex = /^[_a-zA-Z0-9-]+(\.[_a-zA-Z0-9-]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(\.[a-zA-Z]{2,})$/i;

    this.form = this.formbuilder.group({
      Prenom : [null, [Validators.required]],
      Nom : [null, [Validators.required]],
      Mail : [null, [Validators.required, Validators.pattern(this.mailRegex)]],
      Confirmation_Mail : [null, [Validators.required]],
      Mot_De_Passe : [null, [Validators.required, CreationComponent.strongPasswordValidator]],
      Confirmation_Mot_De_Passe : [null, [Validators.required]],
      Date_De_Naissance : [null, [Validators.required, CreationComponent.notInFutureValidator]],
      Sex : ['Non spécifié', [Validators.required]],
      AcceptCGU : [false, [Validators.requiredTrue]],
    }, { validators: [this.matchingFieldsValidator('Mail', 'Confirmation_Mail', 'emailMatch'), this.matchingFieldsValidator('Mot_De_Passe', 'Confirmation_Mot_De_Passe', 'passwordMatch')] });

    // Feedback UI pour la validation du mot de passe en temps réel
    this.form.get('Mot_De_Passe')?.valueChanges.subscribe(val => {
      const password = val || '';
      this.passwordHasLength = password.length >= 8;
      this.passwordHasDigit = /\d/.test(password);
      this.passwordHasSpecial = (password.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g) || []).length >= 2;
      this.passwordValid = this.passwordHasLength && this.passwordHasDigit && this.passwordHasSpecial;
    });

    this.form.get('Confirmation_Mail')?.valueChanges.subscribe(() => {
      this.emailMatch = this.form.get('Mail')?.value === this.form.get('Confirmation_Mail')?.value;
    });
    this.form.get('Mail')?.valueChanges.subscribe(() => {
      this.emailMatch = this.form.get('Mail')?.value === this.form.get('Confirmation_Mail')?.value;
    });
    this.form.get('Confirmation_Mot_De_Passe')?.valueChanges.subscribe(() => {
      this.passwordMatch = this.form.get('Mot_De_Passe')?.value === this.form.get('Confirmation_Mot_De_Passe')?.value;
    });
    this.form.get('Mot_De_Passe')?.valueChanges.subscribe(() => {
      this.passwordMatch = this.form.get('Mot_De_Passe')?.value === this.form.get('Confirmation_Mot_De_Passe')?.value;
    });
  }

  onAnnuler(){
    this.route.navigateByUrl('connexion');
  }

  onSinscrire(){
    // Empêcher les soumissions multiples
    if (this.isSubmitting()) return;
    
    // Réinitialiser les messages d'erreur
    this.errorMessage.set(null);
    this.isSubmitting.set(true);
    
    // Convertir les emails en minuscules avant l'envoi (invisible pour l'utilisateur)
    const formData = {
      ...this.form.value,
      Mail: this.form.value.Mail?.toLowerCase().trim(),
      Confirmation_Mail: this.form.value.Confirmation_Mail?.toLowerCase().trim()
    };
    
    // Envoi des données et attente de la réponse
    this.http.postGreate(formData).pipe(
      tap((response: any) => {
        
        // Vérifier si le serveur indique un succès ou une erreur
        const message = response?.message || response?.Message || response?.etat || '';
        const isError = message.toLowerCase().includes('existe') || 
                        message.toLowerCase().includes('utilisé') ||
                        message.toLowerCase().includes('error') ||
                        message.toLowerCase().includes('erreur') ||
                        response?.error;
        
        if (isError) {
          // Email déjà utilisé - rediriger vers la page de connexion
          const emailExists = message.toLowerCase().includes('existe') || 
                              message.toLowerCase().includes('utilisé');
          
          if (emailExists) {
            // Stocker l'email et un flag pour la page de connexion
            localStorage.setItem('existing_account_email', formData.Mail);
            localStorage.setItem('existing_account_message', 'Un compte existe déjà pour cette adresse');
            this.isSubmitting.set(false);
            this.route.navigateByUrl('/connexion');
          } else {
            // Autre erreur - afficher le message
            this.triggerShake();
            this.errorMessage.set(message || 'Une erreur est survenue.');
            this.isSubmitting.set(false);
          }
        } else {
          // Succès - sauvegarder les infos et rediriger
          localStorage.setItem('temp_id_user', this.http.id_User);
          localStorage.setItem('temp_nom', formData.Nom);
          localStorage.setItem('temp_prenom', formData.Prenom);
          localStorage.setItem('temp_email', formData.Mail);
          localStorage.setItem('temp_token', this.http.token);
          
          this.form.reset();
          this.isSubmitting.set(false);
          this.route.navigateByUrl('connexion/validation');
        }
      }),
      catchError((error: any) => {
        console.error('❌ Erreur lors de la création:', error);
        
        // Extraire le message d'erreur
        let errorMsg = 'Une erreur est survenue. Veuillez réessayer.';
        if (error?.error?.message) {
          errorMsg = error.error.message;
        } else if (error?.error?.Message) {
          errorMsg = error.error.Message;
        } else if (typeof error?.error === 'string') {
          errorMsg = error.error;
        }
        
        // Vérifier si c'est une erreur d'email existant
        const emailExists = errorMsg.toLowerCase().includes('existe') || 
                            errorMsg.toLowerCase().includes('utilisé');
        
        if (emailExists) {
          // Rediriger vers la page de connexion avec l'email pré-rempli
          const formData = this.form.value;
          localStorage.setItem('existing_account_email', formData.Mail?.toLowerCase().trim() || '');
          localStorage.setItem('existing_account_message', 'Un compte existe déjà pour cette adresse');
          this.isSubmitting.set(false);
          this.route.navigateByUrl('/connexion');
        } else {
          this.triggerShake();
          this.errorMessage.set(errorMsg);
          this.isSubmitting.set(false);
        }
        
        return of(null);
      })
    ).subscribe();
  }
  
  private triggerShake() {
    this.shakeError.set(true);
    setTimeout(() => this.shakeError.set(false), 500);
  }
  showPassword = false;
  showConfirmPassword = false;

  onCheckboxChange(event: any): void {
    const isChecked = event.target.checked;
    this.form.patchValue({ AcceptCGU: isChecked });
  }

  onDirectCheckboxClick(): void {
    // Petite temporisation pour laisser Angular traiter le clic natif
    setTimeout(() => {
      const checkboxElement = document.getElementById('acceptCGU') as HTMLInputElement;
      if (checkboxElement) {
        const newValue = checkboxElement.checked;
        this.form.patchValue({ AcceptCGU: newValue });
      }
    }, 10);
  }

  toggleCheckbox(): void {
    const currentValue = this.form.get('AcceptCGU')?.value || false;
    const newValue = !currentValue;
    this.form.patchValue({ AcceptCGU: newValue });
    
    // Synchroniser avec l'élément HTML
    const checkboxElement = document.getElementById('acceptCGU') as HTMLInputElement;
    if (checkboxElement) {
      checkboxElement.checked = newValue;
    }
  }

  matchingFieldsValidator(field1: string, field2: string, prop: 'emailMatch' | 'passwordMatch') {
    return (group: FormGroup) => {
      const v1 = group.get(field1)?.value;
      const v2 = group.get(field2)?.value;
      this[prop] = v1 === v2;
      return v1 === v2 ? null : { notMatching: true };
    };
  }
}

