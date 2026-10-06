# Test global — Appi'Field v2.0 (redesign)

Cocher `[x]` au fur et à mesure. Noter tout problème dans la colonne « Remarque » ou sous la page concernée.
Pour chaque page : tester **ordinateur**, puis **tablette** et **téléphone** (F12 → mode appareil, ex. iPad 820px et iPhone 390px).

> ⚠️ Les tests marqués 🧪 créent ou suppriment de vraies données. Les faire avec des données de test (ex. une culture « TEST »), puis les supprimer.

---

## 0. Partout (vérifier en passant sur chaque page)

- [ ] Une seule couleur d'accent (sarcelle `#05b1af`) — pas de vert foncé, bleu ou rouge hors alertes/suppressions
- [ ] Champs de saisie à la même hauteur (44px sur ordinateur), astérisque rouge collé au libellé des champs obligatoires
- [ ] Boutons « Ajouter » en haut à droite des encadrés
- [ ] Bouton « retour en haut » (flèche) apparaît après avoir défilé, et remonte bien
- [ ] Aucune barre de défilement horizontale (surtout sur téléphone)
- [ ] Popups : se ferment avec la croix, le fond est flouté, le pied (boutons) reste visible

## 1. Sans connexion

| # | Page | URL | À vérifier | OK | Remarque |
|---|---|---|---|---|---|
| 1.1 | Accueil public | `/` | Mise en page, liens Connexion / Créer un compte | [ ] | |
| 1.2 | Connexion | `/connexion` | Champs, œil du mot de passe, message d'erreur avec un mauvais mot de passe | [ ] | |
| 1.3 | Créer un compte | `/connexion/creation_compte` | Champs, astérisques, indications du mot de passe | [ ] | |
| 1.4 | Mot de passe oublié | `/connexion/mis_a_jour` | Texte « lien de réinitialisation (code) », bouton « Envoyer le lien » | [ ] | |
| 1.5 | Récupérer / modifier le mot de passe | `/connexion/recuperer_mot_de_passe`, `/connexion/modifier_mot_de_passe` | Même carte que la connexion | [ ] | |
| 1.6 | Validation du compte | `/connexion/validation` | Même carte que la connexion | [ ] | |
| 1.7 | FAQ | `/faq` | Les 2 liens webinaires | [ ] | |
| 1.8 | CGU | `/cgu` | Titre « (CGU) » | [ ] | |
| 1.9 | Page 404 | `/nimportequoi` | Redirige vers `/erreur`, page propre | [ ] | |

## 2. Après connexion — navigation

- [ ] Barre latérale : tous les liens, page active surlignée
- [ ] Bouton Admin (si compte admin) au-dessus de « Mon compte », son menu s'ouvre
- [ ] Bouton « Se déconnecter » fonctionne
- [ ] Tablette/téléphone : barre de navigation du bas complète

## 3. Accueil connecté / Back-office (`/back-office`)

- [ ] Bannière, tuiles de chiffres, accès rapides, formations (flèches du slider)

## 4. Mon compte (`/reglage`)

- [ ] Encadrés, champs 44px, enregistrement des modifications
- [ ] Rappel bugs connus (journal §27, à ne pas compter comme régression) : nom/prénom, date d'enregistrement vide, TVA, exploitation

## 5. Parcelles

| # | Écran | À vérifier | OK | Remarque |
|---|---|---|---|---|
| 5.1 | `/parcelles` | Tableau, recherche, « Ajouter » en haut à droite | [ ] | |
| 5.2 | 🧪 Ajouter / modifier / supprimer une parcelle | Popups, champs 44px | [ ] | |
| 5.3 | `/parcelles/voir-parcelles` (Ma carte) | Carte affichée (pas blanche), menu « Ajouter » non coupé, icônes visibles | [ ] | |
| 5.4 | Largeur 993–1200px | Bug connu §27-4 : colonne Localisation | [ ] | |

## 6. Inventaire (`/inventaire`)

- [ ] Filtres en pastilles + compteurs
- [ ] Sélection d'un produit : graphique, quantités, bouton « Afficher en mL/g »
- [ ] « Ajouter ▾ » : s'ouvre, se ferme au clic dehors et avec Échap
- [ ] 🧪 Ajout d'un achat, d'un PPNU/PPNV (aussi depuis les encadrés, produit présélectionné)
- [ ] 🧪 Modifier / supprimer un PPNU/PPNV et un achat
- [ ] Onglets de l'historique, export Excel
- [ ] 🧪 Suppression d'un produit vide
- [ ] Téléphone/tablette : sélecteur de produit + barre du bas

