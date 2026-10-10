import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { parsePolygoneToLatLngs as parseLatlngs } from '../../../shared/utils/lambert72.util';
import { SharedModule } from '../../../shared/shared.module';
import { ListeActualitesComponent } from "../../../accueil/components/liste-actualites/liste-actualites.component";
import * as L from 'leaflet';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { fromApi as parcelFromApi } from '../../../parcelles/services/parcelles-server.service';
import { RegistreService } from '../../../registre/services/registre.service';
import { Subject, takeUntil, combineLatest } from 'rxjs';

interface Formation {
  day: string;
  month: string;
  title: string;
  location: string;
  time: string;
  link: string;
}

interface DashboardStats {
  parcellesActives: number | null;
  parcellesHaTotal: number | null;
  culturesEnCours: number | null;
  cultureUniqueName: string | null;
  interventionsCeMois: number | null;
  derniereInterventionDate: string | null;
}

@Component({
  selector: 'app-back-office',
  standalone: true,
  imports: [
    SharedModule,
    ListeActualitesComponent
],
  templateUrl: './back-office.component.html',
  styleUrl: './back-office.component.scss'
})
export class BackOfficeComponent implements OnInit, AfterViewInit, OnDestroy {

  nom!:any;
  map !:any;
  formations: Formation[] = [];
  
  // Variables pour le slider de formations
  currentSlideIndex = 0;
  cardsPerView = 4;
  totalCards = 4;

  // Mon équipe
  operateurs: any[] = [];
  showOperateurForm = false;
  editingOperateur: any = null;
  operateurForm = { name: '', phytolicence: '' };
  operateurSaving = false;
  operateurError = '';

  private resizeHandler = () => {
    this.updateCardsPerView();
  };

  // Tableau de bord — tuiles stats
  stats: DashboardStats = {
    parcellesActives: null,
    parcellesHaTotal: null,
    culturesEnCours: null,
    cultureUniqueName: null,
    interventionsCeMois: null,
    derniereInterventionDate: null,
  };
  today = new Date();

