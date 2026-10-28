import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { combineLatest } from 'rxjs';
import { ApplicationCount, CropAuthorizationRow, PhytoProductInfoService } from '../../services/phyto-product-info.service';

/** Culture du traitement en cours : id de la culture Appi'Field (= une saison) et nom Phytoweb. */
export interface DraftCropRef {
  cropId: string;
  phytowebName: string;
}

interface CropInfo {
  name: string;
  authorized: boolean;
  maxApp: string | null;
  maxDose: string | null;
  stage: string | null;
  stageFull: string | null;
  /** « 1/2 applications déjà faites » (null si le compte n'est pas disponible). */
  done: string | null;
  /** Maximum d'applications atteint (ou dépassé) sur au moins une culture de la saison. */
  doneReached: boolean;
}

const normalize = (value: string | null | undefined) => (value || '').toLowerCase().replace(/\s+/g, '');
const unique = <T>(values: T[]) => Array.from(new Set(values));
const formatNumber = (value: number) => value.toLocaleString('fr-BE', { maximumFractionDigits: 3 });

/**
 * Contenu du popup d'information produit (survol ou icône ⓘ d'une carte produit Phytoweb) :
 * pour chaque culture des parcelles du traitement en cours, nombre max d'applications,
 * dose max et stade d'application, d'après /index/crop_authorizations.
 * Affiché dans un overlay CDK par ProductInfoDirective.
 */
@Component({
  selector: 'app-product-info-popover',
  standalone: true,
  templateUrl: './product-info-popover.component.html',
  styleUrls: ['./product-info-popover.component.scss']
})
export class ProductInfoPopoverComponent implements OnInit {
  private infoService = inject(PhytoProductInfoService);

  product = input<any>(null);
  /** Noms Phytoweb des cultures des parcelles du traitement en cours (peut être vide). */
  crops = input<string[]>([]);
  /** Cultures du traitement en cours (cropId + nom Phytoweb), pour compter les applications déjà faites. */
  cropRefs = input<DraftCropRef[]>([]);
  /** Traitement en cours de modification : exclu du compte des applications déjà faites. */
  excludeEventId = input<string | null>(null);

  loading = signal(true);
  private rows = signal<CropAuthorizationRow[]>([]);
  private cropIdsByName = signal(new Map<string, string>());
  private applicationCounts = signal<ApplicationCount[] | null>(null);

  statusLabel = computed(() => {
    switch (this.product()?.authorization_status) {
      case 'authorized': return 'Autorisé';
      case 'withdrawing': return 'En cours de retrait';
      case 'forbidden': return 'Interdit';
      default: return '';
    }
  });

  authorizedCropCount = computed(() => unique(this.rows().map(r => normalize(r.cropName)).filter(Boolean)).length);

  cropInfos = computed<CropInfo[]>(() => {
    const rows = this.rows();
    const cropIds = this.cropIdsByName();
    return unique(this.crops().filter(Boolean)).map(name => {
      const idCrop = cropIds.get(normalize(name));
      const matching = rows.filter(r => normalize(r.cropName) === normalize(name) || (!!idCrop && r.idCrop === idCrop));
      return this.buildCropInfo(name, matching, this.doneCountFor(name));
    });
  });

  ngOnInit(): void {
    const idAct = this.product()?.product_id;
    combineLatest([
      this.infoService.getCropAuthorizations(idAct),
      this.infoService.getPhytowebCrops()
    ]).subscribe(([rows, phytowebCrops]) => {
      this.rows.set(rows);
      this.cropIdsByName.set(new Map(phytowebCrops.map(c => [normalize(c.cropName), c.idCrop])));
      this.loading.set(false);
    });

    // Compte des applications déjà faites : chargé à part, la ligne s'ajoute quand il arrive
    // (et reste absente si la route n'est pas disponible).
    const cropIdsForCount = unique(this.cropRefs().map(c => c.cropId).filter(Boolean));
    this.infoService.getApplicationCounts(idAct, cropIdsForCount, this.excludeEventId())
      .subscribe(counts => this.applicationCounts.set(counts.length ? counts : null));
  }

  /**
   * Applications déjà faites pour une culture Phytoweb du traitement. Si plusieurs cultures
   * Appi'Field (saisons / parcelles distinctes) portent ce nom Phytoweb, on retient la plus
   * élevée : c'est elle qui atteint le maximum en premier.
   */
  private doneCountFor(phytowebName: string): number | null {
    const counts = this.applicationCounts();
    if (!counts) return null;
    const ids = new Set(this.cropRefs().filter(c => normalize(c.phytowebName) === normalize(phytowebName)).map(c => c.cropId));
    const values = counts.filter(c => ids.has(c.cropId)).map(c => c.count);
    return values.length ? Math.max(...values) : null;
  }

  private buildCropInfo(name: string, rows: CropAuthorizationRow[], doneCount: number | null): CropInfo {
    if (rows.length === 0) {
      return { name, authorized: false, maxApp: null, maxDose: null, stage: null, stageFull: null, done: null, doneReached: false };
    }

    // Plusieurs lignes possibles pour une même culture (ex. plein champ / serre) : on affiche
    // la plage des valeurs plutôt que d'en choisir une arbitrairement.
    const maxApps = unique(rows.map(r => r.cropMaxApp).filter((v): v is number => !!v && v > 0)).sort((a, b) => a - b);
    let maxApp: string | null = null;
    if (maxApps.length === 1) {
      maxApp = `Max ${maxApps[0]} application${maxApps[0] > 1 ? 's' : ''}`;
    } else if (maxApps.length > 1) {
      maxApp = `Max ${maxApps[0]} à ${maxApps[maxApps.length - 1]} applications`;
    }

    const doses = unique(rows
      .filter(r => !!r.cropMaxDose && r.cropMaxDose > 0)
      .map(r => `${formatNumber(r.cropMaxDose!)} ${r.cropMaxDoseUnit || ''}`.trim()));
    const maxDose = doses.length ? `Dose max ${doses.join(' / ')}` : null;

    const stages = unique(rows
      .map(r => (r.cropApplicationStade || '').trim())
      .filter(s => s && s.toUpperCase() !== 'NA'));
    const stage = stages.length ? unique(stages.map(s => this.shortStage(s))).join(', ') : null;

    // « N/max applications déjà faites » : avec une plage de maximums (selon la cible),
    // le dénominateur affiché est la plage et l'alerte se base sur le plus grand maximum.
    let done: string | null = null;
    let doneReached = false;
    if (doneCount !== null) {
      const label = doneCount > 1 ? 'applications déjà faites' : 'application déjà faite';
      if (maxApps.length === 1) {
        done = `${doneCount}/${maxApps[0]} ${label}`;
      } else if (maxApps.length > 1) {
        done = `${doneCount}/${maxApps[0]} à ${maxApps[maxApps.length - 1]} ${label}`;
      } else {
        done = `${doneCount} ${label}`;
      }
      doneReached = maxApps.length > 0 && doneCount >= maxApps[maxApps.length - 1];
    }

    return {
      name, authorized: true, maxApp, maxDose, stage, stageFull: stages.length ? stages.join('\n') : null,
      done, doneReached
    };
  }

  /** "2 feuilles étalées - début montaison: … (BBCH 12-30)" → "BBCH 12-30". */
  private shortStage(stage: string): string {
    const bbch = stage.match(/\(([^()]*BBCH[^()]*)\)\s*$/);
    if (bbch) return bbch[1].trim();
    return stage.length > 60 ? `${stage.slice(0, 60).trim()}…` : stage;
  }
}
