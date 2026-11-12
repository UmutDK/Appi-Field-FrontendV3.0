import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { RegistreService } from '../../registre/services/registre.service';

export interface RenewParcelData {
  sigecCode: string;
  parcelName: string;
  parcelArea: number;
  parcelAreaUnit: string; // 'ha' | 'a' | 'm2'
}

export interface Parcelle {
  id_parcel: string;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  class: string;
  type: string;
  place_rank: number;
  importance: number;
  addresstype: string;
  name: string;
  display_name: string;
  boundingbox: string[];
  parcel_name: string;
  parcel_area: string;
  parcel_area_unit_fr: string;
  parcel_address: string;
  parcel_category: string;
  polygone?: string;
  imported_from_gml?: boolean;
  imported_from_paconweb?: boolean;
  import_date?: string;
  ref_id?: number;
  record_type?: string;
  exploitation_id?: string;
  is_archived?: boolean;          // lecture seule (archive / unarchive / renew)
  prev_parcel_id?: string | null; // parcelle archivée remplacée par celle-ci (renouvellement)
  sigec_code?: string;
}

export interface ParcelUsage {
  crops: number;
  phytoTreatments: number;
  fieldWorks: number;
}

/**
 * Levée par deleteParcelle quand le serveur refuse la suppression (409 PARCEL_IN_USE) :
 * la parcelle est utilisée par des cultures, traitements ou travaux. Il faut l'archiver.
 */
export class ParcelInUseError extends Error {
  constructor(public parcelId: string, public parcelName: string, public usage: ParcelUsage) {
    super(`Parcelle utilisée (${describeParcelUsage(usage)})`);
  }
}

/** « 2 cultures, 5 traitements phyto et 1 travail aux champs » */
export function describeParcelUsage(usage: ParcelUsage): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => { if (n > 0) parts.push(`${n} ${n > 1 ? many : one}`); };
  add(usage.crops, 'culture', 'cultures');
  add(usage.phytoTreatments, 'traitement phyto', 'traitements phyto');
  add(usage.fieldWorks, 'travail aux champs', 'travaux aux champs');
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts.join('');
}

export interface ParcellesData {
  type: string;
  features: Parcelle[];
}

/** Traduit une parcelle renvoyée par le nouveau serveur (camelCase) vers la forme legacy attendue par le reste du module. */
export function fromApi(p: any): Parcelle {
  return {
    id_parcel: p.parcelId,
    licence: '',
    osm_type: '',
    osm_id: 0,
    lat: p.latitude != null ? String(p.latitude) : '',
    lon: p.longitude != null ? String(p.longitude) : '',
    class: '',
    type: '',
    place_rank: 0,
    importance: 0,
    addresstype: '',
    name: p.parcelName || '',
    display_name: p.parcelAddress || '',
    boundingbox: [],
    parcel_name: p.parcelName || '',
    parcel_area: p.parcelArea != null ? String(p.parcelArea) : '',
    parcel_area_unit_fr: p.parcelAreaUnit || 'ha',
    parcel_address: p.parcelAddress || '',
    parcel_category: (p.parcelCategory || '').replace('Sous-protection', 'Sous protection'), // ancienne valeur en base
    polygone: typeof p.polygon === 'string' ? p.polygon : (p.polygon ? JSON.stringify(p.polygon) : undefined),
    imported_from_gml: p.recordType === 'gml_import',
    record_type: p.recordType,
    exploitation_id: p.exploitationId,
    is_archived: !!p.isArchived,
    prev_parcel_id: p.prevParcelId ?? null,
    sigec_code: p.sigecCode || '',
  };
}

/** Traduit les champs legacy (formulaire/composants) vers le corps de requête attendu par POST/PUT /parcels. */
function toApi(data: Partial<Parcelle>): any {
  const payload: any = {};
  if (data.parcel_name !== undefined) payload.parcelName = data.parcel_name;
  if (data.parcel_area !== undefined) payload.parcelArea = parseFloat(data.parcel_area as any) || null;
  if (data.parcel_area_unit_fr !== undefined) payload.parcelAreaUnit = data.parcel_area_unit_fr;
  if (data.parcel_address !== undefined) payload.parcelAddress = data.parcel_address;
  if (data.parcel_category !== undefined) payload.parcelCategory = data.parcel_category;
  if (data.lat !== undefined) payload.latitude = parseFloat(data.lat as any) || null;
  if (data.lon !== undefined) payload.longitude = parseFloat(data.lon as any) || null;
  if (data.polygone !== undefined) payload.polygon = data.polygone;
  if (data.record_type !== undefined) payload.recordType = data.record_type;
  if (data.exploitation_id !== undefined) payload.exploitationId = data.exploitation_id;
  // Jusqu'ici jamais envoyé : le code SIGEC saisi était perdu
  if (data.sigec_code !== undefined) payload.sigecCode = data.sigec_code;
  return payload;
}

