import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { GestionDesOperationsRoutingModule } from './gestion-des-operations-routing.module';
import { GestionDesOperationsService } from './services/gestion-des-operations.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    GestionDesOperationsRoutingModule
  ],
  providers:[
    GestionDesOperationsService
  ]
})
export class GestionDesOperationsModule { }
