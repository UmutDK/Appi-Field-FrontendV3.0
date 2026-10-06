/**
 * Détecte si des coordonnées sont en Lambert 72 belge (EPSG:31370)
 * plutôt qu'en WGS84 (degrés décimaux).
 * Les coordonnées Lambert 72 belges ont des valeurs > 1000 m,
 * ce qui est impossible pour des degrés WGS84.
 */
export function isLambert72(coords: number[][]): boolean {
  if (!coords || coords.length === 0) return false;
  const [x, y] = coords[0];
  return Math.abs(x) > 1000 || Math.abs(y) > 1000;
}

/**
 * Convertit une coordonnée Lambert 72 belge (EPSG:31370) en WGS84.
 * @param lx  Easting en mètres (Lambert 72)
 * @param ly  Northing en mètres (Lambert 72)
 * @returns   [latitude, longitude] en degrés WGS84
 */
export function lambert72ToWgs84(lx: number, ly: number): [number, number] {
  // ── Ellipsoïde International 1924 (Hayford) ──────────────────────────────
  const a = 6378388.0;
  const f = 1 / 297.0;
  const e2 = 2 * f - f * f;
  const e = Math.sqrt(e2);

  // ── Paramètres Lambert Conforme Conique (EPSG:31370) ─────────────────────
  const phi1 = 49.8333339  * Math.PI / 180;        // 1re parallèle standard
  const phi2 = 51.16666723333333 * Math.PI / 180;  // 2e parallèle standard
  const lambda0 = 4.367486666666666 * Math.PI / 180;// méridien central
  const FE = 150000.013;    // fausse abscisse
  const FN = 5400088.438;   // fausse ordonnée

  // ── Paramètres dérivés ───────────────────────────────────────────────────
  const sinPhi1 = Math.sin(phi1);
  const sinPhi2 = Math.sin(phi2);

  const m1 = Math.cos(phi1) / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const m2 = Math.cos(phi2) / Math.sqrt(1 - e2 * sinPhi2 * sinPhi2);

  const t1 = Math.tan(Math.PI / 4 - phi1 / 2) /
    Math.pow((1 - e * sinPhi1) / (1 + e * sinPhi1), e / 2);
  const t2 = Math.tan(Math.PI / 4 - phi2 / 2) /
    Math.pow((1 - e * sinPhi2) / (1 + e * sinPhi2), e / 2);

  const n = Math.log(m1 / m2) / Math.log(t1 / t2);
  const F = m1 / (n * Math.pow(t1, n));
  // rho0 = 0 car phi0 = 90° (pôle Nord)

  // ── Projection inverse LCC ───────────────────────────────────────────────
  const xShift = lx - FE;
  const yShift = FN - ly;   // = rho0 - (ly - FN), avec rho0 = 0

  const rho = Math.sqrt(xShift * xShift + yShift * yShift) * Math.sign(n);
  const tPrime = Math.pow(rho / (a * F), 1 / n);
  const theta = Math.atan2(xShift, yShift);

  const lambdaBelge = theta / n + lambda0;

  // Calcul itératif de la latitude (datum belge, ellipsoïde Hayford)
  let phi = Math.PI / 2 - 2 * Math.atan(tPrime);
  for (let i = 0; i < 10; i++) {
    const sp = Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(
      tPrime * Math.pow((1 - e * sp) / (1 + e * sp), e / 2)
    );
  }

  // ── Cartésien sur Hayford ─────────────────────────────────────────────────
  const Nval = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
  const X = Nval * Math.cos(phi) * Math.cos(lambdaBelge);
  const Y = Nval * Math.cos(phi) * Math.sin(lambdaBelge);
  const Z = Nval * (1 - e2) * Math.sin(phi);

  // ── Transformation de Helmert 7 paramètres (datum belge → WGS84) ─────────
  const dx = -106.8686, dy = 52.2978, dz = -103.7239;
  const arcsecToRad = Math.PI / 648000;
  const rx =  0.3366 * arcsecToRad;
  const ry = -0.457  * arcsecToRad;
  const rz =  1.8422 * arcsecToRad;
  const ds = -1.2747e-6;

  const X2 = (1 + ds) * ( X        - rz * Y + ry * Z) + dx;
  const Y2 = (1 + ds) * ( rz * X   + Y       - rx * Z) + dy;
  const Z2 = (1 + ds) * (-ry * X   + rx * Y  + Z     ) + dz;

  // ── Cartésien → géographique WGS84 ───────────────────────────────────────
  const a_wgs = 6378137.0;
  const f_wgs = 1 / 298.257223563;
  const e2_wgs = 2 * f_wgs - f_wgs * f_wgs;

  const p = Math.sqrt(X2 * X2 + Y2 * Y2);
  const lonWgs = Math.atan2(Y2, X2);

  let latWgs = Math.atan2(Z2, p * (1 - e2_wgs));
  for (let i = 0; i < 10; i++) {
    const N2 = a_wgs / Math.sqrt(1 - e2_wgs * Math.sin(latWgs) * Math.sin(latWgs));
    latWgs = Math.atan2(Z2 + e2_wgs * N2 * Math.sin(latWgs), p);
  }

  return [latWgs * 180 / Math.PI, lonWgs * 180 / Math.PI];
}

/**
 * Parse une chaîne JSON de polygone en tableau de LatLng Leaflet.
 * Gère trois formats :
 *  - GeoJSON  : [[[lon, lat], ...]]  (PAC on Web, import GML converti)
 *  - Interne  : [[lat, lon], ...]    (polygones dessinés dans l'appli)
 *  - Lambert 72 : [[x_m, y_m], ...] (anciens imports GML non convertis)
 */
export function parsePolygoneToLatLngs(polygoneStr: string): Array<[number, number]> {
  const parsed = JSON.parse(polygoneStr) as number[][] | number[][][];

  let coords: number[][];
  let isLonLat: boolean;

  if (Array.isArray(parsed[0]) && Array.isArray((parsed[0] as any)[0])) {
    // Format GeoJSON imbriqué [[[lon, lat], ...]]
    coords = (parsed as number[][][])[0];
    isLonLat = true;
  } else {
    coords = parsed as number[][];
    isLonLat = false;
  }

  // Données historiques hétérogènes (dessin manuel, imports GML de plusieurs générations,
  // PAC on Web) : on écarte les paires incomplètes/non numériques plutôt que de laisser
  // Leaflet planter plus tard sur un LatLng(NaN, NaN).
  coords = coords.filter(c =>
    Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
  );
  if (coords.length === 0) return [];

  // Détection Lambert 72 : coordonnées métriques (> 1000 m, impossible en degrés)
  if (isLambert72(coords)) {
    const converted = coords.map(c => lambert72ToWgs84(c[0], c[1]));
    // Supprimer le doublon de fermeture si présent
    if (converted.length > 1) {
      const first = converted[0];
      const last = converted[converted.length - 1];
      if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
        converted.pop();
      }
    }
    return converted;
  }

  let latlngs = coords.map(c =>
    isLonLat
      ? [c[1], c[0]] as [number, number]   // GeoJSON: [lon, lat] → [lat, lon]
      : [c[0], c[1]] as [number, number]   // Interne: [lat, lon]
  );

  // Supprimer le doublon de fermeture
  if (latlngs.length > 1) {
    const first = latlngs[0];
    const last = latlngs[latlngs.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      latlngs = latlngs.slice(0, -1);
    }
  }

  return latlngs;
}
