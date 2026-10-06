import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FaqListeComponent } from './components/faq-liste/faq-liste.component';

const routes: Routes = [
  {path: '', component:FaqListeComponent},
  {path:'', pathMatch:'full', redirectTo:''}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class FaqRoutingModule { }
