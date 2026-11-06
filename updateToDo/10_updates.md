# Accueil, suppression de la préférence PAC, renouvellement des parcelles et remarque des corrections

Guide d'implémentation **frontend**. Le backend est déjà prêt pour les sections 3 et 4.

## Résumé

| # | Modification | Backend |
|---|---|---|
| 1 | Accueil : nouveau texte « À propos de l'outil » | — |
| 2 | Suppression de la préférence « Je déclare mes parcelles à la PAC » : code SIGEC toujours visible | Préférence retirée |
| 3 | Renouvellement d'une parcelle : nom, superficie et unité modifiables | `POST /parcels/<id>/renew` accepte ces champs |
| 4 | Corrections de stock : champ « Remarque » | `inventoriesOperations.remarks` |

---

## 1. Accueil : texte « À propos de l'outil »

**Fichier** : [accueil.component.html](../src/app/accueil/components/accueil/accueil.component.html), ligne 52.

Remplacer « Développé en collaboration avec le CePiCOP et le CORDER, » par « Développé par l'asbl CORDER, ». Le reste du paragraphe et la mise en gras ne changent pas :

```html
<b>Appi'Field est votre compagnon numérique pour la gestion agricole au quotidien.</b><br>
Développé par l'asbl CORDER, cet outil gratuit vous accompagne dans la gestion complète de votre exploitation : de la <b>cartographie de vos parcelles</b> au suivi de vos interventions phytosanitaires, en passant par la gestion de votre <b>local phyto numérique</b>. Conforme aux <b>exigences légales de 2026</b>, Appi'Field simplifie vos démarches administratives et vous fait gagner un temps précieux.
```

---

## 2. Suppression de la préférence « Je déclare mes parcelles à la PAC »

On annule la section 6 de la note 09. Le champ « Code SIGEC de la parcelle » redevient **toujours visible**, et « Archiver et renouveler » est **toujours proposé**.

**Côté backend**, `GET /user_preferences` ne renvoie plus `pacDeclarationFlag`. S'il est envoyé dans un `PUT`, il est ignoré.

| Fichier | À faire |
|---|---|
| [user-preferences.service.ts](../src/app/reglage/services/user-preferences.service.ts) | Supprimer `pacDeclarationFlag` de l'interface `UserPreferences` (lignes 14-15) et la méthode `declaresToPac()` (lignes 40-46). Retirer `catchError`, `map` et `of` de l'import s'ils ne servent plus. |
| [preferences.component.html](../src/app/reglage/components/preferences/preferences.component.html) | Supprimer le groupe « Encodage des parcelles » (lignes 75-88). Remettre l'introduction (ligne 14) à : « Ces réglages s'appliquent à l'encodage de vos traitements. Ils sont enregistrés automatiquement. » |
| [preferences.component.ts](../src/app/reglage/components/preferences/preferences.component.ts) | Supprimer `pacDeclarationFlag: true` de la valeur initiale de `prefs` (ligne 34) |
| [parcelles.component.ts](../src/app/parcelles/components/parcelles/parcelles.component.ts) | Supprimer la propriété `declaresToPac` (ligne 40) et son chargement dans `ngOnInit` (ligne 626). Retirer l'injection de `UserPreferencesService` si elle ne sert plus. |
| [get-parcelles.component.ts](../src/app/parcelles/components/get-parcelles/get-parcelles.component.ts) | Même chose (lignes 48 et 232) |
| [parcelles.component.html](../src/app/parcelles/components/parcelles/parcelles.component.html) | Ligne 506 : retirer le `@if (declaresToPac) { … }` autour du champ SIGEC, en gardant le champ. Ligne 592 : retirer `[canRenew]="declaresToPac"`. |
| [get-parcelles.component.html](../src/app/parcelles/components/get-parcelles/get-parcelles.component.html) | Lignes 482, 661, 848 et 981 : retirer les `@if (declaresToPac) { … }` en gardant les champs. Ligne 1236 : retirer `[canRenew]="declaresToPac"`. |
| [parcel-archive-choice.component.ts](../src/app/parcelles/components/parcel-archive-choice/parcel-archive-choice.component.ts) | Supprimer l'entrée `canRenew` (lignes 20-21) |
| [parcel-archive-choice.component.html](../src/app/parcelles/components/parcel-archive-choice/parcel-archive-choice.component.html) | Retirer le `@if (canRenew) { … }` autour du bouton « Archiver et renouveler » (lignes 20 et 33), en gardant le bouton |

