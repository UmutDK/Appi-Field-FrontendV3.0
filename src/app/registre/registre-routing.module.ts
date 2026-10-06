import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RegistreComponent } from './components/registre/registre.component';
import { ArchivesComponent } from './components/archives/archives.component';
import { AuthGuard } from '../core/auth/guards/auth.guard';

const routes: Routes = [
  { path: '', component:RegistreComponent, canActivate:[AuthGuard]},
  { path: 'archives', component: ArchivesComponent, canActivate: [AuthGuard] },
  { path:'', pathMatch:'full', redirectTo:'' }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RegistreRoutingModule { }
