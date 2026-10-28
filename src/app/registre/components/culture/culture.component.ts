import { Component, computed, inject, OnInit, signal, Input, OnChanges, OnDestroy, Output, EventEmitter, effect, ChangeDetectorRef } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { FormArray, FormBuilder, FormControl, FormGroup, FormsModule, Validators } from '@angular/forms';
import { RegistreService } from '../../services/registre.service';
import { Observable, Subject, Subscription, tap, takeUntil } from 'rxjs';
import { trigger, transition, animate } from '@angular/animations';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-culture',
  standalone: true,
  imports: [
    SharedModule,
    FormsModule,
    MatTooltipModule
  ],
  templateUrl: './culture.component.html',
  styleUrl: './culture.component.scss',
  animations: [
    trigger('slideStep', [
      // Simplement détecter les changements pour trigger le callback
      transition('* => *', [
        animate('1ms')
      ])
    ])
  ]
})
export class CultureComponent implements OnInit, OnChanges, OnDestroy {

  @Input() cultureToModify: any = null;
  @Output() progressChange = new EventEmitter<number>();
  @Output() validationChange = new EventEmitter<boolean>();
  @Output() validateRequested = new EventEmitter<void>();
  @Output() cultureCreated = new EventEmitter<void>();
  @Output() cultureUpdated = new EventEmitter<void>();

  culture = signal<string>(''); // Transformer en signal
  form!: FormGroup;
  formPhytoWeb!: FormControl;
  nomCulture = signal<any[]>([]);
  listeRechercheCulture = signal('');
  validationState = signal(false);

  // Étape "Parcelles" : liste mise en cache (au lieu de `getparcelles | async` directement dans
  // le template) pour pouvoir la filtrer localement via une barre de recherche.
  parcellesList = signal<any[]>([]);
  parcelSearchTerm = signal('');

  // ── Catégories Phytoweb récemment utilisées (même idée que "produits récemment utilisés"
  // dans traitement-phyto : les crops déjà créés par l'utilisateur, pas le catalogue Phytoweb) ──
  recentlyUsedCultures = signal<any[]>([]);
  isLoadingRecentCultures = signal(false);
  filteredParcelles = computed(() => {
    const query = this.parcelSearchTerm().toLowerCase().trim();
    const parcelles = this.parcellesList();
    if (!query) return parcelles;
    return parcelles.filter(p => (p.parcel_name || '').toLowerCase().includes(query));
  });

  public slideDirection: 'forward' | 'backward' | 'none' = 'none';
  private destroy$ = new Subject<void>();
  private valueChangeSub?: Subscription;

  getCulture!: Observable<any[]>;
  getparcelles!: Observable<any[]>;
  
  private formBuilder = inject(FormBuilder);
  private http = inject(RegistreService);
  private cdr = inject(ChangeDetectorRef);

  constructor(){
    this.http.getCulture().pipe(takeUntil(this.destroy$)).subscribe(culture => {
      this.nomCulture.set(culture);
    });
    
    // 🔄 Écouter les changements de parcelles pour rafraîchir les données
    effect(() => {
      if (this.http.parcelUpdated()) {
        this.refreshCultureData();
      }
    });
  }

  ngOnInit(): void {
    this.initializeForm();
    
    this.formPhytoWeb = this.formBuilder.control('', [Validators.required]);
    
    this.getCulture = this.http.getCulture();
    this.getparcelles = this.http.getParcelles();
    this.getparcelles.pipe(takeUntil(this.destroy$)).subscribe(parcelles => {
      this.setParcelles(parcelles);
    });

    this.loadRecentlyUsedCultures();

    // Après l'initialisation des Observables, pré-remplir les parcelles si nécessaire
    if (this.cultureToModify && this.cultureToModify.parcels?.length) {
      this.getparcelles.pipe(takeUntil(this.destroy$)).subscribe(parcelles => {
        if (parcelles && parcelles.length > 0) {
          this.prefillSelectedParcels(parcelles);
        }
      });
    }

    this.emitProgressChange();
    this.emitValidationChange();
  }

