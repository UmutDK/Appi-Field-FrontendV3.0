import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CreationCompteRoutingModule } from './creation-compte-routing.module';
import { CreationService } from '../core/auth/services/creation.service';
import { CreationCompteService } from './services/creation-compte.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    CreationCompteRoutingModule
  ],
  providers:[
    CreationService,
    CreationCompteService
  ]
})
export class CreationCompteModule { }
