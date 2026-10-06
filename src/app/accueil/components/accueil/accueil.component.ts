import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { BanniereComponent } from "../banniere/banniere.component";
import { ListeActualitesComponent } from "../liste-actualites/liste-actualites.component";
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

interface Formation {
  day: string;
  month: string;
  title: string;
  location: string;
  time: string;
  link: string;
}

@Component({
  selector: 'app-accueil',
  standalone: true,
  imports: [
    SharedModule,
    BanniereComponent,
    ListeActualitesComponent
],
  templateUrl: './accueil.component.html',
  styleUrl: './accueil.component.scss'
})
export class AccueilComponent implements OnInit, OnDestroy {
  // token :boolean = true;
  token = localStorage.getItem('Token');

  router = inject(Router);
  route = inject(ActivatedRoute);
  http = inject(HttpClient);

  formations: Formation[] = [];

  // Variables pour le slider de formations
  currentSlideIndex = 0;
  cardsPerView = 4;
  totalCards = 4; // Nombre total de cards (à ajuster selon vos besoins)

  // Variables pour afficher les messages de session
  sessionExpired = false;
  autoLogout = false;

  private resizeHandler = () => this.updateCardsPerView();
  accountCreated = false;

  ngOnInit(): void {
    this.loadFormations();
    this.updateCardsPerView();
    
    // Vérifier si on arrive ici suite à une expiration de session ou déconnexion auto
    this.route.queryParams.subscribe(params => {
      if (params['sessionExpired'] === 'true') {
        this.sessionExpired = true;
        
        // Nettoyer l'URL après affichage du message
        setTimeout(() => {
          this.router.navigate([], {
            queryParams: { sessionExpired: null },
            queryParamsHandling: 'merge'
          });
        }, 100);
        
        // Masquer le message après 5 secondes
        setTimeout(() => {
          this.sessionExpired = false;
        }, 5000);
      }
      
      if (params['autoLogout'] === 'true') {
        this.autoLogout = true;
        
        // Nettoyer l'URL après affichage du message
        setTimeout(() => {
          this.router.navigate([], {
            queryParams: { autoLogout: null },
            queryParamsHandling: 'merge'
          });
        }, 100);
        
        // Masquer le message après 8 secondes
        setTimeout(() => {
          this.autoLogout = false;
        }, 8000);
      }
      
      if (params['accountCreated'] === 'true') {
        this.accountCreated = true;
        
        // Nettoyer l'URL après affichage du message
        setTimeout(() => {
          this.router.navigate([], {
            queryParams: { accountCreated: null },
            queryParamsHandling: 'merge'
          });
        }, 100);
        
        // Masquer le message après 10 secondes
        setTimeout(() => {
          this.accountCreated = false;
        }, 10000);
      }
    });
    
    // Écouter les changements de taille d'écran
    window.addEventListener('resize', this.resizeHandler);
  }

  loadFormations(): void {
    this.http.get<Formation[]>(`${environment.apiRegistre}/formations`)
      .subscribe({
        next: (data) => {
          this.formations = data;
          this.totalCards = data.length;
          this.updateCardsPerView();
        },
        error: (error) => {
          console.error('Erreur lors du chargement des formations:', error);
          this.updateCardsPerView();
        }
      });
  }

  onRouteAdmin(){
    setTimeout(() => {
      this.router.navigateByUrl("/back-office");
    }, 50);
  }

  prevSlide(): void {
    if (this.currentSlideIndex > 0) {
      this.currentSlideIndex--;
    }
  }

  nextSlide(): void {
    if (this.currentSlideIndex < this.maxSlideIndex) {
      this.currentSlideIndex++;
    }
  }

  updateCardsPerView(): void {
    const width = window.innerWidth;
    if (width <= 950) {
      this.cardsPerView = this.totalCards;
      this.currentSlideIndex = 0;
    } else if (width <= 1200) {
      this.cardsPerView = 3;
    } else {
      this.cardsPerView = 4;
    }
    if (this.currentSlideIndex > this.maxSlideIndex) {
      this.currentSlideIndex = this.maxSlideIndex;
    }
  }

  get maxSlideIndex(): number {
    return Math.max(0, this.totalCards - this.cardsPerView);
  }

  get needsSlider(): boolean {
    return this.totalCards > this.cardsPerView;
  }

  get sliderTransform(): string {
    if (!this.needsSlider) return 'none';
    return `translateX(${-(this.currentSlideIndex * 100 / this.cardsPerView)}%)`;
  }

  redirectToInscription(): void {
    window.open('https://form.typeform.com/to/KKW378n5', '_blank');
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
  }

}
