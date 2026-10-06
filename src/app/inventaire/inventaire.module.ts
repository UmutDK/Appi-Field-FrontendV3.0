import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { InventaireRoutingModule } from './inventaire-routing.module';
import { InventaireService } from './services/inventaire.service';
import { PhytoProductService } from './services/phyto-product.service';
import { RegistreService } from '../registre/services/registre.service';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    InventaireRoutingModule
  ], 
  providers:[
    InventaireService,
    PhytoProductService,
    RegistreService
  ]
})
export class InventaireModule { }
