import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SharedModule } from '../../../../shared/shared.module';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { MdpOublieService } from '../../services/mdp-oublie.service';
import { tap } from 'rxjs';

@Component({
  selector: 'app-modifier-mdp',
  standalone: true,
  imports: [
    SharedModule
],
  templateUrl: './modifier-mdp.component.html',
  styleUrl: './modifier-mdp.component.scss'
})
export class ModifierMdpComponent implements OnInit{

  form!: FormGroup;

  passwordTouched = false;
  passwordHasLength = false;
  passwordHasDigit = false;
  passwordHasSpecial = false;
  passwordValid = false;
  passwordMatch = true;
  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private route: Router,
    private http: MdpOublieService,
    private formBuilder: FormBuilder
  ){}

  static strongPasswordValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value || '';
    const regex = /^(?=(?:[^\d]*\d){1,})(?=(?:[^!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]){2,}).{8,}$/;
    return regex.test(value) ? null : { strongPassword: true };
  }

  ngOnInit(): void {
    this.form = this.formBuilder.group({
      mdp: [null, [Validators.required, ModifierMdpComponent.strongPasswordValidator]],
      confirmation_mdp: [null, [Validators.required]],
    });

    this.form.get('mdp')?.valueChanges.subscribe(val => {
      const password = val || '';
      this.passwordHasLength = password.length >= 8;
      this.passwordHasDigit = /\d/.test(password);
      this.passwordHasSpecial = (password.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g) || []).length >= 2;
      this.passwordValid = this.passwordHasLength && this.passwordHasDigit && this.passwordHasSpecial;
      this.passwordMatch = this.form.get('mdp')?.value === this.form.get('confirmation_mdp')?.value;
    });

    this.form.get('confirmation_mdp')?.valueChanges.subscribe(() => {
      this.passwordMatch = this.form.get('mdp')?.value === this.form.get('confirmation_mdp')?.value;
    });
  }

  onAnnuler(){
    this.route.navigateByUrl('connexion/recuperer_mot_de_passe');
  }

  onModif(){
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    this.http.onModifMdp(this.form.value.mdp, this.form.value.confirmation_mdp).pipe(
      tap(() => {
        this.route.navigateByUrl('connexion');
      })
    ).subscribe();

    this.form.reset();
  }
}
