# Parcelles : archivage, renouvellement et archives

Guide d'implémentation **frontend**. Le backend est déjà prêt (voir § 1).

## Objectif

Mettre en place pour les **parcelles** le même système d'archivage que pour les cultures :

1. **Archiver une parcelle** depuis son formulaire de modification, avec deux choix :
   - **Archiver** : la parcelle est simplement archivée ;
   - **Archiver et renouveler** (infobulle : *« La même parcelle avec un nouveau numéro PAC »*) : la parcelle est archivée et une **copie active** est créée. La copie porte le nom `<nom> (1)` et le **nouveau code SIGEC** saisi par l'utilisateur, et elle est reliée à l'ancienne par `prevParcelId`.
2. **Bouton « Mes archives »** sur la page Mes parcelles, à gauche de « Ajouter une parcelle ». **Il n'y a pas d'accès aux archives depuis la vue carte.**
3. **Page d'archives des parcelles**, sur le modèle de celle des cultures, avec un bouton **Restaurer**.
4. **Les parcelles archivées ne sont plus proposées** dans les formulaires de **création** (culture, traitement, travail au champ). Dans les formulaires de **modification**, une parcelle archivée **déjà liée** reste **visible, cochée, grisée et non cliquable**, avec la mention « Parcelle archivée ». **Il en va de même pour une culture archivée** liée à un traitement ou à un travail modifié (voir § 2.5).

> **Nouveau : le code SIGEC est maintenant enregistré.** Le champ « Code SIGEC de la parcelle » existait déjà dans les formulaires, mais il n'était **jamais envoyé** au serveur (absent de `toApi`) et aucune colonne ne le stockait : il était perdu. La colonne `sigecCode` est ajoutée par la même migration. Il faut maintenant l'envoyer (voir § 2.1).

---

## 1. Contrat API (déjà en place côté backend)

### Nouveaux champs d'une parcelle (`GET /parcels`, `GET /parcels/<id>`)

| Champ | Type | Description |
|---|---|---|
| `isArchived` | `0` \| `1` | Parcelle archivée. **Lecture seule** : ignoré par `POST` et `PUT`. |
| `prevParcelId` | `string` \| `null` | Pour une parcelle renouvelée, l'id de la parcelle archivée qu'elle remplace. **Lecture seule.** |
| `sigecCode` | `string` \| `null` | Code SIGEC |

Toutes les parcelles existantes valent `isArchived = 0`, `prevParcelId = null` et `sigecCode = null`.

### Routes

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/parcels` | **Toutes** les parcelles, archivées **comprises**, chacune avec `isArchived`. C'est voulu : les écrans qui affichent des saisies existantes ont besoin des parcelles archivées. |
| `GET` | `/parcels?archived=0` | Parcelles **actives** uniquement |
| `GET` | `/parcels?archived=1` ou `/parcels/archive` | Parcelles **archivées** uniquement (pour la page d'archives) |
| `POST` | `/parcels/<id>/archive` | Archiver. `404` si la parcelle est introuvable. |
| `POST` | `/parcels/<id>/unarchive` | Restaurer. `404` si la parcelle est introuvable. |
| `POST` | `/parcels/<id>/renew` | Archiver et renouveler (détail ci-dessous) |
| `POST`/`PUT` | `/parcels`, `/parcels/<id>` | Inchangés, mais acceptent maintenant **`sigecCode`**. En `PUT`, `sigecCode` n'est modifié **que s'il est présent** dans le body. |

### `POST /parcels/<id>/renew`

```json
POST /parcels/<id>/renew
{ "sigecCode": "1234567" }
```

**Réponse 201**

```json
{ "success": true, "parcelId": "<id de la nouvelle parcelle>", "archivedParcelId": "<id de l'ancienne>" }
```

**Ce que fait le serveur, en une seule opération**

1. Il crée une nouvelle parcelle **active**, qui reprend la surface (et l'unité), la géométrie (polygone, latitude et longitude), la catégorie, l'adresse et le type (`recordType`) de l'ancienne.
2. Il la nomme **`<nom de l'ancienne> (1)`**, avec `sigecCode` égal au nouveau code et `prevParcelId` égal à l'id de l'ancienne.
3. Il archive l'ancienne parcelle.

**Erreurs**

- `400` : `sigecCode` absent ou vide. Le code SIGEC est **obligatoire** pour un renouvellement.
- `404` : parcelle introuvable.
- `409` : parcelle déjà archivée.

