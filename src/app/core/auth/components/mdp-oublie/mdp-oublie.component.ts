import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MdpOublieService } from '../../services/mdp-oublie.service';
import { SharedModule } from '../../../../shared/shared.module';
import { catchError, map, of, tap } from 'rxjs';
import { BanniereComponent } from "../../../../accueil/components/banniere/banniere.component";

@Component({
  selector: 'app-mdp-oublie',
  standalone: true,
  imports: [
    SharedModule,
    BanniereComponent
],
  templateUrl: './mdp-oublie.component.html',
  styleUrl: './mdp-oublie.component.scss'
})
export class MdpOublieComponent implements OnInit{

  mail!: FormGroup;
  mailRegex!:RegExp;
  message = "La valeur est correcte";

  constructor(
    private route: Router,
    private formBuilder: FormBuilder,
    private http : MdpOublieService
  ){}

  ngOnInit(): void {
    // Même règle que la connexion et l'inscription (auparavant : minuscules et extension de 2-3 lettres
    // seulement, ce qui bloquait p.ex. Jean@Gmail.com ou jean@ferme.info).
    this.mailRegex = /^[_a-zA-Z0-9-]+(\.[_a-zA-Z0-9-]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(\.[a-zA-Z]{2,})$/i;
    this.mail = this.formBuilder.group({
      mail : [null, [Validators.required, Validators.pattern(this.mailRegex)]]
    });
  }

  isLoading = false;

  onAnnuler(){
    this.route.navigateByUrl('connexion');
  }

  onvalider(){
    this.isLoading = true;
    this.http.onGet(this.mail.value).pipe(
      map(r => r),
      map((v:any)=>({
        message: v.Message
      })),
      tap(s => {
        this.isLoading = false;
        if(this.message === s.message){
          this.route.navigateByUrl('connexion/recuperer_mot_de_passe');
        }else{
          alert(s.message);
        }
      }),
      catchError(() => {
        this.isLoading = false;
        alert('Le serveur ne répond pas. Veuillez réessayer dans quelques instants.');
        return of(null);
      })
    ).subscribe();
    this.mail.reset();
  }
}
