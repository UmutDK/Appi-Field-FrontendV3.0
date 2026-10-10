import { AfterViewInit, Component, inject, OnInit, OnDestroy, signal, computed, ChangeDetectorRef, HostListener, ViewChild, ElementRef } from '@angular/core';
import { generateUUID } from '../../../shared/utils/uuid.util';
import { parsePolygoneToLatLngs as parseLatlngs } from '../../../shared/utils/lambert72.util';
import { buildParcelPopupHtml } from '../../../shared/utils/parcel-popup.util';
import { SharedModule } from '../../../shared/shared.module';
import * as L from 'leaflet';
import { NgZone } from '@angular/core';
import 'leaflet-draw';
import { ParcellesService, Parcelle, fromApi } from '../../services/parcelles-server.service';
import { RegistreService } from '../../../registre/services/registre.service';
import { AbstractControl, FormBuilder, FormControl, FormGroup, NgForm, ValidationErrors, Validators } from '@angular/forms';
import { map, Observable, tap, firstValueFrom, Subject, takeUntil } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../../environments/environment';

declare var M : any;

@Component({
  selector: 'app-get-parcelles',
  standalone: true,
  imports: [
    SharedModule
  ],
  providers: [
    ParcellesService
  ],
  templateUrl: './get-parcelles.component.html',
  styleUrl: './get-parcelles.component.scss'
})
export class GetParcellesComponent implements OnInit, AfterViewInit, OnDestroy {

  private map!: L.Map;

  // ===== VERSION MOBILE : panneau « Ajouter » et « Ma position » =====
  mobileAddSheetOpen = false;
  locating = false;
  locateMessage = '';
  private locateZone = inject(NgZone);
  private locateMessageTimer?: ReturnType<typeof setTimeout>;
  private userLocationLayer?: L.LayerGroup;

  /**
   * « Ma position » : centre la carte sur la position du téléphone (API de localisation du
   * navigateur). Rien n'est envoyé au serveur. Ne fonctionne que sur une adresse sécurisée
   * (https, localhost ou application installée).
   */
  locateMe(): void {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      this.showLocateMessage("La localisation n'est pas disponible sur cette adresse (elle demande une connexion sécurisée https).");
      return;
    }
    this.locating = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => this.locateZone.run(() => {
        this.locating = false;
        const here = L.latLng(pos.coords.latitude, pos.coords.longitude);
        this.userLocationLayer?.remove();
        this.userLocationLayer = L.layerGroup([
          L.circle(here, { radius: pos.coords.accuracy, color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }),
          L.circleMarker(here, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).bindTooltip('Vous êtes ici'),
        ]).addTo(this.map);
        this.map.setView(here, Math.max(this.map.getZoom(), 16));
      }),
      (err) => this.locateZone.run(() => {
        this.locating = false;
        this.showLocateMessage(
          err.code === err.PERMISSION_DENIED ? "Autorisez la localisation pour Appi'Field dans les réglages du téléphone, puis réessayez."
          : err.code === err.TIMEOUT ? 'La localisation prend trop de temps. Réessayez dans un instant.'
          : 'Position introuvable pour le moment. Réessayez dans un instant.');
      }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  private showLocateMessage(msg: string): void {
    this.locateMessage = msg;
    clearTimeout(this.locateMessageTimer);
    this.locateMessageTimer = setTimeout(() => this.locateZone.run(() => this.locateMessage = ''), 6000);
  }
  private tilesLayers: L.LayerGroup = new L.LayerGroup(); // Pour les vraies tuiles map_tiles/
  private parcellesLayer: L.LayerGroup = new L.LayerGroup(); // Pour les points parcelles
  private tilesLayerGroup: L.LayerGroup | null = null;
  image : string = "image/map.png";
  form!: FormGroup;
  pointMap!: string;
  maParcelles!: Observable<any[]>;
  afficherCachet:boolean = false;
  private parcellesService: ParcellesService = inject(ParcellesService);
  private httpClient = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  // inject central registre to refresh global parcels cache
  private registreService: RegistreService = inject(RegistreService);

  // Properties for forms
  pointForm: boolean = false;
  lat!: number;
  lon!: number;
  point: boolean = false;
  polygon: boolean = false;

  // Properties for click mode on map
  clickModeActive: boolean = false;
  pointFormFromClick: boolean = false;
  tempMarker: L.Marker | null = null; // Marqueur temporaire pour les points cliqués

  // Properties for edit mode
  editMode: boolean = false;
  selectedParcelForEdit: any = null;

  // Properties for tiles management
  tilesDisplayed: boolean = false; // Indique si des tuiles sont actuellement affichées
  isLoadingParcellaire: boolean = false; // Chargement en cours des tuiles du parcellaire

  // Properties for zoom management
  private readonly MIN_ZOOM_LEVEL = 12;
  zoomMessage: string | undefined = 'Zoomez davantage pour afficher le parcellaire.';
  isZoomSufficient: boolean = false;

  // Properties for PAC parcelle import
  selectedPacFeature: any = null;

  // Properties for address autocomplete
  addressSuggestions: any[] = [];
  showSuggestions: boolean = false;
  addressSearchTimeout: any = null;
  // true uniquement quand l'adresse en base provient d'une suggestion sélectionnée
  // (donc associée à un lat/lon fiable) - évite d'enregistrer des coordonnées 0/0
  addressCoordsConfirmed: boolean = false;

  // Validateur : bloque le formulaire si une adresse est saisie sans avoir été
  // sélectionnée dans le menu déroulant (donc sans lat/lon valides)
  private addressSelectedValidator = (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null; // le champ vide est déjà géré par Validators.required
    }
    return this.addressCoordsConfirmed ? null : { addressNotSelected: true };
  };

  // Liste fixe des catégories proposées dans tous les formulaires d'ajout/édition de
  // parcelle : plus de création de catégorie personnalisée, uniquement ces 3 choix.
  availableParcelCategories = computed(() => ['Plein air', 'Sous-protection', 'Traitement de semences']);

  // Properties for map layer management
  satelliteLayerActive: boolean = false;
  private baseLayer!: L.TileLayer;
  private satelliteLayer!: L.TileLayer;

  // Properties for location search autocomplete
  locationSearchTerm: string = '';
  locationSuggestions: any[] = [];
  showLocationSuggestions: boolean = false;
  locationSearchTimeout: any = null;

  // Properties for parcelles forms - needed by template
  signalParcelle = signal<any[]>([]);
  filteredParcelles = signal<any[]>([]);
  searchTerm: string = '';
  selectedCategory: string = '';
  parcelMarkers: L.LayerGroup = new L.LayerGroup(); // Groupe pour les marqueurs de parcelles
  
  // Properties for loading and empty state
  isLoading: boolean = true;
  isEmpty: boolean = false;
  
  // Propriétés pour l'état de sauvegarde et message de succès
  isSaving: boolean = false;
  isDeleting: boolean = false;
  showSuccessMessage = signal(false);
  successMessageText: string = '';

  // Properties for polygon drawing mode
  drawPolygonMode: boolean = false;
  polygonPoints: L.LatLng[] = [];
  private drawnPolygonLayer: L.Polygon | null = null;
  private drawnPolylineLayer: L.Polyline | null = null;
  private polygonPointMarkers: L.CircleMarker[] = [];
  polygonDrawFormOpen: boolean = false;
  private computedPolygonAreaHa: number = 0;
  private pacAreaHa: number = 0;
  private editAreaHa: number = 0;

  // Dropdown personnalisé pour l'unité de superficie (partagé, un seul popup visible à la fois)
  isUnitDropdownOpen: boolean = false;
  readonly areaUnitOptions: { value: string; label: string }[] = [
    { value: 'ha', label: 'Ha' },
    { value: 'a', label: 'A' },
    { value: 'm2', label: 'M²' },
  ];
  drawnPolygonLatLngs: L.LatLng[] = [];
  private boundPolygonClickHandler: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundMapClickHandler: ((e: any) => void) | null = null;
  private resizeZoomControlHandler: (() => void) | null = null;
  private destroy$ = new Subject<void>();
  // ID de la parcelle dont on modifie le tracé (null = création)
  editPolygonParcelId: string | null = null;
  // Propriétés pour l'édition interactive d'un polygone existant
  polygonEditMode: boolean = false;
  editingPolygonPoints: L.LatLng[] = [];
  private editPolygonPreviewLayer: L.Polygon | null = null;
  private editVertexMarkers: L.Marker[] = [];
  private editMidpointMarkers: L.CircleMarker[] = [];
  
  // Properties for full screen map mode
  isFullScreenMapMode: boolean = false;
  
  // Property to track selected parcel for highlighting
  selectedParcelId: string | null = null;

