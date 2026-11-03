# Retouches frontend et préférence « Je déclare mes parcelles à la PAC »

Guide d'implémentation **frontend**. Les sections 1 à 4 ne concernent que le frontend. Les sections 5 et 6 portent sur une préférence déjà ajoutée au backend.

## Résumé

| Page | Modifications |
|---|---|
| Sidebar | Espacement du logo |
| `/parcelles` | Bouton Modifier toujours visible, libellé « Sur ma carte » |
| `/parcelles/voir-parcelles` | Position du bouton « Ajouter une parcelle » |
| Popups « Modifier la parcelle » | Libellé « Enregistrer », position des boutons |
| `/registre` | Titres des cartes, tag parcelles, point jaune « tiers », champ « tiers » du formulaire |
| `/inventaire` | Débordement des quantités, bouton « Nouveau », textes de l'import |
| `/reglage` + `/parcelles` | Nouvelle préférence PAC : code SIGEC et « Archiver et renouveler » conditionnels |

---

## 1. Logo de la sidebar

**Fichier** : [header.component.scss](../src/app/core/header/component/header/header.component.scss) (`.sidebar-top`, vers la ligne 69)

```scss
.sidebar-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 4px 0;   // au lieu de 14px 6px
    // margin-bottom: 12px à retirer
    flex-shrink: 0;
}
```

---

## 2. Parcelles

### 2.1 `/parcelles` : bouton Modifier toujours visible

**Problème** : quand le tableau est plus large que son conteneur, `.table-scroll` le fait défiler horizontalement. La dernière colonne (`.action-col`), qui contient le crayon, sort alors de la zone visible.

**Correction** : fixer cette colonne à droite, dans [parcelles.component.scss](../src/app/parcelles/components/parcelles/parcelles.component.scss) (`.action-col`, vers la ligne 260). Le fond doit être repris, sinon les autres colonnes apparaissent en transparence quand on fait défiler.

```scss
.action-col {
    width: 56px;
    text-align: right;
    position: sticky;
    right: 0;
    z-index: 1;
    background: #ffffff;
}

thead th.action-col { background: #f8f9fa; }
tbody tr:hover .action-col { background: #f8fbfb; }
tbody tr.selected-row .action-col { background: #f0faf9; }
```

### 2.2 `/parcelles` : libellé du menu « Ajouter une parcelle »

**Fichier** : [parcelles.component.html](../src/app/parcelles/components/parcelles/parcelles.component.html), ligne 37. Remplacer « Dessiner sur ma carte » par **« Sur ma carte »**.

### 2.3 `/parcelles/voir-parcelles` : position du bouton « Ajouter une parcelle »

L'ordre souhaité, de haut en bas, est :

1. le titre « Ma carte » ;
2. le bouton « Ajouter une parcelle » ;
3. le bouton « Retour à mes parcelles » (ou « Mode carte plein écran », qui occupe le même emplacement hors du mode plein écran).

**Fichier** : [get-parcelles.component.html](../src/app/parcelles/components/get-parcelles/get-parcelles.component.html), lignes 19 à 90. Sortir tout le bloc `add-menu` de `.panel-title-row`, sans modifier son contenu :

```html
<div class="panel-title-row">
    <h1 class="principal">Ma carte</h1>
</div>

<div class="add-menu add-menu-desktop" [class.open]="isFabOpen" (click)="$event.stopPropagation()">
    <!-- … contenu actuel inchangé … -->
</div>

<div class="map-mode-controls mb-3">
```

Ajouter une marge sous `.add-menu` si nécessaire, et vérifier que la liste déroulante reste entièrement visible dans le panneau de gauche, qui est étroit.

### 2.4 Popups « Modifier la parcelle »

Sur les deux pages :

- le bouton s'appelle **« Enregistrer »** ;
- **« Enregistrer »** et **« Archiver la parcelle »** échangent leur place.