  ngOnChanges(): void {
    if (this.form) {
      this.valueChangeSub?.unsubscribe();
      this.initializeForm();
    }
  }

  ngOnDestroy(): void {
    this.valueChangeSub?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * 🔄 Rafraîchit les données de cultures et parcelles suite à une modification de parcelle
   */
  private refreshCultureData(): void {
    
    this.getCulture = this.http.getCulture();
    this.getCulture.pipe(takeUntil(this.destroy$)).subscribe(culture => {
      this.nomCulture.set(culture);
    });

    this.getparcelles = this.http.getParcelles();
    this.getparcelles.pipe(takeUntil(this.destroy$)).subscribe(parcelles => {
      this.setParcelles(parcelles);
    });

  }

  // Méthode publique pour déclencher la validation depuis le parent
  public triggerValidation(): void {
    this.validateCurrentStep();
  }

  private initializeForm(): void {
    // S'assurer que le signal culture est bien réinitialisé à vide pour l'étape des informations
    this.culture.set(''); // TOUJOURS forcer l'affichage de l'étape par défaut (informations)
    
    this.form = this.formBuilder.group({
      nomCulture: [this.cultureToModify?.cropName || '', [Validators.required]],
      remarque: [this.cultureToModify?.remarks || ''],
      semis: [this.cultureToModify?.sowingDate || ''],
      culturePrecedant: [this.cultureToModify?.previousCrop || ''],
      autre: [this.cultureToModify?.phytowebId || ''],
      parcels: this.formBuilder.array([])
    });

    this.valueChangeSub = this.form.valueChanges.subscribe(() => {
      if (!this.culture()) {
        this.forceUpdate();
      }
    });
  }

  /**
   * Création : jamais de parcelle archivée.
   * Modification : on garde uniquement les parcelles archivées déjà liées à la culture, verrouillées
   * (visibles, cochées, grisées ; le lien reste dans le FormArray et part dans le PUT).
   */
  private setParcelles(parcelles: any[]): void {
    const linkedIds = new Set((this.cultureToModify?.parcels || []).map((l: any) => l.parcelId));
    this.parcellesList.set(
      (parcelles || [])
        .filter(p => !p.is_archived || (this.cultureToModify && linkedIds.has(p.id_parcel)))
        .map(p => ({ ...p, locked: !!p.is_archived }))
    );
  }

  // Méthode pour pré-remplir les parcelles sélectionnées
  private prefillSelectedParcels(availableParcels: any[]) {
    if (!this.cultureToModify || !this.cultureToModify.parcels?.length) return;

    // this.cultureToModify.parcels est le tableau de liaisons cropsParcels (chacune avec parcelId)
    const parcelIds: string[] = this.cultureToModify.parcels.map((link: any) => link.parcelId);

    const parcelsArray = this.form.get('parcels') as FormArray;
    
    // Vider le FormArray avant de le remplir
    while (parcelsArray.length !== 0) {
      parcelsArray.removeAt(0);
    }
    
    // Pour chaque ID de parcelle, trouver le nom correspondant
    parcelIds.forEach((parcelId: string) => {
      if (parcelId && parcelId.trim()) {
        const cleanParcelId = parcelId.trim();
        
        // Chercher la parcelle par son id_parcel (UUID) ou par son nom (compat ancien format)
        const foundParcel = availableParcels.find(p => 
          p.id_parcel == cleanParcelId || 
          p.parcel_name === cleanParcelId
        );
        
        if (foundParcel) {
          parcelsArray.push(new FormControl(foundParcel.id_parcel));
        } else {
          // Si non trouvé, ignorer (la parcelle peut avoir été supprimée)
        }
      }
    });
    
    // Forcer la mise à jour de l'interface
    this.forceUpdate();
  }

  filtreCultutre = computed(()=>{
    const query = this.listeRechercheCulture().toLowerCase().trim();
    if (query.length < 3) {
      return []; // Retourne un tableau vide si moins de 3 caractères
    }
    
    // Optimisation : limiter les résultats à 50 pour améliorer les performances
    const cultures = this.nomCulture();
    const results: any[] = [];

    for (let i = 0; i < cultures.length && results.length < 50; i++) {
      const culture = cultures[i];
      // Exclure les catégories masquées (visibleStatut === false)
      if (culture.visibleStatut === false) continue;
      const nameFrLower = (culture.nameFr || '').toLowerCase();
      if (nameFrLower.startsWith(query) || nameFrLower.includes(query)) {
        results.push(culture);
      }
    }
    
    return results;
  });

  shouldShowSearchMessage = computed(()=>{
    return this.listeRechercheCulture().trim().length < 3;
  });

  // Calcul du pourcentage de progression selon l'étape

  getProgressPercentage = computed((): number => {
    switch (this.culture()) {

      case "catégorie Phytoweb de la culture":
        return 66; // Deuxième étape
      case "parcels":
        return 100; // Troisième étape
      default:
        return 33; // Première étape (informations de base)
    }

  });

  // DEPRECATED - kept for backwards compatibility
  toggleDropdown(): void {}

  /**
   * 📋 Récupère les informations de la catégorie phytoweb actuellement sélectionnée
   */
  getCurrentCultureInfo(): { name: string, eppoCode: string } | null {
    if (!this.cultureToModify) return null;

    const phytowebId = this.cultureToModify.phytowebId;

    // Chercher dans la liste des cultures disponibles
    const culture = this.nomCulture().find(c => c.cropId === phytowebId);

    if (culture) {
      return {
        name: culture.nameFr || 'Non défini',
        eppoCode: 'Non défini' // non disponible dans le référentiel Phytoweb réel
      };
    }

    return null;
  }

  // Méthodes pour émettre les changements vers le parent
  private emitProgressChange(): void {
    const progress = this.getProgressPercentage();
    this.progressChange.emit(progress);
  }

  private emitValidationChange(): void {
    const isValid = this.canValidateCurrentStep();
    this.validationChange.emit(isValid);
  }

  // Méthode pour forcer les mises à jour
  private forceUpdate(): void {
    this.validationState.set(!this.validationState());
    this.emitProgressChange();
    this.emitValidationChange();
  }

  // Méthode appelée lors de la sélection d'une culture
  onCultureSelection(): void {
    this.forceUpdate();
  }

  /**
   * Charge les catégories Phytoweb des cultures déjà créées par l'utilisateur (pas le
   * catalogue Phytoweb complet), dédoublonnées et triées par date de semis décroissante —
   * même principe que loadRecentlyUsedProducts() dans traitement-phyto.
   */
  private loadRecentlyUsedCultures(): void {
    this.isLoadingRecentCultures.set(true);
    this.http.getExploitation().pipe(takeUntil(this.destroy$)).subscribe({
      next: (crops) => {
        const seenIds = new Set<string>();
        const recent: any[] = [];
        const sorted = [...(crops || [])].sort((a, b) => {
          const da = a.sowingDate || '';
          const db = b.sowingDate || '';
          return db.localeCompare(da);
        });
        for (const crop of sorted) {
          const id = crop.phytowebId;
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            recent.push({ cropId: id, nameFr: crop.phytowebName || '' });
          }
        }
        this.recentlyUsedCultures.set(recent.filter(c => c.nameFr));
        this.isLoadingRecentCultures.set(false);
      },
      error: () => this.isLoadingRecentCultures.set(false)
    });
  }