Pour vérifier que rien n'est oublié, une recherche de `declaresToPac`, `canRenew` et `pacDeclarationFlag` dans `src/` ne doit plus rien renvoyer.

---

## 3. Renouvellement d'une parcelle : nom, superficie et unité modifiables

### 3.1 Contrat API (déjà en place)

```json
POST /parcels/<id>/renew
{
  "sigecCode": "1234567",
  "parcelName": "Champ du bas (1)",
  "parcelArea": 2.35,
  "parcelAreaUnit": "ha"
}
```

| Champ | Obligatoire | Si absent |
|---|---|---|
| `sigecCode` | **Oui** | `400` |
| `parcelName` | Non | Nom de l'ancienne parcelle + « (1) » |
| `parcelArea` | Non | Superficie de l'ancienne parcelle |
| `parcelAreaUnit` | Non | Unité de l'ancienne parcelle |

**Erreurs `400`** : `parcelName` vide, `parcelArea` qui n'est pas un nombre supérieur à 0, ou `parcelAreaUnit` vide.

La géométrie (polygone, latitude et longitude), la catégorie, l'adresse et le type sont toujours repris de l'ancienne parcelle. La réponse ne change pas : `{ success, parcelId, archivedParcelId }`.

### 3.2 Service : [parcelles-server.service.ts](../src/app/parcelles/services/parcelles-server.service.ts), ligne 156

```ts
export interface RenewParcelData {
  sigecCode: string;
  parcelName: string;
  parcelArea: number;
  parcelAreaUnit: string; // 'ha' | 'a' | 'm2'
}

/** Archive la parcelle et crée sa copie active avec les valeurs saisies (SIGEC obligatoire). */
async renewParcelle(id: string, data: RenewParcelData): Promise<{ parcelId: string; archivedParcelId: string }> {
  const res = await this.http.post<any>(`${this.apiUrl}/${id}/renew`, data).toPromise();
  await this.afterArchiveChange();
  return res;
}
```

### 3.3 Popup : [parcel-archive-choice](../src/app/parcelles/components/parcel-archive-choice/)

L'étape « Archiver et renouveler » contient maintenant **quatre champs**, **préremplis** à l'ouverture :

| Champ | Préremplissage | Validation |
|---|---|---|
| Nom de la nouvelle parcelle | `parcel_name` de l'ancienne + « (1) » | Obligatoire |
| Superficie | `parcel_area` de l'ancienne | Nombre > 0 |
| Unité | `parcel_area_unit_fr` de l'ancienne (`ha` par défaut) | `ha`, `a` ou `m2` |
| Nouveau code SIGEC | vide | Obligatoire |

**TS** :

```ts
readonly areaUnitOptions = [
  { value: 'ha', label: 'ha' },
  { value: 'a',  label: 'a' },
  { value: 'm2', label: 'm²' },
];   // mêmes options que parcelles.component.ts

renewName = '';
renewArea: number | null = null;
renewUnit = 'ha';
renewSigecCode = '';

/** À appeler au clic sur « Archiver et renouveler », à la place de `showRenewStep = true`. */
openRenewStep(): void {
  this.renewName = `${this.parcel.parcel_name || ''} (1)`;
  const area = parseFloat(String(this.parcel.parcel_area ?? '').replace(',', '.'));
  this.renewArea = isNaN(area) ? null : area;
  const unit = String(this.parcel.parcel_area_unit_fr || 'ha').toLowerCase().replace('m²', 'm2');
  this.renewUnit = this.areaUnitOptions.some(o => o.value === unit) ? unit : 'ha';
  this.renewSigecCode = '';
  this.errorMessage = '';
  this.showRenewStep = true;
}

get canSubmitRenew(): boolean {
  return !!this.renewName.trim() && (this.renewArea ?? 0) > 0 && !!this.renewUnit && !!this.renewSigecCode.trim();
}

async archiveAndRenew(): Promise<void> {
  if (!this.canSubmitRenew) return;
  await this.run('renewed', () => this.parcellesService.renewParcelle(this.parcel.id_parcel, {
    sigecCode: this.renewSigecCode.trim(),
    parcelName: this.renewName.trim(),
    parcelArea: this.renewArea!,
    parcelAreaUnit: this.renewUnit,
  }));
}
```