**[parcelles.component.html](../src/app/parcelles/components/parcelles/parcelles.component.html)** (lignes 558 à 584) : supprimer la branche `@else if (editMode)` du libellé « Mettre à jour », puis placer « Archiver » avant « Enregistrer » :

```html
@if (editMode) {
    <button type="button" class="btn-secondary" (click)="openArchiveChoice()">
        <i class="bi bi-archive"></i>
        Archiver la parcelle
    </button>
}
<button type="submit" class="btn-primary" (click)="onSubmit()" [disabled]="!form.valid || isSaving">
    @if (isSaving) {
        <span class="spinner-border spinner-border-sm me-1" role="status"></span>
        Enregistrement...
    } @else {
        <i class="bi bi-check-circle"></i>
        Enregistrer
    }
</button>
@if (editMode) {
    <!-- bouton « Supprimer la parcelle » inchangé -->
}
```

**[get-parcelles.component.html](../src/app/parcelles/components/get-parcelles/get-parcelles.component.html)** (lignes 536 à 580) : le libellé est déjà correct. Il suffit d'échanger les deux boutons. L'ordre devient : **Archiver la parcelle**, Modifier le tracé, **Enregistrer**, Supprimer la parcelle.

---

## 3. Registre : carnet de champ

### 3.1 Titres des cartes de culture

**Fichier** : [registre-get.component.scss](../src/app/registre/components/registre-get/registre-get.component.scss), ligne 65. Passer le `h3` de `1.15rem` à **`1.25rem`**.

### 3.2 Tag parcelles sur la même ligne que le tag catégorie

**Fichier** : [registre-get.component.html](../src/app/registre/components/registre-get/registre-get.component.html), lignes 50 à 91.

Déplacer le bloc `.section3` **à l'intérieur de `.section2`**, juste après `.category-phyto` et **avant** `.eppo-code`. Ce dernier est en `visibility: hidden` : il occupe de la place sans être visible et créerait un trou entre les deux tags. Supprimer ensuite la `<section class="row">` devenue vide.

```html
<div class="section2">
    <div class="category-phyto" …>…</div>
    <div class="section3">
        <div class="parcelles-container" (click)="toggleParcellesTooltip(culture.crop_id, $event)">
            <!-- … contenu actuel inchangé … -->
        </div>
    </div>
    <div class="eppo-code" *ngIf="culture.eppo || culture.EPPOCode">…</div>
</div>
```

Dans le SCSS (`.section3`, ligne 131), retirer `margin-top: 8px`.

`.section2` est déjà en `flex-wrap: wrap` : si le tag catégorie est trop long, le tag parcelles passe automatiquement à la ligne.

### 3.3 Traitement par un tiers : point jaune au lieu du tag

Supprimer le tag « Tiers » et afficher un **point jaune à gauche de la date**, aux **trois** endroits où le tag apparaît aujourd'hui :

| Fichier | Tag à supprimer | Date à compléter |
|---|---|---|
| [registre-get.component.html](../src/app/registre/components/registre-get/registre-get.component.html) | ligne 109 | ligne 107, condition `ligne.originalData?.third_part_flag` |
| [registre-get-vue-globale.component.html](../src/app/registre/components/registre-get-vue-globale/registre-get-vue-globale.component.html) | lignes 70 à 72 | ligne 57, condition `event.eventType === 'traitement' && event.originalData?.third_part_flag` |
| [culture-detail-popup.component.html](../src/app/registre/components/culture-detail-popup/culture-detail-popup.component.html) | lignes 112 à 114 | ligne 108, condition `intervention.originalData?.third_part_flag` |

Exemple pour `registre-get` :

```html
<td>
    @if (ligne.originalData?.third_part_flag) {
        <span class="dot-tiers"
              title="Traitement effectué par un tiers : ses produits ne sont pas déduits de votre inventaire"
              aria-label="Traitement effectué par un tiers"></span>
    }
    {{ formatDateShort(ligne.date) }}
</td>
```

