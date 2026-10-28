# Inventaire : nouveau type d'opération « Correction »

Guide d'implémentation **frontend**. Le backend est déjà prêt (voir § 1).

## Objectif

Permettre à l'utilisateur de **corriger le stock restant d'un produit** de son inventaire pour qu'il retombe à **0**. C'est utile quand le stock affiché ne correspond plus à la réalité : stock négatif, ou reliquat qui n'existe plus physiquement.

La popup fonctionne comme celle des PPNU/PPNV :

- sélection d'un **produit existant** de l'inventaire ;
- un **mode** : **Moins** (retire du stock) ou **Plus** (ajoute au stock) ;
- une **quantité**, préremplie pour que le stock restant affiché tombe à 0, mais modifiable ;
- une **date de correction** ;
- une **unité** (L ou Kg), par défaut celle du produit.

---

## 1. Contrat API (déjà en place côté backend)

Les routes sont les mêmes que pour les PPNU/PPNV (`POST /inventories`, `PUT /inventories/<id>`, `DELETE /inventories?inventoryOperationId=<id>`), avec un nouveau type et un champ en plus.

**Création**

```json
POST /inventories
{
  "productId": "ppp-...",
  "operationType": "correction",
  "correctionMode": "minus",
  "operationDate": "2026-10-27",
  "quantity": 3.5,
  "quantityUnit": "L"
}
```

- `quantity` est **toujours positive**. Le sens de la correction est donné uniquement par `correctionMode` : `"plus"` ou `"minus"`.
- `correctionMode` est **obligatoire** quand `operationType` vaut `"correction"`. Sinon, le serveur renvoie `400`.
- Le serveur refuse aussi (`400`) un `operationType` inconnu, et une quantité absente ou ≤ 0. Cette validation s'applique désormais à **tous** les types, achats et PPNU/PPNV compris.
- Le `PUT` accepte les mêmes champs, tous optionnels.

**Lecture** (`GET /inventories`) : chaque opération contient maintenant `correctionMode` (`null` sauf pour les corrections). Chaque produit contient `correctionStock`, le net signé des corrections calculé côté serveur.

> ⚠️ Le frontend ne doit **pas** utiliser `correctionStock`. Le serveur travaille en quantités standardisées, alors que l'écran calcule la quantité restante à partir des quantités brutes (voir § 2). Il faut calculer le total des corrections côté frontend, à partir de `op.quantity` et `op.correctionMode`, comme c'est déjà fait pour les achats.

---

## 2. Règle de calcul : la « quantité restante » de l'écran

On garde la formule déjà utilisée par l'écran d'inventaire, en y ajoutant les corrections :

```
restant = acheté − utilisé − PPNU − PPNV + corrections_plus − corrections_minus
```

La valeur par défaut de la popup est calculée pour que **le restant affiché soit égal à 0 après la correction** :

| Restant actuel `R` | Mode par défaut | Quantité par défaut |
|---|---|---|
| `R > 0` | **Moins** | `R` |
| `R < 0` | **Plus** | `-R` (valeur absolue) |
| `R = 0` | **Moins** | `0` (le formulaire est invalide tant que l'utilisateur n'a rien saisi) + message « Le stock de ce produit est déjà à 0 » |

L'utilisateur peut ensuite changer le mode et la quantité librement.

---

## 3. Modifications à faire

### 3.1 Service [inventaire.service.ts](src/app/inventaire/services/inventaire.service.ts)

1. **Types**
   - Ajouter `'correction'` à l'union `EventHistory['event_type']`, ainsi qu'au paramètre `eventType` de `getProductUsages`.
   - Ajouter `correction_mode?: 'plus' | 'minus'` à `EventHistory`.
   - Ajouter `quantity_correction: number` à `InventoryStock`. C'est le net signé : positif pour un ajout, négatif pour un retrait.

2. **`eventTypeFromApi` / `eventTypeToApi`** : traduire `'correction'` dans les deux sens. Aujourd'hui, tout type inconnu retombe sur `'treatment'` : sans cette modification, une correction s'afficherait comme un traitement.

3. **`mapToRealInventoryData`**
   - Recopier `op.correctionMode` dans `correction_mode` lors du `eventHistory.push(...)`.
   - Ajouter le cas de la correction dans la boucle sur les opérations. Il doit passer **avant** le `else` actuel, qui compte tout le reste comme « utilisé » :

   ```ts
   let quantityCorrection = 0;
   // ...
   if (op.operationType === 'purchase') {
     quantityBuyed += op.quantity || 0;
   } else if (op.operationType === 'correction') {
     const qty = op.quantity || 0;
     quantityCorrection += op.correctionMode === 'plus' ? qty : -qty;
   } else if (op.operationType !== 'ppnu' && op.operationType !== 'ppnv') {
     quantityUsed += op.quantity || 0;
   }
   ```

   - Ajouter `quantity_correction: quantityCorrection` à l'objet retourné.