**HTML** : remplacer le contenu de l'étape « renouveler » (lignes 42-54) par :

```html
<div class="popup-body archive-choice">
  <label class="simple-label" for="renewName">Nom de la nouvelle parcelle<sup class="required-mark">*</sup></label>
  <input id="renewName" type="text" class="form-control popup-text-input" [(ngModel)]="renewName" autocomplete="off">

  <div class="row g-2">
    <div class="col-8">
      <label class="simple-label" for="renewArea">Superficie<sup class="required-mark">*</sup></label>
      <input id="renewArea" type="number" min="0" step="0.0001" class="form-control popup-text-input" [(ngModel)]="renewArea">
    </div>
    <div class="col-4">
      <label class="simple-label" for="renewUnit">Unité<sup class="required-mark">*</sup></label>
      <select id="renewUnit" class="form-select popup-text-input" [(ngModel)]="renewUnit">
        @for (opt of areaUnitOptions; track opt.value) { <option [value]="opt.value">{{ opt.label }}</option> }
      </select>
    </div>
  </div>

  <label class="simple-label" for="renewSigec">Nouveau code SIGEC<sup class="required-mark">*</sup></label>
  <input id="renewSigec" type="text" class="form-control popup-text-input"
         [(ngModel)]="renewSigecCode" placeholder="Ex : 1234567"
         (keydown.enter)="archiveAndRenew()" autocomplete="off">

  <p class="archive-choice__hint">
    Une nouvelle parcelle « {{ renewName || '…' }} » sera créée avec la même géométrie, l'actuelle sera archivée.
    Les cultures, traitements et travaux déjà encodés restent liés à l'ancienne parcelle.
  </p>
  @if (errorMessage) {
    <p class="field-error"><i class="bi bi-exclamation-circle"></i>{{ errorMessage }}</p>
  }
</div>
```

**À adapter aussi :**
- **Bouton « Archiver et renouveler » de l'étape 1** (ligne 21) : `(click)="openRenewStep()"`.
- **Bouton de validation** (ligne 58) : `[disabled]="!canSubmitRenew || isArchiving"`.
- **Description de l'option** (ligne 30) : « Une copie active est créée avec un nouveau code SIGEC, un nom et une superficie modifiables. »
- **Unité** : pour rester homogène avec le formulaire de parcelle, on peut reprendre son menu déroulant maison à la place du `<select>`. Les valeurs à envoyer restent les mêmes.

> **Géométrie et superficie** : le polygone de l'ancienne parcelle est copié tel quel. Si l'utilisateur change fortement la superficie, celle-ci ne correspond plus au tracé. On le laisse libre volontairement : la superficie PAC peut différer du tracé. L'utilisateur pourra ensuite redessiner le tracé via « Modifier le tracé ».

---

## 4. Corrections de stock : champ « Remarque »

### 4.1 Contrat API (déjà en place)

Un champ texte libre **`remarks`**, optionnel, est ajouté aux mouvements d'inventaire :

| Route | Comportement de `remarks` |
|---|---|
| `POST /inventories` | Optionnel. Une chaîne vide ou composée seulement d'espaces est enregistrée `null`. |
| `PUT /inventories/<id>` | **Absent = remarque conservée.** Chaîne vide ou `null` = remarque effacée. |
| `GET /inventories` | Présent sur chaque opération (`null` si aucune). Les opérations de type traitement n'en ont pas. |

L'export Excel de l'inventaire a maintenant une colonne « Remarque » dans la feuille « Mouvements ».

### 4.2 Modèle et service

**[correction.ts](../src/app/inventaire/model/correction.ts)** :

```ts
export interface CorrectionEntry {
    date: string;
    mode: 'plus' | 'minus';
    quantity: number;
    unit: string;
    remarks?: string;   // remarque libre, facultative
}
```

**[inventaire.service.ts](../src/app/inventaire/services/inventaire.service.ts)** :
- **`EventHistory`** (ligne 19) : ajouter `remarks?: string;`.
- **`mapToRealInventoryData`** (ligne 195, à côté de `correction_mode`) : ajouter `remarks: op.remarks || undefined,`.
- **`addCorrection`** (ligne 337) et **`updateCorrectionById`** (ligne 351) : ajouter `remarks: entry.remarks ?? '',` au body. En modification, il faut **toujours** envoyer le champ, même vide, pour qu'une remarque effacée par l'utilisateur soit bien effacée côté serveur.

