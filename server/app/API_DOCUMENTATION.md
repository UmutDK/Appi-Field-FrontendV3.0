# Documentation API — AppiField Server

Base URL : `http://<host>:5000`

L'API est un backend Flask exposant des ressources JSON pour la gestion d'exploitations agricoles (parcelles, cultures, opérateurs, traitements phytosanitaires, travaux aux champs, inventaire de produits). Elle s'appuie sur deux bases MySQL :

- `c2544857c_appifield` — données applicatives (toutes les tables ci-dessous sauf mention contraire)
- `c2544857c_corderPhytoweb` — référentiels phytosanitaires en lecture seule (produits, cultures, unités, doses, ravageurs, avertissements BBCH)

## Sommaire

1. [Authentification](#authentification)
2. [Format des erreurs](#format-des-erreurs)
3. [Référentiels publics — `/index`](#référentiels-publics--index)
4. [Exploitations — `/exploitations`](#exploitations--exploitations)
5. [Parcelles — `/parcels`](#parcelles--parcels)
6. [Opérateurs — `/operators`](#opérateurs--operators)
7. [Cultures — `/crops`](#cultures--crops)
8. [Traitements phytosanitaires — `/phyto_treatments`](#traitements-phytosanitaires--phyto_treatments)
9. [Travaux aux champs — `/field_works`](#travaux-aux-champs--field_works)
10. [Inventaire — `/inventories`](#inventaire--inventories)
11. [Produits personnalisés — `/personal_products`](#produits-personnalisés--personal_products)
12. [Récapitulatif global des endpoints](#récapitulatif-global-des-endpoints)

---

## Authentification

Toutes les routes marquées **🔒 Auth requise** attendent un header :

```
Authorization: Bearer <token>
```

Le token est vérifié auprès d'un service externe (`userkey.corderapp.be`) et le résultat (`user_id`) est mis en cache en mémoire 30 minutes. Toutes les données sont filtrées par `userId` : un utilisateur ne voit et ne modifie jamais les données d'un autre.

Les routes marquées **🌐 Public** ne nécessitent aucun header d'authentification.

## Format des erreurs

| Code | Cas | Corps |
|------|-----|-------|
| `401` | Token absent ou invalide | `{ "error": "Token d'authentification invalide ou manquant" }` |
| `404` | Ressource introuvable ou n'appartenant pas à l'utilisateur | `{ "error": "<message>" }` |
| `400` | Champ obligatoire manquant | `{ "error": "<message>" }` |

Les réponses de succès retournent `{ "success": true, ... }` (avec l'id créé le cas échéant) pour les écritures, ou directement l'objet/la liste demandée pour les lectures.

---

## Référentiels publics — `/index`

Données en lecture seule issues de `c2544857c_corderPhytoweb`. Aucune authentification requise. Aucune écriture possible (l'API ne propose que des `GET`).

| Méthode | Endpoint | Description |
|---------|----------|--------------|
| `GET` | `/index/units` | Table des unités (`idUnit`, `unitName`, `normalisationFactor`) utilisées pour standardiser les quantités/doses/surfaces dans toute l'API |
| `GET` | `/index/phytoweb_products` | Catalogue des produits phytosanitaires homologués |
| `GET` | `/index/phytoweb_crops` | Référentiel des cultures Phytoweb |
| `GET` | `/index/doseminmax` | Doses min/max autorisées par produit/culture |
| `GET` | `/index/enemies` | Ravageurs / maladies / adventices référencés |
| `GET` | `/index/bbch_warnings` | Avertissements liés aux stades BBCH des cultures |

**Exemple — `GET /index/units`**
```json
[
  { "idUnit": 1, "unitName": "ha", "normalisationFactor": 1.0 },
  { "idUnit": 2, "unitName": "L", "normalisationFactor": 1.0 },
  { "idUnit": 3, "unitName": "L/ha", "normalisationFactor": 1.0 }
]
```

> Les autres routes `/index/*` renvoient directement le contenu des tables `products`, `crops`, `dosesMinMax`, `enemies`, `bbchWarnings` de `c2544857c_corderPhytoweb` sans transformation ; consulter la base pour le détail exact des colonnes.

> **Convention d'unités utilisée dans toute l'API** : partout où une quantité/dose/surface est écrite (`parcels`, `phyto_treatments`, `field_works`, `inventories`), le client fournit le **nom** de l'unité (ex. `"ha"`, `"L"`, `"L/ha"`) dans un champ `*Unit`. Le serveur résout ce nom contre `unitsIndex`, stocke l'`idUnit` correspondant dans la colonne `*UnitId`, et calcule automatiquement la valeur standardisée (`standardXxx` = valeur × `normalisationFactor`) au moment de l'écriture. Si le nom d'unité est introuvable, le champ `*UnitId` conserve le nom brut et le champ `standardXxx` reste égal à la valeur non convertie.

---

## Exploitations — `/exploitations`

### Modèle `Exploitation`

| Champ | Type | Description |
|-------|------|--------------|
| `exploitationId` | `string` | Identifiant unique (UUID) |
| `userId` | `string` | Propriétaire |
| `exploitationName` | `string` \| `null` | Nom de la ferme |
| `exploitationAddress` | `string` \| `null` | Adresse |
| `exploitationPostalCode` | `string` \| `null` | Code postal |
| `vatNumber` | `string` \| `null` | Numéro de TVA |
| `responsibleName` | `string` \| `null` | Nom du responsable |
| `responsibleMail` | `string` \| `null` | Email du responsable |
| `responsiblePhytolicence` | `string` \| `null` | Licence phyto du responsable |
| `exploitationPhytolicence` | `string` \| `null` | Licence phyto de l'exploitation |
| `createdAt` / `modifiedAt` | `string` (datetime) | Horodatage géré par la DB |

### `GET /exploitations` 🔒
Liste les exploitations de l'utilisateur.

### `GET /exploitations/<exploitationId>` 🔒
Détail d'une exploitation. `404` si absente ou non possédée.

### `POST /exploitations` 🌐
Création d'une exploitation — **route publique**, utilisée à la création de compte (pas de token requis, `userId` fourni directement dans le body).

**Body**
```json
{
  "userId": "42",
  "exploitationName": "Ferme du Chêne",
  "exploitationAddress": "Rue des Champs 12",
  "exploitationPostalCode": "5590",
  "vatNumber": "BE0123456789",
  "responsibleName": "Jean Dupont",
  "responsibleMail": "jean@ferme.be",
  "responsiblePhytolicence": "7853124681532",
  "exploitationPhytolicence": "P-001"
}
```
**Réponse 201** : `{ "success": true, "exploitationId": "..." }`

### `PUT /exploitations/<exploitationId>` 🔒
Mêmes champs que le `POST` (sauf `userId`, non modifiable).

### `DELETE /exploitations/<exploitationId>` 🔒
Suppression définitive.

---

## Parcelles — `/parcels`

### Modèle `Parcel`

| Champ | Type | Description |
|-------|------|--------------|
| `parcelId` | `string` | Identifiant unique (UUID) |
| `userId` | `string` | Propriétaire |
| `parcelName` | `string` \| `null` | Nom de la parcelle |
| `parcelArea` | `number` \| `null` | Surface, dans l'unité `parcelAreaUnitId` |
| `parcelAreaUnitId` | `string` | Identifiant d'unité résolu (voir [conventions d'unités](#référentiels-publics--index)) |
| `standardParcelArea` | `number` \| `null` | Surface standardisée (calculée) |
| `latitude` / `longitude` | `number` \| `null` | Coordonnées |
| `polygon` | `string` (JSON) \| `null` | Géométrie de la parcelle (GeoJSON ou liste de coordonnées, sérialisée) |
| `parcelCategory` | `string` \| `null` | Ex. `"Plein air"` |
| `parcelAddress` | `string` \| `null` | Adresse |
| `recordType` | `string` \| `null` | Origine de l'enregistrement (ex. `"gml_import"`) |
| `sigecCode` | `string` \| `null` | Code SIGEC |
| `isArchived` | `0` \| `1` | Parcelle archivée (lecture seule : modifiable uniquement via `/archive`, `/unarchive`, `/renew`) |
| `prevParcelId` | `string` \| `null` | Parcelle archivée dont celle-ci est le renouvellement (lecture seule) |
| `createdAt` / `modifiedAt` | `string` (datetime) | Horodatage |

### `GET /parcels` 🔒 · `GET /parcels/<parcelId>` 🔒
Liste / détail des parcelles de l'utilisateur. La liste inclut **les parcelles archivées** (champ `isArchived`) ; filtre optionnel `?archived=0` (actives) ou `?archived=1` (archivées).

### `GET /parcels/archive` 🔒
Parcelles archivées uniquement (équivalent de `/crops/archive`).

### `POST /parcels/<parcelId>/archive` 🔒 · `POST /parcels/<parcelId>/unarchive` 🔒
Archive / restaure une parcelle. `404` si elle n'existe pas. Les cultures, traitements et travaux déjà liés restent liés.

### `POST /parcels/<parcelId>/renew` 🔒
« Archiver et renouveler » (même parcelle, nouveau numéro PAC). Body : `{ "sigecCode": "..." }` (obligatoire, `400` sinon). Archive la parcelle et crée une copie active (surface, géométrie, catégorie, adresse, type identiques) nommée `"<nom> (1)"`, avec le nouveau `sigecCode` et `prevParcelId` = id de la parcelle archivée. `404` si introuvable, `409` si déjà archivée.

**Réponse 201** : `{ "success": true, "parcelId": "<nouvelle>", "archivedParcelId": "<ancienne>" }`

### `POST /parcels` 🔒

**Body**
```json
{
  "parcelName": "Parcelle Nord",
  "parcelArea": 5.81,
  "parcelAreaUnit": "ha",
  "latitude": 50.194,
  "longitude": 4.844,
  "polygon": [[209934.0, 121497.3], [209933.8, 121492.8]],
  "parcelCategory": "Plein air",
  "parcelAddress": "Croix, Sovet, Ciney",
  "recordType": "Adress_parcel"
}
```
`parcelAreaUnit` est le **nom** de l'unité (ex. `"ha"`) : le serveur le résout et remplit `parcelAreaUnitId` + `standardParcelArea`.

**Réponse 201** : `{ "success": true, "parcelId": "..." }`

### `PUT /parcels/<parcelId>` 🔒
Mêmes champs que le `POST` (remplacement complet), sauf `sigecCode` qui n'est modifié que s'il est présent dans le body. `isArchived` et `prevParcelId` sont ignorés.

### `DELETE /parcels/<parcelId>` 🔒

---

## Opérateurs — `/operators`

### Modèle `Operator`

| Champ | Type | Description |
|-------|------|--------------|
| `operatorId` | `string` | Identifiant unique (UUID) |
| `userId` | `string` | Propriétaire |
| `operatorName` | `string` \| `null` | Nom de l'opérateur |
| `operatorPhytolicence` | `string` \| `null` | Numéro de licence phyto |
| `createdAt` / `modifiedAt` | `string` (datetime) | Horodatage |

### `GET /operators` 🔒
Liste des opérateurs de l'utilisateur.

### `POST /operators` 🔒
**Body** : `{ "operatorName": "Tom Leblanc", "operatorPhytolicence": "7890780" }`
**Réponse 201** : `{ "success": true, "operatorId": "..." }`

### `PUT /operators/<operatorId>` 🔒 · `DELETE /operators/<operatorId>` 🔒

---

## Cultures — `/crops`

### Modèle `Crop`

| Champ | Type | Description |
|-------|------|--------------|
| `cropId` | `string` | Identifiant unique (UUID) |
| `userId` | `string` | Propriétaire |
| `cropName` | `string` \| `null` | Nom de la culture |
| `remarks` | `string` \| `null` | Remarques libres |
| `sowingDate` / `harvestDate` | `string` (YYYY-MM-DD) \| `null` | Dates de semis / récolte |
| `efficiency` | `string` \| `null` | Efficacité / rendement |
| `collection` | `string` | Année de semis déduite, ou `"Cultures"` par défaut |
| `phytowebId` | `string` \| `null` | Référence catalogue Phytoweb |
| `eppo` | `string` \| `null` | Code EPPO |
| `isArchived` | `boolean` | `false` = active, `true` = archivée |
| `parcels` | `array<CropParcel>` | Parcelles liées (ajouté à la réponse) |
| `createdAt` / `modifiedAt` | `string` (datetime) | Horodatage |

### Modèle `CropParcel` (`cropsParcels`)
`cropParcelId`, `cropId`, `userId`, `parcelId`, `createdAt`, `modifiedAt`.

### `GET /crops` 🔒
Cultures **actives** (`isArchived = 0`) avec leurs parcelles.

### `GET /crops/archive` 🔒
Cultures **archivées** (`isArchived = 1`) avec leurs parcelles.

### `GET /crops/<cropId>` 🔒
Détail d'une culture.

### `POST /crops` 🔒
**Body**
```json
{
  "cropName": "Maïs",
  "sowingDate": "2025-04-20",
  "harvestDate": "2025-10-01",
  "eppo": "ZEAMX",
  "phytowebId": "pwc-...",
  "parcelIds": ["p-001", "p-002"]
}
```
Si `parcelIds` est fourni, crée aussi les liaisons dans `cropsParcels`. Si `collection` est absent, il est déduit de l'année de `sowingDate`.
**Réponse 201** : `{ "success": true, "cropId": "..." }`

### `PUT /crops/<cropId>` 🔒
Mêmes champs. Si `parcelIds` est présent (même `[]`), les liaisons existantes sont **entièrement remplacées** ; s'il est absent, elles ne sont pas touchées.

### `POST /crops/<cropId>/archive` 🔒 · `POST /crops/<cropId>/unarchive` 🔒
Bascule `isArchived`.

### `DELETE /crops/<cropId>` 🔒
Supprime la culture et ses liaisons `cropsParcels`.

---

## Traitements phytosanitaires — `/phyto_treatments`

Après chaque `POST`/`PUT`/`DELETE`, les mouvements d'inventaire correspondant à la composition du traitement sont **synchronisés automatiquement** (voir [Inventaire](#inventaire--inventories)).

### Modèle `PhytoTreatment`

| Champ | Type | Description |
|-------|------|--------------|
| `eventId` | `string` | Identifiant unique (UUID) |
| `userId` | `string` | Propriétaire |
| `eventType` | `string` \| `null` | Type de traitement |
| `eventDate` | `string` (YYYY-MM-DD) | Date du traitement |
| `eventTime` | `string` (HH:MM:SS) \| `null` | Heure |
| `operatorId` | `string` \| `null` | Référence opérateur |
| `treatmentTotalQuantity` / `treatmentTotalQuantityUsed` | `number` \| `null` | Quantité totale prévue / utilisée |
| `surfaceTreated` | `number` \| `null` | Surface traitée, dans l'unité fournie |
| `standardSurfaceTreated` | `number` \| `null` | Surface standardisée (calculée) |
| `remarks` | `string` \| `null` | Remarques |
| `cleanFlag` | `boolean` | Nettoyage effectué |
| `localizedTreatment` | `boolean` | Traitement localisé |
| `decisionBase` | `string` \| `null` | Base de décision |
| `effectiveness` | `string` \| `null` | Efficacité perçue |
| `thirdPartFlag` | `0` \| `1` (booléen en écriture) | Traitement effectué par un tiers. À `1`, les quantités de produits de ce traitement ne sont **pas déduites** de l'inventaire et n'apparaissent pas dans son historique. Défaut `0` à la création ; **conservé** s'il est omis d'un `PUT` |
| `treatmentType` | `string` | Méthode d'application (≠ `eventType`, le mode d'encodage). Valeurs autorisées : `"pulvérisation"`, `"traitement de semences"`, `"microgranulé"`, `"arrosage"`, `"irrigation"`, `"badigeonnage"`, `"injection"`, `"trempage"` — sinon `400`. Défaut `"pulvérisation"` à la création ; **conservé** s'il est omis d'un `PUT` |
| `parcelsConcerned` | `array<PhytoTreatmentParcel>` | Parcelles/cultures concernées (ajouté à la réponse) |
| `treatmentComposition` | `array<PhytoTreatmentComposition>` | Produits appliqués (ajouté à la réponse) |
| `createdAt` / `modifiedAt` | `string` (datetime) | Horodatage |

### Modèle `PhytoTreatmentParcel` (`phytoTreatmentsParcelsCrops`)

| Champ | Description |
|-------|--------------|
| `eventParcelsId` | Identifiant unique de la ligne |
| `eventId` | Référence au traitement |
| `parcelId`, `parcelName` | Parcelle concernée |
| `cropId`, `cropName`, `phytowebCropName` | Culture concernée |
| `treatmentQuantity` | Quantité appliquée sur cette parcelle |
| `treatmentQuantityUnitId` | Unité résolue |
| `standardTreatmentQuantity` | Quantité standardisée (calculée) |

### Modèle `PhytoTreatmentComposition` (`phytoTreatmentsComposition`)

| Champ | Description |
|-------|--------------|
| `eventCompositionId` | Identifiant unique de la ligne |
| `eventId` | Référence au traitement |
| `productId`, `productName`, `productNumAut` | Produit appliqué |
| `productDose` / `productDoseUnitId` / `standardProductDose` | Dose appliquée, unité résolue, dose standardisée |
| `productQuantity` / `productQuantityUnitId` / `standardProductQuantity` | Quantité totale du produit, unité résolue, quantité standardisée |
| `productTarget` | Cible du traitement (ravageur/maladie/adventice) |

### `GET /phyto_treatments` 🔒
Liste les traitements de l'utilisateur (tri par `eventDate` décroissant), chacun enrichi de `parcelsConcerned` et `treatmentComposition`.

### `GET /phyto_treatments/<eventId>` 🔒

### `GET /phyto_treatments/warnings?idActs=<idAct,...>&cropIds=<cropId,...>` 🔒
Avertissements d'encodage pour les produits (`idActs`, produits personnels `perso-` ignorés) et les cultures du traitement (`cropIds`, ids `/crops` de l'utilisateur), **déjà filtrés selon ses préférences** (`/user_preferences`). Les cultures sont rattachées au référentiel Phytoweb côté serveur (phytowebId courant, catégorie admin, ou nom legacy — voir `app/utils/phytoweb_crops.py`) ; celles qui ne peuvent pas l'être sont listées dans `unresolvedCropIds`.

```json
{
  "preferences": { "erRiWarningFlag": true, "spe8HourWarningFlag": true, "bbchWarningFlag": true,
                   "defaultTreatmentType": "surface", "defaultEventType": "phyto_surface_treatment" },
  "products": [{
    "idAct": "act_...", "productName": "...", "numAut": "...",
    "erRiFlag": true, "spe8FlagHoraire": true,
    "bbchCrops": [{ "idCrop": "pwc_...", "cropName": "betteraves sucrières",
                    "cropApplicationStade": "... (BBCH 12-19)", "cropIds": ["<cropId utilisateur>"],
                    "message": "betteraves sucrières : ... (BBCH 12-19)" }],
    "erRiWarning": "Attention, ce produit ne semble pas autorisé dans le cadre de la campagne Eco-régime réduction d'intrants",
    "hourWarning": true,
    "bbchWarnings": [ "...mêmes éléments que bbchCrops..." ]
  }],
  "unresolvedCropIds": []
}
```
`erRiFlag`/`spe8FlagHoraire`/`bbchCrops` = données brutes Phytoweb ; `erRiWarning`/`hourWarning`/`bbchWarnings` = à afficher (vides si la préférence correspondante est désactivée).

### `POST /phyto_treatments` 🔒

**Body**
```json
{
  "eventType": "phyto_surface_treatment",
  "eventDate": "2025-10-20",
  "operatorId": "e9e5e3be-...",
  "surfaceTreated": 4.15,
  "surfaceTreatedUnit": "ha",
  "treatmentTotalQuantity": 4.141,
  "treatmentTotalQuantityUsed": 4.141,
  "cleanFlag": false,
  "localizedTreatment": false,
  "thirdPartFlag": false,
  "treatmentType": "pulvérisation",
  "decisionBase": "Non définit",
  "effectiveness": "Pas d'avis",
  "remarks": "",
  "parcelsConcerned": [
    {
      "parcelId": "1401d518-...",
      "parcelName": "PEI Bettange 2026",
      "cropId": "713e8fd5-...",
      "cropName": "blé tendre d'hiver KERUBINO",
      "phytowebCropName": "froment d'hiver",
      "treatmentQuantity": 4.141,
      "treatmentQuantityUnit": "L"
    }
  ],
  "treatmentComposition": [
    {
      "productId": "ppp-70eedd87-...",
      "productName": "MALIBU",
      "productNumAut": "9316P/B",
      "productDose": 1,
      "productDoseUnit": "L/ha",
      "productQuantity": 4.141,
      "productQuantityUnit": "L",
      "productTarget": "mauvaises herbes"
    }
  ]
}
```
Tous les champs `*Unit` (`surfaceTreatedUnit`, `treatmentQuantityUnit`, `productDoseUnit`, `productQuantityUnit`) prennent un **nom** d'unité ; le serveur remplit les `*UnitId`/`standardXxx` correspondants.

**Réponse 201** : `{ "success": true, "eventId": "..." }`

### `PUT /phyto_treatments/<eventId>` 🔒
Mêmes champs que le `POST`. Si `parcelsConcerned` et/ou `treatmentComposition` sont fournis, les lignes existantes correspondantes sont **entièrement remplacées** ; s'ils sont absents, ils ne sont pas touchés.

### `DELETE /phyto_treatments/<eventId>` 🔒
Supprime le traitement et ses lignes `phytoTreatmentsParcelsCrops`/`phytoTreatmentsComposition`, puis nettoie les mouvements d'inventaire liés.

### `DELETE /phyto_treatments/<eventId>/parcel/<parcelId>` 🔒
Retire une parcelle donnée de `phytoTreatmentsParcelsCrops` pour ce traitement (sans supprimer le traitement lui-même).

---

## Travaux aux champs — `/field_works`

### Modèle `FieldWork`

| Champ | Type | Description |
|-------|------|--------------|
| `eventId` | `string` | Identifiant unique (UUID) |
| `userId` | `string` | Propriétaire |
| `eventType` | `string` \| `null` | Type de travail (ex. `"Travail du sol"`, `"Fertilisation"`) |
| `eventDate` | `string` (YYYY-MM-DD) | Date |
| `eventInfo` | `string` \| `null` | Informations libres |
| `remarks` | `string` \| `null` | Remarques |
| `eventDose` | `number` \| `null` | Dose appliquée, dans l'unité fournie |
| `eventDoseUnitId` | `string` \| `null` | Unité résolue |
| `standardEventDose` | `number` \| `null` | Dose standardisée (calculée) |
| `eventTool` | `string` \| `null` | Outil utilisé |
| `parcelsConcerned` | `array<FieldWorkParcel>` | Parcelles concernées (ajouté à la réponse) |
| `createdAt` / `modifiedAt` | `string` (datetime) | Horodatage |

### Modèle `FieldWorkParcel` (`fieldWorksParcelsCrops`)
`eventParcelsId`, `eventId`, `parcelId`, `parcelName`, `cropId`, `cropName`, `phytowebCropName`, `createdAt`, `modifiedAt`.

### `GET /field_works` 🔒 · `GET /field_works/<eventId>` 🔒

### `POST /field_works` 🔒
**Body**
```json
{
  "eventType": "Travail du sol",
  "eventDate": "2025-09-24",
  "eventInfo": "",
  "eventDose": 0,
  "eventDoseUnit": "L/ha",
  "eventTool": "",
  "parcelsConcerned": [
    {
      "parcelId": "104055233",
      "parcelName": "Parcelle PAC 1580346160",
      "cropId": "900f0395-...",
      "cropName": "froment",
      "phytowebCropName": "froment d'hiver"
    }
  ]
}
```
**Réponse 201** : `{ "success": true, "eventId": "..." }`

### `PUT /field_works/<eventId>` 🔒
Mêmes champs. Si `parcelsConcerned` est fourni, les liaisons sont entièrement remplacées.

### `DELETE /field_works/<eventId>` 🔒
### `DELETE /field_works/<eventId>/parcel/<parcelId>` 🔒

---

## Inventaire — `/inventories`

L'inventaire combine deux sources en lecture :
- `inventoriesOperations`, un journal de mouvements **à plat**, saisi par l'utilisateur — uniquement des achats/ajouts (+), des déclarations réglementaires PPNU/PPNV (-, suivies à part du stock utilisable) et des corrections de stock (+ ou - selon `correctionMode`) ;
- `phytoTreatmentsComposition`, lue **directement** (jointe à `phytoTreatments` pour la date) pour la consommation par traitement phytosanitaire (-) — jamais copiée dans `inventoriesOperations`.

Le stock courant n'est pas stocké : il est **recalculé à la volée** à chaque lecture, et l'historique affiché par produit fusionne les deux sources, triées chronologiquement (voir `app/utils/inventory_stock.py`).

### Modèle `InventoryOperation`

| Champ | Type | Description |
|-------|------|--------------|
| `inventoryOperationId` | `string` | Identifiant unique (UUID pour un achat/PPNU/PPNV, `eventCompositionId` pour une consommation de traitement) |
| `productId` | `string` | Produit concerné (catalogue Phytoweb `ppp-...` ou produit personnel `perso-...`) |
| `operationType` | `string` | `"purchase"` (achat/ajout, +) ; `"ppnu"`/`"ppnv"` (déclaration, suivie à part) ; `"correction"` (correction de stock, sens donné par `correctionMode`) ; `"treatment"` (consommation, lue depuis phytoTreatmentsComposition, jamais créée via POST) |
| `operationDate` | `string` (YYYY-MM-DD) | Date du mouvement (date du traitement source pour `"treatment"`) |
| `quantity` | `number` \| `null` | Quantité, dans l'unité fournie — toujours > 0 (le sens d'une correction est porté par `correctionMode`) |
| `quantityUnitId` | `string` \| `null` | Unité résolue |
| `standardQuantity` | `number` \| `null` | Quantité standardisée (calculée, utilisée pour le calcul du stock) |
| `correctionMode` | `"plus"` \| `"minus"` \| `null` | Uniquement pour `"correction"` : `"plus"` ajoute la quantité au stock, `"minus"` la retire. `null` pour les autres types |
| `sourceEventId` | `string` \| `null` | `eventId` du traitement source, uniquement pour `"treatment"` |

### `GET /inventories` 🔒
Retourne, groupé par produit :
```json
[
  {
    "productId": "ppp-8084c91f-a3e0-43f8-bea9-6d40428c17ba",
    "stock": 12.3,
    "ppnuStock": 0,
    "ppnvStock": 0,
    "correctionStock": -0.5,
    "operations": [
      { "inventoryOperationId": "...", "operationType": "purchase", "operationDate": "2025-04-01", "quantity": 20, "quantityUnitId": "2", "standardQuantity": 20, "correctionMode": null },
      { "inventoryOperationId": "...", "operationType": "treatment", "operationDate": "2025-04-02", "quantity": 1.3, "quantityUnitId": "2", "standardQuantity": 1.3, "sourceEventId": "phyto_..." },
      { "inventoryOperationId": "...", "operationType": "correction", "operationDate": "2025-04-10", "quantity": 0.5, "quantityUnitId": "2", "standardQuantity": 0.5, "correctionMode": "minus" }
    ]
  }
]
```

`correctionStock` est le **net signé** des corrections (`plus` comptées en +, `minus` en -), déjà répercuté dans `stock`.

### `POST /inventories` 🔒
Ajoute un mouvement manuel : achat/ajout (`operationType: "purchase"`), déclaration PPNU/PPNV (`"ppnu"`/`"ppnv"`) ou correction de stock (`"correction"`, avec `correctionMode: "plus"|"minus"` obligatoire). La consommation par traitement ne se crée jamais ici — elle vient de `POST /phyto_treatments`.

Validation (`400`) : `operationType` hors de la liste ci-dessus, `quantity` absente ou ≤ 0, `correctionMode` absent ou invalide pour une correction. `correctionMode` est ignoré (stocké `null`) pour les autres types.

**Body**
```json
{
  "productId": "ppp-8084c91f-a3e0-43f8-bea9-6d40428c17ba",
  "operationType": "purchase",
  "operationDate": "2025-04-01",
  "quantity": 20,
  "quantityUnit": "L"
}
```
**Réponse 201** : `{ "success": true, "inventoryOperationId": "..." }`

### Import Excel d'achats 🔒
Trois routes, aucune écriture avant `confirm` (logique dans `app/utils/inventory_import.py`) :

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/inventories/import/template` | Modèle `.xlsx` vierge (feuille « Achats » : Numéro d'autorisation, Nom du produit, Quantité, Unité, Date d'achat + feuille « Instructions ») |
| `POST` | `/inventories/import/preview` | Multipart, champ `file` (`.xlsx`, 2 Mo, 500 lignes max). Lit et valide chaque ligne **sans rien enregistrer** : produit résolu par **numéro d'autorisation** (actes les plus récents, comparaison sans espaces ni casse — la colonne Nom est ignorée), quantité (> 0, virgule acceptée), unité (`L`/`Kg`, alias litre/kilo…), date `JJ/MM/AAAA` ou cellule date Excel (pas dans le futur). Retourne `{ rows: [{ rowNumber, input, product, quantity, quantityUnit, operationDate, errors[], warnings[], suggestions[], status }], summary }`. `400` si le fichier est illisible ou sans les colonnes attendues |
| `POST` | `/inventories/import/confirm` | Body `{ rows: [{ rowNumber?, productId, quantity, quantityUnit: "L"\|"Kg", operationDate: "YYYY-MM-DD" }] }`. **Tout ou rien** : revalide chaque ligne, `400` + `rowErrors` si une seule est invalide, sinon crée un mouvement `purchase` par ligne. **201** : `{ success, created, inventoryOperationIds }` |

Avertissements (non bloquants) renvoyés par `preview` : produit retiré (`statut = Retrait`), achat identique (produit, date, quantité) déjà présent dans l'inventaire, doublon dans le fichier. `suggestions` (numéro non reconnu) : produits au même numéro de base (ex. `10992` → `10992P/B`) puis dont le nom contient le nom saisi dans le fichier.

### `DELETE /inventories?inventoryOperationId=<id>` 🔒
Supprime un mouvement précis.

> ⚠️ Pour supprimer les mouvements liés à un traitement, ne pas utiliser cette route : supprimer ou modifier le traitement via `/phyto_treatments`, qui déclenche automatiquement le nettoyage/la régénération des mouvements `treatment` correspondants.

---

## Préférences d'encodage — `/user_preferences`

Table `userPreferences` (une ligne par utilisateur). Menu Réglages > Préférences.

| Champ | Type | Défaut | Description |
|---|---|---|---|
| `erRiWarningFlag` | `boolean` | `false` | Respecte la campagne Eco-régime réduction d'intrants |
| `spe8HourWarningFlag` | `boolean` | `true` | Afficher les avertissements horaires |
| `bbchWarningFlag` | `boolean` | `true` | Afficher les avertissements BBCH |
| `defaultTreatmentType` | `"surface"` \| `"porridge"` \| `"quantity"` | `"surface"` | Mode d'encodage présélectionné |
| `defaultEventType` | `string` (lecture seule) | | `eventType` correspondant (`phyto_surface_treatment`…) |

### `GET /user_preferences` 🔒
Retourne les préférences (valeurs par défaut si l'utilisateur n'en a jamais enregistré — une lecture n'écrit jamais).

### `PUT /user_preferences` 🔒
Upsert partiel : champs optionnels, ceux omis conservent leur valeur. `400` si un booléen n'en est pas un ou si `defaultTreatmentType` est hors liste. Retourne les préférences complètes à jour.

---

## Produits personnalisés — `/personal_products`

Produits hors catalogue Phytoweb (engrais, produits maison...), propres à un utilisateur.

### Modèle `PersonalProduct`

| Champ | Type | Description |
|-------|------|--------------|
| `productId` | `string` | Identifiant unique, préfixé `perso-` |
| `userId` | `string` | Propriétaire |
| `productName` | `string` | Nom du produit (obligatoire) |
| `productType` | `string` | Catégorie, `"autre"` par défaut |
| `createdAt` / `modifiedAt` | `string` (datetime) | Horodatage |

### `GET /personal_products` 🔒

### `POST /personal_products` 🔒
**Body** : `{ "productName": "Engrais maison", "productType": "engrais" }`
`productName` est obligatoire (`400` sinon).
**Réponse 201** : `{ "success": true, "productId": "perso-..." }`

### `PUT /personal_products/<productId>` 🔒 · `DELETE /personal_products/<productId>` 🔒

---

## Récapitulatif global des endpoints

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|--------------|
| `GET` | `/index/units` | 🌐 | Référentiel des unités |
| `GET` | `/index/phytoweb_products` | 🌐 | Catalogue produits Phytoweb |
| `GET` | `/index/phytoweb_crops` | 🌐 | Référentiel cultures Phytoweb |
| `GET` | `/index/doseminmax` | 🌐 | Doses min/max |
| `GET` | `/index/enemies` | 🌐 | Ravageurs/maladies |
| `GET` | `/index/bbch_warnings` | 🌐 | Avertissements BBCH |
| `GET` | `/exploitations` | 🔒 | Liste des exploitations |
| `GET` | `/exploitations/<id>` | 🔒 | Détail d'une exploitation |
| `POST` | `/exploitations` | 🌐 | Créer une exploitation |
| `PUT` | `/exploitations/<id>` | 🔒 | Modifier une exploitation |
| `DELETE` | `/exploitations/<id>` | 🔒 | Supprimer une exploitation |
| `GET` | `/parcels` | 🔒 | Liste des parcelles |
| `GET` | `/parcels/<id>` | 🔒 | Détail d'une parcelle |
| `POST` | `/parcels` | 🔒 | Créer une parcelle |
| `PUT` | `/parcels/<id>` | 🔒 | Modifier une parcelle |
| `DELETE` | `/parcels/<id>` | 🔒 | Supprimer une parcelle |
| `GET` | `/operators` | 🔒 | Liste des opérateurs |
| `POST` | `/operators` | 🔒 | Créer un opérateur |
| `PUT` | `/operators/<id>` | 🔒 | Modifier un opérateur |
| `DELETE` | `/operators/<id>` | 🔒 | Supprimer un opérateur |
| `GET` | `/crops` | 🔒 | Cultures actives |
| `GET` | `/crops/archive` | 🔒 | Cultures archivées |
| `GET` | `/crops/<id>` | 🔒 | Détail d'une culture |
| `POST` | `/crops` | 🔒 | Créer une culture |
| `PUT` | `/crops/<id>` | 🔒 | Modifier une culture |
| `POST` | `/crops/<id>/archive` | 🔒 | Archiver une culture |
| `POST` | `/crops/<id>/unarchive` | 🔒 | Désarchiver une culture |
| `DELETE` | `/crops/<id>` | 🔒 | Supprimer une culture |
| `GET` | `/phyto_treatments` | 🔒 | Liste des traitements |
| `GET` | `/phyto_treatments/<id>` | 🔒 | Détail d'un traitement |
| `POST` | `/phyto_treatments` | 🔒 | Créer un traitement (+ sync inventaire) |
| `PUT` | `/phyto_treatments/<id>` | 🔒 | Modifier un traitement (+ sync inventaire) |
| `DELETE` | `/phyto_treatments/<id>` | 🔒 | Supprimer un traitement (+ nettoyage inventaire) |
| `DELETE` | `/phyto_treatments/<id>/parcel/<parcelId>` | 🔒 | Retirer une parcelle d'un traitement |
| `GET` | `/field_works` | 🔒 | Liste des travaux aux champs |
| `GET` | `/field_works/<id>` | 🔒 | Détail d'un travail au champ |
| `POST` | `/field_works` | 🔒 | Créer un travail au champ |
| `PUT` | `/field_works/<id>` | 🔒 | Modifier un travail au champ |
| `DELETE` | `/field_works/<id>` | 🔒 | Supprimer un travail au champ |
| `DELETE` | `/field_works/<id>/parcel/<parcelId>` | 🔒 | Retirer une parcelle d'un travail au champ |
| `GET` | `/inventories` | 🔒 | Stock + historique par produit |
| `POST` | `/inventories` | 🔒 | Ajouter un mouvement de stock |
| `DELETE` | `/inventories?inventoryOperationId=<id>` | 🔒 | Supprimer un mouvement de stock |
| `GET` | `/personal_products` | 🔒 | Liste des produits personnalisés |
| `POST` | `/personal_products` | 🔒 | Créer un produit personnalisé |
| `PUT` | `/personal_products/<id>` | 🔒 | Modifier un produit personnalisé |
| `DELETE` | `/personal_products/<id>` | 🔒 | Supprimer un produit personnalisé |
