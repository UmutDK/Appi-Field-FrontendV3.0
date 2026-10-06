import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CreationCompteComponent } from './components/creation-compte/creation-compte.component';
import { CreationCompteFormComponent } from './components/creation-compte-form/creation-compte-form.component';

const routes: Routes = [
  {path:'', component:CreationCompteComponent},
  {path:'creation-compte-info-personel', component:CreationCompteFormComponent},
  {path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CreationCompteRoutingModule { }
