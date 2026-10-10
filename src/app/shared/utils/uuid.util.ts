/**
 * Identifiant aléatoire au format UUID v4 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx), même format que
 * `crypto.randomUUID()`.
 *
 * `crypto.randomUUID()` n'existe que sur une adresse sécurisée (https ou localhost) et depuis
 * iOS 15.4 : sur un téléphone qui ouvre l'application par http://192.168.x.x:4200, son absence
 * faisait planter « Créer un compte » (et l'ajout de parcelles / travaux). Repli sur
 * `crypto.getRandomValues`, disponible partout.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
