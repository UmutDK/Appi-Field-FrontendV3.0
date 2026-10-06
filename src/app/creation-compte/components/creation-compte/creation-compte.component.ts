import { Component } from '@angular/core';
import { BanniereComponent } from "../../../accueil/components/banniere/banniere.component";
import { SharedModule } from '../../../shared/shared.module';
import { CreationComponent } from "../../../core/auth/components/creation/creation.component";

@Component({
  selector: 'app-creation-compte',
  standalone: true,
  imports: [
    BanniereComponent,
    SharedModule,
    CreationComponent
],
  templateUrl: './creation-compte.component.html',
  styleUrl: './creation-compte.component.scss'
})
export class CreationCompteComponent {

}
