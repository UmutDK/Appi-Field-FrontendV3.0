import { Component, inject, Input, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { MonProfil } from '../../model/mon-profil';
import { NgForm } from '@angular/forms';
import { MonProfilService } from '../../services/mon-profil.service';
import { MonProfilInfosService } from '../../services/mon-profil-infos.service';
import { environment } from '../../../../environments/environment';
import { ExploitationService } from '../../services/exploitation.service';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-mon-profil-item',
  standalone: true,
  imports: [
    SharedModule
  ],
  templateUrl: './mon-profil-item.component.html',
  styleUrl: './mon-profil-item.component.scss',
  providers: [MonProfilInfosService, ExploitationService]
})
export class MonProfilItemComponent implements OnInit{
  onPhytolicenceInput(event: Event) {
  const input = event.target as HTMLInputElement;
  let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); // garde uniquement lettres et chiffres

  // Ajoute les points en suivant le pattern XX.X.XXXX
  if (value.length > 2) value = value.slice(0, 2) + '.' + value.slice(2);
  if (value.length > 4) value = value.slice(0, 4) + '.' + value.slice(4);

  input.value = value;
}

  userInfos: any = {
    phytolicence: '',
    exploitingNumber: ''
  };
  infosLoaded = false;

  exploitationInfos: any = {
    exploitationAddress: '',
    exploitationPostalCode: '',
    vatNumber: '',
    exploitationName: ''
  };
  exploitationLoaded = false;

  infosService = inject(MonProfilInfosService);
  exploitationService = inject(ExploitationService);
  router = inject(Router);
  httpClient = inject(HttpClient);

  @Input() usersEnfant!: MonProfil;
  http = inject(MonProfilService)

  // Variables pour la suppression du compte
  showDeleteModal = false;
  deleteConfirmText = '';
  deleteError = '';
  isDeleting = false;

  userMail!:string;
  userNom!:string;
  userPrenom!:string;

  ngOnInit(): void {
    // Charger les infos utilisateur (l'intercepteur ajoute le Bearer, le serveur filtre par token)
    this.infosService.getInfosByUserId().subscribe((infos) => {
      this.userInfos = {
        phytolicence: infos?.phytolicence || '',
        exploitingNumber: infos?.exploitingNumber || ''
      };
      this.infosLoaded = true;
    }, () => {
      this.infosLoaded = true;
    });

    // Charger les infos d'exploitation
    this.exploitationService.getExploitationByUserId().subscribe((exploitation) => {
      this.exploitationInfos = {
        exploitationAddress: exploitation?.exploitationAddress || '',
        exploitationPostalCode: exploitation?.exploitationPostalCode || '',
        vatNumber: exploitation?.vatNumber || '',
        exploitationName: exploitation?.exploitationName || '',
        exploitationId: exploitation?.exploitationId || ''
      };
      this.exploitationLoaded = true;
    }, () => {
      this.exploitationLoaded = true;
    });
  }

  updateMonProfil(form: NgForm) {
    // 1. Mettre à jour les données utilisateur de base (Nom, Prénom, Mail — apiUrl/userkey)
    const userDataToUpdate = {
      userMail: this.usersEnfant.Mail,
      userNom: this.usersEnfant.Nom,
      userPrenom: this.usersEnfant.Prenom
    };
    this.http.updateMonProfil(userDataToUpdate).subscribe();

    // 2. Mettre à jour les infos utilisateur si elles sont chargées
    const updateExploitationThenAlert = (message: string) => {
      if (this.exploitationLoaded) {
        this.exploitationService.updateExploitation(this.exploitationInfos).subscribe(() => alert(message));
      } else {
        alert(message);
      }
    };

    if (this.infosLoaded) {
      this.infosService.updateInfos(this.userInfos).subscribe(() => {
        updateExploitationThenAlert('Votre profil et vos infos ont été modifiés');
      });
    } else {
      updateExploitationThenAlert('Votre profil a été modifié');
    }
  }

  onNumeroTVAInput(event: Event) {
    const input = event.target as HTMLInputElement;

    // Supprime tout sauf chiffres
    let value = input.value.replace(/[^0-9]/g, '');

    // Ajoute l'espace BE + formate en 0123.456.789
    if (value.length > 4) value = value.slice(0, 4) + '.' + value.slice(4);
    if (value.length > 7) value = value.slice(0, 8) + '.' + value.slice(8);

    input.value = 'BE ' + value;
  }

  openDeleteModal() {
    this.showDeleteModal = true;
    // Bloquer le scroll en ajoutant le style directement sur le body
    document.body.style.overflow = 'hidden';
  }

  closeDeleteModal() {
    this.showDeleteModal = false;
    this.deleteConfirmText = '';
    this.deleteError = '';
    // Restaurer le scroll
    document.body.style.overflow = '';
  }

  deleteAccount() {
    // Vérifier que le texte de confirmation est exact
    if (this.deleteConfirmText !== 'supprimer mon compte') {
      this.deleteError = 'Veuillez taper exactement "supprimer mon compte" pour confirmer.';
      return;
    }

    // Récupérer le token
    const token = localStorage.getItem('Token');
    if (!token) {
      this.deleteError = 'Utilisateur non authentifié.';
      return;
    }

    this.isDeleting = true;
    this.deleteError = '';

    // Appeler l'API de suppression
    const deleteUrl = `${environment.apiUrl}/controllers/affiche_user/delet_user.php?token=${token}`;
    
    this.httpClient.get(deleteUrl).subscribe({
      next: (response: any) => {
        this.isDeleting = false;
        
        // Fermer la popup et nettoyer
        this.showDeleteModal = false;
        document.body.style.overflow = '';
        localStorage.clear();
        
        // Afficher le message et rediriger
        alert('Votre compte a été supprimé avec succès. Vous allez être redirigé vers la page d\'accueil.');
        
        // Rediriger vers la page d'accueil
        setTimeout(() => {
          window.location.href = '/accueil';
        }, 100);
      },
      error: (error) => {
        this.isDeleting = false;
        
        // Même en cas d'erreur HTTP, si c'est un 200 mais avec erreur, on redirige quand même
        // car le compte pourrait avoir été supprimé
        if (error.status === 0 || error.status === 200) {
          this.showDeleteModal = false;
          document.body.style.overflow = '';
          localStorage.clear();
          alert('Votre compte a été supprimé. Vous allez être redirigé vers la page d\'accueil.');
          setTimeout(() => {
            window.location.href = '/accueil';
          }, 100);
        } else {
          this.deleteError = 'Une erreur est survenue lors de la suppression du compte.';
        }
      }
    });
  }

}
