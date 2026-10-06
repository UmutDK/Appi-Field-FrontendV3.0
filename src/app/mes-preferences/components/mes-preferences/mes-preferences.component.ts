import { AfterViewInit, Component, inject, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MesPreferencesService } from '../../services/mes-preferences.service';
import { Router } from '@angular/router';
import { map, tap } from 'rxjs';

declare var M:any;

@Component({
  selector: 'app-mes-preferences',
  standalone: true,
  imports: [
    SharedModule
  ],
  templateUrl: './mes-preferences.component.html',
  styleUrl: './mes-preferences.component.scss'
})
export class MesPreferencesComponent implements OnInit, AfterViewInit{

  form!: FormGroup;
  signal = inject(MesPreferencesService);
  afficher = this.signal.signalGetId;

  constructor(
    private formBuilder : FormBuilder,
    private http:MesPreferencesService,
    private route:Router
  ){}

  ngOnInit(): void {
    this.token();
    this.http.get().subscribe();
    this.form = this.formBuilder.group({
      id_user:[null,[Validators.required]],
      encodageDuTraitement:['Surface'],
      typeDePulverisateur:[false],
      maraichage:[null],
      grandesCultures:[null],
      culturesFourrageres:[null],
      plantesOrnementales:[null],
      arboriculture:[null],
      pepinieresForestieresEtViticultureSapinsDeNoel:[null]
    });
  }

  ngAfterViewInit(): void {
    const elems = document.querySelectorAll('select');
    M.FormSelect.init(elems);
  }

    token(){
      const token = localStorage.getItem('Token');
      return this.http.getTokenValidation(token).pipe(
        map(s =>s),
        map((r:any)=>({
          id_user:r.Id_User,
          nom:r.Nom,
          prenom:r.Prenom,
        })),
        tap(v => {
          this.http.onGetId(v.id_user);
          this.form.patchValue({
            id_user:v.id_user,
            nom:v.nom,
            prenom:v.prenom
          });
        })
      ).subscribe();
    }

  onSuivant(){

    const typeDePulverisateur = this.form.get('typeDePulverisateur')?.value;

    if(typeDePulverisateur){
      this.form.patchValue({
        typeDePulverisateur: "J’utilise un pulvérisateur de plus de 20 L.",
      });
    }

    this.http.onPost(this.form.value);
    this.form.reset();
    this.route.navigateByUrl('gestion-des-operations');
  }

  onAnnuler(){
    localStorage.clear();
    this.route.navigateByUrl('/');
  }
}