> **Les cultures, traitements et travaux déjà liés restent liés à l'ancienne parcelle** (archivée). Le renouvellement ne les déplace pas vers la nouvelle parcelle.

---

## 2. Modifications à faire

### 2.1 Conversion entre l'API et le frontend

**[parcelles-server.service.ts](../src/app/parcelles/services/parcelles-server.service.ts)**

- Interface `Parcelle` : ajouter

  ```ts
  is_archived?: boolean;
  prev_parcel_id?: string | null;
  sigec_code?: string;
  ```

- Dans `fromApi()`, ajouter :

  ```ts
  is_archived: !!p.isArchived,
  prev_parcel_id: p.prevParcelId ?? null,
  sigec_code: p.sigecCode || '',
  ```

- Dans `toApi()`, ajouter :

  ```ts
  if (data.sigec_code !== undefined) payload.sigecCode = data.sigec_code;
  ```

  Les formulaires mettent déjà `sigec_code` dans leurs données. Il n'arrivait simplement jamais jusqu'au serveur.

- Ajouter les méthodes suivantes, sur le modèle de `deleteParcelle`, qui recharge la liste et prévient le registre :

  ```ts
  async archiveParcelle(id: string): Promise<void> {
    await this.http.post(`${this.apiUrl}/${id}/archive`, {}).toPromise();
    await this.afterArchiveChange();
  }

  async unarchiveParcelle(id: string): Promise<void> {
    await this.http.post(`${this.apiUrl}/${id}/unarchive`, {}).toPromise();
    await this.afterArchiveChange();
  }

  async renewParcelle(id: string, sigecCode: string): Promise<{ parcelId: string; archivedParcelId: string }> {
    const res = await this.http.post<any>(`${this.apiUrl}/${id}/renew`, { sigecCode }).toPromise();
    await this.afterArchiveChange();
    return res;
  }

  getArchivedParcelles(): Promise<Parcelle[]> {
    return this.http.get<any[]>(`${this.apiUrl}/archive`).toPromise().then(rows => (rows || []).map(fromApi));
  }

  /** Les parcelles actives uniquement : à utiliser pour les listes, la carte et les statistiques. */
  getActiveParcelles(): Parcelle[] {
    return this.parcelles.filter(p => !p.is_archived);
  }

  private async afterArchiveChange(): Promise<void> {
    this.isLoaded = false;
    await this.loadParcelles();
    await this.registreService.notifyParcelUpdated(); // vide les caches parcelles/cultures du registre
  }
  ```

**[registre.service.ts](../src/app/registre/services/registre.service.ts)** : dans `parcelFromApi()` (ligne 12), ajouter les **mêmes** trois champs (`is_archived`, `prev_parcel_id`, `sigec_code`).

> Le registre met les parcelles en cache, y compris dans `localStorage` (`CACHE_KEYS.PARCELS`). Les entrées enregistrées avant la mise à jour n'ont pas `is_archived` : elles valent donc `undefined` et sont considérées comme actives. C'est correct. Il faut seulement que chaque archivage, restauration ou renouvellement appelle `notifyParcelUpdated()`, comme dans `afterArchiveChange()` ci-dessus.

### 2.2 Page « Mes parcelles » : liste, carte et bouton Archives

**[parcelles.component.ts](../src/app/parcelles/components/parcelles/parcelles.component.ts)** (vue liste) et **[get-parcelles.component.ts](../src/app/parcelles/components/get-parcelles/get-parcelles.component.ts)** (vue carte) : n'afficher **que les parcelles actives**. Partout où `getAllParcelles()` alimente la liste, la carte, les statistiques ou la pagination, remplacer par `getActiveParcelles()` (par exemple vers la ligne 174 de `parcelles.component.ts`).

**Bouton « Mes archives »**, **uniquement** dans [parcelles.component.html](../src/app/parcelles/components/parcelles/parcelles.component.html), dans l'en-tête, **juste avant** le menu `add-menu` « Ajouter une parcelle » (vers la ligne 21). On reprend le bouton du carnet de champ (`registre.component.html`, ligne 20) :

```html
<button type="button" class="btn-outline-neutral" (click)="goToArchives()">
    <i class="bi bi-archive"></i> Mes archives
</button>
```

```ts
goToArchives(): void {
  this.router.navigate(['/parcelles/archives']);
}
```

Si nécessaire, envelopper le bouton et le menu dans un conteneur flex (comme `.registre-header-actions`), pour qu'ils restent alignés à droite.

**Ne pas ajouter** ce bouton dans la vue carte (`get-parcelles`).

