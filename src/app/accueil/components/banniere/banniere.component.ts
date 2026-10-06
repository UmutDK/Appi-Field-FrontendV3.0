import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-banniere',
  standalone: true,
  imports: [],
  templateUrl: './banniere.component.html',
  styleUrl: './banniere.component.scss'
})
export class BanniereComponent {
  readonly wallesmartUrl = 'https://portail.wallesmart.be/apps';

  constructor(private router: Router) {}

  goToConnexion() {
    this.router.navigate(['/connexion']);
  }

  goToCreationCompte() {
    this.router.navigate(['/creation-compte']);
  }

}