@Injectable({
  providedIn: 'root'
})
export class ParcellesService {
  private http = inject(HttpClient);
  private registreService = inject(RegistreService);
  private parcelles: Parcelle[] = [];
  private isLoaded = false;
  private readonly apiUrl = `${environment.apiRegistre}/parcels`;



  async loadParcelles(forceReload: boolean = false): Promise<void> {
    if (this.isLoaded && !forceReload) {
      return;
    }

    if (forceReload) {
      this.isLoaded = false;
      this.parcelles = [];
    }

    try {

      const response = await this.http.get<any[]>(this.apiUrl, { observe: 'response' }).toPromise();

      if (response?.body && Array.isArray(response.body)) {
        this.parcelles = response.body.map(fromApi);
        this.isLoaded = true;
      }
    } catch (error) {
      console.error('Erreur lors du chargement des parcelles:', error);
    }
  }

  getAllParcelles(): Parcelle[] {
    return this.parcelles;
  }

  getAllParcels(): Parcelle[] {
    return this.getAllParcelles();
  }

  /** Les parcelles actives uniquement : à utiliser pour les listes, la carte et les statistiques. */
  getActiveParcelles(): Parcelle[] {
    return this.parcelles.filter(p => !p.is_archived);
  }

  getArchivedParcelles(): Promise<Parcelle[]> {
    return this.http.get<any[]>(`${this.apiUrl}/archive`).toPromise().then(rows => (rows || []).map(fromApi));
  }

  async archiveParcelle(id: string): Promise<void> {
    await this.http.post(`${this.apiUrl}/${id}/archive`, {}).toPromise();
    await this.afterArchiveChange();
  }

  async unarchiveParcelle(id: string): Promise<void> {
    await this.http.post(`${this.apiUrl}/${id}/unarchive`, {}).toPromise();
    await this.afterArchiveChange();
  }

  /** Archive la parcelle et crée sa copie active avec les valeurs saisies (SIGEC obligatoire). */
  async renewParcelle(id: string, data: RenewParcelData): Promise<{ parcelId: string; archivedParcelId: string }> {
    const res = await this.http.post<any>(`${this.apiUrl}/${id}/renew`, data).toPromise();
    await this.afterArchiveChange();
    return res;
  }

  private async afterArchiveChange(): Promise<void> {
    this.isLoaded = false;
    await this.loadParcelles();
    await this.registreService.notifyParcelUpdated(); // vide les caches parcelles/cultures du registre
  }

  forceReload() {
    this.isLoaded = false;
    this.parcelles = [];
  }

  /**
   * Supprime définitivement une parcelle. Lève ParcelInUseError si elle est utilisée
   * (cultures, traitements, travaux) : le serveur refuse, il faut l'archiver.
   */
  async deleteParcelle(id_parcel: string | number): Promise<boolean> {
    try {
      await this.http.delete(`${this.apiUrl}/${id_parcel}`).toPromise();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409 && error.error?.code === 'PARCEL_IN_USE') {
        throw new ParcelInUseError(String(id_parcel), error.error.parcelName || '', error.error.usage);
      }
      throw error;
    }

