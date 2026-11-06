/** Numéro de phytolicence : 2 chiffres, 1 chiffre ou 1 lettre, 5 chiffres (ex. 23.2.00445, 23.B.00445). */
export const PHYTOLICENCE_PATTERN = /^\d{2}\.[A-Z0-9]\.\d{5}$/;
export const PHYTOLICENCE_ERROR = 'Le numéro de phytolicence doit avoir le format 23.2.00445 : 2 chiffres, 1 chiffre ou 1 lettre, puis 5 chiffres.';

/** Garde seulement les caractères permis à chaque position, puis ajoute les points. */
export function formatPhytolicence(raw: string): string {
  let chars = '';
  for (const c of raw.toUpperCase().replace(/[^A-Z0-9]/g, '')) {
    if (chars.length === 8) break;
    if (chars.length === 2 || /\d/.test(c)) chars += c;
  }
  if (chars.length > 3) chars = chars.slice(0, 3) + '.' + chars.slice(3);
  if (chars.length > 2) chars = chars.slice(0, 2) + '.' + chars.slice(2);
  return chars;
}

/** Le champ est facultatif : un numéro vide reste accepté. */
export function isPhytolicenceValid(value: string | null | undefined): boolean {
  const v = (value || '').trim();
  return !v || PHYTOLICENCE_PATTERN.test(v);
}
