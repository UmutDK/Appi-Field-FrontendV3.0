import { Component, inject, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { MonProfilItemComponent } from "../mon-profil-item/mon-profil-item.component";
import { MonProfilService } from '../../services/mon-profil.service';


@Component({
  selector: 'app-mon-profil',
  standalone: true,
  imports: [
    SharedModule,
    MonProfilItemComponent, 
],
  templateUrl: './mon-profil.component.html',
  styleUrl: './mon-profil.component.scss'
})
export class MonProfilComponent implements OnInit{

  private monProfilService = inject(MonProfilService);
  userSignal = this.monProfilService.userSignal;

  ngOnInit(): void {
   this.monProfilService.getMonProfil().subscribe();
  }

 
}