  selectRecentCulture(cropId: string): void {
    this.form.get('autre')?.setValue(cropId);
    this.onCultureSelection();
  }

  // Méthode pour vérifier si l'étape actuelle peut être validée
  canValidateCurrentStep(): boolean {
    // Force la réactivité en lisant le signal
    this.validationState();
    
    switch (this.culture()) {
      case "catégorie Phytoweb de la culture":
        // Vérifier si une culture est sélectionnée
        const autreValue = this.form?.get('autre')?.value;
        const isValid = autreValue != null && autreValue !== '';
        return isValid;
      case "parcels":
        // Vérifier si au moins une parcelle est sélectionnée
        const parcelles = this.form?.get('parcels') as FormArray;
        return parcelles && parcelles.length > 0;
      default:
        // Étape des informations - vérifier spécifiquement le champ nomCulture
        const nomCultureValid = this.form?.get('nomCulture')?.valid;
        return nomCultureValid || false;
    }
  }

  // Méthode pour valider l'étape actuelle
  validateCurrentStep(): void {
    switch (this.culture()) {
      case "catégorie Phytoweb de la culture":
        if (this.canValidateCurrentStep()) {
          this.onParcels();
        }
        break;
      case "parcels":
        if (this.canValidateCurrentStep()) {
          this.onClose();
        }
        break;
      default:
        // Étape des informations
        if (this.canValidateCurrentStep()) {
          this.onCulture();
        }
        break;
    }
  }

