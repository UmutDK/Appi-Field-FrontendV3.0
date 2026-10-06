import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MesPreferencesRoutingModule } from './mes-preferences-routing.module';
import { MesPreferencesService } from './services/mes-preferences.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    MesPreferencesRoutingModule
  ],
  providers:[
    MesPreferencesService
  ]
})
export class MesPreferencesModule { }
