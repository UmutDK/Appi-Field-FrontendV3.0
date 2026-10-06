import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MonProfilRoutingModule } from './mon-profil-routing.module';
import { MonProfilService } from './services/mon-profil.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    MonProfilRoutingModule
  ],
  providers: [
    MonProfilService
  ]
})
export class MonProfilModule { }