4. **Fonction de calcul unique pour la quantité restante.** La formule est aujourd'hui recopiée **7 fois** dans `accueil-inventaire`. On la centralise :

   ```ts
   /** Quantité restante affichée (même formule que l'écran inventaire). */
   getRemainingQuantity(p: InventoryStock): number {
     return p.quantity_buyed - p.quantity_used - p.quantity_ppnu - p.quantity_ppnv + (p.quantity_correction || 0);
   }
   ```

   `calculateRemainingQuantity` renvoie `current_stock`, c'est-à-dire le stock serveur, qui ne déduit pas les PPNU/PPNV. **Ne pas l'utiliser** pour la correction.

5. **Appels HTTP** : ajouter `addCorrection` et `updateCorrectionById`, sur le modèle de `addPpnuPpnvEntry` et `updatePpnuPpnvEventById`. Il faut envoyer `operationType: 'correction'` et `correctionMode`. Pour la suppression, `deleteInventoryOperation` peut être réutilisé tel quel, via une méthode publique `deleteCorrectionById`.

6. **État d'édition** : ajouter `setEditingCorrectionEvent`, `getEditingCorrectionEvent` et `clearEditingCorrectionEvent`, sur le modèle de `setEditingPpnuPpnvEvent` et des deux autres.

### 3.2 Modèle

Créer `src/app/inventaire/model/correction.ts` :

```ts
export interface CorrectionEntry {
  date: string;
  mode: 'plus' | 'minus';
  quantity: number;
  unit: string; // 'L' | 'Kg'
}
```

### 3.3 Nouveau composant `correction-stock`

Dupliquer `components/ppnu-ppnv/` en `components/correction-stock/` (fichiers TS, HTML et SCSS), puis :

**À retirer** : le menu « Type d'entrée » (`selectedType`, `typeOptions`, `isTypeDropdownOpen`…) et l'ancien chemin d'édition par index (`editingEntryIndex`, `getEditingPpnuPpnv`). Une correction a toujours un vrai identifiant.

**À ajouter**

- Le libellé de la date devient **« Date de correction »**. On garde la date du jour par défaut et `[max]="maxDate"`.
- Un sélecteur **Mode**, qui peut reprendre le style des menus déroulants existants (`.dropdown-container`) ou être un bouton à deux états :

  ```ts
  modeOptions = [
    { value: 'minus', label: 'Moins (retirer du stock)' },
    { value: 'plus',  label: 'Plus (ajouter au stock)' },
  ];
  selectedMode: 'plus' | 'minus' = 'minus';
  ```

- **Préremplissage** lors du choix du produit dans `selectProductOption()`, et au chargement si `preselectedProductId` est fourni. Attention : les produits sont chargés de manière asynchrone, donc il faut l'appeler à la fin de `loadInventoryProducts()`.

  ```ts
  private applyDefaults(): void {
    if (this.isEditMode) return;            // ne jamais écraser une correction existante
    const p = this.selectedProduct;
    if (!p) return;
    const remaining = this.inventaireService.getRemainingQuantity(p);
    this.selectedMode = remaining < 0 ? 'plus' : 'minus';
    this.quantity = Math.round(Math.abs(remaining) * 100) / 100;
    this.selectedUnit = p.quantity_unit || 'L';
  }
  ```

- **Aperçu du résultat** (conseillé), qui rassure l'utilisateur :

  ```ts
  get remainingAfter(): number | null {
    const p = this.selectedProduct;
    if (!p) return null;
    let base = this.inventaireService.getRemainingQuantity(p);
    // En modification, retirer l'effet de la correction en cours d'édition
    if (this.isEditMode && this.originalEntry) {
      base -= this.originalEntry.mode === 'plus' ? this.originalEntry.quantity : -this.originalEntry.quantity;
    }
    return base + (this.selectedMode === 'plus' ? this.quantity : -this.quantity);
  }
  ```

  `originalEntry` est une copie du `CorrectionEntry` chargé dans `checkForEditMode()`.

  Affichage : *« Stock restant après correction : {{ remainingAfter | number:'1.2-2' }} {{ selectedUnit }} »*.

- **Avertissement pour une correction négative importante** : il s'affiche pour un retrait de **plus de 5 litres**. Il ne bloque pas l'enregistrement.

  ```ts
  get isLargeNegativeCorrection(): boolean {
    return this.selectedMode === 'minus' && this.selectedUnit === 'L' && this.quantity > 5;
  }
  ```

  ```html
  @if (isLargeNegativeCorrection) {
    <div class="col-lg-12">
      <div class="form-text text-warning">
        <i class="bi bi-exclamation-triangle"></i>
        Attention : vous semblez effectuer une correction importante ({{ quantity }} L retirés du stock).
      </div>
    </div>
  }
  ```

  On peut reprendre le style de l'avertissement « unité différente » déjà présent dans `ppnu-ppnv.component.html`, qu'il faut d'ailleurs garder.

- **`onSubmit`** : construire un `CorrectionEntry`, puis appeler `addCorrection` ou `updateCorrectionById` selon le mode.
- **Validité du formulaire** : produit renseigné, date renseignée, quantité > 0, unité et mode renseignés.
- **Texte du bouton** : « Ajouter la correction » ou « Modifier la correction ».

