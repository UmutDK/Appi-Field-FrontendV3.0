import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ReglageComponent } from './components/reglage/reglage.component';
import { AuthGuard } from '../core/auth/guards/auth.guard';

const routes: Routes = [
  { path:'', component:ReglageComponent, canActivate:[AuthGuard] },
  { path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ReglageRoutingModule { }