    this.isLoaded = false;
    await this.loadParcelles();
    return true;
  }

  /**
   * Suppression d'une parcelle depuis l'interface : si elle est utilisée, propose de
   * l'archiver à la place. Retourne ce qui a été fait.
   */
  async deleteOrArchiveParcelle(id_parcel: string, parcelName?: string): Promise<'deleted' | 'archived' | 'cancelled'> {
    try {
      await this.deleteParcelle(id_parcel);
      return 'deleted';
    } catch (error) {
      if (!(error instanceof ParcelInUseError)) {
        throw error;
      }
      const name = parcelName || error.parcelName || 'Cette parcelle';
      const archive = confirm(
        `« ${name} » ne peut pas être supprimée : elle est utilisée par ${describeParcelUsage(error.usage)}.\n\n` +
        `Voulez-vous l'archiver à la place ? Elle ne sera plus proposée dans les saisies, ` +
        `mais l'historique (registre, export) reste complet. Vous la retrouverez dans Mes archives.`
      );
      if (!archive) {
        return 'cancelled';
      }
      await this.archiveParcelle(id_parcel);
      return 'archived';
    }
  }

  async addParcelle(parcelleData: Partial<Parcelle>): Promise<Parcelle> {
    try {

      const response = await this.http.post<{ success: boolean; parcelId: string }>(this.apiUrl, toApi(parcelleData)).toPromise();

      this.isLoaded = false;
      await this.loadParcelles();

      return { ...parcelleData, id_parcel: response?.parcelId } as Parcelle;
    } catch (error) {
      throw error;
    }
  }

  async updateParcelle(id_parcel: string | number, parcelleData: Partial<Parcelle>): Promise<Parcelle> {
    try {

      const oldParcel = this.parcelles.find(p =>
        p.id_parcel === id_parcel ||
        p.osm_id === id_parcel
      );
      const oldParcelName = oldParcel?.parcel_name || oldParcel?.name;

      await this.http.put(`${this.apiUrl}/${id_parcel}`, toApi(parcelleData)).toPromise();

      this.isLoaded = false;
      await this.loadParcelles();

      // 🔄 Notifier le RegistreService pour rafraîchir les cards de cultures
      if (oldParcelName !== parcelleData.parcel_name) {
        await this.registreService.notifyParcelUpdated();
      }

      return { ...parcelleData, id_parcel } as Parcelle;
    } catch (error) {
      throw error;
    }
  }

  async getParcelle(id_parcel: string | number): Promise<Parcelle | null> {
    try {

      const response = await this.http.get<any>(`${this.apiUrl}/${id_parcel}`).toPromise();

      return response ? fromApi(response) : null;
    } catch (error) {
      return null;
    }
  }

  getParcellesAsGeoJSON(): any[] {
    return this.getActiveParcelles().map(parcelle => {
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [parseFloat(parcelle.lon), parseFloat(parcelle.lat)]
        },
        properties: {
          id_parcel: parcelle.id_parcel,
          name: parcelle.parcel_name || parcelle.name || 'Parcelle sans nom',
          area: parcelle.parcel_area || '0',
          category: parcelle.parcel_category || 'Non définie',
          address: parcelle.parcel_address || parcelle.display_name || 'Adresse inconnue',
          unit: parcelle.parcel_area_unit_fr || 'ha',
          hasPolygon: !!parcelle.polygone
        }
      };
    });
  }

  private parsePolygonCoordinates(polygoneString: string): number[][] {
    try {
      const cleanString = polygoneString.replace(/^\[\[|\]\]$/g, '');
      const pairs = cleanString.split('],[');

      const coordinates = pairs.map(pair => {
        const coords = pair.replace(/\[|\]/g, '').split(',');
        const x = parseFloat(coords[0]);
        const y = parseFloat(coords[1]);
        return [x, y];
      });

      return coordinates;
    } catch (error) {
      return [];
    }
  }

  getStats() {
    const active = this.getActiveParcelles();
    const totalSuperficie = active.reduce((sum, p) => sum + parseFloat(p.parcel_area || '0'), 0);
    const categories = [...new Set(active.map(p => p.parcel_category))];

    return {
      totalParcelles: active.length,
      totalSuperficie: totalSuperficie,
      categories: categories,
      uniteSuperficie: active[0]?.parcel_area_unit_fr || 'ha'
    };
  }

  searchParcelles(terme: string): Parcelle[] {
    if (!terme) {
      return this.getActiveParcelles();
    }

    const termeLower = terme.toLowerCase();
    return this.getActiveParcelles().filter(p =>
      p.parcel_name.toLowerCase().includes(termeLower) ||
      p.parcel_category.toLowerCase().includes(termeLower) ||
      p.parcel_address.toLowerCase().includes(termeLower) ||
      p.name.toLowerCase().includes(termeLower)
    );
  }

  async loadTilesForPosition(lat: number, lng: number, radius: number = 5): Promise<void> {
    await this.loadParcelles();
  }
}