### 2.3 Bouton « Archiver la parcelle » dans le formulaire de modification

Dans le footer du formulaire de modification, à côté de « Supprimer la parcelle » :

- vue liste : `parcelles.component.html`, bloc `@if (editMode)` vers la ligne 565 ;
- vue carte : `get-parcelles.component.html`, bloc `@if (editMode)` vers la ligne 561. Le formulaire de modification est le même, mais **sans** accès aux archives.

```html
<button type="button" class="btn-outline-neutral" (click)="openArchiveChoice()" [disabled]="isArchiving">
    <i class="bi bi-archive"></i> Archiver la parcelle
</button>
```

Le clic ouvre une **petite popup de choix**, qui reprend `_popup-system.scss` :

```html
@if (showArchiveChoice) {
  <div class="popup-overlay" (click)="$event.target === $event.currentTarget && closeArchiveChoice()">
    <div class="popup-container popup-sm">
      <div class="popup-header"><h3>Archiver « {{ parcelBeingEdited.parcel_name }} »</h3></div>

      @if (!showRenewStep) {
        <div class="popup-body archive-choice">
          <button type="button" class="btn-outline-neutral" (click)="archiveOnly()">
            <i class="bi bi-archive"></i> Archiver
          </button>
          <button type="button" class="btn-primary" (click)="showRenewStep = true">
            <i class="bi bi-arrow-repeat"></i> Archiver et renouveler
            <i class="bi bi-info-circle-fill popup-tooltip-icon"
               matTooltip="La même parcelle avec un nouveau numéro PAC" matTooltipPosition="above"></i>
          </button>
        </div>
      } @else {
        <div class="popup-body">
          <label class="simple-label" for="renewSigec">Nouveau code SIGEC<sup>*</sup></label>
          <input id="renewSigec" type="text" class="form-control popup-text-input"
                 [(ngModel)]="renewSigecCode" placeholder="Ex : 1234567">
          <p class="form-text">Une nouvelle parcelle « {{ parcelBeingEdited.parcel_name }} (1) » sera créée,
            l'actuelle sera archivée.</p>
        </div>
        <div class="popup-footer">
          <button type="button" class="btn-secondary" (click)="showRenewStep = false">Retour</button>
          <button type="button" class="btn-primary" (click)="archiveAndRenew()"
                  [disabled]="!renewSigecCode.trim() || isArchiving">Archiver et renouveler</button>
        </div>
      }
    </div>
  </div>
}
```

```ts
showArchiveChoice = false;
showRenewStep = false;
renewSigecCode = '';
isArchiving = false;

openArchiveChoice(): void { this.showArchiveChoice = true; this.showRenewStep = false; this.renewSigecCode = ''; }
closeArchiveChoice(): void { this.showArchiveChoice = false; }

async archiveOnly(): Promise<void> {
  this.isArchiving = true;
  try {
    await this.parcellesService.archiveParcelle(this.parcelBeingEdited.id_parcel);
    this.closeArchiveChoice();
    this.closeEditForm();          // fermer le formulaire de modification (méthode existante du composant)
  } finally { this.isArchiving = false; }
}

async archiveAndRenew(): Promise<void> {
  this.isArchiving = true;
  try {
    await this.parcellesService.renewParcelle(this.parcelBeingEdited.id_parcel, this.renewSigecCode.trim());
    this.closeArchiveChoice();
    this.closeEditForm();
  } finally { this.isArchiving = false; }
}
```

- `parcelBeingEdited` et `closeEditForm()` sont des noms génériques : il faut utiliser la parcelle en cours de modification et la méthode de fermeture existantes de chaque composant (`selectedParcelForEdit` / `closeEditParcel()` dans `get-parcelles`).
- **En cas d'erreur** `400`, `404` ou `409`, afficher le message `error` renvoyé par le serveur.
- `MatTooltipModule` et `FormsModule` doivent être importés dans les composants s'ils ne le sont pas déjà.

### 2.4 Page d'archives des parcelles

Créer `src/app/parcelles/components/archives-parcelles/` en **dupliquant** [registre/components/archives](../src/app/registre/components/archives/) (mêmes styles, même structure : en-tête, recherche, tableau, état vide, Restaurer), puis :

- **Route** : dans [parcelles-routing.module.ts](../src/app/parcelles/parcelles-routing.module.ts), ajouter

  ```ts
  { path: 'archives', component: ArchivesParcellesComponent, canActivate: [AuthGuard] },
  ```

  avant la route de redirection.
