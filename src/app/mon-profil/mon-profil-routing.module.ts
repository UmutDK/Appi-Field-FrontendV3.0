import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MonProfilComponent } from './components/mon-profil/mon-profil.component';
import { AuthGuard } from '../core/auth/guards/auth.guard';

const routes: Routes = [
  { path:'', component:MonProfilComponent, canActivate:[AuthGuard] },
  { path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class MonProfilRoutingModule { }
