import { Component, inject, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { MdpService } from '../../services/mdp.service';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const news = group.get('mdp_news')?.value;
  const confirme = group.get('mdp_confirme')?.value;
  return news && confirme && news !== confirme ? { mismatch: true } : null;
}

function strongPasswordValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value || '';
  // Au moins 8 caractères, 1 chiffre, 2 caractères spéciaux
  const regex = /^(?=(?:[^\d]*\d){1,})(?=(?:[^!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]){2,}).{8,}$/;
  return regex.test(value) ? null : { strongPassword: true };
}

@Component({
  selector: 'app-password',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './password.component.html',
  styleUrl: './password.component.scss'
})
export class PasswordComponent implements OnInit {

  form!: FormGroup;
  saving = false;
  successMsg = '';
  errorMsg = '';

  show = { actuel: false, news: false, confirme: false };

  passwordTouched = false;
  passwordHasLength = false;
  passwordHasDigit = false;
  passwordHasSpecial = false;
  passwordMatch = true;

  private fb = inject(FormBuilder);
  private http = inject(MdpService);

  ngOnInit(): void {
    this.form = this.fb.group({
      mdp_actuel:  ['', [Validators.required]],
      mdp_news:    ['', [Validators.required, strongPasswordValidator]],
      mdp_confirme:['', [Validators.required]]
    }, { validators: passwordsMatch });

    this.form.get('mdp_news')!.valueChanges.subscribe(val => {
      const password = val || '';
      this.passwordHasLength = password.length >= 8;
      this.passwordHasDigit = /\d/.test(password);
      this.passwordHasSpecial = (password.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g) || []).length >= 2;
      this.passwordMatch = this.form.get('mdp_news')?.value === this.form.get('mdp_confirme')?.value;
    });

    this.form.get('mdp_confirme')?.valueChanges.subscribe(() => {
      this.passwordMatch = this.form.get('mdp_news')?.value === this.form.get('mdp_confirme')?.value;
    });
  }

  onSubmit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    this.saving = true;
    this.successMsg = '';
    this.errorMsg = '';

    const { mdp_actuel, mdp_news, mdp_confirme } = this.form.value;

    this.http.post({ mdp_actuel, mdp_news, mdp_confirme }).subscribe({
      next: () => {
        this.saving = false;
        this.successMsg = 'Mot de passe modifié avec succès !';
        this.form.reset();
        this.show = { actuel: false, news: false, confirme: false };
        this.passwordHasLength = false;
        this.passwordHasDigit = false;
        this.passwordHasSpecial = false;
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = err?.error?.message || 'Le mot de passe actuel est incorrect ou une erreur est survenue.';
      }
    });
  }
}
