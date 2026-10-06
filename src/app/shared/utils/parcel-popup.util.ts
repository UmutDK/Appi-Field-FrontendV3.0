/**
 * Génère le contenu HTML harmonisé des popups Leaflet pour une parcelle.
 * Utilisé par get-parcelles et parcelles pour un rendu cohérent (voir styles.scss > .parcel-popup).
 */

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(icon: string, text: string): string {
  return `
    <div class="parcel-popup-row">
      <i class="bi ${icon}"></i>
      <span>${text}</span>
    </div>
  `;
}

export interface ParcelPopupOptions {
  /** Couleur d'accent des icônes (teal par défaut, jaune si sélectionnée). */
  accentColor?: string;
  /** Titre affiché à la place du nom (utile pour un point de recherche/temporaire). */
  titleOnly?: string;
}

export function buildParcelPopupHtml(parcelle: any, options: ParcelPopupOptions = {}): string {
  const accentColor = options.accentColor || '#03918a';

  if (options.titleOnly) {
    return `
      <div class="parcel-popup" style="--parcel-popup-accent: ${accentColor};">
        <div class="parcel-popup-title">${escapeHtml(options.titleOnly)}</div>
      </div>
    `;
  }

  const name = parcelle?.parcel_name || parcelle?.name || 'Parcelle sans nom';
  const category = parcelle?.parcel_category;
  const area = parcelle?.parcel_area;
  const unit = parcelle?.parcel_area_unit_fr || '';
  const address = parcelle?.parcel_address;
  const lat = parcelle?.lat;
  const lon = parcelle?.lon;

  const rows: string[] = [];
  if (category) {
    rows.push(row('bi-tag', escapeHtml(category)));
  }
  if (area) {
    rows.push(row('bi-rulers', `${escapeHtml(area)} ${escapeHtml(unit)}`.trim()));
  }
  if (address) {
    rows.push(row('bi-geo-alt', escapeHtml(address)));
  } else if (lat && lon) {
    rows.push(row('bi-pin-map', `${escapeHtml(lat)}, ${escapeHtml(lon)}`));
  }
  if (parcelle?.imported_from_paconweb) {
    rows.push(row('bi-cloud-arrow-down', 'Importé depuis PAC on Web'));
  } else if (parcelle?.imported_from_gml) {
    rows.push(row('bi-file-earmark-arrow-down', 'Importé depuis un fichier GML'));
  }

  return `
    <div class="parcel-popup" style="--parcel-popup-accent: ${accentColor};">
      <div class="parcel-popup-title">${escapeHtml(name)}</div>
      ${rows.length ? `<div class="parcel-popup-body">${rows.join('')}</div>` : ''}
    </div>
  `;
}
