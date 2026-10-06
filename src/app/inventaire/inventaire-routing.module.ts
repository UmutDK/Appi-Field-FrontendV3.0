import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AccueilInventaireComponent } from './components/accueil-inventaire/accueil-inventaire.component';

const routes: Routes = [
  {path:'', component:AccueilInventaireComponent},
  {path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class InventaireRoutingModule { }
