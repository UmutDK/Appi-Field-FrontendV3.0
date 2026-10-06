import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ErreurRoutingModule } from './erreur-routing.module';
import { ErreurService } from './service/erreur.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    ErreurRoutingModule
  ],
  providers: [
    ErreurService
  ]
})
export class ErreurModule { }
