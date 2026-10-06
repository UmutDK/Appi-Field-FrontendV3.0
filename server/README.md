# Documentation Backend — AppiField, organisée par sections frontend

Ce document décrit le backend Flask de `server/app/` **en suivant l'organisation de l'application côté frontend** (Accueil, Parcelles, Registre, Inventaire, Réglages), plutôt que par ressource technique. Il complète — sans les remplacer — les deux documents techniques existants :

- [`server/app/API_DOCUMENTATION.md`](app/API_DOCUMENTATION.md) — référence API complète, organisée par ressource backend (modèles, endpoints, exemples JSON). Ce document y renvoie systématiquement au lieu de dupliquer ce qui y est déjà bien documenté.
- [`server/app/DATABASE_STRUCTURE.md`](app/DATABASE_STRUCTURE.md) — schéma détaillé des tables, relations, historique des migrations.

`server/DOCUMENTATION_CorderPhytoweb.md` documente un projet distinct (le pipeline ETL qui alimente `c2544857c_corderPhytoweb`) et n'est pas couvert ici.

## Sommaire

1. [Introduction](#introduction)
2. [Accueil](#accueil)
   - [Référentiels publics — `/index`](#référentiels-publics--index)
   - [Opérateurs — `/operators`](#opérateurs--operators)
   - [Formations — `/formations`](#formations--formations)
   - [Vérification de session — `/session`](#vérification-de-session--session)
3. [Parcelles](#parcelles)
   - [CRUD parcelles — `/parcels`](#crud-parcelles--parcels)
   - [Import GML (PAC / MR14)](#import-gml-pac--mr14)
4. [Registre (carnet de champ)](#registre-carnet-de-champ)
   - [Cultures — `/crops`](#cultures--crops)
   - [Traitements phytosanitaires — `/phyto_treatments`](#traitements-phytosanitaires--phyto_treatments)
   - [Travaux aux champs — `/field_works`](#travaux-aux-champs--field_works)
   - [Export du registre — `/exports/registre`](#export-du-registre--exportsregistre)
5. [Inventaire](#inventaire)
   - [Mouvements de stock — `/inventories`](#mouvements-de-stock--inventories)
   - [Produits personnalisés — `/personal_products`](#produits-personnalisés--personal_products)
   - [Calcul du stock](#calcul-du-stock)
   - [Export de l'inventaire — `/exports/inventaire`](#export-de-linventaire--exportsinventaire)
6. [Réglages](#réglages)
   - [Exploitations — `/exploitations`](#exploitations--exploitations)
   - [Profil utilisateur — `/user_profile`](#profil-utilisateur--user_profile)
   - [Préférences — `/preferences`](#préférences--preferences)
   - [Mandats (délégation d'accès) — `/mandates`](#mandats-délégation-daccès--mandates)
   - [Liaison WalleSmart — `/wallesmart`](#liaison-wallesmart--wallesmart)
7. [Administration](#administration)

---

## Introduction

Le backend est une **API REST Flask** (`server/app/`, factory `create_app()` dans `app/__init__.py`), qui expose des ressources JSON pour la gestion d'exploitations agricoles : parcelles, cultures, traitements phytosanitaires, travaux aux champs, inventaire de produits, et les données de compte/réglages associées.

### Deux bases MySQL

Confirmé dans `app/db.py` (`os.getenv("DB_APPIFIELD")` / `os.getenv("DB_PHYTOWEB")`) :

| Base | Rôle | Accès |
|---|---|---|
| `c2544857c_appifield` | Données applicatives des utilisateurs (exploitations, parcelles, cultures, traitements, travaux, inventaire, réglages, mandats...) | Lecture/écriture |
| `c2544857c_corderPhytoweb` | Référentiels phytosanitaires en lecture seule (produits, cultures, unités, doses, cibles), alimentés par le pipeline ETL externe PhytowebCorder | Lecture seule (exceptionnellement une correction de données ponctuelle, voir [Traitements phytosanitaires](#traitements-phytosanitaires--phyto_treatments)) |

Chaque requête HTTP obtient sa propre connexion par base (pool `mysql.connector`, stockée dans `flask.g`), fermée en fin de requête (`teardown_appcontext`) — nécessaire car le serveur de dev Flask est multi-threadé et une connexion globale partagée provoquait des erreurs de concurrence.

### Authentification

Mécanisme implémenté dans `app/auth.py` :

- Le client envoie `Authorization: Bearer <token>`.
- Le token est vérifié auprès d'un **service externe** (`userkey.corderapp.be/controllers/verification_token.php`, configurable via `AUTH_VERIFY_URL`), qui retourne `Id_User` et `Mail`.
- Le résultat est **mis en cache en mémoire** process (dictionnaire `_token_cache`, clé = MD5 du token) pendant `TOKEN_CACHE_TTL` secondes (1800 par défaut) pour éviter un aller-retour réseau à chaque requête.
- Le décorateur `@require_auth` injecte `user_id` en paramètre de la fonction de route ; **toutes les données sont filtrées par `userId`** en SQL (`WHERE userId = %s`) — un utilisateur ne voit et ne modifie jamais les données d'un autre.
- Variante `@require_auth_self` : comme `@require_auth`, mais **sans** résolution de workspace délégué (voir mandats) — utilisée là où l'identité propre du token doit primer (ex. `/mandates`).
- Variante `@require_admin` : comme `@require_auth`, avec en plus une vérification contre la table `admins` (403 sinon) — voir [Administration](#administration).
- **Délégation multi-compte** : si le header `X-Workspace-UserId: <ownerUserId>` est présent et qu'un mandat `accepted` existe entre ce propriétaire et l'utilisateur du token, `require_auth` substitue `user_id` par celui du propriétaire — le mandataire agit alors "à la place" du owner sur toutes les routes classiques. Voir [Mandats](#mandats-délégation-daccès--mandates).

### Conventions de requête/réponse

- Toutes les routes retournent du JSON. Les listes/lectures renvoient directement l'objet ou le tableau demandé ; les écritures renvoient `{ "success": true, ... }` (avec l'id créé/modifié).
- Erreurs : `401` (token absent/invalide), `403` (accès refusé — admin ou mandat), `404` (ressource introuvable ou non possédée), `400` (champ obligatoire manquant), toujours sous la forme `{ "error": "<message>" }`. Un handler global couvre aussi `404`/`405`/`500` génériques (`app/__init__.py`).
- **Convention d'unités**, commune à `parcels`, `phyto_treatments`, `field_works`, `inventories` : le client envoie le **nom** de l'unité dans un champ `*Unit` (ex. `"ha"`, `"L/ha"`) ; le serveur (`app/utils/units.py`) résout ce nom contre `unitsIndex` (`c2544857c_corderPhytoweb`), stocke l'`idUnit` dans `*UnitId`, et calcule `standardXxx = valeur × normalisationFactor` à l'écriture. Détail complet dans [API_DOCUMENTATION.md](app/API_DOCUMENTATION.md#référentiels-publics--index).
- Aucune contrainte `FOREIGN KEY` en base : l'isolation par utilisateur et l'intégrité référentielle sont garanties uniquement par le code applicatif (voir [DATABASE_STRUCTURE.md](app/DATABASE_STRUCTURE.md)).

Les sections suivantes reprennent ce backend **du point de vue des zones du frontend**, dans l'ordre où un utilisateur les rencontre : Accueil, Parcelles, Registre, Inventaire, Réglages, puis une section Administration à part.

---

## Accueil

La zone Accueil regroupe les données de premier chargement / tableau de bord : les référentiels phytosanitaires publics (chargés une fois et utilisés dans toute l'application), les opérateurs de l'exploitation (personnes habilitées à intervenir, réutilisées dans le registre), le calendrier de formations affiché en page d'accueil, et une route de vérification de session.

### Référentiels publics — `/index`

Implémentés dans `app/routes/public.py`, aucune authentification requise, toujours en lecture seule contre `c2544857c_corderPhytoweb`.

⚠️ **Écart avec `API_DOCUMENTATION.md`** : ce dernier décrit un schéma `products`/`crops`/`dosesMinMax`/`enemies`/`bbchWarnings` qui ne correspond **pas** au schéma réel de `c2544857c_corderPhytoweb` (le docstring de `public.py` le signale explicitement). Le tableau ci-dessous décrit le comportement réellement implémenté :

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/index/units` | 🌐 | Table `unitsIndex` (`idUnit`, `unitName`, `normalisationFactor`) — référentiel des unités |
| `GET` | `/index/phytoweb_products` | 🌐 | Actes d'autorisation les plus récents (`general` où `mostRecentAct = 1`), enrichis d'un `authorizationStatus` calculé et de `useToleranceDate` (jointure sur `dates`) |
| `GET` | `/index/phytoweb_products/search` | 🌐 | Recherche par nom commercial ou n° d'autorisation. Query : `?q=` (obligatoire, sinon `[]`), `?limit=` (défaut 50, max 200) |
| `GET` | `/index/phytoweb_crops` | 🌐 | Catalogue **dédupliqué** des cultures (`indexCrop`) |
| `GET` | `/index/doseminmax` | 🌐 | Doses min/max par produit/culture/cible (jointure `targets`/`crops`/`general`). Query optionnels : `?numAut=`, `?idAct=`, `?cropName=` |
| `GET` | `/index/enemies` | 🌐 | Catalogue dédupliqué des cibles/ravageurs (`indexTarget`) |
| `GET` | `/index/crop_authorizations` | 🌐 | Cultures autorisées + dose max + stade d'application (BBCH, `cropApplicationStade`) pour un acte donné. Query : `?idAct=` (obligatoire, sinon `[]`) |

Points notables non couverts par `API_DOCUMENTATION.md` :

- **`authorizationStatus`** (route `/phytoweb_products`) est un champ calculé, pas une colonne : `forbidden` si `statut = 'Retrait'`, `withdrawing` si `statut` contient `'Accord'` **et** une `useToleranceDate` existe, `authorized` si `statut` contient `'Accord'`, sinon `unknown`.
- Il n'existe **pas** de route `/index/bbch_warnings` séparée (contrairement à ce que documente `API_DOCUMENTATION.md`) : les avertissements BBCH sont dérivés côté frontend à partir de `cropApplicationStade`, exposé par `/index/crop_authorizations`. De même, il n'existe aucune donnée d'heure d'application dans le référentiel ETL ; l'ancien avertissement horaire est désormais dérivé côté frontend de `general.spe8Flag`.
- `/index/phytoweb_products/search` et `/index/crop_authorizations` ne sont pas documentées dans `API_DOCUMENTATION.md`.

### Opérateurs — `/operators`

Personnes habilitées à intervenir (nom + n° de licence phyto), réutilisées comme référence dans les traitements phytosanitaires (`phytoTreatments.operatorId`). CRUD simple, entièrement documenté dans [API_DOCUMENTATION.md § Opérateurs](app/API_DOCUMENTATION.md#opérateurs--operators) — rien à ajouter côté logique métier.

### Formations — `/formations`

Calendrier de formations affiché en Accueil/back-office (`app/routes/formations.py`), **absent d'`API_DOCUMENTATION.md`**. Remplace l'ancien `previousServer/formations_manager.php`, qui n'avait aucune authentification.

- Lecture (`GET /formations`) : réservée aux utilisateurs authentifiés (`@require_auth`), triée par `orderIndex`.
- Écriture (`POST`/`PUT`/`DELETE`/déplacement) : réservée aux administrateurs (`@require_admin`), voir [Administration](#administration).

⚠️ **`DATABASE_STRUCTURE.md` documente un schéma erroné** pour cette table (`formationName`, `formationLocation`, `formationDuration`, `infoLink`) : au moment où ce document a été écrit, la table n'était pas encore exposée par une route API. Le schéma **réellement utilisé** (migration `004_add_formations_table.sql`, suit le contrat du frontend Angular) est :

| Colonne | Type | Description |
|---|---|---|
| `formationId` | VARCHAR(255) PK | UUID |
| `day` / `month` | TEXT | Date d'affichage, en deux champs texte libres |
| `title` | TEXT | Titre de la formation |
| `location` | TEXT | Lieu |
| `time` | TEXT | Horaire |
| `link` | TEXT | Lien d'inscription/info |
| `orderIndex` | INT | Position d'affichage (géré par `/formations/<id>/move`) |
| `createdAt` / `modifiedAt` | TIMESTAMP | Horodatage |

#### Endpoints

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/formations` | 🔒 | Liste triée par `orderIndex` |
| `POST` | `/formations` | 🔒 admin | Crée une formation en fin de liste (`orderIndex` = max + 1) |
| `PUT` | `/formations/<id>` | 🔒 admin | Modifie tous les champs (sauf `orderIndex`) |
| `DELETE` | `/formations/<id>` | 🔒 admin | Supprime |
| `PUT` | `/formations/<id>/move` | 🔒 admin | Body `{ "direction": "up" \| "down" }` — permute `orderIndex` avec le voisin immédiat dans ce sens ; no-op si déjà en bout de liste |

### Vérification de session — `/session`

`GET /session/verify` 🔒 (`app/routes/session.py`) — remplace l'ancien proxy CORS `previousServer/verify_session.php` vers UserKey. Comme le token est déjà validé par `@require_auth` lui-même, la route ne fait qu'un aller-retour local : elle retourne `{ "valid": true, "userId": "<id>" }` sans second appel réseau.

---

## Parcelles

Gestion des parcelles agricoles de l'exploitation : nom, surface, géométrie (coordonnées), catégorie, et l'import en masse depuis un fichier GML officiel (PAC wallon).

### CRUD parcelles — `/parcels`

Modèle et endpoints CRUD standards entièrement documentés dans [API_DOCUMENTATION.md § Parcelles](app/API_DOCUMENTATION.md#parcelles--parcels) (`GET`/`POST`/`PUT`/`DELETE /parcels[/<id>]`). Rappel des points clés :

- `parcelArea` est fourni avec son unité (`parcelAreaUnit`, ex. `"ha"`) ; `parcelAreaUnitId` et `standardParcelArea` sont calculés à l'écriture.
- `polygon` est stocké sérialisé en JSON (liste de coordonnées ou GeoJSON) — `app/routes/parcels.py::_serialize_polygon` accepte indifféremment `list`/`dict` en entrée.
- `recordType` distingue l'origine de l'enregistrement (ex. `"gml_import"` pour les parcelles importées, voir ci-dessous).

### Import GML (PAC / MR14)

`POST /parcels/import_gml` 🔒 — endpoint non documenté dans `API_DOCUMENTATION.md`. Importe en masse les parcelles d'un fichier GML officiel wallon (PAC), remplaçant `previousServer/gml_import.php` (qui utilisait `proj4php`) par `pyproj` côté Python.

**Requête** : `multipart/form-data`, champ `gml_file` — un fichier `.gml`, taille max 10 Mo.

**Réponse 201** : `{ "success": true, "imported": <n>, "parcelIds": ["...", ...] }`

Logique de parsing (`app/utils/gml_import.py`) :

1. **Détection du format** par recherche du premier élément `PARCEL` (format **V1**, ancien PAC) ou `PARCELLE_MR14` (format **V2**, nouveau MR14) dans l'arbre XML, indépendamment des espaces de noms.
2. **Extraction de la géométrie** : lecture de `posList` (liste plate de coordonnées) ou `coordinates` (paires `x,y` séparées par des espaces) selon ce qui est présent.
3. **Calcul de la surface** par la formule du lacet (shoelace formula) sur le polygone, convertie en hectares (`/10000`), arrondie à 2 décimales.
4. **Conversion de projection** : les coordonnées sources sont en Lambert 72 (EPSG:31370, projection officielle belge) ; converties en WGS84 (EPSG:4326, latitude/longitude) via `pyproj.Transformer`. En V2, la conversion n'est appliquée que si l'attribut `srsName` du polygone contient `"31370"` — sinon les coordonnées sont supposées déjà en WGS84.
5. **Catégorisation** :
   - V1 : `TYPE_COUVERTURE` mappé vers un libellé français via une table de correspondance fixe (`PRAIRIE_PERM_90_100` → *Prairie permanente*, `TERRE_ARABLE` → *Terre arable*, etc.), `"Plein air"` par défaut si non reconnu.
   - V2 : `MAINCROPCODE` mappé vers un libellé via une table de codes numériques (`610` → *Prairie permanente*, `311`/`351`/`901`/`3912` → *Terre arable*), sinon déduit du nom de culture (`"prairie"` dans `MAINCROPNAME` → *Prairie permanente*), sinon `"Plein air"`.
6. Chaque parcelle extraite est convertie au format attendu par `POST /parcels` (`parcelName`, `parcelArea`, `parcelAreaUnit: "ha"`, `parcelCategory`, `parcelAddress`, `latitude`/`longitude`, `polygon`, `recordType: "gml_import"`), puis insérée avec la même fonction interne que la création manuelle (`_insert_parcel`) — dans **une seule transaction** commitée une fois toutes les parcelles insérées.

Le nom de la parcelle est dérivé de `PRC_ID`/`PRC_NMR` en V1 (préfixe `Parcelle_`, doublon `Parcelle_` nettoyé s'il est déjà présent), ou de `PARCELNAME`/`PARCELNUMBER` en V2.

---

## Registre (carnet de champ)

Le « carnet de champ » réglementaire : ce qui a été cultivé, avec quels produits phytosanitaires, et quels autres travaux ont été réalisés sur chaque parcelle — la partie la plus dense du backend, avec trois sous-domaines liés (cultures, traitements phyto, travaux) et un export dédié.

### Cultures — `/crops`

Modèle et endpoints CRUD entièrement documentés dans [API_DOCUMENTATION.md § Cultures](app/API_DOCUMENTATION.md#cultures--crops) — actives (`GET /crops`) vs archivées (`GET /crops/archive`), liaison N-N avec les parcelles via `cropsParcels`, archivage par flag `isArchived`.

Un champ existe en base et est accepté en écriture (`app/routes/crops.py`) mais n'apparaît pas dans `API_DOCUMENTATION.md` : **`previousCrop`** (précédent cultural, VARCHAR(255), ajouté par la migration `008_add_crops_previous_crop.sql` — saisi côté frontend mais jusque-là jamais persisté).

#### Résolution du nom de culture Phytoweb (`phytowebName`)

Non documentée ailleurs : chaque culture a un `phytowebId` optionnel, référençant une entrée du référentiel Phytoweb. À la lecture (`GET /crops`, `/crops/archive`, `/crops/<id>`), le backend résout un nom lisible `phytowebName` en cascade à travers **trois sources**, dans cet ordre :

1. **`indexCrop`** (`c2544857c_corderPhytoweb`) — référentiel officiel courant.
2. **`phytowebCategoryOverrides`** (`c2544857c_appifield`) — catégories ajoutées/personnalisées par un administrateur (voir ci-dessous), absentes d'`indexCrop`.
3. **Mapping legacy** en mémoire (`app/data/legacy_phytoweb_crop_names.json`, chargé une fois au premier besoin) — dernier recours pour les cultures créées avant la migration vers `indexCrop`, dont le `phytowebId` (ancien format `pwc-<uuid>`, tiret) ne correspond plus à rien dans le référentiel actuel (`pwc_<uuid>`, underscore).

#### Catégories de cultures Phytoweb — `/phytoweb_categories`

Endpoint non documenté dans `API_DOCUMENTATION.md`, implémenté dans `app/routes/phytoweb_categories.py`. Il ne s'agit **pas** de catégories de produits d'inventaire (malgré ce que son nom pourrait suggérer) mais bien d'une **couche de surcharge sur le référentiel de cultures Phytoweb** utilisée par `/crops` ci-dessus : elle permet à un administrateur de masquer certaines cultures du référentiel officiel ou d'en ajouter des personnalisées, sans jamais modifier `c2544857c_corderPhytoweb` (lecture seule).

`GET /phytoweb_categories` 🔒 fusionne à la volée :
- le catalogue Phytoweb dédupliqué (`indexCrop`, `idCrop`/`cropName`) — chaque entrée devient `{ cropId, initialCropId: cropId, nameFr, visibleStatut }`, `visibleStatut` valant `true` sauf surcharge explicite ;
- les lignes de `phytowebCategoryOverrides` dont le `cropId` ne correspond à aucune entrée `indexCrop` — ce sont les **catégories personnalisées** (`cropId != initialCropId`, préfixées `pwc-`), ajoutées par un admin pour des cultures absentes du référentiel officiel.

Écriture réservée aux administrateurs (`@require_admin`) :

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/phytoweb_categories` | 🔒 | Référentiel fusionné (voir ci-dessus) |
| `POST` | `/phytoweb_categories` | 🔒 admin | Crée une catégorie personnalisée. Body : `{ nameFr, initialCropId, eppoCode?, hierarchyIdList? }` |
| `PUT` | `/phytoweb_categories/<cropId>` | 🔒 admin | Modifie `nameFr` et/ou `visibleStatut`. Une catégorie **initiale** (`cropId == initialCropId`) n'accepte que `visibleStatut` (`403` si tentative de renommage) |
| `DELETE` | `/phytoweb_categories/<cropId>` | 🔒 admin | Supprime une catégorie personnalisée (`403` si catégorie initiale) |

Modèle `phytowebCategoryOverrides` (table `c2544857c_appifield`, migration `005_add_phytoweb_category_overrides_table.sql`) :

| Colonne | Type | Description |
|---|---|---|
| `cropId` | VARCHAR(255) PK | `= initialCropId` pour une surcharge de visibilité, ou `pwc-<uuid>` pour une catégorie personnalisée |
| `initialCropId` | VARCHAR(255) | Référence à l'`idCrop` Phytoweb d'origine |
| `nameFr` | TEXT | Nom affiché (uniquement modifiable si catégorie personnalisée) |
| `eppoCode`, `hierarchyIdList` | TEXT | Métadonnées additionnelles, saisies par l'admin (sans équivalent dans `indexCrop`, qui n'expose que `idCrop`/`cropName`) |
| `visibleStatut` | BOOLEAN | Visibilité de la catégorie dans le sélecteur frontend |

### Traitements phytosanitaires — `/phyto_treatments`

Modèle, endpoints et exemples JSON entièrement documentés dans [API_DOCUMENTATION.md § Traitements phytosanitaires](app/API_DOCUMENTATION.md#traitements-phytosanitaires--phyto_treatments). Ce qui suit couvre ce que ce document ne détaille pas : **le moteur de calcul des doses/quantités** (`app/utils/treatment_calc/`) et un écart de schéma.

⚠️ **Colonnes non documentées dans `API_DOCUMENTATION.md`/`DATABASE_STRUCTURE.md`** (migration `009_add_treatment_surface_and_quantity_units.sql`) : `phytoTreatmentsParcelsCrops` porte aussi `surfaceTreated`/`surfaceTreatedUnitId`/`standardSurfaceTreated` (surface traitée **par parcelle**, distincte de `treatmentQuantity` qui est une quantité de produit) ; `phytoTreatments` porte aussi `treatmentTotalQuantityUnitId`/`treatmentTotalQuantityUsedUnitId`/`standardTreatmentTotalQuantity`/`standardTreatmentTotalQuantityUsed` (unité et standardisation des totaux). Avant cette migration, le frontend détournait `treatmentQuantity` pour y stocker une surface.

#### Trois modes de saisie, un seul moteur de calcul

`eventType` détermine le mode de saisie du traitement, et donc quel module de `app/utils/treatment_calc/` calcule l'ensemble des champs dérivés (surfaces standardisées, doses, quantités, répartition par parcelle, totaux) :

| `eventType` | Module | Principe |
|---|---|---|
| `phyto_surface_treatment` | `surface.py` | L'utilisateur fixe une **dose par ha** ; tout le reste est dérivé de la surface |
| `phyto_porridge_treatment` | `bouillie.py` | L'utilisateur fixe un **volume de bouillie** (mélange eau + produits) et une dose par 100L/10L |
| `phyto_quantity_treatment` | `quantite.py` | L'utilisateur fixe directement une **quantité totale de produit** ; la dose par ha est déduite |

Le calcul est **intégral à chaque écriture** (`POST`/`PUT`) : plutôt qu'un calcul différentiel ("si tel champ a changé, recalculer tel autre"), toutes les valeurs dérivées sont recalculées depuis les seules valeurs de base propres au mode. `PUT` recharge d'abord l'état existant (parcelles/composition en base, avec leurs unités reconverties en noms) si le payload ne fournit pas `parcelsConcerned`/`treatmentComposition`, pour ne pas écraser silencieusement une valeur personnalisée lors d'une mise à jour partielle. Les lignes filles (`phytoTreatmentsParcelsCrops`, `phytoTreatmentsComposition`) sont ensuite entièrement supprimées puis réinsérées.

**Étape commune aux trois modes** : la surface traitée par parcelle (`resolve_surface` dans `common.py`) utilise la valeur/unité envoyée dans le payload si présente, sinon retombe sur `parcelArea`/`parcelAreaUnitId`/`standardParcelArea` de la parcelle (table `parcels`).

**Mode Surface** (`surface.py`) — le plus direct :
1. Résout la surface de chaque parcelle, additionne pour obtenir la surface totale traitée.
2. Pour chaque produit : `productQuantity = dose_standardisée × surface_totale_standardisée`.
3. Pour chaque parcelle : sa part de quantité de chaque produit = `dose_standardisée × sa_propre_surface_standardisée`, sommées (par unité kg/L, voir ci-dessous).
4. Les totaux du traitement = somme des quantités de tous les produits.

**Mode Bouillie** (`bouillie.py`) — le volume de mélange préparé est la donnée de base :
1. Résout la surface de chaque parcelle (identique au mode Surface).
2. Standardise `treatmentTotalQuantity` (volume préparé) et `treatmentTotalQuantityUsed` (volume réellement utilisé) — saisis par l'utilisateur, pas calculés.
3. Pour chaque produit, la dose est exprimée **par 100L/10L de bouillie** (ex. `"kg/100L"`, `"l/10l"`) : `productQuantity = dose_standardisée × volume_utilisé_standardisé`.
4. La quantité de bouillie affectée à chaque parcelle (`treatmentQuantity`) respecte la répartition explicitement choisie par l'utilisateur (étape "Répartition" du frontend, sliders) si elle est fournie ; à défaut, elle est répartie **au prorata de la part de surface traitée** de chaque parcelle dans la surface totale.

**Mode Quantité** (`quantite.py`) — la quantité totale de produit est la donnée de base, la dose est déduite :
1. Résout la surface de chaque parcelle (identique au mode Surface).
2. Pour chaque produit : `dose_standardisée = quantité_standardisée / surface_totale_standardisée` (dose par ha déduite).
3. Répartition par parcelle identique au mode Surface (dose déduite × surface de la parcelle).

**Conversion dose ↔ quantité (`common.py`)** : une dose/quantité de produit se résout toujours vers l'une de deux unités canoniques, déduites du **nom** de l'unité fournie par le client (heuristique reproduite depuis le frontend) :
- contient `"kg"` ou `"g"` → unité de masse (`"kg"`) ;
- sinon → unité de volume (`"l"`).

En mode Quantité, l'unité de dose déduite est construite en ajoutant `/ha` à cette unité canonique (`dose_per_ha_unit_id`). Quand plusieurs produits d'une composition finissent standardisés dans des unités différentes (ex. certains en kg, d'autres en L), impossible à sommer directement : `sum_standardized_by_unit` **ne retient que le total du bucket dont la somme standardisée est la plus élevée** — même heuristique que le frontend (`hasMultipleUnits`/`firstUnit`).

⚠️ **Correction de données** : la migration `010_fix_unitsindex_bouillie_units.sql` a corrigé, exceptionnellement en écriture sur `c2544857c_corderPhytoweb`, des facteurs de normalisation incohérents pour les unités de bouillie (`kg/100L`, `g/100 l`, `ml/100 l`, `l/10l`) et ajouté l'unité `"g"` manquante — condition préalable au bon fonctionnement du moteur de calcul, qui s'appuie entièrement sur `normalisationFactor`.

### Travaux aux champs — `/field_works`

Modèle et endpoints CRUD entièrement documentés dans [API_DOCUMENTATION.md § Travaux aux champs](app/API_DOCUMENTATION.md#travaux-aux-champs--field_works). Logique simple par rapport aux traitements phyto : une seule dose (`eventDose`/`eventDoseUnit`), standardisée à l'écriture via `resolve_and_standardize` — pas de moteur de calcul multi-mode, pas de composition produits. Les liaisons parcelles/cultures (`fieldWorksParcelsCrops`) sont entièrement remplacées si `parcelsConcerned` est fourni en `PUT`, inchangées sinon.

### Export du registre — `/exports/registre`

`POST /exports/registre` 🔒 (`app/routes/exports.py`, logique dans `app/utils/exports.py`) — non documenté dans `API_DOCUMENTATION.md`. Génère le registre réglementaire (traitements PPP + travaux aux champs) en Excel ou PDF, remplaçant `previousServer/export_clean_new.php`/`export_pdf.php` (PhpSpreadsheet/TCPDF).

**Requête** : Body `{ filters?: { years?: string[], cropNames?: string[], archiveStatus?: 'all'|'archived'|'not-archived', parcels?: string[] } }`. Query `?format=excel` (défaut) ou `?format=pdf`.

**Réponse** : fichier téléchargeable (`registre.xlsx` ou `registre.pdf`).

Contenu : **deux feuilles/tables distinctes** — "Registre PPP" (traitements phytosanitaires, jointure `phytoTreatments` + `phytoTreatmentsParcelsCrops` + `phytoTreatmentsComposition` + `crops` + `parcels` + `operators`, avec le n° de phytolicence et d'exploitant tirés du profil utilisateur) et "Travaux aux champs" (jointure `fieldWorks` + `fieldWorksParcelsCrops` + `crops`). Contrairement à l'ancien export, phyto et travaux ne sont **pas fusionnés** dans une seule feuille : les deux registres sont déjà distincts dans le nouveau schéma normalisé.

Limites connues, assumées dans le code : le stade phénologique (BBCH) n'est plus capturé par le schéma actuel (colonne laissée vide dans l'export) ; l'unité de `surfaceTreated`/`treatmentTotalQuantity` au niveau de l'événement n'est pas non plus stockée séparément côté export (seule la valeur standardisée existe), la cellule "unité" correspondante est donc laissée vide plutôt que de deviner.

---

## Inventaire

Suivi du stock de produits phytosanitaires (et produits personnalisés type engrais) de l'exploitation. Particularité du modèle : **il n'existe aucune table de stock matérialisée** — le stock courant est recalculé à la volée à chaque lecture.

### Mouvements de stock — `/inventories`

Modèle et endpoints entièrement documentés dans [API_DOCUMENTATION.md § Inventaire](app/API_DOCUMENTATION.md#inventaire--inventories). Rappel du principe : `inventoriesOperations` ne contient **que** les mouvements saisis manuellement par l'utilisateur (achats `"purchase"`, déclarations réglementaires `"ppnu"`/`"ppnv"`) — jamais la consommation par traitement phytosanitaire, lue en direct depuis `phytoTreatmentsComposition`.

Point non couvert par `API_DOCUMENTATION.md` : `PUT /inventories/<operationId>` 🔒 existe (mise à jour partielle d'un mouvement manuel — tous les champs optionnels, ceux omis conservent leur valeur actuelle ; `404` si le mouvement n'existe pas ou n'appartient pas à l'utilisateur), en plus du `POST`/`DELETE` déjà documentés.

### Produits personnalisés — `/personal_products`

CRUD entièrement documenté dans [API_DOCUMENTATION.md § Produits personnalisés](app/API_DOCUMENTATION.md#produits-personnalisés--personal_products) — produits hors catalogue Phytoweb (engrais, produits maison), identifiés par un préfixe `perso-`, utilisables comme `productId` dans `/inventories` au même titre qu'un produit Phytoweb (`ppp-...`).

### Calcul du stock

Logique centralisée dans `app/utils/inventory_stock.py::compute_stock_by_product`, partagée par `GET /inventories` et l'export inventaire. Pour chaque produit, **deux sources sont combinées** :

1. **`inventoriesOperations`** (mouvements saisis) :
   - `"purchase"` → ajoute `standardQuantity` (ou `quantity` si la standardisation a échoué) au **stock utilisable** (`stock`).
   - `"ppnu"` / `"ppnv"` → suivis **séparément**, dans `ppnuStock`/`ppnvStock` — n'affectent **jamais** `stock` (déclarations réglementaires de produits non utilisables/non vendables, pas une consommation).
2. **`phytoTreatmentsComposition`** (jointe à `phytoTreatments` pour la date), lue en direct — chaque ligne **soustrait** sa `standardProductQuantity` du `stock` utilisable, et apparaît dans l'historique fusionné comme une opération synthétique `operationType: "treatment"` (id = `eventCompositionId`, `sourceEventId` = l'`eventId` du traitement source).

Le résultat par produit est `{ productId, productName, productNumAut, stock, ppnuStock, ppnvStock, operations: [...] }`, avec `operations` triées chronologiquement (mélange mouvements manuels + consommations traitement). `productName`/`productNumAut` sont renseignés dès qu'une des deux sources les fournit (les mouvements manuels n'ont pas de nom de produit stocké, seulement `productId` — ils héritent donc du nom vu dans une consommation de traitement du même produit, si elle existe).

Il n'y a **aucun** appel explicite de "synchronisation" lors d'un `POST`/`PUT`/`DELETE` sur `/phyto_treatments` : la mention de synchronisation automatique dans `API_DOCUMENTATION.md` renvoie simplement au fait que l'inventaire lit `phytoTreatmentsComposition` **en direct** à chaque requête — toute modification de traitement se répercute donc immédiatement sur le stock calculé, sans étape de copie/nettoyage intermédiaire.

### Export de l'inventaire — `/exports/inventaire`

`POST /exports/inventaire` 🔒 (`app/routes/exports.py`) — non documenté dans `API_DOCUMENTATION.md`. Génère un classeur Excel (`inventaire.xlsx`) à partir de `compute_stock_by_product`, remplaçant `previousServer/export_inventaire.php`. Deux feuilles :

- **"Inventaire"** : résumé par produit (`productId`, `stock`, `ppnuStock`, `ppnvStock`, nombre de mouvements).
- **"Mouvements"** : détail ligne à ligne de tous les mouvements (type, date, quantité, unité, traitement source le cas échéant).

---

## Réglages

Informations de compte et d'exploitation, préférences d'utilisation, et partage d'accès entre comptes.

### Exploitations — `/exploitations`

Modèle et endpoints CRUD entièrement documentés dans [API_DOCUMENTATION.md § Exploitations](app/API_DOCUMENTATION.md#exploitations--exploitations) : identité de l'exploitation (nom, adresse, TVA) et de son responsable (nom, mail, licence phyto). `POST /exploitations` est la seule route publique de ce groupe (création à l'inscription, `userId` fourni directement dans le body, avant que le compte n'ait de session).

### Profil utilisateur — `/user_profile`

`app/routes/user_profile.py`, non documenté dans `API_DOCUMENTATION.md`. Une ligne par utilisateur (upsert `ON DUPLICATE KEY UPDATE`), remplace `previousServer/users_infos.json`. Utilisé notamment par l'export du registre pour renseigner le n° de phytolicence/exploitant en en-tête.

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/user_profile` | 🔒 | Profil de l'utilisateur courant (`null` si jamais enregistré) |
| `POST` | `/user_profile` | 🔒 | Crée ou met à jour (upsert). Body : `{ phytolicence?, exploitingNumber? }` |

Modèle `userProfile` :

| Colonne | Type | Description |
|---|---|---|
| `userId` | VARCHAR(255) PK | |
| `phytolicence` | TEXT | Numéro de licence phytosanitaire |
| `exploitingNumber` | TEXT | Numéro d'exploitant |
| `createdAt` / `modifiedAt` | TIMESTAMP | |

### Préférences — `/preferences`

`app/routes/preferences.py`, non documenté dans `API_DOCUMENTATION.md`. Une ligne par utilisateur (upsert), remplace `previousServer/users_pref.json`. Préférences d'affichage/encodage : type de pulvérisateur, mode de saisie des traitements par défaut, et une série de booléens de suivi par type de production (activent/désactivent des sections entières du frontend selon le profil de l'exploitation).

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/preferences` | 🔒 | Préférences de l'utilisateur courant (`null` si jamais enregistrées) |
| `POST` | `/preferences` | 🔒 | Crée ou met à jour (upsert) |

Modèle `preferences` :

| Colonne | Type | Description |
|---|---|---|
| `userId` | VARCHAR(255) PK | |
| `sprayerType` | TEXT | Type de pulvérisateur utilisé |
| `treatmentEncodingMode` | TEXT | Mode de saisie des traitements par défaut (vraisemblablement l'un des 3 `eventType` du [moteur de calcul](#traitements-phytosanitaires--phyto_treatments)) |
| `trackFieldWorks` | BOOLEAN | Suivi des travaux aux champs activé |
| `trackLargeCrops` | BOOLEAN | Suivi grandes cultures |
| `trackMarketGardening` | BOOLEAN | Suivi maraîchage |
| `trackForageCrops` | BOOLEAN | Suivi cultures fourragères |
| `trackOrnamentalPlants` | BOOLEAN | Suivi plantes ornementales |
| `trackArboriculture` | BOOLEAN | Suivi arboriculture |
| `trackNurseriesViticultureChristmasTrees` | BOOLEAN | Suivi pépinières/viticulture/sapins de Noël |

### Mandats (délégation d'accès) — `/mandates`

`app/routes/mandates.py`, non documenté dans `API_DOCUMENTATION.md`. Permet à un utilisateur (**owner**) d'inviter un autre compte (**mandataire**, identifié par email) à agir sur ses données — utile par exemple pour un conseiller ou un second exploitant intervenant sur la même exploitation. Remplace `previousServer/mandats_handler.php` (fichier `mandats.json`).

Toutes les routes utilisent `@require_auth_self` (pas `@require_auth`) : l'identité utilisée est toujours celle du token connecté, jamais résolue via `X-Workspace-UserId` — cohérent, puisque ces routes gèrent la délégation elle-même.

**Cycle de vie d'un mandat** :
1. Le owner crée un mandat (`POST /mandates`) en ciblant l'email du mandataire. Tant que ce dernier ne s'est jamais authentifié sur l'API, `mandateUserId` reste `NULL` et la demande n'est identifiable que par `mandateUserMail`.
2. Dès que le mandataire fait un premier `GET /mandates` (ou toute requête qui déclenche `_resolve_pending_mandates_for_mail`), son `mail` (récupéré depuis le token) est comparé à `mandateUserMail` des mandats en attente et `mandateUserId` est renseigné automatiquement — pas d'action explicite requise du mandataire pour "réclamer" l'invitation.
3. Le mandataire accepte ou refuse (`PUT /mandates/<id>`, body `{ status: "accepted" | "refused" }`) — seul le mandataire identifié (par id ou par email si `mandateUserId` est encore `NULL`) peut le faire (`403` sinon).
4. Une fois `accepted`, le mandataire envoie `X-Workspace-UserId: <ownerUserId>` sur ses requêtes vers les routes classiques (`/parcels`, `/crops`, etc.) : `resolve_effective_user_id` (`app/auth.py`) vérifie qu'un mandat `accepted` existe bien entre ce owner et ce mandataire, et substitue `user_id` par celui du owner — le mandataire opère alors avec les données du owner comme si c'étaient les siennes.

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/mandates` | 🔒 self | Mandats où l'utilisateur est owner, mandataire résolu, ou mandataire en attente (par email) — résout aussi les mandats en attente pour son mail au passage |
| `POST` | `/mandates` | 🔒 self | Crée un mandat `pending`. Body : `{ mandateUserMail }`. `400` si mail manquant ou égal au sien ; `409` si un mandat `pending`/`accepted` existe déjà pour ce couple owner/mail |
| `PUT` | `/mandates/<id>` | 🔒 self | Accepte/refuse. Body : `{ status: "accepted" \| "refused" }`. `403` si l'appelant n'est pas le mandataire ciblé |
| `DELETE` | `/mandates/<id>` | 🔒 self | Supprime — autorisé pour le owner **ou** le mandataire (par id ou email). `404` si non trouvé/non autorisé |

Modèle `mandates` (migration `002_add_mandates_table.sql`) :

| Colonne | Type | Description |
|---|---|---|
| `mandateId` | VARCHAR(255) PK | |
| `mandateName` | TEXT | Nom d'affichage — nom de l'exploitation du owner, ou `"Exploitation de <mail/id>"` à défaut |
| `ownerUserId` / `ownerUserMail` | VARCHAR(255) | Compte propriétaire des données |
| `mandateUserId` | VARCHAR(255) NULL | Compte mandataire, résolu au premier login matching le mail |
| `mandateUserMail` | VARCHAR(255) | Email ciblé (obligatoire dès la création) |
| `status` | VARCHAR(20) | `pending` \| `accepted` \| `refused` |
| `createdAt` / `modifiedAt` | TIMESTAMP | |

### Liaison WalleSmart — `/wallesmart`

`GET /wallesmart/status` 🔒 (`app/routes/wallesmart.py`), non documenté dans `API_DOCUMENTATION.md`. WalleSmart est un **service tiers externe** (probablement un service wallon lié à la gestion de pulvérisateurs/matériel agricole, accessible via le même fournisseur d'identité UserKey qu'AppiField) ; cette route ne fait qu'exposer, côté réglages, si le compte connecté y est lié.

Remplace `previousServer/wallesmart_status.php` + `wallesmart_utils.php`. Le backend ne stocke **aucune donnée WalleSmart** : il relaie une vérification auprès d'UserKey (`WES_CHECK_MAIL_URL`, configurable), authentifiée avec le **propre token de session de l'utilisateur** (pas de secret serveur dédié) :

1. Récupère le mail de l'utilisateur depuis son token (`get_user_mail_from_token`).
2. Interroge `WES_CHECK_MAIL_URL?mail=<mail>` avec `Authorization: Bearer <token>`.
3. Retourne `{ "linked": <bool>, "mail": "<mail>" }` — `linked` vaut `data.data.exists === true` dans la réponse UserKey ; `false` par défaut sur toute erreur réseau/HTTP/mail manquant.

---

## Administration

`app/routes/admin.py` expose une **unique route** :

```
GET /admin/status 🔒 → { "isAdmin": <bool> }
```

Elle vérifie côté serveur (table `admins` : une ligne = un utilisateur admin, pas de colonne booléenne — "plus simple à auditer/révoquer") si l'utilisateur connecté a des droits d'administration. Elle remplace un ancien contrôle **entièrement côté frontend** (`admin.service.ts` comparait un champ à des valeurs codées en dur dans le bundle JS — donc trivialement contournable).

Il ne s'agit **pas** d'un panneau d'administration séparé avec ses propres ressources CRUD : `admin.py` ne fait que répondre "cet utilisateur est-il admin ?", utilisé par le frontend pour afficher/masquer des actions d'administration. Les véritables actions réservées aux admins sont portées par le décorateur `@require_admin` (`app/auth.py`) sur des routes qui, elles, vivent dans leurs sections fonctionnelles respectives plutôt que sous `/admin` :

| Ressource | Routes admin-only | Section |
|---|---|---|
| Formations | `POST`/`PUT`/`DELETE /formations[/<id>]`, `PUT /formations/<id>/move` | [Accueil § Formations](#formations--formations) |
| Catégories de cultures Phytoweb | `POST`/`PUT`/`DELETE /phytoweb_categories[/<id>]` | [Registre § Cultures](#cultures--crops) |

Modèle `admins` (migration `001_add_admins_table.sql`) :

| Colonne | Type | Description |
|---|---|---|
| `userId` | VARCHAR(255) PK | Présence d'une ligne = l'utilisateur est admin |
| `createdAt` | TIMESTAMP | |
