import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthRoutingModule } from './auth-routing.module';
import { CreationService } from './services/creation.service';
import { ValidationCompteService } from './services/validation-compte.service';
import { MdpOublieService } from './services/mdp-oublie.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    AuthRoutingModule
  ],
  providers: [
    CreationService,
    ValidationCompteService,
    MdpOublieService
  ]
})
export class AuthModule { }