Dans [styles.scss](../src/styles.scss) (ligne 1552), remplacer `.badge-tiers` par :

```scss
// Point jaune : traitement effectué par un tiers (thirdPartFlag), non déduit de l'inventaire.
.dot-tiers {
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-right: 6px;
    border-radius: 50%;
    background: #f5b301;
    vertical-align: middle;
    cursor: help;
}
```

### 3.4 Formulaire de traitement : champ « Traitement effectué par un tiers »

Le champ passe d'une case à cocher à un **choix Oui/Non**, sur le même modèle que « S'agit-il d'un traitement localisé ? », placé **juste à sa droite**, avec **Non** par défaut.

**Fichier** : [traitement-phyto.component.html](../src/app/registre/components/traitement-phyto/traitement-phyto.component.html)

1. Supprimer le bloc actuel (lignes 96 à 111).
2. L'ajouter juste après le bloc « traitement localisé » (après la ligne 312) :

```html
<article class="col-lg-6">
    <p></p>
    <div style="display:flex; align-items:center; gap:6px;">
        <label class="simple-label" style="margin:0;">Traitement effectué par un tiers</label>
        <i class="bi bi-info-circle-fill popup-tooltip-icon"
           matTooltip="Choisissez Oui si le traitement a été réalisé par un tiers (entrepreneur, voisin…) avec ses propres produits. Les quantités de produits de ce traitement ne seront pas déduites de votre inventaire. Le traitement reste enregistré normalement dans votre registre."
           matTooltipPosition="above"></i>
    </div>
    <div class="yes-no-toggle">
        <input type="radio" id="third-part-oui" [value]="true" name="third_part_flag" formControlName="third_part_flag" />
        <label for="third-part-oui" [class.active]="formTraitement.value.third_part_flag === true">
            <i class="bi bi-check-circle-fill"></i>
            <span>Oui</span>
        </label>
        <input type="radio" id="third-part-non" [value]="false" name="third_part_flag" formControlName="third_part_flag" />
        <label for="third-part-non" [class.active]="formTraitement.value.third_part_flag === false">
            <i class="bi bi-x-circle-fill"></i>
            <span>Non</span>
        </label>
    </div>
</article>
```

3. Supprimer le style `.third-part-check`, devenu inutile ([traitement-phyto.component.scss](../src/app/registre/components/traitement-phyto/traitement-phyto.component.scss), ligne 5522).

> ⚠️ **Garder les valeurs booléennes** `[value]="true"` et `[value]="false"`. Ne pas reprendre `value="Oui"` / `value="Non"` comme pour le traitement localisé : le code convertit ce champ avec `!!` ([registre.service.ts](../src/app/registre/services/registre.service.ts), ligne 180), et le texte « Non » serait lu comme **vrai**. Tous les traitements seraient alors enregistrés comme faits par un tiers et sortiraient de l'inventaire.
>
> Avec ces valeurs, aucune autre modification n'est nécessaire dans le TS : le champ vaut déjà `false` par défaut.

---

## 4. Inventaire

### 4.1 Quantités qui dépassent de la carte

**Problème** : le graphique a une largeur fixe de 150 px et les quantités ne peuvent pas passer à la ligne (`white-space: nowrap`). Quand la carte devient étroite, elles sortent de `.inventory-card` par la droite.

**Fichier** : [accueil-inventaire.component.scss](../src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.scss)

```scss
.inventory-body {
    // … existant …
    flex-wrap: wrap;          // les statistiques passent sous le graphique si la place manque
}

.stats-container {
    flex: 1 1 220px;          // au lieu de flex: 1
    // … existant …
}

.stat-item {
    // … existant …
    flex-wrap: wrap;          // la valeur passe sous son libellé en dernier recours

    .stat-value {
        // … existant …
        margin-left: auto;    // reste alignée à droite, même à la ligne
    }
}
```

### 4.2 Achat de produit : bouton « Nouveau » (produits personnels)

