import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CompteComponent } from './components/compte/compte.component';
import { AuthGuard } from '../core/auth/guards/auth.guard';

const routes: Routes = [
  { path:'', component:CompteComponent, canActivate:[AuthGuard] },
  { path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CompteRoutingModule { }
