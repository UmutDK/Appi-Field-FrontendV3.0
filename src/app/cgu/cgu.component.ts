import { Component } from '@angular/core';
import { SharedModule } from '../shared/shared.module';
import { HeaderComponent } from '../core/header/component/header/header.component';
import { FooterComponent } from '../core/footer/component/footer/footer.component';

@Component({
  selector: 'app-cgu',
  standalone: true,
  imports: [
    SharedModule,
    HeaderComponent,
    FooterComponent
  ],
  templateUrl: './cgu.component.html',
  styleUrls: ['./cgu.component.scss']
})
export class CguComponent {

  /**
   * `withInMemoryScrolling({ anchorScrolling: 'enabled' })` ne se déclenche pas de façon
   * fiable quand seul le fragment change sur la MÊME route (limitation connue d'Angular
   * Router) — le routerLink met bien à jour l'URL, mais le scroll automatique ne suit pas
   * toujours. Défilement fait ici à la main pour ne pas en dépendre.
   */
  scrollToSection(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