### 4.3 Formulaire : [correction-stock](../src/app/inventaire/components/correction-stock/)

**HTML** : ajouter le champ après le bloc « Unité » (après la ligne 108), sur toute la largeur :

```html
<!-- Remarque (facultative) -->
<div class="col-lg-12">
  <label class="simple-label" for="correctionRemarks">Remarque</label>
  <textarea id="correctionRemarks"
            class="form-control textarea-compact popup-text-input"
            name="remarks"
            [(ngModel)]="remarks"
            maxlength="500"
            rows="2"
            placeholder="Ex : bidon endommagé, erreur d'encodage, inventaire physique…"></textarea>
</div>
```

**TS** :
- **Propriété** : `remarks = '';`.
- **`checkForEditMode()`** (ligne 150) : `this.remarks = editing.entry.remarks || '';`.
- **`onSubmit()`** (ligne 243, dans `entry`) : `remarks: this.remarks.trim(),`.
- **`resetForm()`** (ligne 267) : `this.remarks = '';`.

Le champ est **facultatif** et n'entre pas dans `isFormValid`.

### 4.4 Inventaire : modification et affichage

**[accueil-inventaire.component.ts](../src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.ts)**, `onEditCorrectionEvent()` (ligne 695) : ajouter `remarks: event.remarks || '',` à l'objet passé à `setEditingCorrectionEvent`. Sinon, la remarque n'apparaît pas à l'ouverture en modification, et l'enregistrement l'efface.

**[accueil-inventaire.component.html](../src/app/inventaire/components/accueil-inventaire/accueil-inventaire.component.html)**, ligne correction de l'historique (ligne 483) : la colonne « Cible » affiche aujourd'hui « — ». Y afficher la remarque quand elle existe :

```html
<td>
  @if (usage.remarks) {
    <span class="correction-remark" [title]="usage.remarks">
      <i class="bi bi-chat-left-text"></i> {{ usage.remarks.length > 40 ? (usage.remarks | slice:0:40) + '…' : usage.remarks }}
    </span>
  } @else {
    —
  }
</td>
```

---

## 5. Déploiement

**Ordre à respecter pour le backend**, côté hébergement :

1. **Migration `018_add_inventory_operations_remarks.sql`** (ajout de la colonne `remarks`), **avant** le backend.
2. **Déployer le backend.**
3. **Migration `019_drop_user_preferences_pac_declaration.sql`** (suppression de `pacDeclarationFlag`), **après** le backend. L'ancien backend lit encore cette colonne.

**Le frontend peut être déployé après l'étape 2.** S'il part avant le backend, rien ne casse : les champs ajoutés (`remarks`, `parcelName`, `parcelArea` et `parcelAreaUnit` au renouvellement) seraient simplement ignorés jusqu'à la mise à jour du serveur.

## 6. Tests à faire

1. **Accueil** : le texte mentionne « Développé par l'asbl CORDER », et non plus le CePiCOP.
2. **Réglages > Préférences** : la section « Encodage des parcelles » a disparu.
3. **Code SIGEC** : il est visible dans tous les formulaires de parcelle (adresse, point, polygone, PAC on Web, modification), y compris pour un utilisateur qui avait décoché la préférence.
4. **Popup d'archivage** : « Archiver et renouveler » est toujours proposé.
5. **Archiver et renouveler** une parcelle « Champ A » de 2,5 ha :
   - les champs sont préremplis avec « Champ A (1) », 2,5 et ha ;
   - le code SIGEC est vide, et le bouton de validation est désactivé tant qu'il l'est.
6. **Modifier le nom, la superficie et l'unité, puis valider** : la nouvelle parcelle a ces valeurs, avec la même géométrie, et l'ancienne est archivée.
7. **Vider le nom ou mettre une superficie à 0** : le bouton de validation est désactivé.
8. **Nouvelle correction avec une remarque** : la remarque apparaît dans l'historique, à la place de « — », avec le texte complet au survol.
9. **Modifier cette correction** : la remarque est préremplie. L'effacer et enregistrer : elle disparaît de l'historique.
10. **Modifier une correction sans toucher à la remarque** : elle est conservée.
11. **Export Excel de l'inventaire** : la colonne « Remarque » est remplie pour cette correction.
