import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ParcellesComponent } from './components/parcelles/parcelles.component';
import { AuthGuard } from '../core/auth/guards/auth.guard';
import { GetParcellesComponent } from './components/get-parcelles/get-parcelles.component';

const routes: Routes = [
  {path: '', component: ParcellesComponent, canActivate:[AuthGuard]},
  {path: 'voir-parcelles', component:GetParcellesComponent, canActivate:[AuthGuard]},
  {path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ParcellesRoutingModule { }