  /**
   * Créer une icône personnalisée sous forme de point rond
   */
  private createCustomIcon(color: string = '#03918a', borderColor: string = 'white'): L.DivIcon {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        background: ${color}; 
        border-radius: 50%; 
        width: 14px; 
        height: 14px; 
        border: 2px solid ${borderColor};
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        z-index: 1000;
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -7]
    });
  }
  
  parcel_name: string = '';
  parcel_area: string = '';
  parcel_area_unit_fr: string = 'ha';
  parcel_address: string = '';
  parcel_category: string = '';
  sigec_code: string = ''; // Nouveau champ pour le code SIGEC
  polygone: string = '';

  constructor() {}

  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLElement>;

  // Propriété pour gérer l'état du bouton FAB
  isFabOpen: boolean = false;

  // Méthode pour basculer l'état du FAB
  toggleFab(): void {
    this.isFabOpen = !this.isFabOpen;
  }

  // Fermer le FAB (utilisé quand on clique sur une option)
  closeFab(): void {
    this.isFabOpen = false;
  }

  // isFabOpen pilote désormais la liste déroulante "Ajouter une parcelle" (desktop) :
  // fermée au clic en dehors ou à la touche Échap.
  @HostListener('document:click')
  onDocumentClickCloseAddMenu(): void {
    this.isFabOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscapeCloseAddMenu(): void {
    this.isFabOpen = false;
    // Échap ferme aussi la popup ouverte (même action que sa croix)
    if (this.afficherCachet) { this.editMode ? this.closeEditParcel() : this.cahcher(); }
    else if (this.pointFormFromClick) { this.closePointForm(); }
    else if (this.pointForm) { this.onFermeturePointForm(); }
    else if (this.polygonDrawFormOpen) { this.closePolygonDrawForm(); }
  }

  ngOnInit(): void {
    //  Initialisation des coordonnées à 0 au démarrage uniquement
    this.lat = 0;
    this.lon = 0;
    
    this.form = new FormGroup({
      nom: new FormControl(''),
      culture: new FormControl(''),
      parcel_name: new FormControl('', [Validators.required]),
      parcel_area: new FormControl('', [Validators.required]),
      parcel_area_unit_fr: new FormControl('ha', [Validators.required]),
      parcel_address: new FormControl('', [Validators.required, this.addressSelectedValidator]),
      parcel_category: new FormControl(null, [Validators.required]),
      sigec_code: new FormControl('') // Champ optionnel pour le code SIGEC
    });
    
    // Activer le mode plein écran par défaut si on est sur /parcelles/voir-parcelles
    if (this.router.url === '/parcelles/voir-parcelles') {
      this.isFullScreenMapMode = true;
      document.body.classList.add('full-screen-map-mode');
    }
    
    // Note: Les parcelles seront chargées dans ngAfterViewInit après l'initialisation de la carte
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.loadParcelles();
  }

  private initMap(): void {
    // Coordonnées de base pour la Belgique
    const baseCoordinates: [number, number] = [50.8503, 4.3517];
    
    // Référence propre au composant (et non l'id 'map') : en arrivant depuis /parcelles, l'ancienne
    // page peut rester brièvement dans le DOM avec son propre #map, et Leaflet s'y accrochait
    // (carte blanche, sans contrôles de zoom).
    this.map = L.map(this.mapContainer.nativeElement, {
      center: baseCoordinates,
      zoom: 8,
      zoomControl: false // Désactiver le contrôle de zoom par défaut
    });

    // Définir les couches de base
    this.baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    });

    this.satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: '© Esri, Maxar, Earthstar Geographics, USDA FSA, USGS, Aerogrid, IGN, IGP, and the GIS User Community'
    });

    // Ajouter la couche de base par défaut
    this.baseLayer.addTo(this.map);


    // Toujours ajouter le contrôle de zoom
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Ajouter les LayerGroups à la carte
    this.tilesLayers.addTo(this.map);
    this.parcellesLayer.addTo(this.map);
    this.parcelMarkers.addTo(this.map); // Ajouter les marqueurs de parcelles

    // Écouter les changements de zoom et de vue
    this.map.on('zoomend moveend', () => {
      this.updateZoomAndBounds();
    });

    // Initialiser l'état du zoom
    this.updateZoomAndBounds();
    
    // Forcer le repositionnement et le style des contrôles Leaflet
    setTimeout(() => {
      this.repositionLeafletControls();
      this.resizeZoomControlHandler = () => {
        const zoomControl = document.querySelector('.leaflet-control-zoom');
        if (zoomControl) {
          (zoomControl as HTMLElement).style.display = window.innerWidth <= 992 ? 'none' : '';
        }
      };
      this.resizeZoomControlHandler();
      window.addEventListener('resize', this.resizeZoomControlHandler);
    }, 100);
  }

  /**
   * Repositionner les contrôles Leaflet via JavaScript - à droite de l'écran
   */
  /**
   * Repositionner et styliser les contrôles Leaflet via JavaScript
   */
  private repositionLeafletControls(): void {
    const zoomControl = document.querySelector('.leaflet-control-zoom');
    if (zoomControl && zoomControl instanceof HTMLElement) {
      // Positionner à droite de l'écran, décalé vers le bas
      zoomControl.style.setProperty('top', '25px', 'important');
      zoomControl.style.setProperty('right', '15px', 'important');
      zoomControl.style.setProperty('left', 'auto', 'important');
      zoomControl.style.setProperty('margin', '0', 'important');
      
      // Appliquer les styles visuels
      zoomControl.style.setProperty('box-shadow', '0 2px 6px rgba(0, 0, 0, 0.15)', 'important');
      zoomControl.style.setProperty('border', '1px solid #e5e7eb', 'important');
      zoomControl.style.setProperty('border-radius', '6px', 'important');
    }
    
    // Styliser les boutons individuels du zoom
    const zoomButtons = document.querySelectorAll('.leaflet-control-zoom a');
    zoomButtons.forEach((button, index) => {
      if (button instanceof HTMLElement) {
        button.style.setProperty('background-color', 'white', 'important');
        button.style.setProperty('border', '1px solid #e5e7eb', 'important');
        button.style.setProperty('color', '#374151', 'important');
        button.style.setProperty('font-size', '16px', 'important');
        button.style.setProperty('font-weight', 'bold', 'important');
        button.style.setProperty('width', '35px', 'important');
        button.style.setProperty('height', '35px', 'important');
        button.style.setProperty('line-height', '33px', 'important');
        button.style.setProperty('transition', 'all 0.2s ease', 'important');
        button.style.setProperty('box-shadow', 'none', 'important');
        
        // Styles spécifiques pour le premier et dernier bouton
        if (index === 0) { // Bouton +
          button.style.setProperty('border-top-left-radius', '6px', 'important');
          button.style.setProperty('border-top-right-radius', '6px', 'important');
          button.style.setProperty('border-bottom', 'none', 'important');
        } else { // Bouton -
          button.style.setProperty('border-bottom-left-radius', '6px', 'important');
          button.style.setProperty('border-bottom-right-radius', '6px', 'important');
          button.style.setProperty('border-top', 'none', 'important');
        }
        
        // Ajouter les événements hover
        button.addEventListener('mouseenter', () => {
          button.style.setProperty('background-color', '#03918a', 'important');
          button.style.setProperty('color', 'white', 'important');
          button.style.setProperty('border-color', '#03918a', 'important');
        });
        
        button.addEventListener('mouseleave', () => {
          button.style.setProperty('background-color', 'white', 'important');
          button.style.setProperty('color', '#374151', 'important');
          button.style.setProperty('border-color', '#e5e7eb', 'important');
        });
      }
    });
    
    // Repositionner tous les autres contrôles à droite
    const rightControls = document.querySelectorAll('.leaflet-right .leaflet-control');
    rightControls.forEach((control) => {
      if (control instanceof HTMLElement && !control.classList.contains('leaflet-control-zoom')) {
        control.style.setProperty('top', '60px', 'important');
        control.style.setProperty('margin-top', '0', 'important');
      }
    });
  }

  private updateZoomAndBounds(): void {
    const currentZoom = this.map.getZoom();
    this.isZoomSufficient = currentZoom >= this.MIN_ZOOM_LEVEL;
    
    // Utiliser setTimeout pour éviter ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      if (!this.isZoomSufficient) {
        this.zoomMessage = `Zoomez davantage pour afficher le parcellaire.`;
      }
    });
  }

  /**
   * Méthode appelée lors du clic sur une parcelle GeoJSON
   * Ouvre le formulaire d'encodage avec les données de la parcelle
   */
  onParcelleClick(feature: any, e: L.LeafletEvent): void {
    
    // Pré-remplir le formulaire avec les données de la parcelle
    if (feature.properties && feature.geometry) {
      const props = feature.properties;
      const geometry = feature.geometry;
      
      // Calculer la superficie en hectares depuis Shape_Area (m²)
      const shapeAreaM2 = props.Shape_Area || 0;
      const areaHa = (shapeAreaM2 / 10000).toFixed(4); // m² vers ha avec 4 décimales
      
      // Générer un nom basé sur REF_ID
      this.parcel_name = `Parcelle PAC ${props.REF_ID || 'Unknown'}`;
      this.pacAreaHa = parseFloat(areaHa) || 0;
      this.parcel_area = areaHa;
      this.parcel_area_unit_fr = 'ha';
      this.parcel_address = 'Parcelle Pac On Web'; // Adresse par défaut
      this.parcel_category = 'Plein air'; // Catégorie par défaut

      // Calculer le centroïde du polygone pour lat/lon
      const centroid = this.calculatePolygonCentroid(geometry);
      this.lat = centroid.lat;
      this.lon = centroid.lng;
      
      // Stocker les données spécifiques pour l'import PAC
      this.selectedPacFeature = {
        properties: props,
        geometry: geometry,
        import_date: new Date().toISOString(),
        imported_from_paconweb: true,
        record_type: 'PAC_parcel'
      };
      
      // Ouvrir le formulaire d'encodage
      this.pointForm = true;
      
    }
  }

  /**
   * Calculer le centroïde d'un polygone GeoJSON
   */
  private calculatePolygonCentroid(geometry: any): { lat: number, lng: number } {
    if (geometry.type !== 'Polygon' || !geometry.coordinates || !geometry.coordinates[0]) {
      return { lat: 0, lng: 0 };
    }
    
    const coordinates = geometry.coordinates[0]; // Premier ring du polygone
    let lat = 0;
    let lng = 0;
    const numPoints = coordinates.length - 1; // Exclure le dernier point (identique au premier)
    
    for (let i = 0; i < numPoints; i++) {
      lng += coordinates[i][0];
      lat += coordinates[i][1];
    }
    
    return {
      lat: lat / numPoints,
      lng: lng / numPoints
    };
  }

  /**
  private mapNatureToCategory(nature?: string): string {
    if (!nature) return 'Plein air';
    const natureLower = nature.toLowerCase();
    if (natureLower.includes('serre')) return 'serre';
    if (natureLower.includes('abri') || natureLower.includes('tunnel')) return 'Sous-protection';
    return 'Plein air';
  }

  /**
   * Méthode appelée lors du clic sur le bouton "Le parcellaire"
   * Charge les tuiles GeoJSON en fonction de la position GPS actuelle de la carte
   */
  async onParcellaire(): Promise<void> {
    try {
      // Vérifier la condition de zoom
      if (!this.isZoomSufficient) {
        alert(this.zoomMessage || 'Zoom insuffisant pour charger les parcelles');
        return;
      }

      this.isLoadingParcellaire = true;


      // Récupérer la position GPS au centre de l'écran
      const center = this.map!.getCenter();
      const lat = center.lat;
      const lon = center.lng;


      // Référentiel cadastral wallon (tuiles GeoJSON statiques) : jeu de données non
      // migré vers le nouveau serveur, reste volontairement servi par l'ancien hébergeur.
      const scriptUrl = 'https://server.appifield.be/get_tiles_by_position.php';
      const response = await firstValueFrom(this.httpClient!.get<any>(`${scriptUrl}?lat=${lat}&lon=${lon}`));

      if (!response.success) {
        throw new Error(response.error || 'Erreur lors de la récupération des tuiles');
      }


      // Supprimer les tuiles précédentes s'il y en avait
      if (this.tilesLayerGroup) {
        this.map!.removeLayer(this.tilesLayerGroup);
      }
      this.tilesLayerGroup = new L.LayerGroup();

      // Charger chaque tuile GeoJSON
      const tiles = response.tile_files || [];
      const totalTiles = tiles.length;
      let tilesLoaded = 0;


      for (const tileFilename of tiles) {
        try {
          
          const tileUrl = `https://server.appifield.be/index.php?file=index/map_tiles/${tileFilename}`;
          const tileData = await firstValueFrom(this.httpClient!.get<any>(tileUrl));

          if (tileData && tileData.type === 'FeatureCollection') {
            // Créer une couche GeoJSON avec style personnalisé
            const geoJsonLayer = L.geoJSON(tileData, {
              style: (feature) => ({
                fillColor: '#e74c3c',
                weight: 2,
                opacity: 1,
                color: '#c0392b',
                fillOpacity: 0.3
              }),
              onEachFeature: (feature, layer) => {
                // Ajouter un popup simple avec seulement le nom de la parcelle
                if (feature.properties) {
                  const props = feature.properties;
                  layer.bindPopup(buildParcelPopupHtml(null, {
                    titleOnly: `Parcelle ${props.CAPAKEY || 'N/A'}`,
                    accentColor: '#e74c3c'
                  }));
                  
                  // Ajouter un gestionnaire de clic pour l'encodage - clic direct ouvre le formulaire
                  layer.on('click', (e) => {
                    this.onParcelleClick(feature, e);
                  });
                }
              }
            });

            this.tilesLayerGroup!.addLayer(geoJsonLayer);
            tilesLoaded++;
          }

        } catch (tileError) {
          console.warn(`Erreur lors du chargement de la tuile ${tileFilename}:`, tileError);
        }
      }

      // Ajouter toutes les tuiles à la carte
      if (this.tilesLayerGroup!.getLayers().length > 0) {
        this.tilesLayerGroup!.addTo(this.map!);
        this.tilesDisplayed = true; // Marquer que des tuiles sont affichées
      }
    } catch (error) {
      alert('Erreur lors du chargement du parcellaire. Vérifiez la console pour plus de détails.');
    } finally {
      this.isLoadingParcellaire = false;
    }
  }

  // Additional missing methods required by template
  addClickMarqueur(): void {
    this.clickModeActive = !this.clickModeActive;
    
    if (this.clickModeActive) {
      // Activer le gestionnaire de clic sur la carte
      this.enableMapClickHandler();
      // Changer le curseur pour indiquer le mode actif
      this.map.getContainer().style.cursor = 'crosshair';
    } else {
      // Désactiver le gestionnaire de clic sur la carte
      this.disableMapClickHandler();
      // Restaurer le curseur par défaut
      this.map.getContainer().style.cursor = '';
    }
  }

  afficher(): void {
    // Désactiver le scroll du body quand la popup s'ouvre
    document.body.classList.add('no-scroll');
    
    this.afficherCachet = true;
    
    //  Réinitialiser seulement les suggestions d'adresses, PAS les coordonnées
    this.addressSuggestions = [];
    this.showSuggestions = false;
    
  }

  cahcher(): void {
    // Réactiver le scroll du body quand la popup se ferme
    document.body.classList.remove('no-scroll');
    // Fermer le FAB si ouvert
    this.isFabOpen = false;
    this.isUnitDropdownOpen = false;

    this.afficherCachet = false;
    
    // Si on était en mode édition, le désactiver
    if (this.editMode) {
      this.editMode = false;
      this.selectedParcelForEdit = null;
    }
    
    //  Réinitialiser seulement les suggestions d'adresses, PAS les coordonnées
    this.addressSuggestions = [];
    this.showSuggestions = false;
    
  }

  /**
   * Ouvrir la popup de création de première parcelle
   */
  createFirstParcel(): void {
    this.afficher();
  }

  onSearchCity(): void {
    if (this.form.valid && !this.isSaving) {
      
      //  Vérifier si nous avons des coordonnées valides avant de continuer
      if (!this.lat || !this.lon || this.lat === 0 || this.lon === 0) {
        return;
      }
      
      // Empêcher les double-clics
      this.isSaving = true;
      
      // Sauvegarder le nom pour le message de succès
      const parcelName = this.form.value.parcel_name;
      
      // Fermer immédiatement la popup pour une meilleure UX
      this.afficherCachet = false;
      document.body.classList.remove('no-scroll');
      this.isFabOpen = false;
      
      // Générer les identifiants automatiquement
      const uuid = this.generateUUID();
      const currentDate = new Date().toISOString();
      
      //  S'assurer que nous avons des coordonnées valides
      const finalLat = this.lat && !isNaN(this.lat) ? this.lat.toString() : '0';
      const finalLon = this.lon && !isNaN(this.lon) ? this.lon.toString() : '0';
      
      //  Avertir si les coordonnées sont nulles/invalides
      if (finalLat === '0' || finalLon === '0') {
        this.isSaving = false;
        return;
      }
      
      // Préparer les données selon le format attendu par POST /parcels
      const parcelData = {
        latitude: parseFloat(finalLat),
        longitude: parseFloat(finalLon),
        parcelName: parcelName,
        parcelArea: parseFloat((this.form.value.parcel_area ?? '').toString().replace(',', '.')) || null,
        parcelAreaUnit: this.form.value.parcel_area_unit_fr,
        parcelAddress: this.form.value.parcel_address,
        parcelCategory: this.form.value.parcel_category,
        recordType: "Adress_parcel",
      };

      // Envoyer à l'API
      const apiUrl = environment.apiRegistre + '/parcels';

      this.httpClient.post(apiUrl, parcelData).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response) => {
          // Afficher le message de succès
          this.successMessageText = `La parcelle "${parcelName}" a été créée avec succès !`;
          this.showSuccessMessage.set(true);
          
          // Masquer le message après 3 secondes
          setTimeout(() => {
            this.showSuccessMessage.set(false);
          }, 3000);
          
          // Recharger les parcelles et marqueurs
          this.rechargerParcelles();

          // Mettre à jour le cache central
          try { this.registreService.refreshParcels(); } catch (e) { console.warn('Impossible de rafraîchir le cache central des parcelles:', e); }
          
          // Réinitialiser complètement le formulaire ET les coordonnées après succès
          this.resetFormAndCoordinates();
          
          // Réactiver le bouton
          this.isSaving = false;
        },
        error: (error) => {
          this.isSaving = false;
          // Rouvrir la popup en cas d'erreur pour que l'utilisateur puisse réessayer
          this.afficherCachet = true;
          document.body.classList.add('no-scroll');
          alert('Erreur lors de l\'enregistrement de la parcelle. Veuillez réessayer.');
        }
      });
    }
  }

  /**
   * Réinitialiser complètement le formulaire et les coordonnées après un enregistrement réussi
   */
  private resetFormAndCoordinates(): void {
    // Réinitialiser le formulaire
    this.form.reset({
      parcel_area_unit_fr: 'ha',
      parcel_category: null
    });
    // Réinitialiser aussi la catégorie du formulaire PAC (ngModel)
    this.parcel_category = '';

    // Réinitialiser les coordonnées
    this.lat = 0;
    this.lon = 0;
    this.addressCoordsConfirmed = false;

    // Réinitialiser les suggestions d'adresses
    this.addressSuggestions = [];
    this.showSuggestions = false;

    // S'assurer que l'adresse redemande une sélection valide (au cas où setValidators
    // aurait été allégé lors d'une précédente édition)
    this.form.get('parcel_address')?.setValidators([Validators.required, this.addressSelectedValidator]);
    this.form.get('parcel_address')?.updateValueAndValidity();
  }

  onFermeturePointForm(): void {
    this.pointForm = false;
    this.isUnitDropdownOpen = false;

    // Supprimer les tuiles du parcellaire lors de l'annulation
    this.clearParcellaireData();

  }

  onSendPointForm(form: NgForm): void {
    if (form.valid && !this.isSaving) {
      // Empêcher les double-clics
      this.isSaving = true;
      
      // Sauvegarder le nom pour le message de succès
      const parcelName = form.value.parcel_name;
      
      // Fermer immédiatement la popup pour une meilleure UX
      this.pointForm = false;
      
      // Générer UUID
      const uuid = this.generateUUID();
      
      // Préparer les données à envoyer
      let parcelleData: any = {
        id_parcel: uuid,
        parcel_name: parcelName,
        parcel_area: (form.value.parcel_area ?? '').toString().replace(',', '.'),
        parcel_area_unit_fr: form.value.parcel_area_unit_fr,
        parcel_address: form.value.parcel_address || 'Parcelle Pac On Web',
        parcel_category: form.value.parcel_category,
        sigec_code: form.value.sigec_code || '',
        lat: form.value.lat.toString(),
        lon: form.value.lon.toString(),
        record_type: 'PAC_parcel'
      };

      // Si c'est une parcelle PAC, ajouter les données spécifiques
      if (this.selectedPacFeature) {
        parcelleData = {
          ...parcelleData,
          polygone: JSON.stringify(this.selectedPacFeature.geometry.coordinates[0].map((c: number[]) => [c[1], c[0]])),
          imported_from_paconweb: true,
          import_date: this.selectedPacFeature.import_date,
          ref_id: this.selectedPacFeature.properties.REF_ID,
          record_type: this.selectedPacFeature.record_type
        };
      }

      // Enregistrer la parcelle via le service
      this.parcellesService.addParcelle(parcelleData).then((response: any) => {
        // Afficher le message de succès
        this.successMessageText = `La parcelle "${parcelName}" a été créée avec succès !`;
        this.showSuccessMessage.set(true);
        
        // Masquer le message après 3 secondes
        setTimeout(() => {
          this.showSuccessMessage.set(false);
        }, 3000);
        
        this.selectedPacFeature = null;
        
        // Retirer les tuiles GeoJSON de la carte
        this.clearParcellaireData();
        
        // Recharger la liste des parcelles
        this.rechargerParcelles();

        // Mettre à jour le cache central
        try { this.registreService.refreshParcels(); } catch (e) { console.warn('Impossible de rafraîchir le cache central des parcelles:', e); }
        
        // Réactiver le bouton
        this.isSaving = false;
      }).catch((error: any) => {
        console.error('Erreur lors de l\'enregistrement:', error);
        this.isSaving = false;
        // Rouvrir la popup en cas d'erreur
        this.pointForm = true;
        alert('Erreur lors de l\'enregistrement de la parcelle. Veuillez réessayer.');
      });
    }
  }

  /**
   * Nettoyer les données du parcellaire (retirer les tuiles GeoJSON)
   */
  private clearParcellaireData(): void {
    if (this.tilesLayerGroup) {
      this.map.removeLayer(this.tilesLayerGroup);
      this.tilesLayerGroup = null;
    }
    this.tilesDisplayed = false; // Marquer que les tuiles ne sont plus affichées
  }

  /**
   * Supprimer les tuiles affichées (méthode publique appelée depuis le template)
   */
  onRemoveTiles(): void {
    this.clearParcellaireData();
  }

  /**
   * Recharger la liste des parcelles depuis l'API
   */
  private async rechargerParcelles(): Promise<void> {
    try {
      // Utiliser notre nouvelle méthode de chargement
      await this.loadParcelles();
    } catch (error) {
      console.error('Erreur lors du rechargement des parcelles:', error);
    }
  }

  /**
   * Générer un UUID v4
   */
  private generateUUID(): string {
    return generateUUID();
  }

  /**
   * Générer un place_id aléatoire (nombre entre 100000000 et 999999999)
   */
  private generateRandomPlaceId(): number {
    return Math.floor(Math.random() * (999999999 - 100000000 + 1)) + 100000000;
  }

  onPolygonClose(): void {
    this.polygon = false;
  }

  onSendPolygon(form: NgForm): void {
  
  }

  onPointToogle(): void {
    this.point = !this.point;
  }

  onPolygonToogle(): void {
    this.polygon = !this.polygon;
  }

  onSubmit(form: NgForm): void {
    if (form.valid) {
      // TODO: Implémenter la logique de soumission
    }
  }

  onQuitter(): void {
    // TODO: Implémenter la logique de sortie
  }

  /**
   * Gérer la saisie dans le champ adresse pour l'autocomplétion
   */
  onAddressInput(event: any): void {
    const query = event.target.value;

    // Toute frappe invalide la sélection précédente : il faut re-choisir
    // une suggestion pour obtenir des coordonnées valides
    this.addressCoordsConfirmed = false;
    this.lat = 0;
    this.lon = 0;

    if (this.addressSearchTimeout) {
      clearTimeout(this.addressSearchTimeout);
    }
    
    if (query.length < 3) {
      this.addressSuggestions = [];
      this.showSuggestions = false;
      return;
    }
    
    // Délai de 300ms pour éviter trop de requêtes
    this.addressSearchTimeout = setTimeout(() => {
      this.searchAddresses(query);
    }, 300);
  }

  /**
   * Afficher les suggestions lors du focus
   */
  onAddressFocus(): void {
    if (this.addressSuggestions.length > 0) {
      this.showSuggestions = true;
    }
  }

  /**
   * Masquer les suggestions lors de la perte de focus (avec délai)
   */
  onAddressBlur(): void {
    // Délai pour permettre le clic sur une suggestion
    setTimeout(() => {
      this.showSuggestions = false;
    }, 150);
  }

  /**
   * Rechercher des adresses belges via l'API Nominatim
   */
  private searchAddresses(query: string): void {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=be&q=${encodeURIComponent(query)}`;
    
    
    this.httpClient.get<any[]>(url).pipe(takeUntil(this.destroy$)).subscribe({
      next: (results) => {
        this.addressSuggestions = results.map(result => ({
          place_id: result.place_id,
          display_name: result.display_name,
          lat: parseFloat(result.lat),
          lon: parseFloat(result.lon),
          address: result.address
        }));
        this.showSuggestions = this.addressSuggestions.length > 0;
      },
      error: (error) => {
        this.addressSuggestions = [];
        this.showSuggestions = false;
      }
    });
  }

  /**
   * Sélectionner une suggestion d'adresse
   */
  selectAddressSuggestion(suggestion: any): void {
    // Une suggestion a été choisie : l'adresse est désormais associée à des coordonnées fiables
    this.addressCoordsConfirmed = true;

    // Mettre à jour le champ adresse dans le formulaire réactif
    if (this.form) {
      this.form.patchValue({
        parcel_address: suggestion.display_name
      });
    }
    
    // Aussi mettre à jour la propriété pour la compatibilité
    this.parcel_address = suggestion.display_name;
    
    // 🎯 Mettre à jour les coordonnées en s'assurant qu'elles sont des nombres
    this.lat = typeof suggestion.lat === 'string' ? parseFloat(suggestion.lat) : suggestion.lat;
    this.lon = typeof suggestion.lon === 'string' ? parseFloat(suggestion.lon) : suggestion.lon;

    
    // Masquer les suggestions
    this.showSuggestions = false;
    this.addressSuggestions = [];
    
    // Centrer la carte sur l'adresse sélectionnée
    if (this.map) {
      this.map.setView([this.lat, this.lon], 16);
      
      // Ajouter un marqueur temporaire avec l'icône personnalisée
      const marker = L.marker([this.lat, this.lon], {
        icon: this.createCustomIcon('#03918a', 'white')
      })
        .addTo(this.map)
        .bindPopup(buildParcelPopupHtml(null, { titleOnly: suggestion.display_name, accentColor: '#03918a' }))
        .openPopup();
      
    }
  }

  /**
   * Activer le gestionnaire de clic sur la carte
   */
  private enableMapClickHandler(): void {
    if (this.map) {
      this.boundMapClickHandler = this.onMapClick.bind(this);
      this.map.on('click', this.boundMapClickHandler);
    }
  }

  /**
   * Désactiver le gestionnaire de clic sur la carte
   */
  private disableMapClickHandler(): void {
    if (this.map && this.boundMapClickHandler) {
      this.map.off('click', this.boundMapClickHandler);
      this.boundMapClickHandler = null;
    }
  }

  /**
   * Gestionnaire de clic sur la carte
   */
  private onMapClick(event: any): void {
    if (this.clickModeActive) {
      const latlng = event.latlng;
      
      // Stocker les coordonnées
      this.lat = latlng.lat;
      this.lon = latlng.lng;
      
      // Ajouter un marqueur temporaire avec l'icône personnalisée
      this.tempMarker = L.marker([latlng.lat, latlng.lng], {
        icon: this.createCustomIcon('#03918a', 'white')
      })
        .addTo(this.map)
        .bindPopup(buildParcelPopupHtml(null, { titleOnly: 'Point sélectionné', accentColor: '#03918a' }))
        .openPopup();
      
      // Ouvrir le formulaire de point
      this.pointFormFromClick = true;
      // Réactiver le scroll du body avant de fermer
      document.body.classList.remove('no-scroll');
      this.afficherCachet = false; // Fermer le formulaire d'adresse s'il est ouvert
      
      // Réinitialiser le formulaire pour ce nouveau point
      this.form.patchValue({
        parcel_name: '',
        parcel_area: '',
        parcel_area_unit_fr: 'ha',
        parcel_address: 'Point cliqué sur carte', // Valeur par défaut pour les points cliqués
        parcel_category: null
      });
      
      // Pour les points cliqués, parcel_address n'est pas requis
      this.form.get('parcel_address')?.clearValidators();
      this.form.get('parcel_address')?.updateValueAndValidity();
      
      // Désactiver le mode clic
      this.clickModeActive = false;
      this.map.getContainer().style.cursor = '';
      this.disableMapClickHandler();
      
    }
  }

  /**
   * Fermer le formulaire de point
   */
  closePointForm(): void {
    this.pointFormFromClick = false;
    this.clickModeActive = false;
    // Fermer le FAB si ouvert
    this.isFabOpen = false;
    this.isUnitDropdownOpen = false;
    
    // Restaurer la validation required sur parcel_address
    this.form.get('parcel_address')?.setValidators([Validators.required, this.addressSelectedValidator]);
    this.form.get('parcel_address')?.updateValueAndValidity();
    
    // Supprimer le marqueur temporaire s'il existe
    if (this.tempMarker && this.map) {
      this.map.removeLayer(this.tempMarker);
      this.tempMarker = null;
    }
    
    // Restaurer le curseur par défaut
    if (this.map) {
      this.map.getContainer().style.cursor = '';
      this.disableMapClickHandler();
    }
  }

  /**
   * Enregistrer une parcelle créée par clic sur la carte
   */
  onSavePointForm(): void {
    
    if (this.form.valid && this.lat && this.lon && !this.isSaving) {
      // Empêcher les double-clics
      this.isSaving = true;
      
      // Sauvegarder le nom pour le message de succès
      const parcelName = this.form.value.parcel_name;
      
      // Fermer immédiatement la popup pour une meilleure UX
      this.pointFormFromClick = false;
      this.clickModeActive = false;
      
      // Supprimer le marqueur temporaire s'il existe
      if (this.tempMarker && this.map) {
        this.map.removeLayer(this.tempMarker);
        this.tempMarker = null;
      }
      
      // Restaurer le curseur par défaut
      if (this.map) {
        this.map.getContainer().style.cursor = '';
        this.disableMapClickHandler();
      }
      
      // Générer les identifiants automatiquement
      const uuid = this.generateUUID();
      const currentDate = new Date().toISOString();
      
      // Préparer les données selon le format attendu par POST /parcels
      const parcelData = {
        latitude: this.lat,
        longitude: this.lon,
        parcelName: parcelName,
        parcelArea: parseFloat((this.form.value.parcel_area ?? '').toString().replace(',', '.')) || null,
        parcelAreaUnit: this.form.value.parcel_area_unit_fr,
        parcelCategory: this.form.value.parcel_category,
        recordType: "Point_parcel",
      };

      // Envoyer à l'API
      const apiUrl = environment.apiRegistre + '/parcels';

      this.httpClient.post(apiUrl, parcelData).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response) => {
          // Afficher le message de succès
          this.successMessageText = `La parcelle "${parcelName}" a été créée avec succès !`;
          this.showSuccessMessage.set(true);
          
          // Masquer le message après 3 secondes
          setTimeout(() => {
            this.showSuccessMessage.set(false);
          }, 3000);
          
          // Recharger les parcelles et marqueurs
          this.rechargerParcelles();

          // Mettre à jour le cache central
          try { this.registreService.refreshParcels(); } catch (e) { console.warn('Impossible de rafraîchir le cache central des parcelles:', e); }
          
          // Réinitialiser le formulaire
          this.form.reset({
            parcel_area_unit_fr: 'ha',
            parcel_category: null
          });

          // Restaurer la validation required sur parcel_address
          this.form.get('parcel_address')?.setValidators([Validators.required, this.addressSelectedValidator]);
          this.form.get('parcel_address')?.updateValueAndValidity();
          
          // Réactiver le bouton
          this.isSaving = false;
        },
        error: (error) => {
          this.isSaving = false;
          // Rouvrir la popup en cas d'erreur
          this.pointFormFromClick = true;
          alert('Erreur lors de l\'enregistrement de la parcelle. Veuillez réessayer.');
        }
      });
    }
  }

  /**
   * Charger les parcelles depuis l'API
   */
  async loadParcelles(): Promise<void> {
    this.isLoading = true;
    this.isEmpty = false;

    try {
      const raw = await firstValueFrom(this.httpClient.get<any[]>(environment.apiRegistre + '/parcels'));
      const response = Array.isArray(raw) ? raw.map(fromApi) : raw;

      if (response && Array.isArray(response)) {
        this.signalParcelle.set(response);
        this.filteredParcelles.set(response);
        this.isEmpty = response.length === 0;
        this.displayParcelMarkersOnMap();
        this.fitMapToParcelles(response);
      } else {
        this.isEmpty = true;
      }
    } catch (error) {
      this.isEmpty = true;
    } finally {
      this.isLoading = false;
      
      // Forcer la détection des changements pour mettre à jour l'interface
      this.cdr.detectChanges();
    }
  }

  /**
   * Filtrer les parcelles selon la recherche et la catégorie
   */
  filterParcelles(): void {
    let filtered = this.signalParcelle();
    
    // Filtrage par terme de recherche
    if (this.searchTerm.trim()) {
      filtered = filtered.filter(parcelle => 
        parcelle.parcel_name?.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    
    // Filtrage par catégorie
    if (this.selectedCategory && this.selectedCategory !== '') {
      filtered = filtered.filter(parcelle => 
        parcelle.parcel_category === this.selectedCategory
      );
    }
    
    this.filteredParcelles.set(filtered);
  }

  /**
   * Recherche dynamique des parcelles
   */
  onSearchParcelles(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm = target.value;
    this.filterParcelles();
  }

  /**
   * Filtrage par catégorie — menu déroulant personnalisé (même style que .dropdown-btn/
   * .dropdown-panel des popups, un <select> natif ne permettant pas de styliser ses options).
   */
  isCategoryFilterOpen: boolean = false;

  toggleCategoryFilterDropdown(): void {
    this.isCategoryFilterOpen = !this.isCategoryFilterOpen;
  }

  selectCategoryFilterOption(category: string): void {
    this.selectedCategory = category;
    this.isCategoryFilterOpen = false;
    this.filterParcelles();
  }

  /**
   * Centrer la carte sur une parcelle avec animation fluide
   */
  centerMapOnParcelle(parcelle: any): void {
    if (!this.map) return;

    // Marquer la parcelle comme sélectionnée
    this.selectedParcelId = parcelle.id_parcel;
    this.displayParcelMarkersOnMap();

    // Si la parcelle a un polygone, voler vers ses bounds
    if (parcelle.polygone) {
      try {
        const latlngs = this.parsePolygoneToLatLngs(parcelle.polygone);
        if (latlngs.length >= 3) {
          const bounds = L.latLngBounds(latlngs);
          this.map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 18, duration: 1.2 });
          return;
        }
      } catch (e) {}
    }

    // Sinon voler vers le point GPS
    if (parcelle.lat && parcelle.lon) {
      const lat = parseFloat(parcelle.lat);
      const lon = parseFloat(parcelle.lon);
      if (!isNaN(lat) && !isNaN(lon)) {
        this.map.flyTo([lat, lon], 17, { duration: 1.2 });
      }
    }
  }

  /**
   * Centrer et zoomer la carte pour englober toutes les parcelles
   */
  private fitMapToParcelles(parcelles: any[]): void {
    if (!this.map || !parcelles.length) return;

    const allLatLngs: L.LatLng[] = [];

    parcelles.forEach(parcelle => {
      // Ajouter les points du polygone si disponible
      if (parcelle.polygone) {
        try {
          const pts = this.parsePolygoneToLatLngs(parcelle.polygone);
          if (pts.length >= 3) allLatLngs.push(...pts);
        } catch (e) {}
      }
      // Ajouter le point lat/lon
      if (parcelle.lat && parcelle.lon) {
        const lat = parseFloat(parcelle.lat);
        const lon = parseFloat(parcelle.lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          allLatLngs.push(L.latLng(lat, lon));
        }
      }
    });

    if (allLatLngs.length === 0) return;

    const bounds = L.latLngBounds(allLatLngs);
    // Démarrer centré sur la Belgique puis voler vers les parcelles
    setTimeout(() => {
      this.map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 17, duration: 1.8 });
    }, 400);
  }

  /**
   * Afficher tous les points des parcelles sur la carte
   */
  displayParcelMarkersOnMap(): void {
    // Nettoyer les marqueurs existants
    this.parcelMarkers.clearLayers();
    
    // Ajouter un marqueur/polygone pour chaque parcelle
    this.signalParcelle().forEach(parcelle => {
      // Afficher le tracé polygone pour les parcelles qui en ont un
      if (parcelle.polygone) {
        try {
          const latlngs = this.parsePolygoneToLatLngs(parcelle.polygone);
          if (latlngs.length >= 3) {
            const isSelected = this.selectedParcelId &&
              parcelle.id_parcel === this.selectedParcelId;
            const polyLayer = L.polygon(latlngs, {
              color: isSelected ? '#d3e43a' : '#03918a',
              fillColor: isSelected ? '#d3e43a' : '#03918a',
              fillOpacity: 0.2,
              weight: 2
            });
            polyLayer.bindPopup(buildParcelPopupHtml(parcelle, {
              accentColor: isSelected ? '#d3e43a' : '#03918a'
            }));
            this.parcelMarkers.addLayer(polyLayer);
          }
        } catch (e) { /* si le polygone est corrompu, on continue avec le marqueur point */ }
      }

      if (parcelle.lat && parcelle.lon) {
        const lat = parseFloat(parcelle.lat);
        const lon = parseFloat(parcelle.lon);
        if (isNaN(lat) || isNaN(lon)) {
          return;
        }

        // Déterminer la couleur du marqueur : rouge si sélectionné, sinon vert par défaut
        const isSelected = this.selectedParcelId && parcelle.id_parcel === this.selectedParcelId;
        const markerColor = isSelected ? '#d3e43a' : '#03918a';
        const borderColor = isSelected ? '#110f3b' : 'white';

        const marker = L.marker([lat, lon], {
          icon: L.divIcon({
            className: 'parcel-marker',
            html: `<div style="
              background: ${markerColor}; 
              border-radius: 50%; 
              width: 14px; 
              height: 14px; 
              border: 2px solid ${borderColor};
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              z-index: 1000;
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          }),
          zIndexOffset: 1000 // S'assurer que les marqueurs restent au-dessus
        }).bindPopup(buildParcelPopupHtml(parcelle, { accentColor: markerColor }));
        
        this.parcelMarkers.addLayer(marker);
      }
    });
    
    // Ajouter le groupe de marqueurs à la carte (toujours au-dessus)
    if (this.map) {
      this.parcelMarkers.addTo(this.map);
    }
  }

  /**
   * Obtenir les catégories uniques pour le filtre
   */
  getUniqueCategories(): string[] {
    const categories = this.signalParcelle().map(p => p.parcel_category).filter(Boolean);
    return [...new Set(categories)];
  }

  /**
   * Gérer l'autocomplétion d'adresse lors de la saisie
   */
  onLocationSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.locationSearchTerm = target.value;
    
    // Nettoyer le timeout précédent
    if (this.locationSearchTimeout) {
      clearTimeout(this.locationSearchTimeout);
    }
    
    // Si la recherche est trop courte, cacher les suggestions
    if (this.locationSearchTerm.length < 3) {
      this.showLocationSuggestions = false;
      this.locationSuggestions = [];
      return;
    }
    
    // Attendre 500ms avant de lancer la recherche
    this.locationSearchTimeout = setTimeout(() => {
      this.searchLocationSuggestions(this.locationSearchTerm);
    }, 500);
  }

  /**
   * Rechercher des suggestions d'adresse
   */
  private searchLocationSuggestions(query: string): void {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}&countrycodes=be&addressdetails=1`;
    
    this.httpClient.get<any[]>(url).pipe(takeUntil(this.destroy$)).subscribe({
      next: (results) => {
        this.locationSuggestions = results.map(result => ({
          display_name: result.display_name,
          lat: parseFloat(result.lat),
          lon: parseFloat(result.lon),
          address: result.address
        }));
        this.showLocationSuggestions = this.locationSuggestions.length > 0;
      },
      error: (error) => {
        this.showLocationSuggestions = false;
        this.locationSuggestions = [];
      }
    });
  }

  /**
   * Sélectionner une suggestion d'adresse
   */
  selectLocationSuggestion(suggestion: any): void {
    this.locationSearchTerm = suggestion.display_name;
    this.showLocationSuggestions = false;
    this.locationSuggestions = [];
    
    // Zoomer sur la position sélectionnée
    this.zoomToLocation(suggestion.lat, suggestion.lon, suggestion.display_name);
  }

  /**
   * Cacher les suggestions
   */
  hideLocationSuggestions(): void {
    // Petit délai pour permettre le clic sur une suggestion
    setTimeout(() => {
      this.showLocationSuggestions = false;
    }, 200);
  }

  /**
   * Zoomer sur une position spécifique
   */
  private zoomToLocation(lat: number, lon: number, name: string): void {
    if (!isNaN(lat) && !isNaN(lon)) {
      // Zoomer sur la position trouvée
      this.map.setView([lat, lon], 15);
      
      // Ajouter un marqueur temporaire
      const marker = L.marker([lat, lon], {
        icon: L.icon({
          iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiB2aWV3Qm94PSIwIDAgMjU2IDI1NiI+PGcgZmlsbD0iIzIyYmY3NiI+PHBhdGggZD0iTTEyOCAyNGE4MCA4MCAwIDAgMC04MCA4MGMwIDcyIDgwIDEyOCA4MCAxMjhzODAtNTYgODAtMTI4YTgwIDgwIDAgMCAwLTgwLTgwbTAgMTEyYTMyIDMyIDAgMSAxIDMyLTMyYTMyIDMyIDAgMCAxLTMyIDMyIiBvcGFjaXR5PSIwLjIiLz48cGF0aCBkPSJNMTI4IDY0YTQwIDQwIDAgMSAwIDQwIDQwYTQwIDQwIDAgMCAwLTQwLTQwbTAgNjRhMjQgMjQgMCAxIDEgMjQtMjRhMjQgMjQgMCAwIDEtMjQgMjRtMC0xMTJhODguMSA4OC4xIDAgMCAwLTg4IDg4YzAgMzEuNCAxNC41MSA2NC42OCA0MiA5Ni4yNWEyNTQuMiAyNTQuMiAwIDAgMCA0MS40NSAzOC4zYTggOCAwIDAgMCA5LjE4IDBhMjU0LjIgMjU0LjIgMCAwIDAgNDEuMzctMzguM2MyNy40NS0zMS41NyA0Mi02NC44NSA0Mi05Ni4yNWE4OC4xIDg4LjEgMCAwIDAtODgtODhtMCAyMDZjLTE2LjUzLTEzLTcyLTYwLjc1LTcyLTExOGE3MiA3MiAwIDAgMSAxNDQgMGMwIDU3LjIzLTU1LjQ3IDEwNS03MiAxMTgiLz48L2c+PC9zdmc+',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34]
        })
      }).addTo(this.map);
      
      marker.bindPopup(buildParcelPopupHtml(null, { titleOnly: name, accentColor: '#22bf76' })).openPopup();
      
      // Supprimer le marqueur après 8 secondes
      setTimeout(() => {
        if (this.map) {
          this.map.removeLayer(marker);
        }
      }, 8000);
    }
  }

  /**
   * Rechercher une adresse et zoomer sur la position
   */
  searchLocation(input?: any): void {
    let query = '';
    
    if (typeof input === 'string') {
      query = input;
    } else if (input?.target?.value) {
      query = input.target.value;
    }
    
    // Si pas de query, utiliser le terme de recherche actuel
    if (!query) {
      query = this.locationSearchTerm;
    }
    
    if (!query || query.trim().length < 3) {
      return;
    }
    
    query = query.trim();
    
    // Cacher les suggestions
    this.showLocationSuggestions = false;
    
    // Utiliser l'API Nominatim d'OpenStreetMap pour la géolocalisation
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}&countrycodes=be`;
    
    this.httpClient.get<any[]>(url).pipe(takeUntil(this.destroy$)).subscribe({
      next: (results) => {
        if (results && results.length > 0) {
          const result = results[0];
          const lat = parseFloat(result.lat);
          const lon = parseFloat(result.lon);
          
          this.zoomToLocation(lat, lon, result.display_name);
        }
      },
      error: (error) => {
        console.error('Erreur lors de la recherche d\'adresse:', error);
      }
    });
  }

  /**
   * Basculer entre la vue normale et satellite
   */
  toggleSatelliteLayer(): void {
    if (!this.map || !this.baseLayer || !this.satelliteLayer) {
      return;
    }
    
    if (this.satelliteLayerActive) {
      // Passer à la vue normale
      this.map.removeLayer(this.satelliteLayer);
      this.baseLayer.addTo(this.map);
      this.satelliteLayerActive = false;
    } else {
      // Passer à la vue satellite
      this.map.removeLayer(this.baseLayer);
      this.satelliteLayer.addTo(this.map);
      this.satelliteLayerActive = true;
    }
  }

  /**
   * Ouvrir le formulaire de modification d'une parcelle
   */
  openEditParcel(parcelle: any): void {
    // Désactiver le scroll du body quand la popup s'ouvre
    document.body.classList.add('no-scroll');
    
    this.selectedParcelForEdit = parcelle;
    this.editMode = true;
    this.afficherCachet = true;
    
    // Pré-remplir le formulaire avec les données de la parcelle
    this.form.patchValue({
      parcel_name: parcelle.parcel_name || '',
      parcel_area: parcelle.parcel_area || '',
      parcel_area_unit_fr: parcelle.parcel_area_unit_fr || 'ha',
      parcel_address: parcelle.parcel_address || '',
      parcel_category: parcelle.parcel_category || null,
      sigec_code: parcelle.sigec_code || ''
    });

    // Base de conversion (en hectares) pour la conversion automatique d'unité en édition
    const currentArea = parseFloat(String(parcelle.parcel_area).replace(',', '.')) || 0;
    this.editAreaHa = this.areaUnitToHa(currentArea, parcelle.parcel_area_unit_fr || 'ha');

    // Si la parcelle a des coordonnées valides (différentes de 0/0), les conserver
    const hasValidCoords = !!parcelle.lat && !!parcelle.lon &&
      parseFloat(parcelle.lat) !== 0 && parseFloat(parcelle.lon) !== 0;
    if (hasValidCoords) {
      this.lat = parcelle.lat;
      this.lon = parcelle.lon;
    } else {
      this.lat = 0;
      this.lon = 0;
    }
    // L'adresse existante est considérée "confirmée" tant qu'elle n'est pas retapée
    this.addressCoordsConfirmed = hasValidCoords;

    // Ajuster les validateurs selon le type de parcelle
    const addressControl = this.form.get('parcel_address');
    if (parcelle.record_type === 'Point_parcel' ||
        parcelle.record_type === 'PAC_parcel' ||
        parcelle.imported_from_gml ||
        parcelle.imported_from_paconweb) {
      // Pour les parcelles créées par point GPS, PAC ou importées, l'adresse n'est pas obligatoire
      addressControl?.setValidators([]);
    } else {
      // Pour les autres types (adresse), l'adresse reste obligatoire et doit être confirmée
      addressControl?.setValidators([Validators.required, this.addressSelectedValidator]);
    }
    addressControl?.updateValueAndValidity();
  }

  /**
   * Fermer le formulaire d'édition
   */
  closeEditParcel(): void {
    this.editMode = false;
    this.selectedParcelForEdit = null;
    this.editAreaHa = 0;
    // Réactiver le scroll du body avant de fermer
    document.body.classList.remove('no-scroll');
    // Fermer le FAB si ouvert
    this.isFabOpen = false;
    this.isUnitDropdownOpen = false;
    this.afficherCachet = false;

    // Réinitialiser les suggestions d'adresses
    this.addressSuggestions = [];
    this.showSuggestions = false;
    this.addressCoordsConfirmed = false;
  }

  /**
   * Sauvegarder les modifications de la parcelle
   */
  async saveEditedParcel(): Promise<void> {
    if (!this.form.valid || !this.selectedParcelForEdit) {
      return;
    }

    const formData = {
      ...this.form.value,
      lat: this.lat,
      lon: this.lon,
      parcel_area: (this.form.value.parcel_area ?? '').toString().replace(',', '.'),
      // Le PUT /parcels/:id remplace toutes les colonnes : il faut donc réenvoyer le
      // polygone et le recordType existants sous peine de les écraser à null (ex. parcelles GML/PAC).
      polygone: this.selectedParcelForEdit.polygone,
      record_type: this.selectedParcelForEdit.record_type
    };


    try {
      // Mettre à jour la parcelle via le service
      const response = await this.parcellesService.updateParcelle(this.selectedParcelForEdit.id_parcel, formData);
      
      // Recharger les parcelles pour refléter les changements
      this.loadParcelles();
      
      // Fermer le formulaire d'édition
      this.closeEditParcel();
      
      // Réinitialiser le formulaire
      this.resetFormAndCoordinates();
      
    } catch (error) {
      alert('Erreur lors de la mise à jour de la parcelle. Vérifiez la console pour plus de détails.');
    }
  }

  /**
   * Supprime la parcelle actuellement en cours de modification
   */
  async deleteEditedParcel(): Promise<void> {
    if (!this.selectedParcelForEdit || this.isDeleting) {
      return;
    }

    const parcelName = this.selectedParcelForEdit.parcel_name || 'cette parcelle';
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${parcelName}" ? Cette action est irréversible.`)) {
      return;
    }

    this.isDeleting = true;
    try {
      await this.parcellesService.deleteParcelle(this.selectedParcelForEdit.id_parcel);

      // Recharger les parcelles pour refléter la suppression
      this.loadParcelles();

      // Fermer le formulaire d'édition
      this.closeEditParcel();
      this.resetFormAndCoordinates();
    } catch (error) {
      alert('Erreur lors de la suppression de la parcelle. Vérifiez la console pour plus de détails.');
    } finally {
      this.isDeleting = false;
    }
  }

  /**
   * Activer le mode carte plein écran
   */
  enterFullScreenMapMode(): void {
    this.isFullScreenMapMode = true;
    
    // Ajouter les classes CSS pour masquer les éléments et désactiver le scroll
    document.body.classList.add('full-screen-map-mode');
    
    // Forcer la mise à jour de la carte après le changement de mode
    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
      }
    }, 100);
  }

  /**
   * Quitter le mode carte plein écran
   */
  exitFullScreenMapMode(): void {
    this.cleanupFullScreenMode();
    // Rediriger vers /parcelles (vue tableau)
    this.router.navigate(['/parcelles']);
  }

  /**
   * Nettoyer l'état du mode plein écran sans redirection
   */
  cleanupFullScreenMode(): void {
    this.isFullScreenMapMode = false;
    document.body.classList.remove('full-screen-map-mode');
  }

  /**
   * Retourner au tableau des parcelles de manière synchrone
   */
  returnToParcellesTable(): void {
    // Nettoyer l'état d'abord
    //this.isFullScreenMapMode = false;
    //document.body.classList.remove('full-screen-map-mode');
    
    // Puis naviguer
    this.router.navigate(['/parcelles']);
  }

  /**
   * Ouvrir le mode d'édition interactive du tracé d'une parcelle existante
   */
  startEditPolygon(): void {
    if (!this.selectedParcelForEdit) return;

    // Sauvegarder toutes les données AVANT de fermer la popup
    const parcel = this.selectedParcelForEdit;
    this.editPolygonParcelId = parcel.id_parcel;
    const existingPolygone: string | undefined = parcel.polygone;

    // Pré-remplir le formulaire
    this.form.patchValue({
      parcel_name: parcel.parcel_name || '',
      parcel_area: parcel.parcel_area || '',
      parcel_area_unit_fr: parcel.parcel_area_unit_fr || 'ha',
      parcel_address: parcel.parcel_address || 'Parcelle tracée en polygone',
      parcel_category: parcel.parcel_category || null,
      sigec_code: parcel.sigec_code || ''
    });

    // Fermer la popup d'édition (met selectedParcelForEdit à null)
    this.closeEditParcel();

    if (!existingPolygone) {
      // Pas de polygone existant : lancer le dessin classique
      this.startDrawPolygon();
      return;
    }

    try {
      const latlngs = this.parsePolygoneToLatLngs(existingPolygone);
      if (latlngs.length < 3) throw new Error('Polygone invalide ou incomplet');
      this.startInteractivePolygonEdit(latlngs);
    } catch (e) {
      this.startDrawPolygon();
    }
  }

  /**
   * Parse une chaîne JSON de polygone en tableau de LatLng Leaflet.
   * Gère deux formats :
   *  - GeoJSON  : [[[lon, lat], ...]]  (PAC on Web, import GML)
   *  - Interne  : [[lat, lon], ...]    (polygones dessinés dans l'appli)
   */
  private parsePolygoneToLatLngs(polygoneStr: string): L.LatLng[] {
    return parseLatlngs(polygoneStr).map(([lat, lon]) => L.latLng(lat, lon));
  }

  /**
   * Démarrer l'édition interactive (poignées déplaçables)
   */
  private startInteractivePolygonEdit(latlngs: L.LatLng[]): void {
    this.editingPolygonPoints = [...latlngs];
    this.polygonEditMode = true;
    // Centrer la carte sur le polygone
    const tempPoly = L.polygon(latlngs);
    this.map.fitBounds(tempPoly.getBounds(), { padding: [50, 50] });
    this.renderEditablePolygon();
  }

  /**
   * Rendre le polygone éditable avec ses poignées (vertex + points milieux)
   */
  private renderEditablePolygon(): void {
    this.clearEditPolygonLayers();
    if (this.editingPolygonPoints.length < 2) return;

    // Polygon de prévisualisation
    this.editPolygonPreviewLayer = L.polygon(this.editingPolygonPoints, {
      color: '#03918a',
      fillColor: '#03918a',
      fillOpacity: 0.2,
      weight: 2
    }).addTo(this.map);

    const n = this.editingPolygonPoints.length;

    // Poignées de vertex (déplaçables)
    this.editingPolygonPoints.forEach((pt, i) => {
      const marker = L.marker(pt, {
        draggable: true,
        zIndexOffset: 2000,
        icon: L.divIcon({
          className: '',
          html: `<div style="
            width:14px;height:14px;
            background:white;
            border:2.5px solid #03918a;
            border-radius:50%;
            cursor:grab;
            box-shadow:0 1px 4px rgba(0,0,0,0.3);
          "></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        })
      }).addTo(this.map);

      marker.on('drag', (e: any) => {
        this.editingPolygonPoints[i] = (e.target as L.Marker).getLatLng();
        this.refreshEditPolygonPreview();
      });

      // Clic droit : supprimer le point (minimum 3 points)
      marker.on('contextmenu', (e: any) => {
        L.DomEvent.stopPropagation(e);
        if (this.editingPolygonPoints.length > 3) {
          this.editingPolygonPoints.splice(i, 1);
          this.renderEditablePolygon();
        }
      });

      // Double-clic : supprimer (alternative touch/mobile)
      marker.on('dblclick', (e: any) => {
        L.DomEvent.stopPropagation(e);
        if (this.editingPolygonPoints.length > 3) {
          this.editingPolygonPoints.splice(i, 1);
          this.renderEditablePolygon();
        }
      });

      this.editVertexMarkers.push(marker);
    });

    // Points milieux de segment (cliquer pour insérer un nouveau point)
    for (let i = 0; i < n; i++) {
      const a = this.editingPolygonPoints[i];
      const b = this.editingPolygonPoints[(i + 1) % n];
      const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
      const insertIdx = i + 1;

      const midMarker = L.circleMarker(mid, {
        radius: 5,
        color: '#03918a',
        fillColor: 'white',
        fillOpacity: 0.9,
        weight: 1.5,
        zIndexOffset: 1000
      } as any).addTo(this.map);

      midMarker.on('click', (e: any) => {
        L.DomEvent.stopPropagation(e);
        this.editingPolygonPoints.splice(insertIdx, 0, mid);
        this.renderEditablePolygon();
      });

      this.editMidpointMarkers.push(midMarker);
    }
  }

  /**
   * Mettre à jour uniquement le polygon preview (pendant le drag, sans recréer les marqueurs)
   */
  private refreshEditPolygonPreview(): void {
    if (this.editPolygonPreviewLayer) {
      this.editPolygonPreviewLayer.setLatLngs(this.editingPolygonPoints);
    }
  }

  /**
   * Supprimer tous les calques d'édition interactive
   */
  private clearEditPolygonLayers(): void {
    if (this.editPolygonPreviewLayer) {
      this.map.removeLayer(this.editPolygonPreviewLayer);
      this.editPolygonPreviewLayer = null;
    }
    this.editVertexMarkers.forEach(m => this.map.removeLayer(m));
    this.editVertexMarkers = [];
    this.editMidpointMarkers.forEach(m => this.map.removeLayer(m));
    this.editMidpointMarkers = [];
  }

  /**
   * Terminer l'édition interactive et ouvrir le formulaire
   */
  finishEditablePolygon(): void {
    if (this.editingPolygonPoints.length < 3) return;

    this.polygonEditMode = false;
    this.clearEditPolygonLayers();

    // Afficher le polygone final
    this.drawnPolygonLatLngs = [...this.editingPolygonPoints];
    this.drawnPolygonLayer = L.polygon(this.drawnPolygonLatLngs, {
      color: '#03918a',
      fillColor: '#03918a',
      fillOpacity: 0.3,
      weight: 2
    }).addTo(this.map);

    // Calculer superficie et centroïde
    this.computedPolygonAreaHa = this.calculatePolygonAreaHa(this.drawnPolygonLatLngs);
    const centroid = this.calculateLatLngCentroid(this.drawnPolygonLatLngs);
    this.lat = centroid.lat;
    this.lon = centroid.lng;

    // Mettre à jour la superficie selon l'unité choisie
    const unit = this.form.value.parcel_area_unit_fr || 'ha';
    let area = this.computedPolygonAreaHa;
    if (unit === 'a')  area *= 100;
    if (unit === 'm2') area *= 10000;
    this.form.patchValue({ parcel_area: area.toFixed(4) });

    this.form.get('parcel_address')?.clearValidators();
    this.form.get('parcel_address')?.updateValueAndValidity();

    this.polygonDrawFormOpen = true;
    document.body.classList.add('no-scroll');
  }

  /**
   * Annuler l'édition interactive du polygone
   */
  cancelEditablePolygon(): void {
    this.polygonEditMode = false;
    this.editPolygonParcelId = null;
    this.editingPolygonPoints = [];
    this.clearEditPolygonLayers();
  }

  /**
   * Activer le mode dessin de polygone
   */
  startDrawPolygon(): void {
    // Désactiver les autres modes actifs
    if (this.clickModeActive) {
      this.disableMapClickHandler();
      this.clickModeActive = false;
      this.map.getContainer().style.cursor = '';
    }

    this.drawPolygonMode = true;
    this.polygonPoints = [];
    this.map.getContainer().style.cursor = 'crosshair';

    this.boundPolygonClickHandler = (e: L.LeafletMouseEvent) => {
      this.onMapClickForPolygon(e);
    };
    this.map.on('click', this.boundPolygonClickHandler);
  }

  /**
   * Annuler le mode dessin de polygone
   */
  cancelDrawPolygon(): void {
    this.drawPolygonMode = false;
    this.editPolygonParcelId = null;

    if (this.boundPolygonClickHandler) {
      this.map.off('click', this.boundPolygonClickHandler);
      this.boundPolygonClickHandler = null;
    }

    this.map.getContainer().style.cursor = '';
    this.clearPolygonPreview();
    this.polygonPoints = [];
  }

  /**
   * Gestionnaire de clic sur la carte en mode dessin polygone
   */
  private onMapClickForPolygon(e: L.LeafletMouseEvent): void {
    if (!this.drawPolygonMode) return;

    const latlng = e.latlng;

    // Si >= 3 points : vérifier si l'utilisateur clique près du premier point pour fermer
    if (this.polygonPoints.length >= 3) {
      const firstPoint = this.polygonPoints[0];
      const pixelDist = this.map
        .latLngToContainerPoint(latlng)
        .distanceTo(this.map.latLngToContainerPoint(firstPoint));
      if (pixelDist < 20) {
        this.finishPolygon();
        return;
      }
    }

    this.polygonPoints.push(latlng);

    // Ajouter un marqueur circulaire (rouge pour le premier, vert pour les suivants)
    const isFirst = this.polygonPoints.length === 1;
    const marker = L.circleMarker(latlng, {
      radius: isFirst ? 8 : 5,
      color: isFirst ? '#e74c3c' : '#03918a',
      fillColor: isFirst ? '#e74c3c' : '#03918a',
      fillOpacity: 0.9,
      weight: 2
    }).addTo(this.map);
    this.polygonPointMarkers.push(marker);

    this.updatePolygonPreview();
  }

  /**
   * Mettre à jour l'aperçu du polygone en cours de dessin
   */
  private updatePolygonPreview(): void {
    if (this.drawnPolylineLayer) {
      this.map.removeLayer(this.drawnPolylineLayer);
      this.drawnPolylineLayer = null;
    }
    if (this.drawnPolygonLayer) {
      this.map.removeLayer(this.drawnPolygonLayer);
      this.drawnPolygonLayer = null;
    }

    if (this.polygonPoints.length >= 3) {
      this.drawnPolygonLayer = L.polygon(this.polygonPoints, {
        color: '#03918a',
        fillColor: '#03918a',
        fillOpacity: 0.2,
        dashArray: '6, 4',
        weight: 2
      }).addTo(this.map);
    } else if (this.polygonPoints.length === 2) {
      this.drawnPolylineLayer = L.polyline(this.polygonPoints, {
        color: '#03918a',
        dashArray: '6, 4',
        weight: 2
      }).addTo(this.map);
    }
  }

  /**
   * Fermer le polygone et ouvrir le formulaire
   */
  finishPolygon(): void {
    if (this.polygonPoints.length < 3) return;

    this.drawPolygonMode = false;

    if (this.boundPolygonClickHandler) {
      this.map.off('click', this.boundPolygonClickHandler);
      this.boundPolygonClickHandler = null;
    }

    this.map.getContainer().style.cursor = '';

    // Supprimer l'aperçu temporaire (tirets)
    if (this.drawnPolylineLayer) {
      this.map.removeLayer(this.drawnPolylineLayer);
      this.drawnPolylineLayer = null;
    }
    if (this.drawnPolygonLayer) {
      this.map.removeLayer(this.drawnPolygonLayer);
      this.drawnPolygonLayer = null;
    }

    // Dessiner le polygone final (trait plein)
    this.drawnPolygonLatLngs = [...this.polygonPoints];
    this.drawnPolygonLayer = L.polygon(this.drawnPolygonLatLngs, {
      color: '#03918a',
      fillColor: '#03918a',
      fillOpacity: 0.3,
      weight: 2
    }).addTo(this.map);

    // Calculer la superficie et le centroïde
    this.computedPolygonAreaHa = this.calculatePolygonAreaHa(this.drawnPolygonLatLngs);
    const centroid = this.calculateLatLngCentroid(this.drawnPolygonLatLngs);
    this.lat = centroid.lat;
    this.lon = centroid.lng;

    // Pré-remplir le formulaire
    this.form.patchValue({
      parcel_name: '',
      parcel_area: this.computedPolygonAreaHa.toFixed(4),
      parcel_area_unit_fr: 'ha',
      parcel_address: 'Parcelle tracée en polygone',
      parcel_category: null,
      sigec_code: ''
    });

    // L'adresse n'est pas obligatoire pour un polygone tracé
    this.form.get('parcel_address')?.clearValidators();
    this.form.get('parcel_address')?.updateValueAndValidity();

    this.polygonDrawFormOpen = true;
    document.body.classList.add('no-scroll');
  }

  /**
   * Supprimer tous les marqueurs et couches de dessin temporaires
   */
  private clearPolygonPreview(): void {
    this.polygonPointMarkers.forEach(m => {
      if (this.map) this.map.removeLayer(m);
    });
    this.polygonPointMarkers = [];

    if (this.drawnPolylineLayer) {
      this.map.removeLayer(this.drawnPolylineLayer);
      this.drawnPolylineLayer = null;
    }
    if (this.drawnPolygonLayer) {
      this.map.removeLayer(this.drawnPolygonLayer);
      this.drawnPolygonLayer = null;
    }
  }

  /**
   * Fermer le formulaire d'ajout par polygone sans sauvegarder
   */
  closePolygonDrawForm(): void {
    this.polygonDrawFormOpen = false;
    document.body.classList.remove('no-scroll');
    this.isFabOpen = false;
    this.isUnitDropdownOpen = false;

    // Supprimer le polygone tracé de la carte
    if (this.drawnPolygonLayer) {
      this.map.removeLayer(this.drawnPolygonLayer);
      this.drawnPolygonLayer = null;
    }
    // Supprimer les marqueurs de points
    this.polygonPointMarkers.forEach(m => this.map.removeLayer(m));
    this.polygonPointMarkers = [];

    this.polygonPoints = [];
    this.drawnPolygonLatLngs = [];

    // Restaurer la validation de l'adresse
    this.form.get('parcel_address')?.setValidators([Validators.required, this.addressSelectedValidator]);
    this.form.get('parcel_address')?.updateValueAndValidity();
  }

  /**
   * Enregistrer la parcelle tracée en polygone
   */
  onSavePolygonParcel(): void {
    if (!this.form.valid || this.isSaving) return;

    this.isSaving = true;
    const parcelName = this.form.value.parcel_name;

    // Fermer la popup immédiatement
    this.polygonDrawFormOpen = false;
    document.body.classList.remove('no-scroll');
    this.isFabOpen = false;

    // Construire les coordonnées du polygone [[lat, lng], ...] et fermer la boucle
    const polygonCoords = this.drawnPolygonLatLngs.map(p => [p.lat, p.lng]);
    if (polygonCoords.length > 0) {
      polygonCoords.push([...polygonCoords[0]]);
    }

    const parcelPayload = {
      parcelName: parcelName,
      parcelArea: parseFloat(this.form.value.parcel_area) || null,
      parcelAreaUnit: this.form.value.parcel_area_unit_fr,
      parcelCategory: this.form.value.parcel_category,
      parcelAddress: 'Parcelle tracée en polygone',
      latitude: this.lat,
      longitude: this.lon,
      polygon: JSON.stringify(polygonCoords),
      recordType: 'polygon'
    };

    const isUpdate = !!this.editPolygonParcelId;
    const apiUrl = environment.apiRegistre + '/parcels'
      + (isUpdate ? `/${this.editPolygonParcelId}` : '');

    const request$ = isUpdate
      ? this.httpClient.put(apiUrl, parcelPayload)
      : this.httpClient.post(apiUrl, parcelPayload);

    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.successMessageText = this.editPolygonParcelId
          ? `Le tracé de la parcelle "${parcelName}" a été mis à jour avec succès !`
          : `La parcelle "${parcelName}" a été créée avec succès !`;
        this.showSuccessMessage.set(true);
        setTimeout(() => this.showSuccessMessage.set(false), 3000);

        // Nettoyer le polygone de la carte
        if (this.drawnPolygonLayer) {
          this.map.removeLayer(this.drawnPolygonLayer);
          this.drawnPolygonLayer = null;
        }
        this.polygonPointMarkers.forEach(m => this.map.removeLayer(m));
        this.polygonPointMarkers = [];
        this.polygonPoints = [];
        this.drawnPolygonLatLngs = [];
        this.editPolygonParcelId = null;

        // Restaurer la validation adresse
        this.form.get('parcel_address')?.setValidators([Validators.required, this.addressSelectedValidator]);
        this.form.get('parcel_address')?.updateValueAndValidity();

        this.rechargerParcelles();
        try { this.registreService.refreshParcels(); } catch (e) {}
        this.isSaving = false;
      },
      error: () => {
        this.isSaving = false;
        this.polygonDrawFormOpen = true;
        document.body.classList.add('no-scroll');
        alert('Erreur lors de l\'enregistrement de la parcelle. Veuillez réessayer.');
      }
    });
  }

  /**
   * Convertit une superficie exprimée en hectares vers l'unité demandée (ha/a/m2).
   */
  private areaHaToUnit(areaHa: number, unit: string): number {
    switch (unit) {
      case 'ha':  return areaHa;
      case 'a':   return areaHa * 100;
      case 'm2':  return areaHa * 10000;
      default:    return areaHa;
    }
  }

  /**
   * Convertit une superficie exprimée dans une unité donnée (ha/a/m2) vers des hectares.
   */
  private areaUnitToHa(area: number, unit: string): number {
    switch (unit) {
      case 'ha':  return area;
      case 'a':   return area / 100;
      case 'm2':  return area / 10000;
      default:    return area;
    }
  }

  /**
   * Conversion automatique de la superficie lors du changement d'unité (formulaire polygone)
   */
  private onPolygonAreaUnitChange(newUnit: string): void {
    if (this.computedPolygonAreaHa === 0) return;
    this.form.patchValue({ parcel_area: this.areaHaToUnit(this.computedPolygonAreaHa, newUnit).toFixed(4) });
  }

  /**
   * Conversion automatique de la superficie lors du changement d'unité (formulaire parcelle PAC)
   */
  private onPacAreaUnitChange(newUnit: string): void {
    if (this.pacAreaHa === 0) return;
    this.parcel_area = this.areaHaToUnit(this.pacAreaHa, newUnit).toFixed(4);
  }

  /**
   * Conversion automatique de la superficie lors du changement d'unité (formulaire d'édition d'une parcelle existante)
   */
  private onEditAreaUnitChange(newUnit: string): void {
    if (this.editAreaHa === 0) return;
    this.form.patchValue({ parcel_area: this.areaHaToUnit(this.editAreaHa, newUnit).toFixed(4) });
  }

  // === Dropdown personnalisé "Unité" (Ha/A/M²) ===

  toggleUnitDropdown(): void {
    this.isUnitDropdownOpen = !this.isUnitDropdownOpen;
  }

  getAreaUnitLabel(unit: string | null | undefined): string {
    return this.areaUnitOptions.find(o => o.value === unit)?.label || 'Ha';
  }

  selectAreaUnitAddress(unit: string): void {
    this.form.get('parcel_area_unit_fr')?.setValue(unit);
    this.isUnitDropdownOpen = false;
    if (this.editMode) {
      this.onEditAreaUnitChange(unit);
    }
  }

  selectAreaUnitPoint(unit: string): void {
    this.form.get('parcel_area_unit_fr')?.setValue(unit);
    this.isUnitDropdownOpen = false;
  }

  selectAreaUnitPac(unit: string): void {
    this.parcel_area_unit_fr = unit;
    this.isUnitDropdownOpen = false;
    this.onPacAreaUnitChange(unit);
  }

  selectAreaUnitPolygon(unit: string): void {
    this.form.get('parcel_area_unit_fr')?.setValue(unit);
    this.isUnitDropdownOpen = false;
    this.onPolygonAreaUnitChange(unit);
  }

  /**
   * Calculer la superficie d'un polygone en hectares (formule sphérique)
   */
  private calculatePolygonAreaHa(latlngs: L.LatLng[]): number {
    if (latlngs.length < 3) return 0;
    const R = 6371000; // rayon terrestre en mètres
    const n = latlngs.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const lat1 = latlngs[i].lat * Math.PI / 180;
      const lat2 = latlngs[j].lat * Math.PI / 180;
      const dlng = (latlngs[j].lng - latlngs[i].lng) * Math.PI / 180;
      area += dlng * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs(area * R * R / 2) / 10000;
  }

  /**
   * Calculer le centroïde d'un ensemble de points lat/lng
   */
  private calculateLatLngCentroid(latlngs: L.LatLng[]): { lat: number; lng: number } {
    const n = latlngs.length;
    let lat = 0, lng = 0;
    latlngs.forEach(p => { lat += p.lat; lng += p.lng; });
    return { lat: lat / n, lng: lng / n };
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    clearTimeout(this.addressSearchTimeout);
    clearTimeout(this.locationSearchTimeout);
    if (this.resizeZoomControlHandler) {
      window.removeEventListener('resize', this.resizeZoomControlHandler);
      this.resizeZoomControlHandler = null;
    }
    // Réactiver le scroll du body si le composant est détruit avec popup ouverte
    document.body.classList.remove('no-scroll');
    // Nettoyer le mode plein écran si actif
    document.body.classList.remove('full-screen-map-mode');
    // Nettoyer le mode dessin polygone si actif
    if (this.drawPolygonMode || this.boundPolygonClickHandler) {
      this.cancelDrawPolygon();
    }
    // Nettoyer le mode édition interactive si actif
    if (this.polygonEditMode) {
      this.cancelEditablePolygon();
    }
    if (this.map) {
      this.map.remove();
    }
  }

}

