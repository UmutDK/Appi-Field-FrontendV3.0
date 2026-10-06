import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { GestionDesOperationsComponent } from './components/gestion-des-operations/gestion-des-operations.component';

const routes: Routes = [
  {path:'',component:GestionDesOperationsComponent},
  {path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class GestionDesOperationsRoutingModule { }
