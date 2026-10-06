import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AccueilRoutingModule } from './accueil-routing.module';
import { AccueilService } from './services/accueil.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    AccueilRoutingModule
  ],
  providers: [
    AccueilService
  ]
})
export class AccueilModule { }
