# Points à corriger repérés pendant la rédaction du guide

Document interne (équipe de développement). Le guide décrit l'application **telle qu'elle fonctionne aujourd'hui** ; ces points n'ont pas été corrigés dans le code.

## Partie 1 : inscription et connexion

| # | Constat | Où | Effet pour l'utilisateur |
|---|---|---|---|
| 1 | Après « Finaliser mon inscription › Suivant », l'app navigue vers `/?accountCreated=true`, que le garde `RedirectIfAuthenticatedGuard` renvoie vers `/back-office`. Les pages « Mes préférences » et « Gestion des opérateurs » ne sont jamais affichées. | `creation-compte-form.component.ts` (`onSuivant`) | Parcours en 3 étapes au lieu de 5. |
| 2 | Le message « Compte créé avec succès ! » n'est jamais visible : l'utilisateur est déjà connecté, donc redirigé avant de l'afficher. | idem + `accueil.component.html` | — |
| 3 | La création automatique de l'exploitant comme opérateur (`createOperatorOnFirstLogin`) dépend de `validation_pending`, qui n'est écrit nulle part. | `auth.component.ts` | La liste des opérateurs est vide après l'inscription. Le guide demande d'ajouter son équipe à la main. |
| 4 | « Mes préférences » (type d'encodage, pulvérisateur, secteurs) est enregistré par `POST /preferences` mais n'est relu nulle part (front ou exports). | `mes-preferences`, `server/app/routes/preferences.py` | Aucun effet. |
| 5 | Le n° de TVA est **obligatoire** dans Mon compte › Mon exploitation, mais **facultatif** à l'inscription, et la FAQ dit « laissez ce champ vide ». Décision : le guide indique « facultatif », sans toucher au code. | `infos-exploitation.component.*` | Sans TVA, impossible d'enregistrer ses infos d'exploitation dans Mon compte. |
| 6 | La page de validation du compte n'a pas de bouton « Renvoyer le code » (le code expire après 1 h). | `validation-compte.component.html` | Il faut recommencer l'inscription. |
| 7 | Phytolicence de l'opérateur : obligatoire dans « Gestion des opérateurs », facultative sur l'accueil et dans Mon compte. | `gestion-des-operations`, `create-user`, `back-office` | Incohérence. |

## Export du registre

| # | Constat | Où | Effet |
|---|---|---|---|
| 8 | La colonne « Stade phénologique » de l'export est toujours vide (« non modélisé dans le nouveau schéma »), alors que l'utilisateur saisit le stade BBCH à l'étape 4 d'un traitement. | `server/app/utils/exports.py` (`_registre_row_values`) | Information légale demandée quand l'autorisation du produit précise un stade, absente du registre. |

## Partie 2 : accueil et navigation

| # | Constat | Où | Effet |
|---|---|---|---|
| 12 | Supprimer un opérateur efface son nom de **tous ses traitements passés** dans l'export (`LEFT JOIN operators` sur `operatorId`) ; le recréer donne un nouvel identifiant, sans lien avec les anciens traitements. | `server/app/utils/exports.py`, suppression dans `back-office` / `create-user` | Registre exporté incomplet (nom de l'opérateur manquant). Le guide déconseille la suppression. |
| 13 | L'encadré « Parcelles actives » compte toutes les parcelles : la notion de parcelle inactive n'existe pas. | `back-office.component.html` | Libellé trompeur. « Parcelles » suffirait. |

## Partie 3 : parcelles

