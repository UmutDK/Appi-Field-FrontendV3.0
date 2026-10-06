import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthComponent } from './components/auth/auth.component';
import { CreationComponent } from './components/creation/creation.component';
import { MdpOublieComponent } from './components/mdp-oublie/mdp-oublie.component';
import { ValidationCompteComponent } from './components/validation-compte/validation-compte.component';
import { RecupererMdpComponent } from './components/recuperer-mdp/recuperer-mdp.component';
import { ModifierMdpComponent } from './components/modifier-mdp/modifier-mdp.component';

const routes: Routes = [
  {path:'', component:AuthComponent},
  {path:'creation_compte', component:CreationComponent},
  {path:'mis_a_jour', component: MdpOublieComponent},
  {path:'validation', component:ValidationCompteComponent},
  {path:'recuperer_mot_de_passe', component:RecupererMdpComponent},
  {path:'modifier_mot_de_passe', component:ModifierMdpComponent},
  {path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AuthRoutingModule { }
