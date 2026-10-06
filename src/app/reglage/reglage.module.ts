import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ReglageRoutingModule } from './reglage-routing.module';
import { ReglageService } from './services/reglage.service';
import { MdpService } from './services/mdp.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    ReglageRoutingModule
  ],
  providers: [
    ReglageService,
    MdpService
  ]
})
export class ReglageModule { }
