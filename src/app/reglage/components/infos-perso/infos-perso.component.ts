import { Component, inject, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { MonProfilService } from '../../../mon-profil/services/mon-profil.service';
import { MonProfilInfosService } from '../../../mon-profil/services/mon-profil-infos.service';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, forkJoin, map, of } from 'rxjs';

@Component({
  selector: 'app-infos-perso',
  standalone: true,
  imports: [SharedModule, MatTooltipModule],
  templateUrl: './infos-perso.component.html',
  styleUrl: './infos-perso.component.scss',
  providers: [MonProfilService, MonProfilInfosService]
})
export class InfosPersoComponent implements OnInit {

  private profilService = inject(MonProfilService);
  private infosService = inject(MonProfilInfosService);

  user: any = null;
  userInfos: any = { phytolicence: '', exploitingNumber: '' };
  saving = false;
  successMsg = '';
  errorMsg = '';
  /** Passe à true dès qu'on quitte le champ (ou qu'on tente d'enregistrer) : affiche les erreurs. */
  touched = { nom: false, prenom: false };
  /** Date d'inscription à Appi'Field (profil créé à l'étape « Finaliser mon inscription »). */
  dateEnregistrement: string | null = null;

  ngOnInit(): void {
    this.profilService.getMonProfil().subscribe(data => {
      this.user = data;
    });
    this.infosService.getInfosByUserId().subscribe(infos => {
      if (infos) {
        this.dateEnregistrement = (infos as any).createdAt || null;
        this.userInfos = {
          phytolicence: infos.phytolicence || '',
          exploitingNumber: infos.exploitingNumber || ''
        };
      }
    });
  }

  onPhytolicenceInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (value.length > 2) value = value.slice(0, 2) + '.' + value.slice(2);
    if (value.length > 4) value = value.slice(0, 4) + '.' + value.slice(4);
    input.value = value;
    this.userInfos.phytolicence = value;
  }

  isEmpty(value: string | null | undefined): boolean {
    return !(value || '').trim();
  }

  canSave(): boolean {
    return !!this.user && !this.isEmpty(this.user.Nom) && !this.isEmpty(this.user.Prenom);
  }

  onSubmit(): void {
    if (!this.user) return;
    this.successMsg = '';
    this.errorMsg = '';
    if (!this.canSave()) {
      this.touched = { nom: true, prenom: true };
      this.errorMsg = 'Le nom et le prénom sont obligatoires.';
      return;
    }
    this.saving = true;
    const nom = this.user.Nom.trim();
    const prenom = this.user.Prenom.trim();

    // Les deux enregistrements sont attendus : le succès n'est affiché que si les deux ont réussi.
    forkJoin({
      profil: this.profilService.updateMonProfil({ userMail: this.user.Mail, userNom: nom, userPrenom: prenom })
        .pipe(map(() => true), catchError(() => of(false))),
      infos: this.infosService.updateInfos(this.userInfos)
        .pipe(map(() => true), catchError(() => of(false))),
    }).subscribe(({ profil, infos }) => {
      this.saving = false;
      if (profil) {
        // Nom affiché dans la barre latérale mis à jour tout de suite (sans reconnexion)
        this.user.Nom = nom;
        this.user.Prenom = prenom;
        localStorage.setItem('Nom', nom);
        localStorage.setItem('Prenom', prenom);
      }
      if (profil && infos) {
        this.successMsg = 'Informations personnelles enregistrées avec succès !';
      } else if (!profil && !infos) {
        this.errorMsg = "Une erreur est survenue : aucune information n'a été enregistrée.";
      } else if (!profil) {
        this.errorMsg = "Le nom et le prénom n'ont pas pu être enregistrés (phytolicence et numéro d'exploitant enregistrés).";
      } else {
        this.errorMsg = "La phytolicence et le numéro d'exploitant n'ont pas pu être enregistrés (nom et prénom enregistrés).";
      }
    });
  }
}
