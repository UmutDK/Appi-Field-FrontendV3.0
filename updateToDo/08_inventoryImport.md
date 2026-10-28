# Inventaire : import Excel d'achats

Guide d'implémentation **frontend**. Le backend est déjà prêt (voir § 1). **Aucune migration SQL n'est nécessaire.**

## Objectif

Sur l'onglet **Inventaire**, un bouton **« Importer des achats »** ouvre une popup en trois étapes :

1. **Préparer le fichier** : télécharger un **modèle Excel**, puis **déposer** le fichier complété.
2. **Résolution des conflits** : chaque ligne est vérifiée par le serveur. Les lignes en erreur doivent être corrigées ou exclues :
   - numéro d'autorisation non reconnu : on recherche le bon produit par numéro ou par nom ;
   - quantité ou unité incorrecte ;
   - date incorrecte.
3. **Import** : les achats valides sont ajoutés à l'inventaire, en une seule fois.

**Colonnes du fichier**

| Colonne | Utilisation |
|---|---|
| Numéro d'autorisation | Identifie le produit dans Phytoweb |
| Nom du produit | **Ignorée à l'import** : le nom officiel vient de Phytoweb. Elle sert seulement à proposer des produits quand le numéro n'est pas reconnu. |
| Quantité | Nombre supérieur à 0 (`12,5` et `12.5` sont acceptés) |
| Unité | `L` ou `kg` (les variantes « litre », « kilo »… sont acceptées) |
| Date d'achat | Format `JJ/MM/AAAA`, ou cellule au format date Excel |

---

## 1. Contrat API (déjà en place côté backend)

Base : `environment.apiRegistre`. Le token est ajouté automatiquement par l'intercepteur, et l'en-tête de mandat aussi si nécessaire : l'import se fait dans l'inventaire de l'espace en cours.

### 1.1 `GET /inventories/import/template` : modèle Excel

Il renvoie `modele_import_achats.xlsx`, qui contient :

- une feuille **« Achats »** : les 5 colonnes, avec un menu déroulant L/kg sur la colonne Unité et un format date sur la colonne Date ;
- une feuille **« Instructions »**.

Le télécharger **avec `HttpClient`** (`responseType: 'blob'`), comme `exportInventaireExcel()` dans [inventaire.service.ts](../src/app/inventaire/services/inventaire.service.ts). Un simple lien `<a href>` n'enverrait pas le token, et le serveur répondrait 401.

### 1.2 `POST /inventories/import/preview` : vérification (n'enregistre rien)

**Requête** : `multipart/form-data`, avec le fichier `.xlsx` dans le champ **`file`**. Limites : 2 Mo et 500 lignes.

```ts
const formData = new FormData();
formData.append('file', file);
this.http.post<ImportPreview>(`${environment.apiRegistre}/inventories/import/preview`, formData);
```

**Réponse 200**

```json
{
  "summary": { "total": 9, "ok": 2, "warning": 2, "error": 5 },
  "rows": [
    {
      "rowNumber": 5,
      "input": { "numAut": "99999X/Z", "productName": "kenof", "quantity": "5", "unit": "kg", "date": "01/02/2026" },
      "product": null,
      "quantity": 5,
      "quantityUnit": "Kg",
      "operationDate": "2026-02-01",
      "errors":   [{ "field": "numAut", "message": "Numéro d'autorisation non reconnu : « 99999X/Z »" }],
      "warnings": [],
      "suggestions": [{ "productId": "act_00744b9c-…", "numAut": "10983P/B", "productName": "KENOFEN" }],
      "status": "error"
    }
  ]
}
```

**Champs de chaque ligne**

| Champ | Description |
|---|---|
| `rowNumber` | Numéro de la ligne dans Excel. **À afficher** pour que l'utilisateur retrouve la ligne dans son fichier. |
| `input` | Valeurs **brutes** du fichier, sous forme de texte, à afficher pour référence |
| `product` | Produit reconnu `{ productId, numAut, productName }`, ou `null` s'il n'est pas reconnu |
| `quantity` / `quantityUnit` / `operationDate` | Valeurs **normalisées**, ou `null` si la valeur est invalide : nombre, `"L"` ou `"Kg"`, et date `YYYY-MM-DD` |
| `errors` | Erreurs **bloquantes**, chacune avec `field` (`numAut`, `quantity`, `unit` ou `date`) et `message` |
| `warnings` | Avertissements **non bloquants** : produit retiré du marché, achat identique déjà présent dans l'inventaire, doublon d'une autre ligne du fichier |
| `suggestions` | Produits proposés quand le numéro n'est pas reconnu (5 au maximum) : même numéro de base (`10992` → `10992P/B`), puis nom contenant la valeur de la colonne Nom |
| `status` | `"ok"`, `"warning"` ou `"error"` |

