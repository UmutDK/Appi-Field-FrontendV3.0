import { Component, OnInit } from '@angular/core';
import { SharedModule } from '../../../../shared/shared.module';
import { Router } from '@angular/router';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { ValidationCompteService } from '../../services/validation-compte.service';
import { map, tap } from 'rxjs';
import { BanniereComponent } from "../../../../accueil/components/banniere/banniere.component";

@Component({
  selector: 'app-validation-compte',
  standalone: true,
  imports: [
    SharedModule,
    BanniereComponent
],
  templateUrl: './validation-compte.component.html',
  styleUrl: './validation-compte.component.scss'
})
export class ValidationCompteComponent implements OnInit{

  formCTRL!: FormControl;
  message = "ok";

  constructor(
    private route:Router,
    private formBuilder:FormBuilder,
    private http:ValidationCompteService
  ){}

  ngOnInit(): void {
    this.formCTRL = this.formBuilder.control('', Validators.required);
  }

  onAnnuler(){
    this.route.navigateByUrl("connexion/creation_compte");
  }

  onValider(){
    
    this.http.postValidation(this.formCTRL.value).pipe(
      tap((rawResponse: any) => {
      }),
      map((r: any) => {
        const nom = localStorage.getItem('temp_nom') || r.Nom || '';
        const prenom = localStorage.getItem('temp_prenom') || r.Prenom || '';
        const email = localStorage.getItem('temp_email') || r.Mail || '';
        
        return {
          message: r.message || r.Message || 'ok',
          idUser: r.Id_User || localStorage.getItem('temp_id_user'),
          token: r.Token || null,
          email: email,
          nom: nom,
          prenom: prenom
        };
      }),
      tap(s => {
        
        if(this.message === s.message){
          
          if (s.token && s.idUser) {
            localStorage.setItem('Token', s.token);
            localStorage.setItem('Ref', s.idUser);
            localStorage.setItem('Nom', s.nom);
            localStorage.setItem('Prenom', s.prenom);
            localStorage.setItem('Mail', s.email);
            localStorage.setItem('user_email', s.email);
            localStorage.setItem('user_nom', s.nom);
            localStorage.setItem('user_prenom', s.prenom);
            
            // Nettoyer les données temporaires
            localStorage.removeItem('temp_id_user');
            localStorage.removeItem('temp_nom');
            localStorage.removeItem('temp_prenom');
            localStorage.removeItem('temp_email');
            localStorage.removeItem('temp_token');
            
            this.formCTRL.reset();
            
            // Redirection directe vers le formulaire
            setTimeout(() => {
              this.route.navigateByUrl('creation-compte/creation-compte-info-personel');
            }, 100);
          } else {
            // Pas de token reçu - rediriger vers connexion
            localStorage.setItem('account_creation_pending', 'true');
            localStorage.setItem('user_email', s.email);
            localStorage.setItem('user_nom', s.nom);
            localStorage.setItem('user_prenom', s.prenom);
            
            localStorage.removeItem('temp_id_user');
            localStorage.removeItem('temp_nom');
            localStorage.removeItem('temp_prenom');
            localStorage.removeItem('temp_email');
            localStorage.removeItem('temp_token');
            
            this.formCTRL.reset();
            
            alert('Votre email a été validé ! Veuillez maintenant vous re-connecter pour finaliser la création de votre compte.');
            setTimeout(() => {
              this.route.navigate(['/'], { queryParams: { emailValidated: 'true' } });
            }, 100);
          }
        } else {
          alert(s.message);
        }
      })
    ).subscribe();
  }
}
