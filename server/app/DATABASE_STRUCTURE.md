# Structure de la base de données — AppiField Server

Ce document décrit le schéma de la base applicative `c2544857c_appifield` utilisé par l'API (`app/routes/*.py`), son évolution ([`server/migrations/`](../migrations/)) et les différences avec l'ancien système (API PHP + fichiers JSON plats, conservés dans `previousServer/`).

> **Schéma vérifié sur la base de production le 04/11/2026** (migrations 001 à 017 appliquées, 23 tables), puis mis à jour pour les migrations 018 et 019. En cas de doute, c'est la production qui fait foi : [`000_local_dev_schema.sql`](../migrations/000_local_dev_schema.sql) reproduit la structure pour le développement local, mais diffère sur certains types (`VARCHAR` au lieu de `TEXT`, `NOT NULL` sur `userId`) et ne contient pas les tables de sauvegarde.

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Schéma détaillé](#schéma-détaillé)
3. [Tables de sauvegarde](#tables-de-sauvegarde)
4. [Relations entre tables](#relations-entre-tables)
5. [Différences avec l'ancien système](#différences-avec-lancien-système)
6. [Historique du schéma](#historique-du-schéma)
7. [Points d'attention](#points-dattention)

---

## Vue d'ensemble

Deux bases MySQL distinctes :

| Base | Contenu | Écriture |
|------|---------|----------|
| `c2544857c_appifield` | Données applicatives des utilisateurs (exploitations, parcelles, cultures, traitements, inventaire, préférences, mandats...) | Lecture/écriture via l'API |
| `c2544857c_corderPhytoweb` | Référentiels phytosanitaires (produits, cultures, unités, doses, cibles), alimentés par le pipeline externe PhytowebCorder (voir [`DOCUMENTATION_CorderPhytoweb.md`](../DOCUMENTATION_CorderPhytoweb.md)) | Lecture seule via l'API |

**Conventions générales**

- **Clé primaire** : `<entité>Id` (UUID). Exceptions : `eventId` (traitements, travaux), `eventParcelsId`, `eventCompositionId`, `userId` (`admins`, `userProfile`), `idUser` (`userPreferences`), `cropId` (`phytowebCategoryOverrides`).
- **Isolation par utilisateur** : colonne `userId`, filtrée dans les requêtes SQL. Exceptions : `userPreferences` (`idUser`), `mandates` (`ownerUserId` / `mandateUserId`), et `formations` et `phytowebCategoryOverrides`, partagées entre tous les utilisateurs et modifiables par les administrateurs.
- **Horodatage** : `createdAt` (`DEFAULT CURRENT_TIMESTAMP`) et `modifiedAt` (`DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`). `admins` n'a que `createdAt`.
- **Quantités, doses et surfaces** : même triplet de colonnes, `xxx` (valeur brute), `xxxUnitId` (unité résolue depuis `unitsIndex`, base Phytoweb) et `standardXxx` (valeur dans l'unité standard, calculée à l'écriture par `app/utils/units.py`).
- **Colonnes nullables** : sauf mention contraire (`NOT NULL`), toutes les colonnes acceptent `NULL`, y compris `userId`.

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
| `parcelArea` | DOUBLE | Surface brute |
| `parcelAreaUnitId` | TEXT | Unité résolue (`unitsIndex.idUnit`) |
| `standardParcelArea` | DOUBLE | Surface standardisée |
| `latitude`, `longitude` | DOUBLE | |
| `polygon` | TEXT | Géométrie sérialisée (GeoJSON / liste de coordonnées) |
| `parcelCategory` | TEXT | |
| `parcelAddress` | TEXT | |
| `recordType` | TEXT | Origine de l'enregistrement (`gml_import`, `PAC_parcel`, `Point_parcel`, `Adress_parcel`, `polygon`) |
| `isArchived` | TINYINT(1) NOT NULL DEFAULT 0 | Parcelle archivée (migration 016) |
| `prevParcelId` | VARCHAR(255) | Parcelle archivée dont celle-ci est le renouvellement, « Archiver et renouveler » (migration 016) |
| `sigecCode` | VARCHAR(50) | Code SIGEC (migration 016) |
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
| `previousCrop` | VARCHAR(255) | Précédent cultural (migration 008) |
| `efficiency` | TEXT | |
| `collection` | TEXT | Année de semis déduite, ou `"Cultures"` |
| `phytowebId` | VARCHAR(255) | Référence au catalogue Phytoweb (voir [Points d'attention](#points-dattention)) |
| `eppo` | TEXT | Code EPPO |
| `isArchived` | TINYINT(1) DEFAULT 0 | |
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
| `eventType` | TEXT | Mode d'encodage : `phyto_surface_treatment`, `phyto_porridge_treatment`, `phyto_quantity_treatment` |
| `eventDate` | DATE | |
| `eventTime` | TIME | |
| `operatorId` | TEXT | FK logique vers `operators` |
| `treatmentTotalQuantity`, `treatmentTotalQuantityUnitId`, `standardTreatmentTotalQuantity` | DOUBLE, TEXT, DOUBLE | Total prévu (migration 009 pour l'unité et le standard) |
| `treatmentTotalQuantityUsed`, `treatmentTotalQuantityUsedUnitId`, `standardTreatmentTotalQuantityUsed` | DOUBLE, TEXT, DOUBLE | Total utilisé (migration 009 pour l'unité et le standard) |
| `surfaceTreated`, `standardSurfaceTreated` | DOUBLE | |
| `remarks` | TEXT | |
| `cleanFlag`, `localizedTreatment` | TINYINT(1) | |
| `decisionBase`, `effectiveness` | TEXT | |
| `thirdPartFlag` | TINYINT(1) NOT NULL DEFAULT 0 | Traitement effectué par un tiers : à 1, sa composition est exclue du calcul d'inventaire (migration 012) |
| `treatmentType` | VARCHAR(50) NOT NULL DEFAULT 'pulvérisation' | Méthode d'application (pulvérisation, traitement de semences, microgranulé, arrosage, irrigation, badigeonnage, injection, trempage), validée par l'API (migration 013) |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `phytoTreatmentsParcelsCrops` (parcelles/cultures concernées par un traitement)
| Colonne | Type | Description |
|---|---|---|
| `eventParcelsId` | VARCHAR(255) PK | |
| `eventId` | VARCHAR(255) | FK logique vers `phytoTreatments` |
| `userId` | VARCHAR(255) | |
| `parcelId`, `parcelName` | VARCHAR(255), TEXT | |
| `cropId`, `cropName`, `phytowebCropName` | VARCHAR(255), TEXT, TEXT | |
| `treatmentQuantity`, `treatmentQuantityUnitId`, `standardTreatmentQuantity` | DOUBLE, TEXT, DOUBLE | Quantité appliquée sur cette parcelle |
| `surfaceTreated`, `surfaceTreatedUnitId`, `standardSurfaceTreated` | DOUBLE, TEXT, DOUBLE | Surface traitée sur cette parcelle (migration 009) |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `phytoTreatmentsComposition` (produits appliqués lors d'un traitement)
| Colonne | Type | Description |
|---|---|---|
| `eventCompositionId` | VARCHAR(255) PK | |
| `eventId` | VARCHAR(255) | FK logique vers `phytoTreatments` |
| `userId` | VARCHAR(255) | |
| `productId`, `productName`, `productNumAut` | VARCHAR(255), TEXT, TEXT | Produit Phytoweb (`act_...`, ou ancien `ppp-...`) ou personnel (`perso-...`) |
| `productDose`, `productDoseUnitId`, `standardProductDose` | DOUBLE, TEXT, DOUBLE | |
| `productQuantity`, `productQuantityUnitId`, `standardProductQuantity` | DOUBLE, TEXT, DOUBLE | |
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
| `eventDose`, `eventDoseUnitId`, `standardEventDose` | DOUBLE, TEXT, DOUBLE | `standardEventDose` : migration 007 |
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
| `productId` | TEXT | Produit Phytoweb (`act_...`, ou ancien `ppp-...`) ou personnel (`perso-...`) |
| `operationType` | TEXT | `"purchase"` (achat/ajout, +), `"ppnu"`/`"ppnv"` (déclaration réglementaire, suivie à part) ou `"correction"` (correction de stock, sens dans `correctionMode`) |
| `operationDate` | DATE | |
| `quantity`, `quantityUnitId`, `standardQuantity` | DOUBLE, TEXT, DOUBLE | `quantity` toujours > 0 |
| `correctionMode` | VARCHAR(10) | `"plus"`/`"minus"` pour une correction, `NULL` sinon (migration 011) |
| `remarks` | TEXT | Remarque libre, saisie avec les corrections, `NULL` si vide (migration 018) |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

> Il n'existe **pas** de table de stock matérialisée. La consommation par traitement phytosanitaire n'est **pas** stockée ici : elle est lue directement depuis `phytoTreatmentsComposition` (jointe à `phytoTreatments` pour la date), jamais dupliquée. Le stock courant est recalculé à la volée en combinant les deux sources dans `app/utils/inventory_stock.py`.

### `personalProducts` (produits hors catalogue Phytoweb, migration 006)
| Colonne | Type | Description |
|---|---|---|
| `productId` | VARCHAR(255) PK | Préfixé `perso-` |
| `userId` | VARCHAR(255) | |
| `productName`, `productType` | TEXT | |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `userProfile` (informations du compte, migration 003)
| Colonne | Type | Description |
|---|---|---|
| `userId` | VARCHAR(255) PK | Une ligne par utilisateur |
| `phytolicence` | TEXT | Numéro de phytolicence |
| `exploitingNumber` | TEXT | Numéro d'exploitant |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

### `userPreferences` (préférences d'encodage, migration 014)
| Colonne | Type | Description |
|---|---|---|
| `idUser` | VARCHAR(255) PK | Id UserKey de l'utilisateur (même valeur que `userId` des autres tables) |
| `erRiWarningFlag` | TINYINT(1) NOT NULL DEFAULT 0 | Respecte la campagne Eco-régime réduction d'intrants → avertir sur les produits `general.erRiFlag = 1` |
| `spe8HourWarningFlag` | TINYINT(1) NOT NULL DEFAULT 1 | Afficher les avertissements horaires (`general.spe8FlagHoraire`) |
| `bbchWarningFlag` | TINYINT(1) NOT NULL DEFAULT 1 | Afficher les avertissements BBCH (`crops.bbchFlag`, corderPhytoweb) |
| `defaultTreatmentType` | VARCHAR(20) NOT NULL DEFAULT 'surface' | Mode d'encodage présélectionné : `surface` / `porridge` / `quantity` |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

> Initialisée par la migration pour tous les `userId` présents dans les tables de données. Un utilisateur sans ligne reçoit les valeurs par défaut via l'API ; sa ligne est créée à son premier `PUT /user_preferences`. Remplace l'ancienne table `preferences` (migration 003, jamais alimentée), supprimée par la migration 015.

### `mandates` (délégation d'accès, migration 002)
| Colonne | Type | Description |
|---|---|---|
| `mandateId` | VARCHAR(255) PK | |
| `mandateName` | TEXT | |
| `ownerUserId` | VARCHAR(255) NOT NULL | Propriétaire de l'espace (indexé) |
| `ownerUserMail` | VARCHAR(255) | |
| `mandateUserId` | VARCHAR(255) | Mandataire, renseigné quand il répond à l'invitation (indexé) |
| `mandateUserMail` | VARCHAR(255) NOT NULL | Mandataire invité (indexé) |
| `status` | VARCHAR(20) NOT NULL DEFAULT 'pending' | `pending`, `accepted` ou `refused` |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

> Un mandat `accepted` permet au mandataire d'agir sur les données du propriétaire via l'en-tête `X-Workspace-UserId` (voir `app/auth.py`).

### `admins` (migration 001)
| Colonne | Type | Description |
|---|---|---|
| `userId` | VARCHAR(255) PK | Présence d'une ligne = administrateur |
| `createdAt` | TIMESTAMP | |

### `formations` (migration 004)
| Colonne | Type | Description |
|---|---|---|
| `formationId` | VARCHAR(255) PK | |
| `day`, `month` | TEXT | Date affichée |
| `title`, `location`, `time`, `link` | TEXT | |
| `orderIndex` | INT DEFAULT 0 | Ordre d'affichage |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

> Table partagée, sans `userId`, exposée par `app/routes/formations.py`.

### `phytowebCategoryOverrides` (surcharge du catalogue de cultures, migration 005)
| Colonne | Type | Description |
|---|---|---|
| `cropId` | VARCHAR(255) PK | `= initialCropId` pour une surcharge de visibilité, `pwc-<uuid>` pour une catégorie personnalisée |
| `initialCropId` | VARCHAR(255) NOT NULL | `idCrop` Phytoweb d'origine (indexé) |
| `nameFr` | TEXT | Nom affiché |
| `eppoCode`, `hierarchyIdList` | TEXT | Métadonnées saisies par l'administrateur |
| `visibleStatut` | TINYINT(1) DEFAULT 1 | Visibilité dans le sélecteur de culture |
| `createdAt`, `modifiedAt` | TIMESTAMP | |

> Table partagée, sans `userId`. Elle ne contient que les surcharges : le référentiel lui-même reste dans `c2544857c_corderPhytoweb` (`indexCrop`).

---

## Tables de sauvegarde

Présentes en production, **sans clé primaire et utilisées par aucune route ni aucun script du dépôt**. Il s'agit de copies faites avant d'anciens traitements de données. Leur structure correspond à celle de la table d'origine **à l'époque de la copie**, sans les colonnes ajoutées depuis :

| Table | Copie de | Différence notable |
|---|---|---|
| `parcelsBackup` | `parcels` | Sans `isArchived`, `prevParcelId`, `sigecCode` |
| `inventoriesOperationsBackup` | `inventoriesOperations` | Colonne `product_id` au lieu de `productId`, sans `correctionMode` |
| `phytoTreatmentsCompositionbackUp` | `phytoTreatmentsComposition` | Structure identique |
| `phytoTreatmentsCompositionbackUpPhase2` | `phytoTreatmentsComposition` | Structure identique |
| `phytoTreatmentsParcelsCropsBackup` | `phytoTreatmentsParcelsCrops` | Sans les colonnes de surface |

---

## Relations entre tables

Aucune contrainte `FOREIGN KEY` n'est déclarée en base (choix assumé du projet : « pas d'ORM lourd, lisibilité maximale »). Les relations sont **logiques**, portées uniquement par convention de nommage :

```
crops         *──* parcels          via cropsParcels
parcels       1──0..1 parcels       (parcels.prevParcelId : renouvellement d'une parcelle archivée)

phytoTreatments 1──* phytoTreatmentsParcelsCrops   (.eventId)
phytoTreatments 1──* phytoTreatmentsComposition    (.eventId)
phytoTreatmentsComposition ──> inventoriesOperations (pas de FK : consommation lue en direct
                                                       depuis phytoTreatmentsComposition,
                                                       jamais copiée dans inventoriesOperations)

fieldWorks    1──* fieldWorksParcelsCrops          (.eventId)

operators     1──* phytoTreatments  (phytoTreatments.operatorId)

Vers le service externe UserKey (comptes utilisateurs, pas de table locale) :
  userId (toutes les tables de données), userProfile.userId, userPreferences.idUser, admins.userId,
  mandates.ownerUserId, mandates.mandateUserId

Vers c2544857c_corderPhytoweb :
  crops.phytowebId                        ──> indexCrop.idCrop (voir Points d'attention)
  phytowebCategoryOverrides.initialCropId ──> indexCrop.idCrop
  *.productId                             ──> general.idAct    (voir Points d'attention)
  *UnitId                                 ──> unitsIndex.idUnit
```

Les données des utilisateurs sont filtrées par `userId` au niveau applicatif (les routes ajoutent `WHERE userId = %s`).

---

## Différences avec l'ancien système

L'ancien système (`previousServer/`) stockait tout en **fichiers JSON plats** sur disque (un fichier par ressource, ex. `parcels.json`, `phyto_treatments.json`), sans base relationnelle pour les données applicatives. Le nouveau schéma introduit une vraie normalisation. Principaux changements par ressource :

| Ressource | Ancien système | Nouveau schéma |
|---|---|---|
| **Exploitations** | JSON, champs incohérents (`adress`, `tva`, `postal`...) | Table `exploitations`, colonnes normalisées en anglais camelCase |
| **Parcelles** | JSON, `place_id` numérique + `id_parcel` UUID coexistants, `polygone`/`polygon` incohérents | Table `parcels`, UUID unique (`parcelId`), `polygon` unifié, surface toujours standardisée (`standardParcelArea`) |
| **Cultures** | 2 fichiers séparés `crops.json` / `cropsArchive.json` avec des **schémas de champs différents** (`eppo` vs `EPPOCode`, `is_archived` vs `isArchived`...), parcelles liées par une liste d'UUID embarquée | Une seule table `crops` + table de liaison `cropsParcels` (N-N normalisée), archivage via simple flag `isArchived` |
| **Traitements phyto** | 1 objet JSON par événement avec `parcels_concerned[]` et `treatment_composition[]` **imbriqués** | 3 tables normalisées : `phytoTreatments`, `phytoTreatmentsParcelsCrops`, `phytoTreatmentsComposition` |
| **Travaux aux champs** | 1 objet JSON par événement avec `parcels_concerned[]` imbriqué | 2 tables : `fieldWorks`, `fieldWorksParcelsCrops` |
| **Inventaire** | 1 objet JSON par produit/exploitation avec un `event_history[]` imbriqué mélangeant achats et consommations | Table à plat `inventoriesOperations`, un mouvement par ligne, stock recalculé à la volée |
| **Produits personnalisés** | Fichier JSON dédié | Table `personalProducts` |
| **Profil et préférences** | `users_infos.json`, `users_pref.json` | Tables `userProfile` et `userPreferences` |
| **Mandats** | `mandats.json` | Table `mandates` |
| **Administrateurs** | Valeurs codées en dur dans le frontend | Table `admins`, vérifiée côté serveur |
| **Unités** (surfaces, doses, quantités) | Stockées en texte libre (`"ha"`, `"L/ha"`...), jamais converties dans une unité commune | Chaque quantité a son triplet `xxx` / `xxxUnitId` / `standardXxx`, résolu et calculé **à l'écriture** par `app/utils/units.py` contre le référentiel `unitsIndex` (`c2544857c_corderPhytoweb`) |
| **Identifiants** | Mélange d'IDs numériques (`place_id`), de chaînes courtes (`event_id: "ae316e58"`) et d'UUID selon les ressources | UUID pour les nouvelles lignes |
| **Isolation utilisateur** | Champ `id_user` dans chaque enregistrement JSON, filtrage applicatif côté PHP | Colonne `userId`, même principe, filtrage SQL |
| **Concurrence** | Écritures atomiques avec verrou sur fichier temporaire | Transactions MySQL standard (`commit`/`rollback`) |

---

## Historique du schéma

**Évolutions : [`server/migrations/`](../migrations/)**

| Migration | Contenu |
|---|---|
| 000 | Schéma complet pour le développement local (pas à passer en production) |
| 001 | Table `admins` |
| 002 | Table `mandates` |
| 003 | Tables `userProfile` et `preferences` (cette dernière supprimée depuis) |
| 004 | Table `formations` |
| 005 | Table `phytowebCategoryOverrides` |
| 006 | Table `personalProducts` |
| 007 | `fieldWorks.standardEventDose` |
| 008 | `crops.previousCrop` |
| 009 | Surface par parcelle et unités des totaux de traitement |
| 010 | Corrections de `unitsIndex` (**base Phytoweb**) |
| 011 | `inventoriesOperations.correctionMode` |
| 012 | `phytoTreatments.thirdPartFlag` |
| 013 | `phytoTreatments.treatmentType` |
| 014 | Table `userPreferences`, initialisée pour les utilisateurs existants |
| 015 | Suppression de la table `preferences` |
| 016 | `parcels.isArchived`, `prevParcelId`, `sigecCode` |
| 017 | `userPreferences.pacDeclarationFlag` (supprimée par la 019) |
| 018 | `inventoriesOperations.remarks` |
| 019 | Suppression de `userPreferences.pacDeclarationFlag` |

**Avant les migrations.** Le schéma a connu plusieurs phases, utiles à connaître si d'anciens scripts ou d'anciennes données réapparaissent. Les scripts et documents cités ici (`database/init_first_db.py`, `generate_first_db.py`, `unit*.py`, `json_db/`, `MIGRATION_PLAN.md`) **ne sont pas présents dans ce dépôt** :

1. **Schéma initial** défini dans `database/init_first_db.py`, peuplé une première fois depuis `json_db/*.json` par `generate_first_db.py`, puis « nettoyé » (résolution des unités texte en `idUnit` + calcul des `standardXxx`) par une série de scripts batch : `unitParcelsPGindexer.py`, `unitTreatmentCompositionPGindexerPhase1.py`, `unitTreatmentCompositionPGindexerPhase2.py`, `unitTreatmentsParcelsCrops.py`, `unitInventories.py`.
2. **Schéma parallèle**, dénormalisé (snake_case, colonnes `JSON` brutes type `parcels_concerned`), qui a fini par être celui réellement branché derrière la plupart des routes `app/routes/*.py` (sauf `crops`), documenté dans `MIGRATION_PLAN.md` §3.
3. **Réunification** : toutes les routes ont été réalignées sur le schéma normalisé, complété avec les colonnes manquantes. La résolution d'unité se fait désormais **à l'écriture** via `app/utils/units.py`, ce qui rend les scripts batch `unit*.py` inutiles pour tout nouvel enregistrement créé par l'API.

⚠️ **`generate_first_db.py` et les scripts `unit*.py` n'ont pas été mis à jour** pour suivre ces changements de colonnes (ex. `inventoriesOperations.product_id` → `productId`). Si une nouvelle migration `json_db/` → MySQL est relancée, ces scripts doivent d'abord être corrigés.

⚠️ **`exploitationId` n'existe pas** sur `parcels`/`operators`/`fieldWorks`/`phytoTreatments`/`inventoriesOperations`. Aucune de ces tables ne rattache ses lignes à une `exploitations` précise : tout est filtré uniquement par `userId`.

---

## Points d'attention

- **Identifiants de produits `ppp-...`** : au 04/11/2026, 1 976 mouvements d'`inventoriesOperations` et 2 036 lignes de `phytoTreatmentsComposition` portent un `productId` `ppp-...`, l'ancien format. **Aucun n'existe dans `general.idAct`**, qui n'utilise que `act_...`, et les nouvelles saisies utilisent `act_...`. Conséquences : un même produit peut avoir deux identifiants, donc deux entrées d'inventaire et deux stocks distincts ; aucun avertissement Phytoweb n'est calculé pour un `ppp-...` ; la détection de doublons de l'import d'achats ne compare pas les `ppp-...` aux `act_...`. `phytoTreatmentsComposition` conserve `productName` et `productNumAut`, ce qui permet de retrouver le produit. `inventoriesOperations` ne contient que `productId`.
- **`crops.phytowebId` au format `pwc-...`** : la grande majorité des cultures portent un identifiant de l'ancien référentiel (`pwc-<uuid>`), absent d'`indexCrop` (`pwc_<uuid>`). `app/utils/phytoweb_crops.py` les rattache par leur nom, via `app/data/legacy_phytoweb_crop_names.json`. Les catégories génériques (« céréales », « grandes cultures »…) ne peuvent pas être rattachées.
- **`cropsArchive.json` n'a été importé par aucun script** (`generate_first_db.py` ne lisait que `crops.json`) : à vérifier si des cultures archivées manquent en base suite à la migration historique.
- **Champs de l'ancien système sans équivalent** dans le nouveau schéma, donc définitivement perdus si non re-capturés côté client : `imported_from_gml` (parcelles, déduit aujourd'hui de `recordType`), `component_type`/catégorie de produit, `harvest_date`/`bbch`/métadonnées techniques (traitements), `observation` (travaux aux champs). Le `sigec_code` a retrouvé une colonne `sigecCode` avec la migration 016, mais les codes de l'ancien système n'ont pas été repris.
- **`responsibleName`/`responsibleMail`/`responsiblePhytolicence`/`exploitationPhytolicence`** étaient toujours `NULL` après l'import batch historique (clés JSON sources inexistantes). Cela ne concerne pas les nouveaux enregistrements créés via l'API.
- **Aucune contrainte `FOREIGN KEY` ni `UNIQUE`** en base (seulement les clés primaires et 4 index simples sur `mandates` et `phytowebCategoryOverrides`) : l'intégrité référentielle (`userId`, `parcelId`...) est garantie uniquement par le code applicatif. Les colonnes `userId` et `parcelId` ne sont pas indexées en production.
- **Base partagée entre production et développement** : aujourd'hui, un poste de développement configuré sur cette base travaille sur les vraies données. Activer `READONLY_MODE=true` dans `server/.env.local` bloque les écritures passant par l'API.