**Fichiers** : [achat-de-ppp.component.html](../src/app/inventaire/components/achat-de-ppp/achat-de-ppp.component.html) (ligne 148) et [achat-de-ppp.component.scss](../src/app/inventaire/components/achat-de-ppp/achat-de-ppp.component.scss) (lignes 441 et 467)

**Style** : retirer la classe `btn`, qui apporte l'ombre portée, et utiliser le style commun des boutons secondaires :

```html
<button type="button" class="btn-secondary btn-create-perso"
        (click)="showNewPersonalProductForm = !showNewPersonalProductForm">
```

```scss
.btn-create-perso {
    flex: 0 0 auto;
    white-space: nowrap;

    i { color: $color-primary !important; }
}
```

**Alignement** : les largeurs actuelles (75 % + 25 % + 8 px d'espace) dépassent 100 % de la ligne. Laisser le champ de recherche prendre la place restante, et vérifier qu'il ne garde pas de marge basse :

```scss
.personal-search-create-row {
    display: flex;
    align-items: center;
    gap: 8px;

    .perso-search-field {
        flex: 1 1 auto;     // au lieu de flex: 0 0 75%
        width: auto;        // au lieu de 75%
        min-width: 0;

        input { margin-bottom: 0; }
    }

    // bloc @media (max-width: 420px) inchangé
}
```

### 4.3 Textes de l'import

- **« Importer des achats » devient « Importer des produits »** dans [accueil-inventaire.component.html](../src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.html), lignes 22 (bouton), 58 (menu) et 671 (titre de la popup).
- **Bloc descriptif** dans [import-achats.component.html](../src/app/inventaire/components/import-achats/import-achats.component.html), ligne 19 :

  > Colonnes : numéro d'autorisation, nom du produit, **quantité**, unité (L ou Kg), date d'achat.

---

## 5. Contrat API de la nouvelle préférence

Le backend est prêt. La nouvelle préférence s'ajoute aux routes existantes :

| Champ | Type | Défaut | Signification |
|---|---|---|---|
| `pacDeclarationFlag` | `boolean` | `true` | L'utilisateur déclare ses parcelles à la PAC |

```json
GET /user_preferences
{
  "erRiWarningFlag": false,
  "spe8HourWarningFlag": true,
  "bbchWarningFlag": true,
  "pacDeclarationFlag": true,
  "defaultTreatmentType": "surface",
  "defaultEventType": "phyto_surface_treatment"
}
```

```json
PUT /user_preferences
{ "pacDeclarationFlag": false }
```

Le `PUT` renvoie les préférences complètes à jour. Une valeur qui n'est pas un booléen renvoie une erreur `400`.

**L'affichage est géré par le frontend** : le backend continue d'accepter `sigecCode` et `/renew` quelle que soit la préférence.

---

## 6. Préférence « Je déclare mes parcelles à la PAC »

| `pacDeclarationFlag` | Champ « Code SIGEC de la parcelle » | Popup « Archiver la parcelle » |
|---|---|---|
| `true` (coché, par défaut) | Affiché en création et en modification | « Archiver » et « Archiver et renouveler » |
| `false` | Masqué en création et en modification | « Archiver » uniquement |

### 6.1 Service : [user-preferences.service.ts](../src/app/reglage/services/user-preferences.service.ts)

```ts
export interface UserPreferences {
  // … champs existants …
  pacDeclarationFlag: boolean;
}

/** En cas d'erreur ou de réponse incomplète, on garde le comportement actuel (champ affiché). */
declaresToPac(): Observable<boolean> {
  return this.get().pipe(
    map(prefs => prefs.pacDeclarationFlag !== false),
    catchError(() => of(true))
  );
}
```

### 6.2 Réglages > Préférences

**[preferences.component.ts](../src/app/reglage/components/preferences/preferences.component.ts)** : ajouter `pacDeclarationFlag: true` à la valeur initiale du signal `prefs` (ligne 30).

**[preferences.component.html](../src/app/reglage/components/preferences/preferences.component.html)** : ajouter ce groupe après « Type d'encodage de traitements » (après la ligne 73) :

```html
<div class="preferences-group">
  <h3 class="preferences-group__title">Encodage des parcelles</h3>

  <label class="preferences-check" for="prefPac">
    <input type="checkbox" id="prefPac"
           [checked]="prefs().pacDeclarationFlag"
           [disabled]="saving()"
           (change)="save('pacDeclarationFlag', $any($event.target).checked)">
    <div class="preferences-check__text">Je déclare mes parcelles à la PAC</div>
    <i class="bi bi-info-circle-fill popup-tooltip-icon"
       matTooltip="Si vous décochez cette case, le code SIGEC et l'option « Archiver et renouveler » ne sont plus proposés pour vos parcelles."
       matTooltipPosition="above"></i>
  </label>
</div>
```

La phrase d'introduction (ligne 14) ne parle que des traitements. La remplacer par : « Ces réglages s'appliquent à l'encodage de vos traitements et de vos parcelles. Ils sont enregistrés automatiquement. »

### 6.3 Chargement dans les pages de parcelles

Dans [parcelles.component.ts](../src/app/parcelles/components/parcelles/parcelles.component.ts) (ligne 621) et [get-parcelles.component.ts](../src/app/parcelles/components/get-parcelles/get-parcelles.component.ts) (ligne 227) :

```ts
private userPreferencesService = inject(UserPreferencesService);
declaresToPac = true;

ngOnInit(): void {
  this.userPreferencesService.declaresToPac().subscribe(value => this.declaresToPac = value);
  // … existant …
}
```

La préférence est relue à chaque ouverture de la page. Un changement fait dans Réglages s'applique donc au retour sur `/parcelles`.

### 6.4 Masquer le champ « Code SIGEC »

Entourer le champ d'un `@if (declaresToPac) { … }` aux **cinq** endroits où il apparaît :

| Fichier | Ligne | Formulaire |
|---|---|---|
| [parcelles.component.html](../src/app/parcelles/components/parcelles/parcelles.component.html) | 506 | Ajout par adresse et modification |
| [get-parcelles.component.html](../src/app/parcelles/components/get-parcelles/get-parcelles.component.html) | 482 | Ajout par adresse et modification |
| [get-parcelles.component.html](../src/app/parcelles/components/get-parcelles/get-parcelles.component.html) | ~658 | Ajout par point GPS |
| [get-parcelles.component.html](../src/app/parcelles/components/get-parcelles/get-parcelles.component.html) | 844 | Ajout depuis le parcellaire PAC on Web |
| [get-parcelles.component.html](../src/app/parcelles/components/get-parcelles/get-parcelles.component.html) | 976 | Ajout par polygone |

```html
@if (declaresToPac) {
    <div class="col-lg-12">
        <label class="simple-label" for="sigec_code">Code SIGEC de la parcelle</label>
        <input type="text" class="form-control popup-text-input" id="sigec_code"
               placeholder="Ex : 12345A" formControlName="sigec_code">
    </div>
}
```

> **Ne masquer que l'affichage.** Il ne faut pas retirer le contrôle `sigec_code` du formulaire ni modifier le code d'enregistrement. Un code déjà saisi reste ainsi dans le formulaire et n'est pas effacé quand on modifie la parcelle avec le champ masqué.

Les commentaires « toujours visible » au-dessus du champ sont aussi à retirer.

### 6.5 Popup d'archivage

**[parcel-archive-choice.component.ts](../src/app/parcelles/components/parcel-archive-choice/parcel-archive-choice.component.ts)** :

```ts
/** false si l'utilisateur ne déclare pas ses parcelles à la PAC : seul « Archiver » est proposé. */
@Input() canRenew = true;
```

**[parcel-archive-choice.component.html](../src/app/parcelles/components/parcel-archive-choice/parcel-archive-choice.component.html)** : entourer le bouton « Archiver et renouveler » (lignes 20 à 31) d'un `@if (canRenew) { … }`.

**Dans les deux parents** ([parcelles.component.html](../src/app/parcelles/components/parcelles/parcelles.component.html) ligne 592, [get-parcelles.component.html](../src/app/parcelles/components/get-parcelles/get-parcelles.component.html) ligne 1230) :

```html
<app-parcel-archive-choice [parcel]="selectedParcelForEdit" [canRenew]="declaresToPac"
    (done)="onArchiveDone($event)" (closed)="showArchiveChoice = false"></app-parcel-archive-choice>
```

---

## 7. Points d'attention

- **Ordre de déploiement** : d'abord la migration SQL `server/migrations/017_add_user_preferences_pac_declaration.sql`, puis le backend, puis le frontend. Déployé sans la migration, le nouveau backend casserait `/user_preferences` et `/phyto_treatments/warnings`.
- **Mandats** : dans `/reglage`, on modifie toujours ses propres préférences. Dans `/parcelles`, en travaillant dans l'espace d'un autre utilisateur, c'est la préférence **du propriétaire** qui s'applique. Il n'y a rien à faire : l'intercepteur gère déjà l'en-tête.
- **Page d'archives des parcelles** : la colonne « Code SIGEC » reste affichée, quelle que soit la préférence.

## 8. Tests à faire

**Sidebar et parcelles**

1. Le logo de la sidebar est bien collé en haut, avec 4 px d'espace dessous, sidebar dépliée et repliée.
2. En réduisant progressivement la largeur de l'écran sur `/parcelles`, le crayon reste visible et la colonne garde un fond opaque pendant le défilement.
3. Le menu « Ajouter une parcelle » de `/parcelles` affiche « Sur ma carte ».
4. Sur la carte, l'ordre est : titre, « Ajouter une parcelle », puis « Retour à mes parcelles » ou « Mode carte plein écran ». La liste déroulante est entièrement visible.
5. Dans les deux popups de modification, le bouton s'appelle « Enregistrer », et sa place est échangée avec celle d'« Archiver la parcelle ».

**Registre**

6. Les titres de culture sont légèrement plus grands.
7. Les tags catégorie et parcelles sont sur la même ligne, et le tag parcelles passe à la ligne avec une catégorie longue. L'infobulle des parcelles fonctionne toujours.
8. Le point jaune apparaît à gauche de la date dans les trois vues, avec son infobulle au survol. Le tag « Tiers » n'apparaît plus nulle part.
9. **Nouveau traitement sans toucher au champ « tiers »** : « Non » est sélectionné, la requête envoie `"thirdPartFlag": false`, et le produit est bien déduit de l'inventaire.
10. **Traitement avec « Oui »** : la requête envoie `"thirdPartFlag": true`, et le produit n'est pas déduit. En modification, « Oui » est bien présélectionné.

**Inventaire**

11. En réduisant la largeur de l'écran, avec de grandes quantités (ex. 12 345,67 L), aucune valeur ne dépasse de la carte.
12. Le bouton « Nouveau » est aligné avec le champ de recherche, sans ombre portée, et a le même style que les autres boutons secondaires.
13. L'import s'intitule « Importer des produits » dans le bouton, le menu et la popup, et le bloc descriptif mentionne « quantité ».

**Préférence PAC**

14. Pour un utilisateur existant, la case « Je déclare mes parcelles à la PAC » est cochée, dans la section « Encodage des parcelles ». Après l'avoir décochée et rechargé la page, elle reste décochée.
15. **Case décochée** : le champ « Code SIGEC » n'apparaît dans aucun des formulaires (adresse, point, polygone, PAC on Web, modification), et la popup d'archivage ne propose que « Archiver ».
16. **Parcelle qui a déjà un code SIGEC, case décochée** : modifier son nom et enregistrer. En recochant la case, le code est toujours là.
17. **Case cochée** : le champ et « Archiver et renouveler » sont de retour.