| # | Constat | Où | Effet |
|---|---|---|---|
| 15 | 🔴 Le champ « Code SIGEC » n'est jamais enregistré : il n'est pas envoyé (`toApi`) et la table `parcels` n'a pas de colonne pour lui. **Le guide n'en parle pas (décision du 22/10/2026) ; à revoir.** | `parcelles-server.service.ts`, `server/app/routes/parcels.py` | La saisie est perdue, alors que le SIGEC est la référence légale de localisation. |
| 16 | 🔴 Pour modifier une parcelle **dessinée** (`recordType = 'polygon'`), l'adresse est obligatoire : la condition qui la rend facultative ne vise que `Point_parcel`, `PAC_parcel`, GML et PAC on Web. Le guide donne un contournement (choisir l'adresse la plus proche). | `parcelles.component.ts` (≈ l. 882) et `get-parcelles.component.ts` (≈ l. 1658) | Impossible de mettre à jour une parcelle dessinée sans lui ajouter une adresse. |
| 17 | 🟠 Supprimer une parcelle ne supprime ni ses liens culture-parcelle ni ses lignes de traitement (aucune clé étrangère). L'export joint `parcels` pour l'adresse et les coordonnées, qui deviennent vides. | `DELETE /parcels`, `exports.py` | Localisation (information obligatoire) absente du registre pour les anciens traitements. Le guide déconseille la suppression. |
| 18 | 🟠 Renommer une parcelle ne met pas à jour `parcelName`, recopié dans les traitements et les travaux. | `phytoTreatmentsParcelsCrops`, `fieldWorksParcelsCrops` | L'export garde l'ancien nom. |
| 19 | 🟡 Le tri par superficie compare `parcel_area` sans tenir compte de l'unité (25 a passe après 7,8 ha). Il faudrait trier sur `standardParcelArea`. | `parcelles.component.ts` (tri) | Tri trompeur. |
| 20 | 🟡 Importer deux fois le même GML crée des doublons (aucune détection). | `POST /parcels/import_gml` | Doublons à supprimer à la main. |
| 21 | 🟡 Catégories : le formulaire en propose 3 (Plein air, Sous-protection, Traitement de semences), l'import GML en crée d'autres (Terre arable, Prairie permanente, Haie…). « Traitement de semences » est plutôt un type d'utilisation qu'une catégorie de parcelle. | `availableParcelCategories`, `gml_import.py` | Catégories incohérentes. |

## Partie 4 : Ma carte

| # | Constat | Où | Effet |
|---|---|---|---|
| 22 | 🟡 Le bouton « Ma position » n'existe que dans la barre de recherche mobile (`locate-btn-mobile`) : rien sur ordinateur. | `get-parcelles.component.html` | Fonction absente sur ordinateur et tablette en mode bureau. |
| 23 | 🟡 Le bouton « Mode carte plein écran » ne s'affiche jamais : la page `/parcelles/voir-parcelles` force le plein écran dès l'ouverture (`ngOnInit`). | `get-parcelles.component.*` | Code mort. |
| 24 | 🟡 Modifier le tracé d'une parcelle PAC ou GML l'enregistre comme `polygon` avec l'adresse « Parcelle tracée en polygone » : le type d'origine est perdu, et la parcelle retombe dans le bug n°16 (adresse exigée à la modification suivante). | `onSavePolygonParcel` | Parcelle bloquée en modification. |

## Partie 5 : cultures

| # | Constat | Où | Effet |
|---|---|---|---|
| 25 | 🔴 Le message de suppression d'une culture annonce « supprimera également tous les traitements et travaux associés », mais le serveur ne supprime que la culture et ses liens aux parcelles. Les traitements restent (orphelins) : invisibles dans le carnet, mais toujours dans l'export. | `registre-get.component.ts` (`onDeleteCulture`), `DELETE /crops` | Message faux ; interventions fantômes. Le guide recommande l'archivage. |
| 26 | 🟡 Changer la date de semis (fiche ou modification) recalcule la `collection` à partir de l'année de semis, même si l'utilisateur avait choisi une collection. | `update_crop` (`crops.py`) | Collection d'archive écrasée. |
| 27 | 🟡 Le filtre par dates du carnet masque les cultures sans intervention dans la période (y compris une culture qui vient d'être créée). | `applyDateFilter` | Culture « disparue ». Le guide le signale. |

## Affichage

| # | Constat | Où |
|---|---|---|
| 9 | Fiche d'une culture (ordinateur, 1280 px) : la date (« 04/08/2… »), la colonne BBCH (« Non … ») et le badge « Fertilisation » sont tronqués dans l'historique. | `culture-detail-popup` |
| 10 | Mon compte › Mandats : le badge « Accepté » est en vert sur fond vert, presque illisible. | `mandats.component.*` |
| 11 | Page de connexion : les messages d'erreur (« L'adresse mail ou le mot de passe mentionné n'est pas correct », « Un compte existe déjà pour cette adresse ») s'affichent en gris, comme un texte normal, et passent facilement inaperçus. | `auth.component.html` (`.error-message`) |
| 14 | Accueil sur smartphone (390 px) : la date « Dernière : 12/1… » est coupée dans l'encadré « Interventions ce mois » ; le bouton « Voir toutes mes parcelles » recouvre les crédits de la carte ; « NOVEMBRE » dépasse de la colonne date d'une carte de formation. | `back-office.component.*`, `_mobile.scss` |

## Points à confirmer (contenu du guide)

- **Numéro d'exploitant** : numéro SIGeC (producteur) ou numéro BCE ? Marqué « À confirmer » dans le guide.
- **Format de la phytolicence** : l'app impose `XX.X.XXXXX` (ex. 23.2.00445). Format non confirmé par une source officielle.