  /**
   * 🔙 Retourne à l'étape précédente avec animation
   */
  goToPreviousStep(): void {
    
    this.slideDirection = 'backward';
    this.cdr.detectChanges();
    
    switch(this.culture()) {
      case "catégorie Phytoweb de la culture":
        // Retour à l'étape des informations
        this.culture.set('');
        break;
      case "parcels":
        // Retour à la sélection de catégorie Phytoweb
        this.culture.set("catégorie Phytoweb de la culture");
        break;
      default:
        console.warn('⚠️ Impossible de revenir en arrière depuis la première étape');
    }
    
    // Mettre à jour la progression et la validation
    this.emitProgressChange();
    this.emitValidationChange();
    
    // 🎬 Réinitialiser la direction après l'animation (600ms + 100ms de marge)
    setTimeout(() => {
      this.slideDirection = 'none';
      this.cdr.detectChanges();
    }, 700);
  }

  /**
   * 🎬 Callback appelé à la fin de l'animation de slide
   */
  onSlideAnimationDone(): void {
    // Animation terminée - peut être utilisé pour des actions post-animation si besoin
  }

  /**
   * ✅ Vérifie si le bouton Précédent doit être affiché
   */
  canGoToPreviousStep(): boolean {
    // Le bouton précédent n'apparaît PAS sur la première étape (informations de base)
    return this.culture() !== '';
  }


  oncheckboxchange(e: any, item?: any){
    // Parcelle archivée liée : ni décochable ni cochable
    if (item?.locked) { e.target.checked = this.isParcelSelected(item.id_parcel); return; }
    const parcelles: FormArray = this.form.get('parcels') as FormArray;

    if(e.target.checked){
      parcelles.push(new FormControl(e.target.value));
    } else {
      const index = parcelles.controls.findIndex(x => x.value === e.target.value);
      parcelles.removeAt(index);
    }
    
    this.forceUpdate();
  }

  // Méthode pour vérifier si une parcelle est déjà sélectionnée
  isParcelSelected(parcelName: string): boolean {
    const parcelles: FormArray = this.form.get('parcels') as FormArray;
    return parcelles.controls.some(control => control.value === parcelName);
  }

  // Radio `value="{{...}}"` (interpolation) stocke toujours une chaîne dans le FormControl,
  // même si item.cropId est numérique côté API : comparaison normalisée en chaîne pour éviter
  // un mismatch de type qui empêcherait la carte sélectionnée de s'afficher comme telle.
  isCultureSelected(cropId: any): boolean {
    const current = this.form?.get('autre')?.value;
    return current != null && String(current) === String(cropId);
  }

