import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CreationCompteAdminComponent } from './components/creation-compte-admin/creation-compte-admin.component';

const routes: Routes = [
  {path:'', component:CreationCompteAdminComponent},
  {path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CreationCompteAdminRoutingModule { }