  private destroy$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private registreService: RegistreService
  ) {}

  ngOnInit(): void {
    this.nom = localStorage.getItem("Prenom");
    this.loadFormations();
    this.loadOperateurs();
    this.loadCulturesStats();
    this.loadInterventionsStats();

    // Écouter les changements de taille d'écran
    window.addEventListener('resize', this.resizeHandler);
  }

  private loadCulturesStats(): void {
    this.registreService.get().pipe(takeUntil(this.destroy$)).subscribe({
      next: (crops) => {
        this.stats.culturesEnCours = crops.length;
        this.stats.cultureUniqueName = crops.length === 1 ? (crops[0].crop_name || null) : null;
      },
      error: () => { this.stats.culturesEnCours = 0; }
    });
  }

  private loadInterventionsStats(): void {
    combineLatest([
      this.registreService.getAllTraitements(),
      this.registreService.getAllTravauxChamps()
    ]).pipe(takeUntil(this.destroy$)).subscribe({
      next: ([traitements, travaux]) => {
        const now = new Date();
        const events = [...(traitements || []), ...(travaux || [])].filter(e => e?.date);

        const thisMonthEvents = events.filter(e => {
          const d = new Date(e.date);
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        });

        this.stats.interventionsCeMois = thisMonthEvents.length;
        this.stats.derniereInterventionDate = thisMonthEvents.length
          ? thisMonthEvents.map(e => e.date).sort().at(-1) ?? null
          : null;
      },
      error: () => { this.stats.interventionsCeMois = 0; }
    });
  }

  loadFormations(): void {
    this.http.get<Formation[]>(`${environment.apiRegistre}/formations`)
      .pipe(takeUntil(this.destroy$))
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

  @ViewChild('mapContainer', { static: true }) mapContainer?: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    setTimeout(() => this.configMap(), 0);
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.destroy$.next();
    this.destroy$.complete();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  configMap(): void {
    // Référence propre au composant (et non document.getElementById('map')) : pendant une
    // navigation, une autre page avec son propre #map peut rester brièvement dans le DOM.
    const container = this.mapContainer?.nativeElement;
    if (!container) return;
    if ((container as any)._leaflet_id) return; // déjà initialisée

    // VERSION MOBILE : sur téléphone/tablette, la carte de l'accueil est un aperçu — un doigt posé
    // dessus fait défiler la page au lieu de déplacer la carte (« Voir toutes mes parcelles » ouvre la carte).
    const apercu = L.Browser.mobile;
    this.map = L.map(container, {
      dragging: !apercu,
      touchZoom: !apercu,
      doubleClickZoom: !apercu,
      zoomControl: !apercu,
    }).setView([50.5667, 4.7], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);
    this.map.invalidateSize();

    // Charger les parcelles et centrer la carte
    this.loadParcelsOnMap();
  }

  private loadParcelsOnMap(): void {
    const token = localStorage.getItem('token');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    this.http.get<any[]>(`${environment.apiRegistre}/parcels`, { headers })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (raw) => {
          const parcelles = (raw || []).map(parcelFromApi);

          this.stats.parcellesActives = parcelles.length;
          // Superficie totale en hectares : chaque parcelle est convertie depuis son unité
          // (ha / a / m², mêmes unités et facteurs que la page Parcelles) avant l'addition.
          this.stats.parcellesHaTotal = parcelles.reduce(
            (sum, p) => sum + this.areaToHa(parseFloat(p.parcel_area) || 0, p.parcel_area_unit_fr), 0
          );

          if (!parcelles?.length) return;
          const allLatLngs: L.LatLng[] = [];

          parcelles.forEach(parcelle => {
            const popupContent = `<strong>${parcelle.parcel_name || 'Parcelle'}</strong><br><small>${parcelle.parcel_area || ''} ${parcelle.parcel_area_unit_fr || ''}</small>`;

            if (parcelle.polygone) {
              try {
                const latlngs = this.parsePolygoneToLatLngs(parcelle.polygone);
                if (latlngs.length >= 3) {
                  latlngs.forEach(ll => allLatLngs.push(ll));
                  L.polygon(latlngs, { color: '#03918a', fillColor: '#03918a', fillOpacity: 0.25, weight: 2 })
                    .addTo(this.map).bindPopup(popupContent);
                  return;
                }
              } catch (e) {}
            }

            if (parcelle.lat && parcelle.lon) {
              const lat = parseFloat(parcelle.lat);
              const lon = parseFloat(parcelle.lon);
              if (!isNaN(lat) && !isNaN(lon)) {
                allLatLngs.push(L.latLng(lat, lon));
                L.circleMarker([lat, lon], { radius: 7, color: '#03918a', fillColor: '#03918a', fillOpacity: 0.8, weight: 2 })
                  .addTo(this.map).bindPopup(popupContent);
              }
            }
          });

          if (allLatLngs.length > 0) {
            const bounds = L.latLngBounds(allLatLngs);
            setTimeout(() => {
              this.map.flyToBounds(bounds, { padding: [20, 20], maxZoom: 17, duration: 1.5 });
            }, 300);
          }
        },
        error: () => {
          this.stats.parcellesActives = 0;
          this.stats.parcellesHaTotal = 0;
        }
      });
  }

  private parsePolygoneToLatLngs(polygoneStr: string): L.LatLng[] {
    return parseLatlngs(polygoneStr).map(([lat, lon]) => L.latLng(lat, lon));
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

  redirectToInscription(): void {
    window.open('https://form.typeform.com/to/KKW378n5', '_blank');
  }

  /**
   * `<base href="/">` fait résoudre un `href="#id"` brut contre la racine du site (donc vers `/`,
   * protégée par un guard) plutôt que contre l'URL courante — même piège déjà rencontré et corrigé
   * sur le sommaire de la page CGU. `routerLink`+`fragment` évite le problème, mais le scroll est
   * fait ici à la main car Angular ne le déclenche pas de façon fiable pour un fragment sur la même route.
   */
  scrollToSection(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ==================== MON ÉQUIPE ====================

  loadOperateurs(): void {
    this.http.get<any[]>(`${environment.apiRegistre}/operators`).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.operateurs = data || [];
      },
      error: () => { this.operateurs = []; }
    });
  }

  openOperateurForm(): void {
    this.editingOperateur = null;
    this.operateurForm = { name: '', phytolicence: '' };
    this.operateurError = '';
    this.showOperateurForm = true;
    document.body.classList.add('no-scroll');
  }

  editOperateur(op: any): void {
    this.editingOperateur = op;
    this.operateurForm = {
      name: op.operatorName || '',
      phytolicence: op.operatorPhytolicence || ''
    };
    this.operateurError = '';
    this.showOperateurForm = true;
    document.body.classList.add('no-scroll');
  }

  /** Convertit une superficie (ha / a / m²) en hectares — mêmes facteurs que parcelles.component.ts. */
  private areaToHa(area: number, unit: string): number {
    switch ((unit || 'ha').toLowerCase()) {
      case 'a':  return area / 100;
      case 'm2':
      case 'm²': return area / 10000;
      default:   return area;
    }
  }

  /** Échap ferme la popup « Nouvel opérateur / Modifier l'opérateur ». */
  @HostListener('document:keydown.escape')
  onEscapeCloseOperateurForm(): void {
    if (this.showOperateurForm) this.closeOperateurForm();
  }

  closeOperateurForm(): void {
    this.showOperateurForm = false;
    this.editingOperateur = null;
    this.operateurSaving = false;
    document.body.classList.remove('no-scroll');
  }

  saveOperateur(): void {
    if (!this.operateurForm.name.trim()) {
      this.operateurError = 'Le nom et prénom est obligatoire.';
      return;
    }
    this.operateurSaving = true;
    this.operateurError = '';

    const payload = {
      operatorName: this.operateurForm.name.trim(),
      operatorPhytolicence: this.operateurForm.phytolicence.trim()
    };

    if (this.editingOperateur) {
      this.http.put<any>(
        `${environment.apiRegistre}/operators/${this.editingOperateur.operatorId}`,
        payload
      ).subscribe({
        next: () => { this.loadOperateurs(); this.closeOperateurForm(); },
        error: () => {
          this.operateurError = 'Erreur lors de la mise à jour.';
          this.operateurSaving = false;
        }
      });
    } else {
      this.http.post<any>(
        `${environment.apiRegistre}/operators`,
        payload
      ).subscribe({
        next: () => { this.loadOperateurs(); this.closeOperateurForm(); },
        error: () => {
          this.operateurError = 'Erreur lors de l\'enregistrement.';
          this.operateurSaving = false;
        }
      });
    }
  }

  onPhytolicenceInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (value.length > 2) value = value.slice(0, 2) + '.' + value.slice(2);
    if (value.length > 4) value = value.slice(0, 4) + '.' + value.slice(4);
    input.value = value;
    this.operateurForm.phytolicence = value;
  }

  deleteOperateur(op: any): void {
    if (!confirm(`Supprimer l'opérateur « ${op.operatorName} » ?`)) return;
    this.http.delete<any>(
      `${environment.apiRegistre}/operators/${op.operatorId}`
    ).subscribe({
      next: () => this.loadOperateurs(),
      error: () => alert('Erreur lors de la suppression.')
    });
  }

}
