import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { RegistreRoutingModule } from './registre-routing.module';
import { RegistreService } from './services/registre.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    RegistreRoutingModule
  ],
  providers:[
    RegistreService
  ]
})
export class RegistreModule { }
