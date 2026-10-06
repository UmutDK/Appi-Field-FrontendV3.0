import { Component, OnInit, signal } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { ReglageService } from '../../services/reglage.service';
import { PasswordComponent } from "../password/password.component";
import { CreateUserComponent } from "../create-user/create-user.component";
import { InfosPersoComponent } from "../infos-perso/infos-perso.component";
import { InfosExploitationComponent } from "../infos-exploitation/infos-exploitation.component";
import { PersonalProductsComponent } from "../personal-products/personal-products.component";
import { MandatsComponent } from "../mandats/mandats.component";
import { WallesmartComponent } from "../wallesmart/wallesmart.component";

@Component({
  selector: 'app-reglage',
  standalone: true,
  imports: [
    SharedModule,
    PasswordComponent,
    CreateUserComponent,
    InfosPersoComponent,
    InfosExploitationComponent,
    PersonalProductsComponent,
    MandatsComponent,
    WallesmartComponent
  ],
  templateUrl: './reglage.component.html',
  styleUrl: './reglage.component.scss'
})
export class ReglageComponent implements OnInit{

  activeSection = signal<'equipe' | 'password' | 'infos-perso' | 'infos-exploitation' | 'fertilisants' | 'mandats' | 'wallesmart'>('infos-perso');

  readonly sectionLabels: Record<string, string> = {
    'infos-perso': 'Informations personnelles',
    'infos-exploitation': 'Informations de mon exploitation',
    'wallesmart': 'WalleSmart',
    'equipe': 'Mon équipe',
    'fertilisants': 'Fertilisants personnels',
    'password': 'Modifier mon mot de passe',
    'mandats': 'Gestion des mandats'
  };

  getSectionLabel(): string {
    return this.sectionLabels[this.activeSection()] ?? '';
  }

  onSelectChange(event: Event): void {
    this.activeSection.set((event.target as HTMLSelectElement).value as any);
  }

  constructor(
    private http : ReglageService
  ) { }

  ngOnInit(): void {
   
  }

}
