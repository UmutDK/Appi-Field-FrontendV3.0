# Journal des modifications

Historique de chaque changement effectué par rapport à la version initiale du projet, pour retour arrière rapide ou pour servir de base à un compte rendu. Tenu à jour à chaque nouvelle modification.

**Légende :**
- 🟢 **Local uniquement** — fichier ignoré par Git (`server/.env.local`) ou config machine, n'affecte jamais le déploiement.
- 🔵 **Code source** — fichier versionné, sera répercuté sur le déploiement dès qu'il sera poussé/mergé.

---

## 1. Protection contre l'écriture accidentelle en base (READONLY_MODE)

- 🔵 [server/app/__init__.py](server/app/__init__.py) — ajout d'un hook `before_request` : si `READONLY_MODE=true` est actif, toute requête non-GET renvoie une erreur 403 (`"READONLY_MODE actif : écriture bloquée en local"`) au lieu d'atteindre la base. Le code reste en place en permanence ; il ne s'active que si la variable d'environnement est à `true` (jamais le cas par défaut).
- 🔵 [server/run.py](server/run.py) — charge en plus `.env.local` (avec `override=True`) après `.env`, pour permettre des réglages propres à chaque machine sans toucher au fichier partagé.
- 🟢 [server/.env.local](server/.env.local) — ajouté au `.gitignore`. Contenait initialement `READONLY_MODE=true` (le temps de brancher une base locale), **repassé à `false` une fois la base locale isolée en place** (section 2) puisque le risque d'écrire par erreur sur la production a disparu.

**Contexte :** au départ, l'environnement local pointait directement vers la base de production (pas de base de test séparée). Ce garde-fou empêchait toute écriture accidentelle pendant qu'on développait en local.

**Retour arrière :** repasser `READONLY_MODE=true` dans `server/.env.local` suffit pour réactiver le blocage (aucun changement de code nécessaire).

---

## 2. Base de données locale isolée (WSL + MariaDB)

- 🟢 MariaDB installée et lancée **à l'intérieur de WSL Ubuntu** (pas sur Windows, pour éviter un blocage du pare-feu Windows rencontré en cours de route), base `appifield_local`, utilisateur `appifield_dev`.
- 🔵 [server/migrations/000_local_dev_schema.sql](server/migrations/000_local_dev_schema.sql) *(nouveau fichier)* — reproduit la structure des tables de production (19 tables, sans contraintes FK, conforme à la convention déjà en place dans le projet) + données de test (dont la table `unitsIndex`, normalement dans une base séparée `corderPhytoweb`, dupliquée ici en local avec ses facteurs de conversion).
- 🟢 [server/.env.local](server/.env.local) — `DB_HOST=127.0.0.1`, `DB_USER=appifield_dev`, `DB_PASSWORD=...`, `DB_APPIFIELD=appifield_local`, `DB_PHYTOWEB=appifield_local` : redirige l'appli locale vers cette base au lieu de celle de production.