  getSelectedParcelCount(): number {
    const parcelles = this.form?.get('parcels') as FormArray;
    return parcelles ? parcelles.length : 0;
  }

  clearParcelSearch(): void {
    this.parcelSearchTerm.set('');
  }

  onSend() {
    this.closeOrReset();
  }

  onCulture(){
    this.slideDirection = 'forward';
    this.cdr.detectChanges();
    
    this.culture.set("catégorie Phytoweb de la culture");
    this.forceUpdate();
    
    // 🎬 Réinitialiser après animation
    setTimeout(() => {
      this.slideDirection = 'none';
      this.cdr.detectChanges();
    }, 700);
  }

  onParcels(){
    this.slideDirection = 'forward';
    this.cdr.detectChanges();
    
    this.culture.set("parcels");
    this.forceUpdate();
    
    // 🎬 Réinitialiser après animation
    setTimeout(() => {
      this.slideDirection = 'none';
      this.cdr.detectChanges();
    }, 700);
  }

  onClose(){
    if (this.cultureToModify) {
      // Mode modification - pas d'animation de succès, juste émettre l'événement
      
      // Récupérer les données du formulaire
      const formData = this.form.value;
      
      // Si l'ID phytoweb a changé, récupérer le nom français correspondant
      if (formData.autre && formData.autre !== this.cultureToModify.phytowebId) {

        this.http.getCultureId(formData.autre).pipe(
          tap(r => {
            const updatedCulture = {
              cropId: this.cultureToModify.cropId,
              cropName: formData.nomCulture,
              phytowebId: r[0]?.initialCropId || formData.autre,
              remarks: formData.remarque || '',
              sowingDate: formData.semis || '',
              previousCrop: formData.culturePrecedant || '',
              parcelIds: formData.parcels
            };

            this.performUpdate(updatedCulture);
          })
        ).pipe(takeUntil(this.destroy$)).subscribe();
      } else {
        // Pas de changement d'ID phytoweb, mise à jour directe
        const updatedCulture = {
          cropId: this.cultureToModify.cropId,
          cropName: formData.nomCulture,
          remarks: formData.remarque || '',
          sowingDate: formData.semis || '',
          previousCrop: formData.culturePrecedant || '',
          phytowebId: this.cultureToModify.phytowebId,
          parcelIds: formData.parcels
        };

        this.performUpdate(updatedCulture);
      }
    } else {
      // Mode création : émettre l'événement de création
      this.http.post(this.form.value).pipe(takeUntil(this.destroy$)).subscribe({
        next: (success) => {
          if (success) {
            // ✅ Émettre l'événement de création réussie
            this.cultureCreated.emit();
          } else {
            // En cas d'échec, fermer normalement
            this.closeOrReset();
          }
        },
        error: () => {
          // En cas d'erreur, fermer normalement
          this.closeOrReset();
        }
      });
    }
  }

  private performUpdate(updatedCulture: any): void {
    // Appeler le service de mise à jour
    this.http.updateCulture(updatedCulture).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        // ✅ Émettre l'événement de modification réussie
        this.cultureUpdated.emit();
        this.closeOrReset();
      },
      error: (error) => {
        alert(`Erreur lors de la mise à jour de la culture: ${error.error?.error || error.message}`);
      }
    });
  }

  /**
   * 🔄 Méthode pour fermer le modal ou réinitialiser après succès
   */
  private closeOrReset(): void {
    // Si c'est un modal, émettre un événement pour le fermer
    // Ou réinitialiser le formulaire pour une nouvelle saisie
    this.form.reset();
    this.cultureToModify = null;
    
    // Réinitialiser les signaux
    this.validationState.set(false);
    this.culture.set('');
    this.listeRechercheCulture.set('');
    
    // Émettre les changements de progression
    this.emitProgressChange();
    this.emitValidationChange();
  }
    
}