**Erreur globale (`400 { "error": "…" }`)** : fichier absent, pas en `.xlsx`, illisible, trop gros, trop de lignes, aucune ligne remplie, ou colonnes obligatoires introuvables. Afficher le message tel quel, et rester sur l'étape 1.

### 1.3 `POST /inventories/import/confirm` : enregistrement

**Requête**

```json
{
  "rows": [
    { "rowNumber": 2, "productId": "act_…", "quantity": 20,  "quantityUnit": "L",  "operationDate": "2026-03-15" },
    { "rowNumber": 5, "productId": "act_00744b9c-…", "quantity": 5, "quantityUnit": "Kg", "operationDate": "2026-02-01" }
  ]
}
```

- `productId` est l'`idAct` Phytoweb : soit `product.productId` de la ligne, soit celui d'une suggestion ou d'un produit choisi par recherche.
- `quantityUnit` vaut **exactement** `"L"` ou `"Kg"`, et `operationDate` est au format **`YYYY-MM-DD`**.
- `rowNumber` est optionnel. Il sert seulement à faire remonter les erreurs à la bonne ligne.

**Réponse 201**

```json
{ "success": true, "created": 2, "inventoryOperationIds": ["…", "…"] }
```

Chaque ligne crée un achat (`operationType: "purchase"`), identique à un achat saisi via « Achat de PPP ».

**Tout ou rien** : si **une** ligne est invalide, **rien** n'est enregistré, et le serveur renvoie :

```json
400 { "error": "Certaines lignes sont invalides, aucun achat n'a été importé",
      "rowErrors": [{ "index": 1, "rowNumber": 5, "field": "quantity", "message": "La quantité doit être supérieure à 0" }] }
```

`index` est la position dans le tableau `rows` envoyé.

### 1.4 Recherche d'un produit (existante)

`GET /index/phytoweb_products/search?q=<numéro ou nom>&limit=15` est déjà utilisé par `PhytoProductService.searchProducts()` ([phyto-product.service.ts](../src/app/inventaire/services/phyto-product.service.ts)). On le réutilise pour la résolution des conflits. `product_id` correspond au `productId` à envoyer.

---

## 2. Modifications à faire

### 2.1 Service : [inventaire.service.ts](../src/app/inventaire/services/inventaire.service.ts)

```ts
export interface ImportRowIssue { field: string; message: string; }
export interface ImportProduct { productId: string; numAut: string; productName: string; }
export interface ImportPreviewRow {
  rowNumber: number;
  input: { numAut: string; productName: string; quantity: string; unit: string; date: string };
  product: ImportProduct | null;
  quantity: number | null;
  quantityUnit: 'L' | 'Kg' | null;
  operationDate: string | null;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
  suggestions: ImportProduct[];
  status: 'ok' | 'warning' | 'error';
}
export interface ImportPreview {
  rows: ImportPreviewRow[];
  summary: { total: number; ok: number; warning: number; error: number };
}

downloadImportTemplate(): Observable<Blob> {
  return this.http.get(`${environment.apiRegistre}/inventories/import/template`, { responseType: 'blob' }).pipe(
    tap(blob => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'modele_import_achats.xlsx';
      link.click();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    })
  );
}

previewImport(file: File): Observable<ImportPreview> {
  const formData = new FormData();
  formData.append('file', file);
  return this.http.post<ImportPreview>(`${environment.apiRegistre}/inventories/import/preview`, formData);
}

confirmImport(rows: { rowNumber: number; productId: string; quantity: number;
                     quantityUnit: 'L' | 'Kg'; operationDate: string }[]): Observable<any> {
  return this.http.post(`${environment.apiRegistre}/inventories/import/confirm`, { rows }).pipe(
    tap(() => this.getRealInventoryData().subscribe())   // rafraîchit l'inventaire affiché
  );
}
```

