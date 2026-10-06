import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MesPreferencesComponent } from './components/mes-preferences/mes-preferences.component';

const routes: Routes = [
  {path:'', component:MesPreferencesComponent},
  {path:'', pathMatch:'full',redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class MesPreferencesRoutingModule { }
