import { Component, inject } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { Router } from '@angular/router';
import { Location } from '@angular/common';

@Component({
  selector: 'app-erreur',
  standalone: true,
  imports: [
    SharedModule
  ],
  templateUrl: './erreur.component.html',
  styleUrl: './erreur.component.scss'
})
export class ErreurComponent {

  route = inject(Router)
  private location = inject(Location)

  onAccueil(){
    this.route.navigateByUrl('/')
  }

  onBack(){
    this.location.back()
  }

}
