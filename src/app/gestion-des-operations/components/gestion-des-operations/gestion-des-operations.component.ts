import { AfterViewInit, Component, inject, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { GestionDesOperationsService } from '../../services/gestion-des-operations.service';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { formatPhytolicence, PHYTOLICENCE_PATTERN } from '../../../shared/utils/phytolicence.util';
 
declare var M: any; // Import Materialize CSS
 
@Component({
  selector: 'app-gestion-des-operations',
  standalone: true,
  imports: [
    SharedModule,
  ],
  templateUrl: './gestion-des-operations.component.html',
  styleUrl: './gestion-des-operations.component.scss'
})
export class GestionDesOperationsComponent implements OnInit, AfterViewInit{
 
  form!: FormGroup;
  private signalHttp = inject(GestionDesOperationsService);
  signalGet = this.signalHttp.signal;
 
  constructor(
        private formBuilder : FormBuilder,
        private http:GestionDesOperationsService,
        private route:Router
  ){}
 
  ngOnInit(): void {
    this.form = this.formBuilder.group({
      name:[null, [Validators.required]],
      phytolicence:[null, [Validators.required, Validators.pattern(PHYTOLICENCE_PATTERN)]]
    });
    this.signalHttp.onGet().pipe(
      tap(r =>{
        if(r.length>0){
          this.route.navigateByUrl('back-office');
        }
      })
    ).subscribe();
  }

  ngAfterViewInit(): void {
    const elems = document.querySelectorAll('select');
    M.FormSelect.init(elems);
  }

  onTerminer(){
    this.route.navigateByUrl('back-office');
  }

  onDEl(id:string){
    // Même confirmation que dans « Mon compte › Mon équipe » avant de supprimer un opérateur
    const op = (this.signalGet() || []).find((o: any) => o.operatorId === id);
    const nom = op?.operatorName ? ` « ${op.operatorName} »` : '';
    if (!confirm(`Supprimer l'opérateur${nom} ?`)) return;
    this.http.onDelet(id);
  }

  onInviter(){
    this.http.onPost(this.form.value);
    this.form.reset();
  }
 
 onPhytolicenceInput(event: Event) {
  const input = event.target as HTMLInputElement;
  input.value = formatPhytolicence(input.value);
  this.form.get('phytolicence')?.setValue(input.value);
}
}

 