## 7. Inscription (suite) et opérateurs

- [ ] `/creation-compte/creation-compte-info-personel` (Finaliser mon inscription) : mise en page, champs
- [ ] `/gestion-des-operations` : liste des opérateurs, 🧪 ajouter / modifier / supprimer
- [ ] `/mes-preferences` et Admin → catégories Phytoweb : **non redessinées** (remises à l'original) — vérifier seulement qu'elles fonctionnent

## 8. Carnet de champ (`/registre`)

### 8.1 Page principale
- [ ] En-tête : Exporter, Mes archives, « + Ajouter ▾ » (Culture / Travail au champ / Traitement phyto)
- [ ] Recherche, 4 boutons de filtre (surlignés quand actifs), bascule vue par cultures / vue globale
- [ ] Cartes de culture (2 colonnes), infobulle des parcelles, pagination des interventions
- [ ] Vue globale : tableau, badges de type, crayon, bouton Actualiser
- [ ] Téléphone/tablette : barre d'actions du bas

### 8.2 Détail d'une culture (clic sur une carte)
- [ ] Semis / Récolte / Parcelles, historique (badge violet pour les traitements)
- [ ] 🧪 Modifier la date de récolte puis de semis → fermer → rouvrir → **la date est conservée** (bug corrigé)
- [ ] Pied : Supprimer à gauche, Archiver puis Modifier à droite
- [ ] 🧪 Archiver dans une collection (nouvelle ou existante)

### 8.3 🧪 Popup Culture (ajout puis modification)
- [ ] Noms des 3 étapes sous la barre (Informations · Culture · Parcelles)
- [ ] Astérisques : nom, catégorie Phytoweb, parcelles
- [ ] Recherche Phytoweb (essayer `fro`, `maï`, `pom`), cartes sélectionnées en sarcelle
- [ ] Cartes parcelles, badge « X sélectionnées »
- [ ] Écran « Nouvelle culture créée ! » en carte blanche
- [ ] Modification : encadré « catégorie actuelle »

### 8.4 🧪 Popup Travail au champ (les 5 types)
- [ ] 4 étapes sous la barre ; cartes du choix du type (survol sarcelle)
- [ ] Pastilles de regroupement, « Tout sélectionner » visible, coche ✓ sur les cartes
- [ ] Détails : astérisques, champs 44px, Irrigation (libellés + menu « Unité » alignés)
- [ ] Écran de succès + résumé ; modification : « Supprimer » à gauche

### 8.5 🧪 Popup Traitement phyto (Surface, Bouillie, Quantité)
- [ ] 5 étapes sous la barre (téléphone : seulement l'étape en cours)
- [ ] Type : boutons Surface/Bouillie/Quantité, menus Opérateur/Efficacité/Base décisionnelle, Oui/Non
- [ ] Composition : recherche 44px, cartes produits (barre de couleur du statut), fiche produit (icônes, tableau des doses), Annuler blanc / Valider sarcelle, **plus de « total » parasite**
- [ ] Fertilisant personnel : 🧪 enregistrer / supprimer
- [ ] Volume (Bouillie) : champs Préparée / Utilisée
- [ ] Répartition : encadrés Phytoweb repliables, cartes par parcelle, curseurs, « Fixer la quantité » / « Verrouiller »
- [ ] Parcelles : comme le Travail au champ
- [ ] Écran de succès avec produits ; modification : « Supprimer » à gauche

### 8.6 Exporter
- [ ] Filtres Année/Parcelle/Culture (cases à cocher visibles), Statut, Excel/PDF
- [ ] Bouton « Exporter » sarcelle en Excel **et** en PDF ; 🧪 les deux fichiers se téléchargent correctement

### 8.7 Mes archives (`/registre/archives`)
- [ ] En-tête + « ← Retour au carnet de champ » en haut à droite
- [ ] Recherche, filtre collection (bouton sarcelle quand actif), tri par colonne
- [ ] 🧪 Restaurer une culture ; ouvrir le détail d'une culture archivée (Supprimer / Restaurer)
- [ ] État vide

## 9. Points mis de côté — décider pendant le test

- [ ] **Recherche Phytoweb sans résultat** : ajouter le message « Aucune catégorie ne correspond à … » ? (oui / non)
- [ ] **Noms d'étapes** sous la barre : les aligner sur le remplissage ? (oui / non)
- [ ] **Curseurs de volume bleus** (Traitement → Répartition) : passer en sarcelle ? (modifie 1 couleur dans le TypeScript — oui / non)

## 10. Problèmes trouvés

| # | Page | Taille d'écran | Description | Capture |
|---|---|---|---|---|
| | | | | |
