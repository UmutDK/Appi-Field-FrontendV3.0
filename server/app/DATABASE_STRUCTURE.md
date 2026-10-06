# Structure de la base de données — AppiField Server

Ce document décrit le schéma normalisé actuellement utilisé par l'API (`app/routes/*.py`), défini dans [database/init_first_db.py](../database/init_first_db.py), et les différences avec l'ancien système (API PHP + fichiers JSON plats dans `prev_API_système/`).

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Schéma détaillé](#schéma-détaillé)
3. [Relations entre tables](#relations-entre-tables)
4. [Différences avec l'ancien système](#différences-avec-lancien-système)
5. [Historique du schéma dans ce repo](#historique-du-schéma-dans-ce-repo)
6. [Points d'attention restants](#points-dattention-restants)

---

## Vue d'ensemble

Deux bases MySQL distinctes :

| Base | Contenu | Écriture |
|------|---------|----------|
| `c2544857c_appifield` | Données applicatives des utilisateurs (exploitations, parcelles, cultures, traitements, inventaire...) | Lecture/écriture via l'API |
| `c2544857c_corderPhytoweb` | Référentiels phytosanitaires (produits, cultures, unités, doses, ravageurs, avertissements BBCH) | Lecture seule via l'API (route `/index/*`) |

Convention générale : toutes les tables applicatives ont une PK `<entité>Id` (UUID), une colonne `userId` pour l'isolation par utilisateur, et `createdAt`/`modifiedAt` gérées automatiquement par MySQL (`DEFAULT CURRENT_TIMESTAMP` / `ON UPDATE CURRENT_TIMESTAMP`). Les quantités/doses/surfaces suivent toutes le même triplet de colonnes : `xxx` (valeur brute), `xxxUnitId` (unité résolue depuis `unitsIndex`), `standardXxx` (valeur convertie dans l'unité standard, calculée automatiquement à l'écriture par `app/utils/units.py`).

---

## Schéma détaillé

### `exploitations`
| Colonne | Type | Description |
|---|---|---|
| `exploitationId` | VARCHAR(255) PK | |
| `userId` | VARCHAR(255) | Propriétaire |
| `exploitationName` | TEXT | |
| `exploitationAddress` | TEXT | |
| `exploitationPostalCode` | TEXT | |
| `vatNumber` | TEXT | |
| `responsibleName` | TEXT | |
| `responsibleMail` | TEXT | |
| `responsiblePhytolicence` | TEXT | |
| `exploitationPhytolicence` | TEXT | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `parcels`
| Colonne | Type | Description |
|---|---|---|
| `parcelId` | VARCHAR(255) PK | |
| `userId` | VARCHAR(255) | |
| `parcelName` | TEXT | |
| `parcelArea` | REAL | Surface brute |
| `parcelAreaUnitId` | TEXT | Unité résolue (`unitsIndex.idUnit`) |
| `standardParcelArea` | REAL | Surface standardisée |
| `latitude`, `longitude` | REAL | |
| `polygon` | TEXT | Géométrie sérialisée (GeoJSON / liste de coordonnées) |
| `parcelCategory` | TEXT | |
| `parcelAddress` | TEXT | |
| `recordType` | TEXT | Origine de l'enregistrement |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `operators`
| Colonne | Type | Description |
|---|---|---|
| `operatorId` | VARCHAR(255) PK | |
| `userId` | VARCHAR(255) | |
| `operatorName` | TEXT | |
| `operatorPhytolicence` | TEXT | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `crops`
| Colonne | Type | Description |
|---|---|---|
| `cropId` | VARCHAR(255) PK | |
| `userId` | VARCHAR(255) | |
| `cropName` | TEXT | |
| `remarks` | TEXT | |
| `sowingDate`, `harvestDate` | DATE | |
| `efficiency` | TEXT | |
| `collection` | TEXT | Année de semis déduite, ou `"Cultures"` |
| `phytowebId` | VARCHAR(255) | Référence catalogue Phytoweb |
| `eppo` | TEXT | Code EPPO |
| `isArchived` | BOOLEAN | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `cropsParcels` (liaison N-N `crops` ↔ `parcels`)
| Colonne | Type | Description |
|---|---|---|
| `cropParcelId` | VARCHAR(255) PK | |
| `cropId` | VARCHAR(255) | FK logique vers `crops` |
| `userId` | VARCHAR(255) | |
| `parcelId` | VARCHAR(255) | FK logique vers `parcels` |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `phytoTreatments`
| Colonne | Type | Description |
|---|---|---|
| `eventId` | VARCHAR(255) PK | |
| `userId` | VARCHAR(255) | |
| `eventType` | TEXT | |
| `eventDate` | DATE | |
| `eventTime` | TIME | |
| `operatorId` | TEXT | FK logique vers `operators` |
| `treatmentTotalQuantity`, `treatmentTotalQuantityUsed` | REAL | |
| `surfaceTreated` | REAL | |
| `standardSurfaceTreated` | REAL | |
| `remarks` | TEXT | |
| `cleanFlag`, `localizedTreatment` | BOOLEAN | |
| `decisionBase`, `effectiveness` | TEXT | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `phytoTreatmentsParcelsCrops` (parcelles/cultures concernées par un traitement)
| Colonne | Type | Description |
|---|---|---|
| `eventParcelsId` | VARCHAR(255) PK | |
| `eventId` | VARCHAR(255) | FK logique vers `phytoTreatments` |
| `userId` | VARCHAR(255) | |
| `parcelId`, `parcelName` | VARCHAR(255), TEXT | |
| `cropId`, `cropName`, `phytowebCropName` | VARCHAR(255), TEXT, TEXT | |
| `treatmentQuantity` | REAL | Quantité appliquée sur cette parcelle |
| `treatmentQuantityUnitId` | TEXT | |
| `standardTreatmentQuantity` | REAL | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `phytoTreatmentsComposition` (produits appliqués lors d'un traitement)
| Colonne | Type | Description |
|---|---|---|
| `eventCompositionId` | VARCHAR(255) PK | |
| `eventId` | VARCHAR(255) | FK logique vers `phytoTreatments` |
| `userId` | VARCHAR(255) | |
| `productId`, `productName`, `productNumAut` | VARCHAR(255), TEXT, TEXT | |
| `productDose`, `productDoseUnitId`, `standardProductDose` | REAL, TEXT, REAL | |
| `productQuantity`, `productQuantityUnitId`, `standardProductQuantity` | REAL, TEXT, REAL | |
| `productTarget` | TEXT | Cible (ravageur/maladie/adventice) |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `fieldWorks`
| Colonne | Type | Description |
|---|---|---|
| `eventId` | VARCHAR(255) PK | |
| `userId` | VARCHAR(255) | |
| `eventType` | TEXT | |
| `eventDate` | DATE | |
| `eventInfo`, `remarks` | TEXT | |
| `eventDose`, `eventDoseUnitId`, `standardEventDose` | REAL, TEXT, REAL | |
| `eventTool` | TEXT | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `fieldWorksParcelsCrops`
| Colonne | Type | Description |
|---|---|---|
| `eventParcelsId` | VARCHAR(255) PK | |
| `eventId` | VARCHAR(255) | FK logique vers `fieldWorks` |
| `userId` | VARCHAR(255) | |
| `parcelId`, `parcelName` | VARCHAR(255), TEXT | |
| `cropId`, `cropName`, `phytowebCropName` | VARCHAR(255), TEXT, TEXT | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `inventoriesOperations` (mouvements de stock saisis par l'utilisateur, table à plat)
| Colonne | Type | Description |
|---|---|---|
| `inventoryOperationId` | VARCHAR(255) PK | |
| `userId` | VARCHAR(255) | |
| `productId` | TEXT | Produit Phytoweb (`ppp-...`) ou personnel (`perso-...`) |
| `operationType` | TEXT | `"purchase"` (achat/ajout, +) ou `"ppnu"`/`"ppnv"` (déclaration réglementaire, suivie à part) |
| `operationDate` | DATE | |
| `quantity`, `quantityUnitId`, `standardQuantity` | REAL, TEXT, REAL | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

> Il n'existe **pas** de table de stock matérialisée. La consommation par traitement phytosanitaire n'est **pas** stockée ici : elle est lue directement depuis `phytoTreatmentsComposition` (jointe à `phytoTreatments` pour la date), jamais dupliquée. Le stock courant est recalculé à la volée en combinant les deux sources dans `app/utils/inventory_stock.py`.

### `personalProducts` (produits hors catalogue Phytoweb)
| Colonne | Type | Description |
|---|---|---|
| `productId` | VARCHAR(255) PK | Préfixé `perso-` |
| `userId` | VARCHAR(255) | |
| `productName`, `productType` | TEXT | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `formations`
| Colonne | Type | Description |
|---|---|---|
| `formationId` | VARCHAR(255) PK | |
| `formationName`, `formationLocation`, `formationDuration`, `infoLink` | TEXT | |
| `formationDate` | DATE | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

> Table sans équivalent dans l'ancien système ni dans `json_db/` — fonctionnalité pas encore exposée par une route API.

---

## Relations entre tables

Aucune contrainte `FOREIGN KEY` n'est déclarée en base (choix assumé du projet : « pas d'ORM lourd, lisibilité maximale ») — les relations sont **logiques**, portées uniquement par convention de nommage :

```
crops         *──* parcels          via cropsParcels

phytoTreatments 1──* phytoTreatmentsParcelsCrops   (.eventId)
phytoTreatments 1──* phytoTreatmentsComposition    (.eventId)
phytoTreatmentsComposition ──> inventoriesOperations (pas de FK : consommation lue en direct
                                                       depuis phytoTreatmentsComposition,
                                                       jamais copiée dans inventoriesOperations)

fieldWorks    1──* fieldWorksParcelsCrops          (.eventId)

operators     1──* phytoTreatments  (phytoTreatments.operatorId)
```

Toutes les tables sont en plus systématiquement filtrées par `userId` au niveau applicatif (chaque requête SQL des routes ajoute `WHERE userId = %s`).

---

## Différences avec l'ancien système

L'ancien système (`prev_API_système/`) stockait tout en **fichiers JSON plats** sur disque (un fichier par ressource, ex. `parcels.json`, `phyto_treatments.json`), sans base relationnelle pour les données applicatives. Le nouveau schéma introduit une vraie normalisation. Principaux changements par ressource :

| Ressource | Ancien système | Nouveau schéma |
|---|---|---|
| **Exploitations** | JSON, champs incohérents (`adress`, `tva`, `postal`...) | Table `exploitations`, colonnes normalisées en anglais camelCase |
| **Parcelles** | JSON, `place_id` numérique + `id_parcel` UUID coexistants, `polygone`/`polygon` incohérents | Table `parcels`, UUID unique (`parcelId`), `polygon` unifié, surface toujours standardisée (`standardParcelArea`) |
| **Cultures** | 2 fichiers séparés `crops.json` / `cropsArchive.json` avec des **schémas de champs différents** (`eppo` vs `EPPOCode`, `is_archived` vs `isArchived`...), parcelles liées par une liste d'UUID embarquée | Une seule table `crops` + table de liaison `cropsParcels` (N-N normalisée), archivage via simple flag `isArchived` |
| **Traitements phyto** | 1 objet JSON par événement avec `parcels_concerned[]` et `treatment_composition[]` **imbriqués** | 3 tables normalisées : `phytoTreatments`, `phytoTreatmentsParcelsCrops`, `phytoTreatmentsComposition` |
| **Travaux aux champs** | 1 objet JSON par événement avec `parcels_concerned[]` imbriqué | 2 tables : `fieldWorks`, `fieldWorksParcelsCrops` |
| **Inventaire** | 1 objet JSON par produit/exploitation avec un `event_history[]` imbriqué mélangeant achats et consommations | Table à plat `inventoriesOperations`, un mouvement par ligne, stock recalculé à la volée |
| **Produits personnalisés** | Fichier JSON dédié | Table `personalProducts` |
| **Unités** (surfaces, doses, quantités) | Stockées en texte libre (`"ha"`, `"L/ha"`...), jamais converties dans une unité commune | Chaque quantité a son triplet `xxx` / `xxxUnitId` / `standardXxx`, résolu et calculé **à l'écriture** par `app/utils/units.py` contre le référentiel `unitsIndex` (`c2544857c_corderPhytoweb`) |
| **Identifiants** | Mélange d'IDs numériques (`place_id`), de chaînes courtes (`event_id: "ae316e58"`) et d'UUID selon les ressources | UUID v4 uniformes sur toutes les PK |
| **Isolation utilisateur** | Champ `id_user` dans chaque enregistrement JSON, filtrage applicatif côté PHP | Colonne `userId`, même principe, filtrage SQL |
| **Concurrence** | Écritures atomiques avec verrou sur fichier temporaire | Transactions MySQL standard (`commit`/`rollback`) |

---

## Historique du schéma dans ce repo

Ce schéma normalisé a connu plusieurs phases dans le développement de ce repo, utile à connaître si d'anciens scripts ou d'anciennes données réapparaissent :

1. **Schéma initial** défini dans `database/init_first_db.py`, peuplé une première fois depuis `json_db/*.json` par `generate_first_db.py`, puis « nettoyé » (résolution des unités texte en `idUnit` + calcul des `standardXxx`) par une série de scripts batch : `unitParcelsPGindexer.py`, `unitTreatmentCompositionPGindexerPhase1.py`, `unitTreatmentCompositionPGindexerPhase2.py`, `unitTreatmentsParcelsCrops.py`, `unitInventories.py`.
2. **Schéma parallèle**, dénormalisé (snake_case, colonnes `JSON` brutes type `parcels_concerned`), qui a fini par être celui réellement branché derrière la plupart des routes `app/routes/*.py` (sauf `crops`), documenté dans `MIGRATION_PLAN.md` §3.
3. **Réunification** (état actuel) : toutes les routes ont été réalignées sur le schéma normalisé de `database/init_first_db.py`, complété avec les colonnes manquantes (`standardEventDose` sur `fieldWorks`, `sourceEventId` sur `inventoriesOperations` avant sa dépréciation, et la nouvelle table `personalProducts`). La résolution d'unité se fait désormais **à l'écriture** via `app/utils/units.py`, ce qui rend les scripts batch `unit*.py` inutiles pour tout nouvel enregistrement créé par l'API.

⚠️ **`generate_first_db.py` et les scripts `unit*.py` n'ont pas été mis à jour** pour suivre ces derniers changements de colonnes (ex. `inventoriesOperations.product_id` → `productId`, table `personal_products` → `personalProducts`) : si une nouvelle migration `json_db/` → MySQL est relancée, ces scripts doivent d'abord être corrigés en conséquence.

⚠️ **`exploitationId` n'a en réalité jamais existé** sur `parcels`/`operators`/`fieldWorks`/`phytoTreatments`/`inventoriesOperations`, malgré ce que documentait une version antérieure de ce fichier et malgré son usage dans le code (`app/routes/*.py` référençait la colonne dans les `INSERT`/`UPDATE`, provoquant un 500 `Unknown column` à chaque création/modification). Le code a été corrigé pour ne plus y faire référence : aucune de ces tables ne rattache ses lignes à une `exploitations` précise, tout est filtré uniquement par `userId`.

---

## Points d'attention restants

- **`cropsArchive.json` n'est importé par aucun script** (`generate_first_db.py` ne lit que `crops.json`) — à vérifier si des cultures archivées manquent en base suite à une éventuelle migration passée.
- Champs de l'ancien système **sans équivalent** dans le nouveau schéma, donc définitivement perdus si non re-capturés côté client : `sigec_code` et `imported_from_gml` (parcelles), `component_type`/catégorie de produit, `harvest_date`/`bbch`/métadonnées techniques (traitements), `observation` (travaux aux champs).
- `responsibleName`/`responsibleMail`/`responsiblePhytolicence`/`exploitationPhytolicence` étaient toujours `NULL` après l'import batch historique (clés JSON sources inexistantes) — non pertinent pour les nouveaux enregistrements créés via l'API, qui les acceptent désormais correctement en entrée.
- Aucune contrainte `FOREIGN KEY` ni `UNIQUE` en base : l'intégrité référentielle (`userId`, `parcelId`...) est garantie uniquement par le code applicatif, pas par MySQL.