### 3.4 Écran [accueil-inventaire](src/app/inventaire/components/accueil-inventaire/)

**TS**

- Ajouter `CorrectionStockComponent` aux `imports` du composant.
- Ajouter un nouvel état de popup, `popInventaire = 'Correction'`, avec les méthodes `onAddCorrection()`, `onAddCorrectionForSelectedProduct()` et `onCloseCorrectionForm()` (sur le modèle de `onAddPpnu`, `onAddPpnuForSelectedProduct` et `onClosePpnuForm`).
- Gérer ce nouvel état dans le gestionnaire de la touche Échap (`popInventaire === 'PPNU - PPNV' || ...`).
- Remplacer les **7 recopies** de la formule de quantité restante par `inventaireService.getRemainingQuantity(p)` : getter `filteredProducts`, `countPositive`, `countNegative`, `countEmpty` et `calculateStatistics()`. Sans ça, les filtres « positif / négatif / vide » ignoreraient les corrections.
- Ajouter `quantity_correction === 0` dans `isProductEmpty()`.
- Historique : `updateProductUsages()` garde déjà tout sauf les PPNU/PPNV, donc les corrections y apparaîtront. On peut aussi ajouter une liste `productCorrections` si on veut un filtre dédié.
- Ajouter `onEditCorrectionEvent(event)` et `onDeleteCorrectionEvent(event)`, sur le modèle des méthodes PPNU/PPNV. La confirmation de suppression peut être : *« Supprimer la correction du JJ/MM/AAAA ? »*.
- Graphique (`buildChartData`) : on peut ajouter un segment « Corrections (−) » pour les retraits. Les ajouts sont déjà inclus dans le restant.

**HTML**

- Menu « + » : ajouter un bouton **« Correction de stock »** à côté de « PPNU / PPNV » (vers la ligne 30).
- Barre du bas sur mobile (`footer-fab`) : ajouter le bouton, et exclure `'Correction'` de la condition `*ngIf` qui masque la barre quand une popup est ouverte.
- Fiche produit : ajouter un bouton **« Corriger le stock »**, qui ouvre la popup avec le produit présélectionné.
- Ajouter le bloc de popup `@else if (popInventaire === 'Correction')`, en recopiant le bloc PPNU/PPNV (vers la ligne 576), avec le titre « Correction de stock ».
- Tableau historique (vers les lignes 449-457) : aujourd'hui, il ne distingue que « Achat » et « Traitement ». Il faut y ajouter la correction :

  | Type | Libellé | Classe du libellé | Quantité affichée |
  |---|---|---|---|
  | correction plus | `Correction +` | `tag tag--correction` | `+X` (`qty--in`) |
  | correction minus | `Correction −` | `tag tag--correction` | `−X` (`qty--out`) |

  Ajouter aussi les boutons modifier et supprimer sur ces lignes.

**SCSS** (vers la ligne 719 de `accueil-inventaire.component.scss`) :

```scss
&--correction { background: #fde8e4; color: #a3301a; }
```

---

## 4. Points d'attention

- **Ordre de déploiement** : d'abord la migration SQL `server/migrations/011_add_inventory_correction_mode.sql`, puis le backend, puis le frontend. Une API pas encore mise à jour **ajouterait** la quantité d'une correction au lieu de la retirer.
- **Unités** : on ne gère pas le mélange L/Kg pour l'instant, comme pour les PPNU/PPNV. On garde simplement l'avertissement « unité différente de celle du produit ».
- **Arrondis** : arrondir la quantité proposée à 2 décimales. Sinon, des valeurs comme `2.9999999` s'afficheraient à cause des calculs en nombres à virgule.
- **Modification d'une correction** : la quantité proposée par défaut ne s'applique **pas**. On reprend les valeurs enregistrées, et l'aperçu « après correction » tient compte de la correction en cours de modification (voir `remainingAfter`).

## 5. Tests à faire

1. Produit à +12 L : la popup propose **Moins / 12 / L**. Après validation, le restant vaut 0 et la ligne « Correction − » apparaît dans l'historique.
2. Produit à −3 L : la popup propose **Plus / 3**. Après validation, le restant vaut 0.
3. Produit à 0 : le message « déjà à 0 » s'affiche et le formulaire est invalide tant que la quantité est vide.
4. Mode Moins, 6 L : l'avertissement « correction importante » s'affiche. À 5 L, ou en Kg, il ne s'affiche pas.
5. Modification d'une correction : les valeurs enregistrées sont reprises (pas les valeurs par défaut) et le restant est cohérent après enregistrement.
6. Suppression d'une correction : le restant revient à sa valeur précédente.
7. Filtres positif / négatif / vide de la liste de produits : ils tiennent compte des corrections.
8. Export Excel : la colonne « Corrections (net) » est présente, et le type `correction (minus)` ou `correction (plus)` apparaît dans la feuille « Mouvements ».