- **En-tête** : titre « Mes parcelles archivées », bouton « Retour à mes parcelles », qui mène à `/parcelles`.
- **Données** : `parcellesService.getArchivedParcelles()`.
- **Recherche** : sur le nom de la parcelle et le code SIGEC. Le filtre par collection des cultures n'a pas d'équivalent : le remplacer par un filtre par **catégorie** (`parcel_category`), ou le supprimer.
- **Colonnes** (triables) : **Parcelle** (`parcel_name`), **Catégorie**, **Surface** (`parcel_area` + `parcel_area_unit_fr`), **Code SIGEC**.
  - Optionnel : une colonne **« Renouvelée par »**, qui affiche le nom de la parcelle active dont `prev_parcel_id` vaut l'id de la ligne. On la trouve dans `getAllParcelles()`, qui contient aussi les parcelles actives.
- **Bouton Restaurer** : `confirm("Voulez-vous restaurer la parcelle « … » ?")`, puis `unarchiveParcelle(id)`, puis rechargement de la liste.
  - Si la parcelle a été **renouvelée**, il vaut mieux le préciser dans le message de confirmation (« Sa version renouvelée « … (1) » restera active »), puisque les deux seront alors actives.
- **États vides** : « Aucune parcelle archivée. Archivez une parcelle depuis son formulaire de modification pour la retrouver ici. »

### 2.5 Parcelles et cultures archivées dans les formulaires

#### Règle commune

La règle est la même pour les **parcelles archivées** et pour les **cultures archivées** :

