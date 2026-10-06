import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SharedModule } from '../../../../shared/shared.module';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { MdpOublieService } from '../../services/mdp-oublie.service';
import { map, tap } from 'rxjs';

@Component({
  selector: 'app-recuperer-mdp',
  standalone: true,
  imports: [
    SharedModule
],
  templateUrl: './recuperer-mdp.component.html',
  styleUrl: './recuperer-mdp.component.scss'
})
export class RecupererMdpComponent implements OnInit{

  formCtrl!:FormControl; 

  constructor(
    private route:Router,
    private http:MdpOublieService,
    private formBuilder: FormBuilder
  ){}

  ngOnInit(): void {
    this.formCtrl = this.formBuilder.control('', [Validators.required]);
  }

  onAnnuler(){
    this.route.navigateByUrl("connexion/mis_a_jour");
  }

  onValider(){
    this.http.onInitMdp(this.formCtrl.value).pipe(
      map(r=>r),
      map((s:any)=>({
        message: s.Message
      })),
      tap(v => {
        if(v.message){
          this.route.navigateByUrl("connexion/modifier_mot_de_passe");
          this.http.getValeurMail(v.message);
        }else{
          alert("Le code de récupération que vous avez introduit n'est pas correct");
        }
      })
    ).subscribe();
    this.formCtrl.reset();
  }

}
