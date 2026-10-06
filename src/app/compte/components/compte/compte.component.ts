import { Component } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { UsersComponent } from "../users/users.component";
import { SuperUserComponent } from "../super-user/super-user.component";
import { AllUserComponent } from "../all-user/all-user.component";

@Component({
  selector: 'app-compte',
  standalone: true,
  imports: [
    SharedModule,
    UsersComponent,
    SuperUserComponent,
    AllUserComponent
],
  templateUrl: './compte.component.html',
  styleUrl: './compte.component.scss'
})
export class CompteComponent {

}