> **Ne pas** définir d'en-tête `Content-Type` pour l'envoi du fichier. Le navigateur doit le générer lui-même, avec sa délimitation (`boundary`).

### 2.2 Bouton : [accueil-inventaire.component.html](../src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.html)

- **Ordinateur** : dans `.inventaire-header-actions` (vers la ligne 11), entre « Exporter » et « Ajouter », ajouter

  ```html
  <button type="button" class="btn-export" (click)="onImportAchats()">
      <i class="bi bi-file-earmark-arrow-up"></i> Importer des achats
  </button>
  ```

- **Mobile** : ajouter le même choix dans la barre du bas (`footer-fab`), ou comme troisième élément du menu « Ajouter » (« Importer des achats — depuis un fichier Excel »).
- **Popup** : ajouter un état `popInventaire = 'Import achats'`, géré comme `'PPNU - PPNV'` et `'Achat de PPP'`. Cela comprend l'ouverture, la fermeture par la croix ou par Échap, et la condition `*ngIf` qui masque la barre du bas quand une popup est ouverte. Le bloc HTML de la popup se calque sur celui des popups existantes (vers la ligne 576).

### 2.3 Composant de la popup : `components/import-achats/`

Un nouveau composant autonome, sur le modèle de `ppnu-ppnv` : popup, `closeForm` en sortie, et `no-scroll` sur le body.

#### Étape 1 : préparer le fichier

- **Explication** : « Téléchargez le modèle, complétez une ligne par achat puis déposez-le ici. »
- **Bouton « Télécharger le modèle Excel »** : appelle `downloadImportTemplate()`.
- **Zone de dépôt** : glisser-déposer, plus un `<input type="file" accept=".xlsx">`. Vérifier côté client l'extension `.xlsx` et la taille (2 Mo au maximum).
- **Bouton « Vérifier le fichier »** : appelle `previewImport(file)`, avec un indicateur de chargement. En cas de `400`, afficher `error.error.error` et rester sur l'étape 1. En cas de succès, passer à l'étape 2.

#### Étape 2 : résolution des conflits