**Contexte :** la base de production réelle était utilisée par défaut en local (aucune base de test n'existait) et est devenue par ailleurs injoignable (pare-feu/hébergeur, sans lien avec ce projet). Cette base locale permet de développer sans jamais toucher aux données réelles.

**Retour arrière :** supprimer/vider `server/.env.local` fait retomber l'appli sur la config de `server/.env` (donc sur la base de production) — dans ce cas, repasser `READONLY_MODE=true` d'abord.

---

## 3. Stabilité de la navigation (blocage après clics rapides)

- 🔵 [server/run.py](server/run.py) — `app.run(..., threaded=True)` : le serveur Flask de dev traitait les requêtes une par une (série), ce qui pouvait donner l'impression de blocage. `threaded=True` conservé (dernière décision explicite).
- 🔵 [src/app/core/auth/services/auth.service.ts](src/app/core/auth/services/auth.service.ts) — `validateTokenViaAPI()` met désormais en cache (60s) le dernier token validé avec succès, pour éviter de relancer une vérification réseau à chaque navigation. Cause racine du blocage : cliquer plusieurs fois vite dans la sidebar déclenchait plusieurs vérifications asynchrones qui se chevauchaient, et le Router Angular restait en attente de l'une d'elles.

**Contexte :** après 2-3 clics rapides dans la nouvelle sidebar, la navigation se figeait. Diagnostiqué par élimination (thread Flask → pool de connexions DB, temporairement modifié puis revenu à la valeur par défaut → cache de token, la cause réelle).

---

## 4. Refonte visuelle : navigation (barre latérale)

- 🔵 [src/app/core/header/component/header/header.component.ts/html/scss](src/app/core/header/component/header/header.component.html) — remplacement de la barre de navigation horizontale par une **sidebar gauche** (état replié/déplié persisté en `localStorage`, largeur exposée via la variable CSS `--sidebar-width` sur `<body>`), menu déroulant exploitation/mandat, menu mobile en offcanvas Bootstrap.
- 🔵 [src/app/app.component.html/scss](src/app/app.component.html) — layout ajusté en conséquence (`<app-header/>` + `.content-wrapper` avec `margin-left: var(--sidebar-width, 232px)` en desktop).
- 🔵 [src/styles.scss](src/styles.scss) — suppression de l'ancienne règle `.content-wrapper{width:75%}`, devenue obsolète.

**Bug corrigé au passage :** Materialize (chargé globalement) impose `height:56px` à tout `<nav>` nu — provoquait un fond rouge/saumon (`#ee6e73`) et un bandeau écrasé sur la sidebar. Corrigé avec des `!important` ciblés (`height:auto`, `line-height:normal`, `background-color:transparent`).

---

## 5. Refonte visuelle : back-office et accueil

- 🔵 [src/app/back-office/components/back-office/back-office.component.ts/html/scss](src/app/back-office/components/back-office/back-office.component.ts) — tuiles de statistiques (parcelles/cultures/interventions, calculées en direct via `RegistreService`), cartes d'accès rapide, carte carte/map, bandeau formations. `takeUntil(destroy$)` ajouté sur tous les abonnements HTTP (évite un empilement de requêtes en cas de navigation rapide).
- 🔵 [src/app/accueil/components/accueil/accueil.component.html/scss](src/app/accueil/components/accueil/accueil.component.html) — même langage visuel : grille de 6 cartes fonctionnalités, slider formations, actualités.
- 🔵 [src/styles/_dashboard-cards.scss](src/styles/_dashboard-cards.scss) *(nouveau fichier)* — primitives visuelles partagées (`.dashboard-card`, `.quick-access-card`, slider formations...) extraites de `back-office.component.scss` pour être réutilisées par accueil, formations et faq sans dupliquer le CSS.

---

## 6. Refonte visuelle : /admin/formations

- 🔵 [src/app/admin/formations/formations.component.html/scss](src/app/admin/formations/formations.component.html) — même langage visuel que back-office/accueil (réutilise `_dashboard-cards.scss`).

**Non-bug identifié :** le bouton "flèche bas" (réordonner) semblait ne rien faire — c'était en fait `READONLY_MODE=true` qui bloquait correctement l'écriture (403), pas un dysfonctionnement.

---

## 7. Corrections /reglage

- 🔵 [src/app/reglage/components/infos-perso/infos-perso.component.html](src/app/reglage/components/infos-perso/infos-perso.component.html), [infos-exploitation.component.html](src/app/reglage/components/infos-exploitation/infos-exploitation.component.html), [password.component.html](src/app/reglage/components/password/password.component.html) — bouton de soumission : classe `"btn btn-success form-control"` → `"btn-primary"` (l'ancienne classe cassait le style du bouton).
- 🔵 [src/styles.scss](src/styles.scss) — ajout d'une règle globale restaurant le style "encadré" Bootstrap (`input.form-control, select.form-control, textarea.form-control`) écrasé par Materialize sur les 7 sous-pages de `/reglage`.

---

## 8. Corrections et améliorations /cgu

- 🔵 [src/app/cgu/cgu.component.html](src/app/cgu/cgu.component.html) — `id="cgu-section-1"` à `15` ajoutés sur chaque titre de section ; sommaire ajouté en colonne gauche (15 liens) avec `[routerLink]="[]" fragment="..."`.
- 🔵 [src/app/cgu/cgu.component.ts](src/app/cgu/cgu.component.ts) — méthode `scrollToSection()` (défilement manuel via `scrollIntoView`), nécessaire car le défilement automatique d'Angular Router ne se déclenche pas de façon fiable pour un changement de fragment sur la même route.
- 🔵 [src/app/cgu/cgu.component.scss](src/app/cgu/cgu.component.scss) — compteur CSS (`counter-reset`/`counter-increment`) corrigeant la numérotation des sections (recommençait à "1." à chaque section, artefact du copier-coller Word) ; sommaire en `position: sticky`.
- 🔵 [src/app/app.config.ts](src/app/app.config.ts) — `withInMemoryScrolling({ anchorScrolling: 'enabled' })` ajouté au routeur.
- 🔵 [src/styles.scss](src/styles.scss) — `html { scroll-behavior: smooth; }` (vérifié sans effet ailleurs dans l'appli).

**Bugs corrigés :**
- Numérotation qui repartait de 1 à chaque section → compteur CSS.
- Clic sur le sommaire redirigeait vers `/back-office` → `<base href="/">` faisait résoudre `href="#cgu-section-N"` contre la racine `/` (protégée par un guard) ; remplacé par `routerLink`+`fragment`.
- Défilement ne se déclenchait pas → ajout de `scrollToSection()` manuel.

**Limite connue, non corrigée (signalée comme non prioritaire) :** le sommaire (`position: sticky`) disparaît complètement en défilant loin dans la page. Cause : `<html>` et `<body>` ont chacun leur propre `overflow-y: auto` (double conteneur de scroll), ce qui casse le calcul de `position: sticky`. Corrigible plus tard via `position: fixed` si besoin.

---

## 9. Refonte visuelle /faq + corrections

- 🔵 [src/app/faq/components/faq-liste-item/faq-liste-item.component.html/scss](src/app/faq/components/faq-liste-item/faq-liste-item.component.html) — les 3 blocs de contact et le bloc questions/recherche/filtres/accordéon regroupés dans des `.dashboard-card` (réutilise `_dashboard-cards.scss`, section 5) ; coins de l'accordéon arrondis et espacés (au lieu du style Bootstrap par défaut, incohérent avec le reste de l'appli).
- 🔵 [src/app/faq/components/faq-liste-item/faq-liste-item.component.html/ts](src/app/faq/components/faq-liste-item/faq-liste-item.component.ts) — retrait des bindings Angular `[class.collapsed]`/`[class.show]` basés sur une propriété `isOpen` jamais renseignée : ces bindings réappliquaient à chaque cycle de détection de changement une classe qui effaçait celle que Bootstrap venait de poser au clic, empêchant de refermer une question déjà ouverte. Bootstrap gère maintenant seul l'ouverture/fermeture. Champ `isOpen` (mort) supprimé de l'interface `FaqItem`.
- 🔵 [angular.json](angular.json) — retrait de `node_modules/bootstrap/dist/js/bootstrap.min.js` du tableau `scripts` (doublon avec `bootstrap.bundle.min.js`, déjà présent et qui inclut tout, Popper compris).
- 🔵 [src/index.html](src/index.html) — retrait des `<script>` CDN `popper.min.js` et `bootstrap.min.js` (jsdelivr), redondants avec la copie locale packagée par Angular.

**Cause racine du bug "impossible de refermer une question de la FAQ" :** Bootstrap était chargé **trois fois** (deux fois via `angular.json`, une fois via CDN dans `index.html`). Chaque copie enregistrait son propre gestionnaire de clic sur le composant "accordéon" ; au clic pour fermer, l'une des copies fermait puis une autre — lisant l'état juste après — le rouvrait aussitôt dans le même instant. Un simple correctif d'`angular.json` n'a pas suffi tant que la copie CDN d'`index.html` restait présente.

---

> **Sections 10 à 26 : sessions du 28/09 et du 01/10/2026.** Uniquement du frontend (`src/`) — aucune modification backend, service HTTP ou base de données. Le TypeScript ajouté ne concerne que l'affichage (menus déroulants, calculs de tuiles à partir de données déjà chargées, validations de formulaire).

## 10. Scroll horizontal dans les popups et champs trop larges (correctif global)

- 🔵 [src/styles/_popup-system.scss](src/styles/_popup-system.scss) — `.popup-body` : `overflow-x: visible` → `hidden` ; `.popup-text-input` : `box-sizing: border-box !important` + `max-width: 100%`.
- 🔵 [src/styles.scss](src/styles.scss) — même `box-sizing: border-box !important` sur `input/select/textarea.form-control`.
- 🔵 [accueil-inventaire.component.scss](src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.scss) — `.popup-content-scrollable` : `overflow-x: hidden`.

**Cause racine :** Materialize impose `box-sizing: content-box` aux `input[type=text]` → `width:100%` + padding + bordure dépassait de la popup.

---

## 11. Convention : boutons d'ajout en haut à droite de l'encadré

- 🔵 [src/styles/_dashboard-cards.scss](src/styles/_dashboard-cards.scss) — nouvel en-tête de carte `.dashboard-card-header`.
- 🔵 [back-office](src/app/back-office/components/back-office/back-office.component.html) (« Mon équipe »), [create-user](src/app/reglage/components/create-user/create-user.component.html), [personal-products](src/app/reglage/components/personal-products/personal-products.component.html) — « Nouvel opérateur » / « Nouveau fertilisant » en haut à droite.

---

## 12. Accueil connecté (/back-office)

- 🔵 [back-office.component.html/scss](src/app/back-office/components/back-office/back-office.component.html) — libellés « Accès rapide » / « Ma carte parcellaire » agrandis ; 4 raccourcis (Besoin d'aide, Mon équipe, Espace formation, Actualités) ; encadré bleu « Espace formation » supprimé.
- 🔵 [_dashboard-cards.scss](src/styles/_dashboard-cards.scss) — tuiles de stats déplacées ici pour être partagées.

**Bug corrigé :** raccourcis dans un `<nav>` → fond rouge + hauteur 64px imposés par Materialize ; remplacé par `<div role="navigation">`.

---

## 13. Accueil public (bannière)

- 🔵 [banniere.component.html/scss](src/app/accueil/components/banniere/banniere.component.html) — image supprimée ; encadré standard, boutons à droite alignés en bas, casse normale. Une version avec image a été essayée puis abandonnée.
- 🔵 [accueil.component.html](src/app/accueil/components/accueil/accueil.component.html) — bannière dans le même conteneur que « À propos ».

---

## 14. Connexion et création de compte

- 🔵 [src/styles/_auth-form.scss](src/styles/_auth-form.scss) *(nouveau fichier)* — styles partagés des formulaires d'authentification.
- 🔵 [auth.component.html/scss](src/app/core/auth/components/auth/auth.component.html) — mise en page standard, champs côte à côte, lien « Créer un compte gratuitement », Entrée lance la connexion.
- 🔵 [creation.component.html/scss/ts](src/app/core/auth/components/creation/creation.component.html) — grille 2 colonnes, libellés de confirmation visibles (étaient en blanc), messages sous les champs, date de naissance ≤ aujourd'hui (`notInFutureValidator`), explication sous « S'inscrire » grisé, lien « Se connecter » (`onAnnuler()` existait sans être utilisé).

---

## 15. Navigation latérale (sidebar) et menus

- 🔵 [header.component.html/ts/scss](src/app/core/header/component/header/header.component.html) :
  - bouton rouge de **déconnexion** (sous l'avatar quand la sidebar est repliée) ;
  - « FAQ » → **« Besoin d'aide »** ; liens **CGU** et **Mon compte** ajoutés ;
  - bouton **« Admin »** (admins uniquement) avec sous-menu à droite, positionné en `fixed` (la sidebar a `overflow-x:hidden`) ;
  - **panneau utilisateur (offcanvas) supprimé** après vérification : nom de la sidebar et icône 👤 mobile → « Mon compte » ; menu mobile ☰ complété (Mon compte, admin, Déconnexion) ; contacts sur « Besoin d'aide ».

---

## 16. Mon compte (/reglage, ex-« Réglages »)

- 🔵 [reglage.component.html/scss](src/app/reglage/components/reglage/reglage.component.html) — titre « Mon compte » ; conteneur standard ; encadrés des onglets et menu au style standard ; titres d'onglet en gras ; 16px entre les lignes ; **champs à 44px**.
- 🔵 [infos-perso.component.html](src/app/reglage/components/infos-perso/infos-perso.component.html) — mail et date d'enregistrement dans une boîte identique à un champ (`.readonly-field`).

---

## 17. Page Parcelles (refonte)

- 🔵 [parcelles.component.html/scss/ts](src/app/parcelles/components/parcelles/parcelles.component.html) — bouton **« + Ajouter une parcelle ▾ »** en haut à droite (carte, adresse, import GML) à la place du bouton flottant et du bouton « Importer » ; tuiles (nombre, superficie en ha, catégories) ; recherche, pastilles, badges, crayon discret ; carte sticky. Suppression groupée inchangée.
- 🔵 [src/styles/_add-menu.scss](src/styles/_add-menu.scss) *(nouveau fichier)* — style partagé du bouton « Ajouter ▾ » (Parcelles, Ma carte, Inventaire).
- 🔵 Formulaire « par adresse » : champs, Unité et catégories uniformisés à 44px.

**Bug corrigé :** le filtre proposait des catégories inexistantes (« Sous abri », « Verger »…) ; il utilise désormais les catégories réelles.

---

## 18. Carte des parcelles (/parcelles/voir-parcelles)

- 🔵 [get-parcelles.component.html/scss/ts](src/app/parcelles/components/get-parcelles/get-parcelles.component.html) — titre « Ma carte » ; « + Ajouter une parcelle ▾ » (polygone, point, adresse, parcellaire PAC, retirer les tuiles) à la place du bouton flottant desktop ; « Retour à mes parcelles » neutre (était rouge) ; crayons discrets ; badges ; « Satellite » en casse normale.

**Bug corrigé (01/10) :** la liste « Ajouter ▾ » était coupée à gauche de l'écran (alignée à droite du bouton) et le « + » / la flèche étaient invisibles (la règle `.parcelles i { color:#03918a }` les colorait en teal sur fond teal). Liste désormais alignée à gauche, icônes forcées en blanc.

---

## 19. Bug : carte blanche en arrivant sur « Ma carte »

- 🔵 [get-parcelles](src/app/parcelles/components/get-parcelles/get-parcelles.component.ts), [parcelles](src/app/parcelles/components/parcelles/parcelles.component.ts), [back-office](src/app/back-office/components/back-office/back-office.component.ts) — Leaflet initialisé via `#mapContainer` + `@ViewChild` au lieu de `L.map('map')`.

**Cause :** 3 pages ont un `id="map"` ; pendant la navigation, l'ancienne page reste brièvement dans le DOM et Leaflet s'accrochait à son `#map`.

---

## 20. Page 404 (/erreur)

- 🔵 [erreur.component.html/scss/ts](src/app/erreur/components/erreur/erreur.component.html) — encadré standard, « 404 » turquoise, boutons « Page précédente » (nouveau) et « Retour à l'accueil », lien « Besoin d'aide ? ».

---

## 21. CGU et Besoin d'aide

- 🔵 [cgu.component.html/scss/ts](src/app/cgu/cgu.component.html) — conteneur/en-tête standard, titre « Conditions générales d'utilisation (CGU) », titres de section en gras numérotés en turquoise (styles Word neutralisés, **texte juridique inchangé**).
- 🔵 [faq-liste](src/app/faq/components/faq-liste/faq-liste.component.html), [faq-liste-item](src/app/faq/components/faq-liste-item/faq-liste-item.component.html) — conteneur/en-tête standard ; 3 cartes de contact ; **2 liens webinaire** (législatif / pratique) ; recherche + pastilles ; numéro `010/47.37.54`.
- 🔵 [back-to-top.component.ts](src/app/shared/components/back-to-top/back-to-top.component.ts) *(nouveau composant)* — bouton « Revenir en haut » (CGU, Besoin d'aide).

**Bug rencontré :** `html` et `body` ont `height:100%` + `overflow-x:hidden` → c'est `<body>` qui défile, pas la fenêtre ; le composant écoute le défilement en phase de capture.

---

## 22. Cohérence visuelle globale

- 🔵 [_popup-system.scss](src/styles/_popup-system.scss) — `.btn-primary` : vert `#198754` → **turquoise `#05b1af`** (tous les boutons principaux de l'app ; la vue globale du registre garde 2 boutons verts locaux).
- 🔵 18 libellés obligatoires : astérisque **collé** (« Nom et prénom* »).

---

## 23. Parcours « mot de passe oublié » et validation de compte (01/10/2026)

- 🔵 [mdp-oublie](src/app/core/auth/components/mdp-oublie/mdp-oublie.component.html) (`/connexion/mis_a_jour`), [recuperer-mdp](src/app/core/auth/components/recuperer-mdp/recuperer-mdp.component.html) (`/connexion/recuperer_mot_de_passe`), [modifier-mdp](src/app/core/auth/components/modifier-mdp/modifier-mdp.component.html) (`/connexion/modifier_mot_de_passe`), [validation-compte](src/app/core/auth/components/validation-compte/validation-compte.component.html) (`/connexion/validation`) — même gabarit que la connexion (icône, titre, explication, champs 44px, boutons en bas à droite) ; liens « Retour à la connexion » / « Renvoyer un mail » ; textes : « lien de réinitialisation (code) », bouton « Envoyer le lien », page 3 renommée « Nouveau mot de passe ».
- 🔵 Les 4 `.scss` remplacés par `@use auth-form` ; [_auth-form.scss](src/styles/_auth-form.scss) complété (`.auth-card--narrow`, `.auth-icon`, `.auth-note`, `.auth-stack`, bulle `.password-hints` désormais partagée — doublon retiré de `creation.component.scss`).

**Logique métier :** aucun fichier TypeScript ni service modifié. Seuls effets fonctionnels côté template : la touche Entrée déclenche le bouton principal (sur « Mot de passe oublié », elle déclenchait « Annuler », premier bouton du formulaire) ; champ mail en `type="email"` (clavier adapté sur mobile).

---

## 24. Page Inventaire (/inventaire) — refonte (01/10/2026)

- 🔵 [accueil-inventaire.component.html/scss](src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.html) — en-tête (titre + intro, « Exporter » et « + Ajouter ▾ » en haut à droite, à la place du bouton flottant desktop) ; liste « Mes produits » dans un encadré sticky avec filtres en pastilles + compteurs ; fiche produit (graphique + quantités avec légende colorée, bouton « Afficher en mL/g ») ; Phytoweb (libellés, encadrés d'alerte orange/rouge) ; tableaux PPNU & PPNV et Historique au style Parcelles (en-tête gris, badges, crayon/corbeille discrets, onglets avec compteurs) ; bandeau « produit vide » ; états vide/chargement. Footer mobile, popups et ancienne popup `#popup` inchangés.
- 🔵 [accueil-inventaire.component.ts](src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.ts) — seul ajout : `@HostListener` fermant la liste « Ajouter ▾ » au clic en dehors / Échap.
- 🔵 [ppnu-ppnv.component.scss](src/app/inventaire/components/ppnu-ppnv/ppnu-ppnv.component.scss), [achat-de-ppp.component.scss](src/app/inventaire/components/achat-de-ppp/achat-de-ppp.component.scss) — champs et menus déroulants des popups à 44px.

**Vérification effectuée (statique, par comparaison ancien/nouveau template) :** actions au clic, conditions `@if/@for`, données affichées `{{ }}`, liaisons `[...]`, attributs Bootstrap (`data-bs-*`, `id`), référence du graphique `#chartCanvas`, popups et footer mobile → **identiques** (seul ajout : `stopPropagation` sur la liste « Ajouter ▾ »). Compilation OK.

**⚠️ Tests fonctionnels dans le navigateur : NON effectués par Claude** (pas d'accès à l'app connectée). Restent à faire manuellement : filtres ; sélection produit ; bascule d'unité ; liste « Ajouter ▾ » (clic dehors / Échap) ; ajout achat ; ajout PPNU/PPNV ; ajout depuis les encadrés (produit présélectionné) ; modifier/supprimer PPNU/PPNV ; modifier/supprimer achat ; onglets historique ; export Excel ; suppression d'un produit vide ; affichage < 992px (sélecteur + barre du bas).

---

## 25. Suite de l'inscription et opérateurs (02/10/2026)

- 🔵 [creation-compte-form](src/app/creation-compte/) (« Finaliser mon inscription ») et [gestion-des-operations](src/app/gestion-des-operations/) (« Gestion des opérateurs ») — refonte gardée (encadrés, libellés, champs 44px, boutons). Pas d'indicateur « Étape x/3 » (parcours non linéaire).
- ↩️ **Mes préférences** et **Admin → catégories Phytoweb** : refonte **annulée**, fichiers remis à l'identique (les menus déroulants Materialize cassaient la mise en page). À revoir pendant le nettoyage.

**⚠️ Tests navigateur : à faire par l'utilisateur.**

---

## 26. Carnet de champ (/registre) — refonte en 6 sous-étapes (02–03/10/2026)

Sauvegardes avant modification : dossier scratchpad de la session (`registre-avant-refonte`, `culture-detail-avant-refonte`, `culture-avant-refonte`).

**Sous-étape 1 — page principale**
- 🔵 [registre.component.html](src/app/registre/components/registre/registre.component.html) — même conteneur/en-tête que les autres pages ; « Exporter », « Mes archives » et « + Ajouter ▾ » (Culture / Travail au champ / Traitement phyto) en haut à droite à la place du bouton flottant ; filtres actifs surlignés ; états vide/chargement. Popups et footer mobile inchangés.
- 🔵 [registre.component.ts](src/app/registre/components/registre/registre.component.ts) — seul ajout : fermeture de « Ajouter ▾ » au clic dehors / Échap.
- 🔵 [registre-get](src/app/registre/components/registre-get/) (vue par cultures) et [registre-get-vue-globale](src/app/registre/components/registre-get-vue-globale/) — cartes et tableaux au style Parcelles/Inventaire, badges de type, crayon discret.

**Sous-étape 2 — détail d'une culture (popup)**
- 🔵 [culture-detail-popup.component.html/scss](src/app/registre/components/culture-detail-popup/) — icônes Bootstrap, palette sarcelle, tableau de l'historique (badge violet pour les traitements), pied : « Supprimer » à gauche, « Archiver » puis « Modifier » à droite ; popup d'archivage à en-tête blanc, champs 44px.

**🐞 Bug corrigé (logique front, accord de l'utilisateur, 03/10/2026) — dates non enregistrées depuis le détail**
- Symptôme : date de récolte (ou de semis) modifiée dans le détail → affichée, puis « Non précisé » à la réouverture.
- Cause (antérieure à la refonte) : le front envoyait `harvest_date`/`sowing_date`, le serveur lit `harvestDate`/`sowingDate` (qui gardaient l'ancienne valeur).
- Correction : [culture-detail-popup.component.ts](src/app/registre/components/culture-detail-popup/culture-detail-popup.component.ts) — `saveSowingDate()`/`saveHarvestDate()` envoient aussi `sowingDate`/`harvestDate`. **Aucun changement backend.** ✅ Testé par l'utilisateur.

**Sous-étape 3 — popup « Ajouter / Modifier une culture »**
- 🔵 [culture.component.html/scss](src/app/registre/components/culture/) — libellés au style des autres formulaires, astérisques sur les champs déjà obligatoires (nom, catégorie Phytoweb, parcelles), champs et recherches à 44px, espacements réguliers (suppression des `<p></p>` vides), cartes Phytoweb/parcelles harmonisées (icône pleine sarcelle quand sélectionnée), encadré « catégorie actuelle » revu.
- 🔵 [registre.component.html/scss](src/app/registre/components/registre/) (cadre de la popup Culture uniquement) — barre de progression sarcelle unie + **noms des étapes visibles** sous la barre (Informations · Culture · Parcelles) ; icônes Bootstrap sur Précédent/Valider ; écran « Nouvelle culture créée ! » en carte blanche avec coche sarcelle.

**Sous-étape 4 — popup « Travail au champ » (03/10/2026)**
- 🔵 [travail-au-champ.component.html](src/app/registre/components/travail-au-champ/travail-au-champ.component.html) — astérisques sur les 12 champs déjà obligatoires dans le code (dates, produits apportés, outil de pilotage, quantité, unité, rendement, observation, type de travail) ; coche décorative sur les cartes parcelle+culture.
- 🔵 [travail-au-champ.component.scss](src/app/registre/components/travail-au-champ/travail-au-champ.component.scss) — bloc « REFONTE V2 » ajouté en fin de fichier (anciennes règles conservées) : cartes du choix du type et des parcelles au style de la popup Culture, pastilles de regroupement, case « Tout sélectionner » réaffichée (masquée par Materialize), libellés unifiés (y compris ceux de l'irrigation), champs 44px sur ordinateur. Paliers tablette/téléphone inchangés.
- 🔵 [registre.component.html/scss](src/app/registre/components/registre/) (cadre Travail au champ) — noms des 4 étapes visibles sous la barre, icônes Bootstrap, « Supprimer le travail » à gauche du pied, écran de succès en carte blanche avec résumé en encadré gris clair (classe commune `success-animation-overlay--card`).

**Vérification (statique) :** liaisons des templates identiques à la sauvegarde ; TypeScript non modifié ; compilation OK.
**⚠️ Tests navigateur à faire par l'utilisateur** (sous-étapes 1 à 4) — prévus pendant le test global.

**Notés pour le test global :** message « Aucune catégorie ne correspond » quand la recherche Phytoweb ne trouve rien ; alignement des noms d'étapes avec le remplissage de la barre.

**Sous-étape 5a — popup « Traitement phyto », écrans Type et Composition (03/10/2026)**
- 🔵 [traitement-phyto.component.html](src/app/registre/components/traitement-phyto/traitement-phyto.component.html) — astérisques ajoutés sur les champs déjà obligatoires (Dose/Quantité, Unité, nom et type du fertilisant personnel ; « Cible » passe au même astérisque) ; émojis ⛔ ⚠️ 📋 des encadrés de la fiche produit → icônes Bootstrap ; cadenas Font Awesome → Bootstrap.
- 🐞 Texte parasite **« total »** retiré à 7 endroits où il s'affichait par erreur (après le n° d'autorisation dans le tableau de composition et la fiche produit, après le type des fertilisants personnels, à la fin du message « type non modifiable »). Les « total » légitimes de la répartition sont conservés.
- 🔵 [traitement-phyto.component.scss](src/app/registre/components/traitement-phyto/traitement-phyto.component.scss) — bloc « REFONTE V2, PARTIE 5a » en fin de fichier : boutons Surface/Bouillie/Quantité, menus Opérateur/Efficacité/Base décisionnelle, Oui/Non, recherche produit (30px → 44px), cartes produits (carte blanche, bord gauche à la couleur du statut), légende des statuts, tableau de composition et tableau des doses Phytoweb au style Parcelles, ligne Dose/Unité/Cible à 44px, boutons Annuler (secondaire) / Valider (sarcelle) au lieu de rouge/vert foncé. Couleurs de statut (vert/orange/rouge) conservées. Paliers tablette/téléphone inchangés.
- 🔵 [registre.component.html/scss](src/app/registre/components/registre/) (cadre Traitement) — noms des 5 étapes sous la barre (sur téléphone : seulement l'étape en cours), icônes Bootstrap dans le pied, « Supprimer » à gauche.

**Vérification (statique) :** liaisons des templates identiques à la sauvegarde (`traitement-avant-refonte`) ; TypeScript non modifié ; compilation OK.

**Sous-étape 5b — popup « Traitement phyto », écrans Volume, Répartition, Parcelles + succès (03/10/2026)**
- 🔵 [traitement-phyto.component.html](src/app/registre/components/traitement-phyto/traitement-phyto.component.html) — émojis ⚠️ des encadrés Phytoweb repliables → icônes Bootstrap ; coche décorative sur les cartes parcelle+culture.
- 🔵 [traitement-phyto.component.scss](src/app/registre/components/traitement-phyto/traitement-phyto.component.scss) — bloc « REFONTE V2, PARTIE 5b » : volume de bouillie (libellés normaux, champs encadrés), encadré stades BBCH (ambre, bord gauche) et heures d'application (bleu → sarcelle clair), en-tête « Quantité totale », cartes de répartition par parcelle (en-tête gris clair au lieu de gris foncé, badges sarcelle, champs 44px), écran Parcelles identique au Travail au champ. **Inchangés volontairement :** remplissage bleu/ambre des curseurs de volume (couleur calculée dans le TypeScript) et liseré ambre des parcelles verrouillées.
- 🔵 [registre.component.html/scss](src/app/registre/components/registre/) — écran « Nouveau traitement créé ! » en carte blanche, produits en pastilles sarcelle claires.

**Vérification (statique) :** liaisons identiques à la sauvegarde ; TypeScript non modifié ; compilation OK.

**Noté pour le test global :** couleur bleue des curseurs de volume (passer en sarcelle = 1 couleur à changer dans le TypeScript, demande d'accord).

**Sous-étape 6 — popup « Exporter » et page « Mes archives » (03/10/2026)**
- 🔵 [export-popup.component.html/scss](src/app/registre/components/export-popup/) — `type="button"` sur les 22 boutons ; bloc « REFONTE V2 » : titre bleu nuit, libellés normaux, menus 44px, cases à cocher réaffichées en sarcelle (masquées par Materialize), Toutes/Actives/Archivées et Excel/PDF au style des autres choix, pastilles de filtres sarcelle claires, bouton « Exporter » **sarcelle aussi en PDF** (le rouge est réservé aux suppressions). Système global `_popup-system.scss` non modifié.
- 🔵 [archives.component.html](src/app/registre/components/archives/archives.component.html) — même structure que le carnet : en-tête titre + intro, « ← Retour au carnet de champ » en haut à droite, encadré recherche + filtre collection (surligné quand une collection est choisie — seule liaison ajoutée, visuelle), tableau dans un encadré, état vide en carte. Icônes Material → Bootstrap (sauf les flèches de tri, dont le nom vient du TypeScript).
- 🔵 [archives.component.scss](src/app/registre/components/archives/archives.component.scss) — réécrit (style Parcelles/Inventaire/carnet) ; paliers tablette/téléphone conservés (colonnes Date puis Espèce masquées et reportées sous le nom, « Restaurer » en icône seule sur téléphone).

**Vérification (statique) :** liaisons et données affichées identiques à la sauvegarde (`export-archives-avant-refonte`) ; TypeScript non modifié ; compilation OK.

**✅ Redesign du Carnet de champ terminé (sous-étapes 1 à 6).** Prochaine étape : **test global de toute l'application**, puis nettoyage.

---

## 26b. Test global — onglet 1 « pages sans connexion » (03/10/2026)

Test automatique (Playwright, fenêtre visible) : 11 pages × 3 tailles, aucun formulaire envoyé au vrai serveur. Corrections faites avec l'accord de l'utilisateur :
- 🐞 [mdp-oublie.component.ts](src/app/core/auth/components/mdp-oublie/mdp-oublie.component.ts) — **bug corrigé (logique front)** : la vérification de l'e-mail refusait les majuscules et les extensions de 4 lettres ou plus (`Jean@Gmail.com`, `jean@ferme.info`, `.brussels`) → même règle que la connexion/l'inscription. ✅ Re-testé : 5 adresses valides acceptées, 4 invalides refusées.
- 🔵 [creation.component.html](src/app/core/auth/components/creation/creation.component.html) — « Champ obligatoire. » + cadre rouge sous chaque champ obligatoire quitté vide (Prénom, Nom, Adresse mail, Confirmation, Mot de passe, Confirmation, Date de naissance). Messages existants (e-mail invalide, e-mails/mots de passe différents, date future) conservés. ✅ Re-testé ordinateur + téléphone.
- 🔵 [liste-actualites.component.scss](src/app/accueil/components/liste-actualites/liste-actualites.component.scss) — titre « Actualités » à la même taille et au même alignement que « À propos de l'outil » / « Espace formation ». ✅ Re-testé 3 tailles (écart 0px).
- 🔵 [banniere.component.scss](src/app/accueil/components/banniere/banniere.component.scss) — boutons « Me créer un compte » / « Me connecter » en Panton (étaient en Roboto).

**Constatés, non corrigés (à décider) :** « Espace formation » vide pour les visiteurs (`/formations` exige d'être connecté — backend) ; requête `/mandates` en 401 sur chaque page publique (console uniquement) ; pied de page « V1.2.0 » à mettre à jour au gel de la v2.0.

---

## 26c. Test global — onglet 2 « navigation + accueil connecté » (03/10/2026)

52 contrôles (barre latérale, menu Admin, menu mobile, déconnexion, accès rapides, carte, opérateurs). Corrections faites avec l'accord de l'utilisateur, toutes re-testées :
- 🔵 [back-office.component.scss](src/app/back-office/components/back-office/back-office.component.scss) / [.html](src/app/back-office/components/back-office/back-office.component.html) — nom d'opérateur très long coupé avec « … » (il débordait de 763px sur la carte voisine) ; nom complet en infobulle au survol. ✅ 3 tailles.
- 🔵 [back-office.component.ts](src/app/back-office/components/back-office/back-office.component.ts) — Échap ferme la popup « Nouvel opérateur / Modifier l'opérateur » (sans enregistrer). ✅
- 🔵 Formations sans date ([back-office](src/app/back-office/components/back-office/back-office.component.html) + [accueil public](src/app/accueil/components/accueil/accueil.component.html), style dans [_dashboard-cards.scss](src/styles/_dashboard-cards.scss)) — « ???? » remplacé par une icône + « Sans date fixe » sur fond gris. Cause du « ???? » : l'émoji 📅 enregistré par l'admin est transformé en « ???? » par la base locale (table `formations` sans jeu de caractères utf8mb4). ✅ 3 tailles.
- 🐞 [back-office.component.ts](src/app/back-office/components/back-office/back-office.component.ts) — **bug d'audit n°5 corrigé (logique front)** : la tuile « ha total » additionnait les superficies sans tenir compte de l'unité. Chaque parcelle est maintenant convertie en hectares (ha / a / m², mêmes facteurs que la page Parcelles). Les « 57 ha » actuels étaient justes (45 ha + 12 ha). ✅ Test : ajout temporaire d'une parcelle de 50 a → « 57,5 ha » (avant correction : 107), puis suppression.

**Constatés, non corrigés :** table `indexCrop` absente de la base locale → `/phytoweb_categories` en erreur 500 (recherche Phytoweb de la popup Culture et page Admin → catégories inutilisables en local ; données à importer) ; erreur Leaflet « LatLng NaN » sur /parcelles en tablette/téléphone (à voir onglet 4).

---

## 26d. Test global — onglet 3 « Mon compte » (03/10/2026)

64 contrôles (7 sections × 3 tailles + interactions) avec garde-fou bloquant toute écriture vers le vrai serveur. Corrections faites avec l'accord de l'utilisateur, re-testées avec des réponses serveur **simulées** (rien n'a été envoyé) :
- 🐞 **Bug n°1 corrigé (logique front)** — [mon-profil.service.ts](src/app/mon-profil/services/mon-profil.service.ts) renvoie la requête au lieu de l'envoyer « sans attendre » ; [infos-perso.component.ts](src/app/reglage/components/infos-perso/infos-perso.component.ts) attend les 2 enregistrements (nom/prénom + phytolicence/n° d'exploitant) : succès seulement si les deux réussissent, sinon message précis ; nom de la barre latérale mis à jour sans reconnexion ; « Enregistrer » bloqué + « Champ obligatoire. » si Nom ou Prénom vide (ou espaces). ⚠️ À confirmer en réel : si le serveur de comptes refuse l'appel depuis le navigateur (CORS), l'utilisateur verra maintenant le message d'erreur au lieu d'un faux succès.
- 🐞 **Bug n°2 corrigé (front uniquement)** — « Date d'enregistrement » = date de création du profil Appi'Field (`/user_profile` → `createdAt`, créé à « Finaliser mon inscription ») ; « Non disponible » si le profil n'existe pas encore (cas du compte de test local).
- 🐞 **Bug n°7 corrigé (logique front)** — [infos-exploitation](src/app/reglage/components/infos-exploitation/) : « Enregistrer » bloqué tant qu'un champ obligatoire est vide (« BE » seul = vide), message sous chaque champ ; code postal : chiffres uniquement, 4 maximum, message « Code postal belge : 4 chiffres. ».
- 🐞 [create-user.component.ts](src/app/reglage/components/create-user/create-user.component.ts) — confirmation « Supprimer l'opérateur « … » ? » avant suppression (comme sur l'accueil).
- 🔵 Design : cartes Équipe et Fertilisants 2 par ligne, nom sur 2 lignes max (« Umut Demirkaz » n'est plus coupé) ; sous-titres « Mon équipe actuelle » / « Mes fertilisants personnels » plus petits que le titre de section ; boutons « Lier mon compte WalleSmart » et « Envoyer » (mandats) en casse normale.
- 🔧 [mon-profil-item.component.ts](src/app/mon-profil/components/mon-profil-item/mon-profil-item.component.ts) (ancien écran non routé) : `.subscribe()` ajouté pour garder son comportement.

**Non corrigés (choix de l'utilisateur) :** bug n°6 (TVA impossible à vider, curseur qui saute), bulle des règles du mot de passe qui masque un champ, vérification du format e-mail dans Mandats, phytolicence acceptant des lettres (bug n°10).

---

## 26e. Test global — onglet 4 « Parcelles + Ma carte » (03/10/2026)

75 contrôles (recherche, filtres, tri, ajout par adresse, modification avec conversion ha→a, suppression simple et multiple, polygone, point GPS, parcellaire PAC, satellite, 3 tailles) ; parcelles « TEST-CLAUDE » créées puis supprimées en base locale. Corrections (accord de l'utilisateur), re-testées sans aucune écriture : **41/41**.
- 🐞 **Bug n°4 corrigé (design)** — [parcelles.component.scss](src/app/parcelles/components/parcelles/parcelles.component.scss) : entre 993 et 1400px le tableau débordait (défilement horizontal, crayon « Modifier » caché) → colonne Localisation masquée jusqu'à 1400px, carte sous le tableau entre 993 et 1150px ; `getVisibleColumnCount()` suit le même seuil (lignes « aucun résultat » sur toute la largeur). ✅ Testé de 993 à 1600px.
- 🐞 [parcelles.component.ts](src/app/parcelles/components/parcelles/parcelles.component.ts) — la petite carte, masquée sous 992px, n'est plus créée tant qu'elle est invisible (91 erreurs « LatLng NaN » en tablette/téléphone) ; elle est créée si la fenêtre est agrandie. ✅ 0 erreur.
- 🔵 Bouton « Ajouter une parcelle » toujours calé à droite : la liste sortait de l'écran par la gauche sur téléphone (signalé par l'utilisateur) ou par la droite sur tablette. ✅ 3 tailles.
- 🔵 Astérisques sur les champs obligatoires des 5 popups parcelle (Nom, Superficie, Unité, Adresse, Catégorie) ; libellé « Catégorie de parcelle » de Ma carte au style des autres ; « Supprimer la parcelle » à gauche du pied ; message « Aucune parcelle ne correspond à votre recherche. » sur Ma carte.
- 🔵 Échap et clic en dehors ferment les popups parcelle (Mes parcelles + 4 popups de Ma carte), sans enregistrer ; un clic dans la popup ne la ferme pas.

- 🔵 Messages explicites (question de l'utilisateur) — popups parcelle de [Mes parcelles](src/app/parcelles/components/parcelles/parcelles.component.html) et [Ma carte](src/app/parcelles/components/get-parcelles/get-parcelles.component.html) : « Champ obligatoire. » + cadre rouge sous Nom, Superficie, Adresse quand on les quitte vides ; aide dans le pied « À compléter : nom · superficie · adresse (à choisir dans la liste) · catégorie » qui se met à jour (absente de la popup PAC, qui utilise un autre type de formulaire). Les champs obligatoires sont ceux **déjà imposés par le code** (`Validators.required`) — rien n'a été rendu obligatoire en plus.
- 🔵 [_popup-system.scss](src/styles/_popup-system.scss) — les menus déroulants maison (`.dropdown-btn`) devenaient sarcelle plein après un clic (règle Materialize `button:focus`) : fond blanc conservé (toute l'application).
- 🐞 Régression évitée : le « clic en dehors » renvoyait `false` pour les clics dans la popup → Angular annulait leur action (impossible de cocher une catégorie). Corrigé (ternaire `… : null`) et re-testé.

**Non corrigés (à décider) :** parcellaire PAC chargé au zoom par défaut (15 128 parcelles d'un coup — risque de lenteur) ; champ Adresse « Parcelle tracée en polygone » pour les polygones ; recherche d'adresse tronquée sur Ma carte (téléphone) ; superficie affichée « 250.0000 » après conversion.

---

## 26f. Test global — onglet 5 « Inventaire » (03/10/2026)

48 contrôles (filtres, achat avec création de produit personnel, fiche produit, bascule L/mL, historique, modification d'achat, PPNU depuis la fiche, suppressions, export Excel, 3 tailles) ; données « TEST-CLAUDE » supprimées. Aucun bug bloquant. Corrections design (accord de l'utilisateur), re-testées : **21/21**.
- 🔵 [ppnu-ppnv.component.html](src/app/inventaire/components/ppnu-ppnv/ppnu-ppnv.component.html) — astérisques sur Produit, Type, Date, Quantité, Unité (déjà obligatoires dans le code).
- 🔵 Popups PPNU et [Achat](src/app/inventaire/components/achat-de-ppp/achat-de-ppp.component.html) — « Champ obligatoire. » / « La quantité doit être supérieure à 0. » + cadre rouge ; aide « À compléter : … » dans le pied (au-dessus des boutons sur téléphone).
- 🔵 [achat-de-ppp.component.ts](src/app/inventaire/components/achat-de-ppp/achat-de-ppp.component.ts) + [accueil-inventaire](src/app/inventaire/components/accueil-inventaire/) — l'alerte du navigateur « Achat modifié avec succès ! » remplacée par un message intégré (bas d'écran, 4 s) ; même message à l'ajout d'un achat. Les alertes d'**erreur** restent inchangées.
- 🔵 Échap et clic en dehors ferment les popups PPNU et Achat (un clic dans la popup ne la ferme pas).
- 🔵 Pieds de popup (Inventaire + Parcelles) : boutons non coupés sur 2 lignes quand l'aide est affichée.

**Constatés, non corrigés (choix de l'utilisateur) :** quantité PPNU pré-remplie à « 0 » ; date d'expiration antérieure à la date d'achat acceptée (règle métier à décider) ; recherche de produits Phytoweb vide en local (table `general` absente de la base locale).

---

## 26g. Test global — onglet 6a « Carnet de champ : page, détail, popup Culture » (03/10/2026)

32 contrôles. Cultures « TEST-CLAUDE » créées (API locale) puis supprimées.
- 🐞 **Correction complétée** — [culture-detail-popup.component.ts](src/app/registre/components/culture-detail-popup/culture-detail-popup.component.ts) : la correction des dates (section 26) était incomplète. En modifiant la récolte **puis** le semis dans la même ouverture, le 2e enregistrement renvoyait l'ancienne récolte et l'effaçait. Les champs lus par le serveur (`harvestDate` / `sowingDate`) sont maintenant aussi mis à jour après chaque enregistrement. ✅ Re-testé dans les deux ordres avec rechargement.

- 🐞 **Filtre « par parcelles » corrigé (logique front, accord de l'utilisateur)** — [registre-get.component.ts `applyParcelFilter`](src/app/registre/components/registre-get/registre-get.component.ts) : les identifiants de parcelles des cultures sont convertis en noms avant comparaison (même table que la recherche texte). ✅ Ucku / Champ du Bois / les deux.
- 🔵 Cartes : « Catégorie non définie » (gris) au lieu d'une pastille vide ; détail : en-tête « BBCH » en entier ; Échap ferme la popup de détail (annule d'abord l'édition d'une date, puis ferme la petite popup « Archiver », puis le détail). ✅ Re-testé.

**Constatés, non corrigés (à décider) :**
- ~~🐞 Filtre « par parcelles » du carnet : ne renvoie jamais rien — il compare les noms de parcelles cochés aux identifiants techniques des cultures ([registre-get.component.ts `applyParcelFilter`](src/app/registre/components/registre-get/registre-get.component.ts), bug antérieur au redesign ; la recherche texte, elle, convertit correctement).~~ ✅ corrigé ci-dessus.
- « (null) » affiché dans le détail d'un traitement avec un produit personnel (n° d'autorisation absent) : « Fongicide Test XY (null) - 1.50L/ha ».
- Badge de catégorie vide (pastille sans texte) sur les cartes quand la catégorie Phytoweb est inconnue — le détail affiche, lui, « Catégorie non définie ».
- Popup détail : Échap ne la ferme pas (le clic en dehors, oui) ; en-tête de colonne « BBCH » tronqué en « BB… ».
- Création / modification de culture **impossibles en local** : l'étape « Culture » exige une catégorie Phytoweb et la table `indexCrop` est absente de la base locale (pas un bug du code).

---

## 26h. Test global — onglet 6b « Travail au champ » (03/10/2026)

Les 5 types créés via l'interface (sélection parcelle+culture, champs obligatoires, écran de succès avec résumé), affichage sur la carte, modification, suppression ; données « TEST-CLAUDE » supprimées.
- 🐞 **Régression de la refonte corrigée** — case « Tout sélectionner » (Travail au champ, Traitement phyto) et cases de la popup Exporter **affichées en double** : j'avais réaffiché la case native alors que Materialize dessine déjà une fausse case sur le `<span>` voisin. La fausse case est retirée, la case native sarcelle reste. ✅ Vérifié (une seule case, se coche).

**Corrections (accord de l'utilisateur), re-testées : 15/15**
- 🐞 Observation — le texte s'affiche de nouveau (carte, détail, vue globale, résumé de succès) : relu depuis `informations` ([registre-get](src/app/registre/components/registre-get/registre-get.component.ts), [vue globale](src/app/registre/components/registre-get-vue-globale/registre-get-vue-globale.component.ts)).
- 🐞 Récolte — « Rendement » pré-rempli en modification (relu depuis `remark`, [travail-au-champ.component.ts](src/app/registre/components/travail-au-champ/travail-au-champ.component.ts)) ; résumé « Rendement : … » au lieu de « Remarques ».
- 🔵 Pied de la popup : aide « Choisissez le type de travail à encoder. » / « Cochez au moins une parcelle (avec sa culture) pour continuer. » + bouton « Précédent » dès l'écran Parcelles ; Échap et clic en dehors ferment la popup ; quantité d'irrigation ≤ 0 : « La quantité doit être supérieure à 0. ».
- ⏳ **Travail du sol : laissé de côté à la demande de l'utilisateur, à traiter plus tard** (type et description enregistrés ensemble dans `eventInfo`).

**Constatés au départ — bugs antérieurs au redesign (passage au nouveau serveur) :** le serveur range certains textes dans d'autres champs (`eventInfo`, `remarks`) que ceux relus par l'écran :
- Observation : le texte est enregistré mais **n'apparaît pas** dans la colonne « Détails » (carte + détail) ni dans le résumé de succès.
- Récolte : le rendement s'affiche bien, mais en **modification le champ « Rendement » est vide**.
- Travail du sol : « Type de travail » et « Description » sont enregistrés ensemble (« Labour - 25 cm ») → **absents** de la colonne Détails ; en modification, « Type de travail » vide et tout le texte dans « Description ».
- Pied de la popup absent à l'écran « Type » et à l'écran « Parcelles » tant que rien n'est coché (aucune indication) ; Échap / clic en dehors ne ferment pas la popup ; quantité d'irrigation négative refusée sans message ; erreurs console NG0100 (barre de progression, mode développement uniquement).

---

## 26i. Test global — onglet 6c « Traitement phyto, Export, Archives » (03/10/2026)

Traitement : modes Surface, Bouillie, Quantité de bout en bout avec un fertilisant personnel (produits Phytoweb absents en local) → succès ; modification ; suppression. Export : Excel et PDF téléchargés. Archives : archiver (nouvelle collection), rechercher, filtrer, trier, détail, restaurer, supprimer. Données « TEST-CLAUDE » supprimées. **Aucune modification de code dans cette partie.**

**Constatés, non corrigés (à décider) :**
- Traitement — noms d'étapes dans le désordre : l'ordre réel est Parcelles → Type → Composition (+ Volume en bouillie, sur le même écran) → Répartition, mais la barre affiche « Type · Composition · Volume · Répartition · Parcelles » (aucun nom actif sur l'écran Parcelles, « Parcelles » allumé pendant la Répartition ; sur téléphone aucun nom au premier écran).
- Traitement — mode **Quantité** : l'écran de succès affiche « Type : Surface ».
- Traitement — parenthèses vides « TEST-CLAUDE Engrais T () - 2.50L/ha » pour les produits personnels (même cause que le « (null) » de l'onglet 6a).
- Traitement — mode Bouillie : cartes des fertilisants sans marge intérieure (texte collé au bord) ; libellés « PRÉPARÉE / UTILISÉE » encore en majuscules.
- Traitement — Échap / clic en dehors ne ferment pas la popup ; à l'ouverture, seul un « Valider » grisé sans explication.
- Export — 🐞 les pastilles des filtres actifs (et « Effacer tout ») ne s'affichent jamais : `hasActiveFilters` est un `computed()` basé sur des propriétés non-signal, jamais recalculé (bug antérieur au redesign). Liste « Année » qui reste ouverte quand on clique ailleurs dans la popup.
- Archives — dates de semis / récolte encore modifiables sur une culture archivée (à décider) ; archivage et restauration confirmés par des alertes du navigateur.
- Base locale : `/index/enemies`, `/index/phytoweb_crops`, `/index/phytoweb_products` en erreur (tables Phytoweb absentes).

**Corrigés (04/10/2026, accord de l'utilisateur — points 1, 2, 3, 5, 6, 7), re-testés dans Chrome :**
- Export — `export-popup.component.ts` : `hasActiveFilters` devient une méthode → les pastilles et « Effacer tout » s'affichent. `export-popup.component.html` : un clic dans la popup ferme les listes ouvertes (`closeAllDropdowns()`).
- Traitement — `registre.component.html` : barre d'étapes réduite à 4 noms dans l'ordre réel « Parcelles · Type · Composition · Répartition » (seuils 25 / 50 / 70 / 100) ; écran de succès « Type : Quantité » en mode Quantité ; aide « ce qu'il manque » dans le pied selon l'étape (`canProceedToNext()`) ; clic en dehors ferme la popup. `registre.component.ts` : Échap ferme aussi la popup Traitement. `registre.component.scss` : style de l'aide.
- Traitement — `traitement-phyto.component.scss` (fin de fichier) : marge intérieure des cartes de fertilisant en mode Bouillie ; libellés « Préparée / Utilisée » sans majuscules forcées (`!important`, la règle d'origine était plus spécifique).
- Sauvegarde avant modification : scratchpad `onglet6c-avant-corrections/`.

---

## 26j. Test global — onglet 7 « Finaliser mon inscription + Gestion des opérateurs » (05/10/2026)

Les deux pages redirigent quand le compte est déjà complet → test avec réponses serveur simulées (profil vide, liste d'opérateurs en mémoire) ; aucune écriture n'a atteint une base. **Aucune modification de code.**

**OK :** champs à 44px, « Suivant » désactivé à vide, mise en forme phytolicence / TVA, ajout d'opérateur (bouton et Entrée), champs vidés, nom très long tronqué dans sa carte, suppression, « Terminer » → back-office, pas de débordement tablette / téléphone.

**Constatés, non corrigés (à décider) :**
- 🐞 Finaliser — `userId: "undefined"` envoyé à `POST /exploitations` : `localStorage.Ref` vaut la chaîne « undefined » (la connexion range `s.Etat.Id_User`, absent de la réponse) et le formulaire prend `Ref` en priorité → l'exploitation serait rattachée à l'utilisateur « undefined ».
- 🐞 Finaliser — redirection immédiate sans attendre le serveur : en cas d'erreur, rien n'est affiché.
- 🐞 Opérateurs — « Ajouter » jamais désactivé : un clic à vide envoie `{operatorName: null, operatorPhytolicence: null}`.
- 🐞 Opérateurs — `maxlength="9"` sur la phytolicence : « 23.2.00445 » est coupé en « 23.2.0044 » (10 partout ailleurs).
- Opérateurs — suppression sans confirmation ; phytolicence incomplète (« 12 ») acceptée.
- Finaliser — pas de message sous les champs obligatoires laissés vides ; code postal « 12 » ou « -5000 » accepté.

**Corrigés (05/10/2026, accord de l'utilisateur — erreurs 2 et 4, améliorations 1, 3 et 4), re-testés dans Chrome :**
- Erreur 2 — `creation-compte.service.ts` : `onPost()` renvoie l'enchaînement `user_profile` → `exploitations` (switchMap). `creation-compte-form.component.ts/html/scss` : la page attend la réponse (bouton « Enregistrement... »), redirige seulement en cas de succès ; sinon message rouge au-dessus de « Suivant », données conservées.
- Erreur 4 — `gestion-des-operations.component.html` : phytolicence `maxlength="10"` (« 23.2.00445 » complet).
- Amélioration 1 — `gestion-des-operations.component.ts` : confirmation avant suppression (même texte que Mon équipe).
- Amélioration 3 — Finaliser : « Champ obligatoire. » + encadré rouge sous Adresse, Code postal, Nom (`showError()`).
- Amélioration 4 — Finaliser : code postal en chiffres seulement, 4 maximum, `Validators.pattern(/^\d{4}$/)`, message « Code postal belge : 4 chiffres. » ; toujours envoyé comme nombre.
- **À discuter plus tard (demande de l'utilisateur) :** erreur 1 (`userId: "undefined"`) et erreur 3 (« Ajouter » d'opérateur à vide).
- Sauvegarde : scratchpad `onglet7-avant-corrections/`.

---

## 29. Version mobile — onglet 1 « pages sans connexion » (09/10/2026)

Test sur 5 appareils simulés (Android 360, iPhone 390 et 430, tablette portrait et paysage), écran tactile. Aucun défilement horizontal. Toutes les corrections et propositions appliquées à la demande de l'utilisateur, **pour essai** (retour arrière prévu). Uniquement sous 993px : la version ordinateur ne change pas.
- 🆕 [src/styles/_mobile.scss](src/styles/_mobile.scss) — tout le CSS mobile, chargé par une ligne de [styles.scss](src/styles.scss) : champs en 16px, barre du haut 56px, menu en panneau de 85% (fond assombri qui le ferme), boutons de 48px, pied de page compact, zones tactiles ≥ 44px, petits textes à 14px ; sous 576px : pages sans cadre, titre d'accueil 28px, lien « Mot de passe oublié ? » sous le champ.
- 🔵 [header.component.html](src/app/core/header/component/header/header.component.html) — « Se connecter » / « Créer un compte » en bas du menu pour les visiteurs.
- 🔵 Remplissage automatique (`autocomplete`, clavier e-mail) : [connexion](src/app/core/auth/components/auth/auth.component.html), [création de compte](src/app/core/auth/components/creation/creation.component.html), [mot de passe oublié](src/app/core/auth/components/mdp-oublie/mdp-oublie.component.html), [nouveau mot de passe](src/app/core/auth/components/modifier-mdp/modifier-mdp.component.html).
- ℹ️ Le zoom iPhone sur les champs était déjà évité sur un vrai iPhone (règle iOS de styles.scss) ; signalé à tort par la simulation.

**Suite après essai sur téléphone (09/10/2026)** — sauvegarde `sauvegardes-mobile\onglet1b-avant\` :
- 🐞 **« Créer un compte » ne s'affichait pas sur téléphone** (accord de l'utilisateur, logique) : `crypto.randomUUID()` n'existe pas sur une adresse non sécurisée (http://192.168.x.x) ni avant iOS 15.4 → le service plantait. Nouveau [uuid.util.ts](src/app/shared/utils/uuid.util.ts) (`generateUUID()`, même format) utilisé dans [creation.service.ts](src/app/core/auth/services/creation.service.ts), [parcelles](src/app/parcelles/components/parcelles/parcelles.component.ts), [get-parcelles](src/app/parcelles/components/get-parcelles/get-parcelles.component.ts), [travail-au-champ](src/app/registre/components/travail-au-champ/travail-au-champ.component.ts).
- 🔵 « Retour en haut » (rond sarcelle, flèche ↑) sur **toutes les pages**, téléphone et ordinateur : placé une fois dans [app.component.html](src/app/app.component.html), retiré de la FAQ et des CGU.
- 🔵 Mobile : flèche **←** + titre de la page dans la barre du haut sur les pages secondaires (logo sur Accueil, Parcelles, Carnet, Inventaire) — [header.component.ts/html](src/app/core/header/component/header/) ; retour à la page précédente, ou à l'accueil si la page a été ouverte directement.

**Retour arrière :** retirer `@use 'styles/mobile';` de styles.scss ; fichiers HTML d'origine dans `Desktop\Appi'Field\sauvegardes-mobile\onglet1-avant\` et `onglet1b-avant\`.

---

## 30. Version mobile — onglet 2 « navigation connectée + accueil connecté » (09/10/2026)

D'après la [maquette validée](https://claude.ai/artifact/9wHK8CinobkNap2J8i7w9Q), pour essai (retour arrière prévu). Sauvegarde : `Desktop\Appi'Field\sauvegardes-mobile\onglet2-avant\`.
- 🔵 **Barre de navigation du bas** (connecté, < 993px) : Accueil, Parcelles, Carnet, Inventaire, Plus — [header.component.html](src/app/core/header/component/header/header.component.html). Le ☰ du haut disparaît une fois connecté.
- 🔵 **Menu « Plus »** en panneau blanc qui monte du bas : Mon compte, aide, conditions, section « Administration », déconnexion (les 4 pages principales n'y sont plus).
- 🔵 **Popups en panneau du bas** : classe réutilisable `.popup-sheet-mobile`, appliquée d'abord à « Nouvel opérateur » ([back-office](src/app/back-office/components/back-office/back-office.component.html)).
- 🔵 **Accueil** (< 768px) : chiffres clés sur une ligne, accès rapide en grille 2×2 avec 2 raccourcis mobiles « Encoder un traitement » et « Exporter le registre » (ouvrent directement la popup du carnet : [registre.component.ts](src/app/registre/components/registre/registre.component.ts), paramètre `?action=`) ; carte en aperçu (un doigt fait défiler la page) avec « Voir toutes mes parcelles » posé dessus ([back-office.component.ts](src/app/back-office/components/back-office/back-office.component.ts)) ; titres des sections visibles sous la barre après un raccourci ; zones tactiles 44px.
- 🔧 **Test sur téléphone** : [environment.development.ts](src/environments/environment.development.ts) `apiRegistre: '/api-local'` + entrée `/api-local` dans [proxy.conf.json](proxy.conf.json) (→ localhost:5000). Développement uniquement ; redémarrer `ng serve`.
- Styles : section « ONGLET 2 » de [_mobile.scss](src/styles/_mobile.scss).

---

## 31. Version mobile — onglet 3 « Mon compte » (09/10/2026)

Pour essai (retour arrière prévu). Sauvegarde : `Desktop\Appi'Field\sauvegardes-mobile\onglet3-avant\`. Styles : section « ONGLET 3 » de [_mobile.scss](src/styles/_mobile.scss). Re-test : 41/41 (3 appareils mobiles + version ordinateur), aucune écriture envoyée.
- 🐞 **Popups « Nouvel opérateur » / « Nouveau fertilisant » décalées vers le bas** (téléphone **et ordinateur**, bug antérieur) : leur fond porte la classe `.modal-overlay`, que Materialize stylise aussi (`height: 125%`) → corrigé pour toutes les tailles d'écran.
- 🔵 Ces deux formulaires en **panneau du bas** sur mobile ([create-user](src/app/reglage/components/create-user/create-user.component.html), [personal-products](src/app/reglage/components/personal-products/personal-products.component.html)).
- 🔵 Mobile : grand titre masqué (déjà dans la barre du haut) ; sections en **pastilles** compactes collées sous la barre du haut au défilement ; **« Enregistrer » collé en bas** au-dessus de la barre de navigation (Infos perso, Exploitation, Mot de passe) ; sections sans cadre sous 576px ; zones tactiles 44px ; libellés de la barre du bas en 12px.
- 🔵 Claviers / remplissage : numéro d'exploitant et TVA en clavier numérique, mots de passe (`current-password` / `new-password`), e-mail des mandats ([infos-perso](src/app/reglage/components/infos-perso/infos-perso.component.html), [infos-exploitation](src/app/reglage/components/infos-exploitation/infos-exploitation.component.html), [password](src/app/reglage/components/password/password.component.html), [mandats](src/app/reglage/components/mandats/mandats.component.html)). Phytolicence laissée en clavier texte (bug d'audit n°10 à trancher).

---

## 32. Version mobile — onglet 4 « Parcelles + Ma carte » (09/10/2026)

D'après la [maquette validée](https://claude.ai/artifact/Q7ibQXu4wkiddUe4ybxDiY), pour essai (retour arrière prévu). Sauvegarde : `Desktop\Appi'Field\sauvegardes-mobile\onglet4-avant\`. Styles : section « ONGLET 4 » de [_mobile.scss](src/styles/_mobile.scss). Re-test : 57 contrôles OK, aucune écriture envoyée ; version ordinateur inchangée.
- 🔵 **Parcelles** ([parcelles.component.html](src/app/parcelles/components/parcelles/parcelles.component.html)) : chiffres sur une ligne ; « Ajouter une parcelle » → **bouton rond +** en bas à droite, choix en panneau du bas (fond assombri qui ferme) ; « Supprimer la sélection » seulement quand une parcelle est cochée ; filtres et crayon 44px ; popup en panneau du bas, « Supprimer la parcelle » en contour rouge après « Mettre à jour ».
- 🐞 **Ma carte recouvrait les barres du haut et du bas** (mode plein écran) → la carte se place entre les deux ; la flèche ← remplace « Quitter le mode carte » (retour à Parcelles même si la page a été ouverte directement — [header.component.ts](src/app/core/header/component/header/header.component.ts)).
- 🔵 **Ma carte** ([get-parcelles.component.html](src/app/parcelles/components/get-parcelles/get-parcelles.component.html)) : recherche pleine largeur, Satellite en bouton rond ; les 5 gros boutons remplacés par **« + Ajouter »** et un panneau du bas (Tracer un polygone, Placer un point, Par adresse, Parcellaire PAC, chacun expliqué) ; barre « Terminer / Annuler » du tracé au-dessus de la barre du bas ; les 5 popups en panneau du bas.
- 🆕 **« Ma position »** ([get-parcelles.component.ts](src/app/parcelles/components/get-parcelles/get-parcelles.component.ts), `locateMe()`) : centre la carte sur la position du téléphone (point bleu + cercle de précision). Aucun appel serveur. Fonctionne en https / localhost / application installée ; message clair si refusée ou sur une adresse non sécurisée (http://192.168.x.x). Pour les stores : texte d'autorisation de localisation à prévoir.

---

## 33. Version mobile — onglet 5 « Inventaire » (09/10/2026)

Pour essai (retour arrière prévu). Sauvegarde : `Desktop\Appi'Field\sauvegardes-mobile\onglet5-avant\`. Styles : section « ONGLET 5 » de [_mobile.scss](src/styles/_mobile.scss). Re-test : 32/32, aucune écriture envoyée ; version ordinateur inchangée. (Base locale : un seul produit.)
- 🔵 La barre flottante « PPNU & PPNV / Achat PPP », qui cachait le graphique et l'historique, est remplacée par le **bouton rond +** (choix en panneau du bas) — [accueil-inventaire.component.html](src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.html).
- 🔵 Popups PPNU et Achat en **panneau du bas** (règle étendue aux popups à fond `#overlay`, utile aussi pour le Carnet).
- 🔵 Fiche du produit : graphique plus petit, **4 chiffres en grille 2 × 2** (valeur au-dessus du libellé) ; « Afficher en mL » et « Exporter » 44px.
- 🔵 Sous 576px : **historique et PPNU en cartes** (plus de défilement de côté, en-têtes de 10,5px supprimés) ; choix du produit sans cadre, juste sous le titre (26px, une ligne) ; liste des produits limitée en hauteur.
- 🔵 Pages avec bouton + : le pied de page laisse la place au bouton (logo CORDER visible).

---

## 34. Version mobile — onglet 6a « Carnet : page, cultures, détail, popup Culture » (09/10/2026)

Pour essai (retour arrière prévu). Sauvegarde : `Desktop\Appi'Field\sauvegardes-mobile\onglet6a-avant\`. Styles : section « ONGLET 6a » de [_mobile.scss](src/styles/_mobile.scss). Re-test avec 6 cultures (5 de test) : 26/26, aucune écriture envoyée ; version ordinateur inchangée.
- 🔵 La barre flottante « Culture / Traitement phyto / Travail au champ », qui cachait les interventions, est remplacée par le **bouton rond +** (choix en panneau du bas) ; le « retour en haut » commun revient sur le Carnet.
- 🔵 **Filtres en pastilles avec texte** (Vue, Dates, Parcelles, Cultures) sur une ligne qui défile de côté ; recherche sans cadre, texte d'exemple « Rechercher une culture… » — [registre.component.html](src/app/registre/components/registre/registre.component.html).
- 🔵 **Cartes de culture compactes** : nom + pastilles (catégorie, parcelles) ; interventions en **liste** (date, parcelle, type en pastille, détail) au lieu d'un tableau coupé.
- 🔵 **Détail d'une culture en panneau du bas** ([culture-detail-popup](src/app/registre/components/culture-detail-popup/culture-detail-popup.component.html)) : historique en cartes (parcelle lisible, plus de « U… »), crayon 44px, « Modifier la culture » en grand puis « Archiver » et « Supprimer » côte à côte.
- 🔵 **Popup « Ajouter une culture » en panneau du bas.**
- Données de test locales « TEST-CLAUDE » (5 cultures, 10 travaux) : `scratchpad/pw/seed-carnet.js clean` pour les supprimer.

---

## 35. Version mobile — onglet 6b « Travail au champ » (09/10/2026)

Pour essai (retour arrière prévu). Sauvegarde : `Desktop\Appi'Field\sauvegardes-mobile\onglet6b-avant\`. Styles : section « ONGLET 6b » de [_mobile.scss](src/styles/_mobile.scss). Re-test : 25/25, aucune écriture envoyée ; version ordinateur inchangée.
- 🔵 Popup en **panneau du bas** (94 % de l'écran), titre 20px sur une ligne, croix 40px, toucher le fond ferme.
- 🔵 Écran « Type » : les **5 types visibles sans défiler**.
- 🔵 Écran « Parcelles » : **1er groupe ouvert automatiquement** ([travail-au-champ.component.ts](src/app/registre/components/travail-au-champ/travail-au-champ.component.ts), accord de l'utilisateur) ; titres de groupe 16px, « Tout sélectionner » sous le titre, cases 22px, boutons de regroupement 44px sur une ligne.
- 🔵 Formulaires : date en pleine largeur (elle était coupée), quantité + unité côte à côte ; pied « Précédent » + « Valider » sur une ligne.

---

## 36. Version mobile — onglet 6c « Traitement phyto, Export, Mes archives » (10/10/2026)

Pour essai (retour arrière prévu). Sauvegarde : `Desktop\Appi'Field\sauvegardes-mobile\onglet6c-avant\`. Styles : section « ONGLET 6c » de [_mobile.scss](src/styles/_mobile.scss). Re-test : 33/33, aucune écriture envoyée ; version ordinateur inchangée. (La culture de test « TEST-CLAUDE Colza » a été archivée le temps du test puis restaurée.)
- 🔵 **Traitement phyto** : panneau du bas (94 %), titre 20px, croix 40px, « Précédent » + « Valider » côte à côte, toucher le fond ferme ; groupes de parcelles lisibles avec **1er groupe ouvert automatiquement** ([traitement-phyto.component.ts](src/app/registre/components/traitement-phyto/traitement-phyto.component.ts), même logique que Travail au champ, accord de l'utilisateur) ; cartes de fertilisant compactes, poubelle 44px.
- 🔵 **Export** ([export-popup.component.html](src/app/registre/components/export-popup/export-popup.component.html)) : panneau du bas, listes en taille normale, « Toutes / Actives / Archivées » 44px, « Annuler » + « Exporter » côte à côte.
- 🔵 **Mes archives** : grand titre et « Retour au carnet de champ » masqués sur mobile (déjà dans la barre du haut), recherche sans cadre, **archives en cartes** (collection + Restaurer, puis nom en entier et date).

---

## 37. Version mobile — onglet 7 « Finaliser mon inscription + Gestion des opérateurs » (10/10/2026)

Pour essai (retour arrière prévu). Sauvegarde : `Desktop\Appi'Field\sauvegardes-mobile\onglet7-avant\`. Styles : section « ONGLET 7 » de [_mobile.scss](src/styles/_mobile.scss). Re-test (compte neuf simulé, aucune écriture) : 36/36 ; version ordinateur inchangée.
- 🔵 **Parcours d'inscription guidé** : sur ces deux pages, plus de barre du bas, de flèche ← ni d'icône « Mon compte » (logo à la place) — [header.component.ts](src/app/core/header/component/header/header.component.ts), liste `ONBOARDING_PAGES`. L'utilisateur termine son inscription avant d'accéder au reste.
- 🔵 Haut de page allégé (titre 28px sur une ligne, icône 40px) ; **« Suivant » / « Terminer » collés en bas de l'écran**.
- 🔵 Opérateurs : poubelle 44px, phytolicence 13px, nom long sur 2 lignes.

**✅ Version mobile : les 7 onglets sont faits (sections 29 à 37).** Suite prévue : re-test mobile global + essai sur téléphone, points en attente, commit, nettoyage, PWA, configuration de production, Capacitor, stores.

---

## 27. Bugs connus, non corrigés (audit du 28/09/2026)

1. ✅ *Corrigé le 03/10/2026 (26d).* **Mon compte — nom/prénom :** sauvegarde « fire-and-forget » (`MonProfilService.updateMonProfil`) → succès affiché même en cas d'échec ; nom de la sidebar pas mis à jour avant reconnexion.
2. ✅ *Corrigé le 03/10/2026 (26d).* **Mon compte — « Date d'enregistrement » toujours vide :** profil lu depuis le localStorage, qui ne contient pas cette date.
3. **Accueil public — redirection en boucle :** `{{ onRouteAdmin() }}` dans le template.
4. ✅ *Corrigé le 03/10/2026 (26e).* **Parcelles, 993–1200px (régression de la refonte) :** colonne Localisation plus masquée ; `getVisibleColumnCount()` = 5 au lieu de 6.
5. ~~Accueil connecté : superficie totale sans conversion d'unité.~~ ✅ Corrigé le 03/10/2026 (section 26c).
6. Mon compte — TVA : champ impossible à vider, curseur qui saute.
7. ✅ *Corrigé le 03/10/2026 (26d).* Mon compte — exploitation : enregistrable vide ; code postal accepte lettres/décimales.
8. Accueil public : cartes « À propos » réagissant au survol sans être cliquables ; description de « Entièrement gratuit » hors sujet.
9. Boutons « Informations » des formations : `<button>` dans un `<a>`.
10. Placeholder phytolicence `XX.X.XXXX` au lieu du format réel `23.2.00445`.

---

## 28. Retour arrière

Sections 10 à 26 : code source versionné → `git checkout -- <fichier>` sur les fichiers listés. Les nouveaux fichiers (`_auth-form.scss`, `_add-menu.scss`, `back-to-top.component.ts`) peuvent être supprimés avec leurs références.

**Reste à faire (v2.0) :** **test global de toute l'application**, puis état des lieux du frontend pour refactorisation/nettoyage (Materialize + Bootstrap, code mort, SCSS lourds, bugs de la section 27, Mes préférences et catégories Phytoweb).

---

## Fichiers strictement locaux (jamais commités, jamais déployés)

| Fichier | Rôle |
|---|---|
| `server/.env.local` | Surcharge de config locale (base locale + `READONLY_MODE`) |
| `server/migrations/000_local_dev_schema.sql` *(committable si besoin)* | Script de création de la base locale — peut être commité sans risque, il ne s'exécute jamais automatiquement |

Tout le reste listé ci-dessus est du code source normal : sera répercuté sur le déploiement dès qu'il sera poussé sur la branche utilisée pour déployer.
