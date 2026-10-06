import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BackOfficeRoutingModule } from './back-office-routing.module';
import { BackOfficeService } from './services/back-office.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    BackOfficeRoutingModule
  ],
  providers:[
    BackOfficeService
  ]
})
export class BackOfficeModule { }