- **Résumé en haut** : « 9 lignes : 2 prêtes, 2 avec avertissement, 5 à corriger ». Ajouter un filtre « Afficher seulement les lignes à corriger ».
- **Tableau, une ligne par achat**, avec les colonnes : n° de ligne Excel, **produit** (nom Phytoweb et numéro d'autorisation), quantité, unité, date, statut (pastille verte, orange ou rouge) et une case **« Inclure »**.
  - **Lignes `ok`** : en lecture seule, incluses par défaut.
  - **Lignes `warning`** : incluses par défaut, mais les messages sont affichés en orange (« Ce produit n'est plus autorisé », « Un achat identique existe déjà… », « Doublon de la ligne 2 »). L'utilisateur peut décocher « Inclure » pour ne pas importer un doublon.
  - **Lignes `error`** : **non incluses tant qu'elles ne sont pas corrigées**. Afficher la valeur du fichier (`input`) et le message d'erreur sous chaque champ fautif, puis les contrôles de correction :

| `field` en erreur | Correction proposée |
|---|---|
| `numAut` | Les **suggestions** sous forme de boutons cliquables (« KENOFEN — 10983P/B »), **plus** un champ de recherche par numéro ou par nom, qui réutilise `PhytoProductService.searchProducts()` avec un délai de saisie de 300 ms, comme dans `achat-de-ppp`. Choisir un produit remplit `product` avec `{ productId: p.product_id, numAut: p.product_numaut, productName: p.product_name }`. |
| `quantity` | Champ numérique (`min > 0`), prérempli avec `quantity` si elle a été lue, sinon vide |
| `unit` | Menu déroulant **L / Kg**, avec les valeurs `"L"` et `"Kg"` |
| `date` | `<input type="date" [max]="aujourd'hui">`, prérempli avec `operationDate` s'il est valide |

  - **Corriger en local** : une correction modifie la ligne côté frontend uniquement, sans rappeler `/preview`. Une ligne est **valide** quand :

    ```ts
    isRowValid(r) {
      return !!r.product?.productId && r.quantity! > 0
          && (r.quantityUnit === 'L' || r.quantityUnit === 'Kg')
          && !!r.operationDate && r.operationDate <= today;
    }
    ```

    Dès qu'elle devient valide, sa pastille passe au vert et la case « Inclure » est cochée automatiquement.
  - **Raccourci par produit** (facultatif) : si plusieurs lignes ont le même numéro non reconnu, proposer « Appliquer ce produit aux N lignes avec le numéro « 99999X/Z » ».
- **Pied de la popup** : boutons « Retour », pour changer de fichier, et **« Importer N achats »**, où N est le nombre de lignes incluses **et** valides.
  - Le bouton est désactivé si N vaut 0.
  - Si des lignes en erreur ne sont ni corrigées ni exclues, afficher : « 3 lignes en erreur seront ignorées », ou bloquer le bouton. **Il vaut mieux ignorer avec un message**, pour ne pas bloquer tout l'import à cause d'une ligne.

#### Étape 3 : import

- **Envoi** : appeler `confirmImport()` avec, **pour chaque ligne incluse et valide**, `{ rowNumber, productId: r.product.productId, quantity: r.quantity, quantityUnit: r.quantityUnit, operationDate: r.operationDate }`.
- **En cas de succès (201)** : afficher « N achats importés dans votre inventaire », fermer la popup, et laisser l'inventaire se rafraîchir. `confirmImport` appelle déjà `getRealInventoryData()`.
- **En cas de `400` avec `rowErrors`** : retourner à l'étape 2. Repasser les lignes concernées (retrouvées par `rowNumber`) en erreur, avec les messages du serveur. **Rien n'a été enregistré.**

---

## 3. Points d'attention

- **Produits Phytoweb uniquement** : l'import identifie les produits par leur numéro d'autorisation. Les **produits personnels** (engrais…) ne peuvent pas être importés et restent à encoder via « Achat de PPP ».
- **Nom du produit** : la colonne du fichier n'est **jamais** utilisée comme nom. Il faut toujours afficher `product.productName`, qui vient de Phytoweb. La valeur du fichier (`input.productName`) peut être affichée en petit, pour référence.
- **Unités** : seuls L et kg sont acceptés, comme dans la saisie manuelle d'un achat. Des grammes ou des millilitres sont signalés en erreur. L'utilisateur convertit lui-même et choisit l'unité dans la popup.
- **Dates** : une date future est refusée, au même titre qu'une date inexistante comme le 31/02. Excel peut stocker une date comme texte ou comme vraie date : les deux sont acceptés.
- **Doublons** : ce sont des avertissements, pas des erreurs. On peut légitimement acheter deux fois le même produit le même jour. C'est l'utilisateur qui décide en cochant ou non « Inclure ».
- **Mandats** : dans l'espace d'un autre utilisateur, l'import alimente **son** inventaire, comme un achat manuel. Il n'y a rien à faire.

## 4. Tests à faire

1. **« Télécharger le modèle Excel »** : le fichier s'ouvre dans Excel, avec les onglets Achats et Instructions et le menu déroulant L/kg sur la colonne Unité.
2. **Fichier complet sans erreur** : tout est vert, et « Importer N achats » ajoute bien N achats, visibles dans l'inventaire avec le nom Phytoweb (même si la colonne Nom contenait autre chose).
3. **Numéro `10992`** (incomplet) : la ligne est en erreur avec la suggestion « TUSK — 10992P/B ». Cliquer dessus rend la ligne valide.
4. **Numéro `99999X/Z` avec le nom `kenof`** : la suggestion KENOFEN apparaît. Une recherche manuelle « 10983 » ou « kenofen » permet aussi de le choisir.
5. **Quantité `12,5`, unité `litres`, date saisie comme vraie date Excel** : la ligne est acceptée telle quelle (12.5, L, date correcte).
6. **Quantité `-2`, unité `g`, date `31/02/2026`** : trois erreurs, chacune corrigeable dans la popup.
7. **Deux lignes identiques** : la seconde porte l'avertissement « Doublon de la ligne X ». La décocher : elle n'est pas importée.
8. **Produit retiré du marché** (ex. `9126P/B`) : un avertissement orange s'affiche, mais l'import reste possible.
9. **Fichier `.xls`, `.csv` ou sans les bonnes colonnes** : un message d'erreur clair s'affiche à l'étape 1.
10. **Lignes en erreur non corrigées** : elles ne sont pas envoyées, et le message « X lignes ignorées » s'affiche.
