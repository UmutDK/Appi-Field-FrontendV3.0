import { Component } from '@angular/core';
import { BanniereComponent } from "../../../accueil/components/banniere/banniere.component";
import { SharedModule } from '../../../shared/shared.module';

@Component({
  selector: 'app-creation-compte-admin',
  standalone: true,
  imports: [
    SharedModule, 
    BanniereComponent
  ],
  templateUrl: './creation-compte-admin.component.html',
  styleUrl: './creation-compte-admin.component.scss'
})
export class CreationCompteAdminComponent {

}
