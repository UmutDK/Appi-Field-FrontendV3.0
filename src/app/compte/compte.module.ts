import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CompteRoutingModule } from './compte-routing.module';
import { CompteService } from './services/compte.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    CompteRoutingModule
  ],
  providers:[
    CompteService
  ]
})
export class CompteModule { }