| Formulaire | Élément archivé **non lié** | Élément archivé **déjà lié** à la saisie modifiée |
|---|---|---|
| **Création** (culture, traitement, travail au champ) | absent | — (rien n'est encore lié) |
| **Modification** (culture, traitement, travail au champ) | absent | **visible, coché, grisé, non cliquable**, avec la mention « Parcelle archivée » ou « Culture archivée » |

- **Non cliquable** veut dire que l'utilisateur ne peut **ni le décocher ni le cocher**. Le lien est **conservé tel quel** à l'enregistrement : il doit donc toujours être envoyé dans le `PUT`. Le serveur enregistre les liens qu'il reçoit, archivés ou non.
- **Au niveau d'une association parcelle × culture** (traitements, travaux), l'association est verrouillée dès que **la parcelle OU la culture** est archivée.

**Style commun** (à mettre dans `src/styles/` pour le réutiliser dans les trois formulaires) :

```scss
.is-archived-locked {
  opacity: .5;
  filter: grayscale(1);
  cursor: not-allowed;
  input[type="checkbox"] { pointer-events: none; }
}
.badge-archived {
  font-size: .75rem;
  color: #6c757d;
  i { margin-right: .2rem; }
}
```

> ⚠️ **Ne pas utiliser `FormControl.disable()`** pour verrouiller un élément dans un formulaire réactif : un contrôle désactivé est **exclu** de `form.value`, et le lien serait donc **perdu** à l'enregistrement. Il faut verrouiller **l'élément HTML** (attribut `[disabled]` sur l'`<input>` + garde dans le gestionnaire de clic), pas le contrôle.

#### a) Culture : [culture.component.ts](../src/app/registre/components/culture/culture.component.ts)

La liste `parcellesList` (lignes 91 et 134) est alimentée par `getParcelles()`, qui contient **toutes** les parcelles. La filtrer :

```ts
private setParcelles(parcelles: any[]): void {
  // Création : jamais de parcelle archivée.
  // Modification : on garde uniquement les parcelles archivées déjà liées à la culture, verrouillées.
  const linkedIds = new Set((this.cultureToModify?.parcels || []).map((l: any) => l.parcelId));
  this.parcellesList.set(
    (parcelles || [])
      .filter(p => !p.is_archived || (this.cultureToModify && linkedIds.has(p.id_parcel)))
      .map(p => ({ ...p, locked: !!p.is_archived }))
  );
}
```

Appeler `setParcelles(...)` à la place de `this.parcellesList.set(parcelles || [])`, aux deux endroits.

Dans [culture.component.html](../src/app/registre/components/culture/culture.component.html) (boucle `@for (item of filteredParcelles(); ...)`, ligne 148), sur l'élément de la parcelle :

```html
<div class="… classes existantes …" [class.is-archived-locked]="item.locked"
     [attr.title]="item.locked ? 'Parcelle archivée : le lien est conservé mais ne peut pas être modifié' : null">
  <input type="checkbox" … [disabled]="item.locked" …>
  … nom de la parcelle …
  @if (item.locked) {
    <span class="badge-archived"><i class="bi bi-archive"></i> Parcelle archivée</span>
  }
</div>
```

Dans la méthode appelée au clic ou au changement de la case, ajouter en première ligne `if (item.locked) return;`.

`prefillSelectedParcels()` reçoit déjà toutes les parcelles : la parcelle archivée liée est donc bien cochée à l'ouverture, et reste dans le `FormArray` `parcels` à l'enregistrement.

#### b) Traitement phyto : [traitement-phyto.component.ts](../src/app/registre/components/traitement-phyto/traitement-phyto.component.ts)

**Construction des choix** (`loadParcelCultureGroupsOptimized()`, vers la ligne 1438). Les associations sont construites à partir de `/crops`, qui ne renvoie que les cultures **actives**, croisées avec les parcelles. Il faut **exclure les parcelles archivées** de cette liste, qui est mise en cache et réutilisée en création :

```ts
const parcelInfo = parcelMap.get(parcelId);
if (parcelInfo && !parcelInfo.is_archived) {   // ← ajout de la condition
  associations.push({ … champs existants … });
}
```

**En modification, ajouter les associations archivées verrouillées.** Une association enregistrée dans le traitement (`editingTreatment.parcels_concerned`) est verrouillée si sa parcelle est archivée **ou** si sa culture est archivée, c'est-à-dire absente de `/crops`. Ajouter une méthode :

```ts
/** Associations du traitement modifié dont la parcelle ou la culture est archivée : visibles mais verrouillées. */
private buildLockedArchivedAssociations(parcelles: any[], activeCrops: any[]): any[] {
  if (!this.isEditMode) return [];
  const parcelById = new Map((parcelles || []).map((p: any) => [p.id_parcel, p]));
  const activeCropIds = new Set((activeCrops || []).map((c: any) => c.crop_id));

  return (this.editingTreatment?.parcels_concerned || [])
    .map((stored: any) => {
      const parcelId = stored.parcel_id ?? stored.parcels_id;
      const parcel = parcelById.get(parcelId);
      const parcelArchived = !!parcel?.is_archived;
      const cropArchived = !activeCropIds.has(stored.crop_id);
      if (!parcelArchived && !cropArchived) return null;      // association normale, déjà proposée
      return {
        uniqueId: `${parcelId}_${stored.crop_id}`,
        parcel_id: parcelId,
        parcel_name: stored.parcel_name || parcel?.parcel_name,
        parcel_area: parcel?.parcel_area ?? stored.parcel_surface,
        parcel_area_unit_fr: parcel?.parcel_area_unit_fr || stored.surface_unit || 'ha',
        crop_id: stored.crop_id,
        crop_name: stored.crop_name,
        phytoweb_name: stored.phytoweb_name || '',
        parcel_archived: parcelArchived,
        is_archived: cropArchived,
        locked: true,
      };
    })
    .filter(Boolean);
}
```

L'appeler une fois les cultures et les parcelles chargées, et **concaténer le résultat à `rawAssociations` uniquement**, **jamais** au cache `parcelCultureGroupsCache$`. Sinon, ces associations seraient proposées dans le traitement suivant, créé en **création**. Puis :

- **Sélection** : ces associations doivent figurer dans `selectedParcelCultureIds` et `selectedParcelCultureAssociations`. Elles y sont déjà via `syncSelectionFromStoredParcels()` / le bloc de la ligne ~1970, qui part de `parcels_concerned`. Il suffit de vérifier qu'elles portent bien `locked: true`.
- **`onCheckedParcelCulture(event, association)`** (ligne ~2574) : en première ligne, ajouter

  ```ts
  if (association.locked) { event.target.checked = true; return; }
  ```

- **Template** (case à cocher de l'association, ligne ~1807 de `traitement-phyto.component.html`) :

  ```html
  <input type="checkbox" … [disabled]="association.locked" …>
  ```

  Sur la carte de l'association, ajouter `[class.is-archived-locked]="association.locked"`, ainsi que :

  ```html
  @if (association.parcel_archived) { <span class="badge-archived"><i class="bi bi-archive"></i> Parcelle archivée</span> }
  @if (association.is_archived) { <span class="badge-archived"><i class="bi bi-archive"></i> Culture archivée</span> }
  ```

- **Boutons « Tout sélectionner » / « Tout désélectionner »**, s'ils existent : ils doivent **ignorer** les associations `locked`.
- **Étape « Répartition »** : la parcelle verrouillée reste incluse dans le traitement. Ses surfaces et volumes enregistrés sont conservés. Le verrouillage ne concerne que la sélection.

#### c) Travail au champ : [travail-au-champ.component.ts](../src/app/registre/components/travail-au-champ/travail-au-champ.component.ts)

Exactement la même chose :

- exclure les parcelles archivées dans `loadParcelCultureGroupsOptimized()` (vers la ligne 327) ;
- en modification, ajouter les associations verrouillées construites à partir du travail modifié (`parcels_concerned`), sans les mettre en cache ;
- empêcher le changement de sélection, et ajouter le style et les badges.

#### d) Affichage des saisies existantes

Les cartes et détails du carnet de champ (`registre-get`, `culture-detail-popup`…) **continuent** d'afficher les parcelles archivées liées. C'est voulu, et c'est pour ça que `GET /parcels` les renvoie toujours. On peut y ajouter le même badge « Parcelle archivée », mais ce n'est pas obligatoire.

---

## 3. Points d'attention

- **Ordre de déploiement** : d'abord la migration SQL `server/migrations/016_add_parcels_archive_and_sigec.sql`, puis le backend, puis le frontend. Le nouveau backend lit et écrit les nouvelles colonnes : déployé sans la migration, il casserait toutes les routes `/parcels`.
- **Nom du renouvellement** : le suffixe est toujours ` (1)`. Renouveler une parcelle déjà renouvelée donne donc `« Champ (1) (1) »`. C'est le comportement demandé, et l'utilisateur peut renommer la parcelle ensuite.
- **Cultures en cours sur une parcelle renouvelée** : elles restent liées à l'ancienne parcelle, qui est archivée, et ne sont donc plus proposées dans les traitements tant qu'on ne les rattache pas à la nouvelle parcelle via « Modifier la culture ». Si ce n'est pas le comportement voulu, prévenir le backend : le renouvellement pourrait déplacer automatiquement les cultures **actives** vers la nouvelle parcelle.
- **Restaurer une parcelle renouvelée** : l'ancienne et la nouvelle redeviennent toutes les deux actives. C'est autorisé, mais il vaut mieux le signaler dans la confirmation (voir 2.4).
- **Code SIGEC** : il est maintenant enregistré pour toutes les parcelles créées ou modifiées. Les parcelles existantes ont un code vide tant qu'il n'est pas saisi.

## 4. Tests à faire

1. **Modifier une parcelle, saisir un code SIGEC, enregistrer et rouvrir** : le code est bien conservé (avant cette mise à jour, il était perdu).
2. **« Archiver la parcelle » puis « Archiver »** : la parcelle disparaît de la liste, de la carte et des statistiques, et apparaît dans Mes archives.
3. **« Archiver et renouveler »** sans code SIGEC : le bouton est désactivé. Avec le code `1234567` : l'ancienne parcelle est archivée, et une parcelle « <nom> (1) » apparaît avec la même surface et la même géométrie, et le code `1234567`.
4. **Survol de l'icône** « Archiver et renouveler » : l'infobulle « La même parcelle avec un nouveau numéro PAC » s'affiche.
5. **Vue carte** : pas de bouton « Mes archives ». Le bouton « Archiver la parcelle » est présent dans le formulaire de modification.
6. **Mes archives, « Restaurer »** : la parcelle revient dans la liste et sur la carte.
7. **Nouvelle culture, nouveau traitement, nouveau travail au champ** : la parcelle archivée n'est **pas** proposée.
8. **Modifier une culture, un traitement ou un travail déjà lié à la parcelle archivée** :
   - elle est affichée, **cochée, grisée**, avec la mention « Parcelle archivée » ;
   - cliquer dessus **ne change rien**, ni décocher ni cocher ;
   - **enregistrer sans rien changer conserve le lien** : vérifier que le `PUT` contient toujours cette parcelle.
9. **Modifier un traitement ou un travail lié à une culture archivée** (archivée depuis le carnet de champ) : l'association est affichée, cochée, grisée et non cliquable, avec la mention « Culture archivée ». Le lien est conservé à l'enregistrement.
10. **Juste après les étapes 8 et 9, créer un nouveau traitement ou un nouveau travail** : ni la parcelle archivée, ni la culture archivée ne sont proposées (vérification du cache).
11. **Nouvelle culture** : une parcelle archivée n'apparaît pas du tout, même grisée.
12. **Archiver une parcelle déjà archivée**, depuis un autre onglet ou après un double clic : le message `409` « Parcelle déjà archivée » s'affiche proprement.
