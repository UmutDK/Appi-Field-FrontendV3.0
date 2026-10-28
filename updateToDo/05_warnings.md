# Encodage d'un traitement phyto : préférences et avertissements

Guide d'implémentation **frontend**. Le backend est déjà prêt (voir § 1).

> À faire **après** [04_preferences.md](04_preferences.md), qui crée le service `UserPreferencesService` réutilisé ici.

## Objectif

Le formulaire d'encodage d'un traitement (`traitement-phyto.component`) doit tenir compte des préférences de l'utilisateur :

| Préférence | Effet dans le formulaire | Où |
|---|---|---|
| `defaultTreatmentType` | Mode d'encodage présélectionné (Surface / Bouillie / Quantité) | Partie **Type** |
| `erRiWarningFlag` | Avertissement **« Attention, ce produit ne semble pas autorisé dans le cadre de la campagne Eco-régime réduction d'intrants »** si le produit a `erRiFlag = 1` | Partie **Composition**, à la sélection d'un produit |
| `spe8HourWarningFlag` | Affiche ou masque les avertissements **horaires** | Partie **Répartition** |
| `bbchWarningFlag` | Affiche ou masque les avertissements **BBCH** | Partie **Répartition** |

Les avertissements reposent maintenant sur de **nouvelles sources de données** Phytoweb, et sont **calculés par le backend** :

| Avertissement | Avant (frontend) | Maintenant (backend) |
|---|---|---|
| Horaire | `general.spe8Flag` (étiquette SPe8, trop large) | **`general.spe8FlagHoraire = 1`** |
| BBCH | `crops.cropApplicationStade` contient le texte « BBCH » + correspondance des cultures **par nom** | **`crops.bbchFlag = 1`** + correspondance des cultures **par `idCrop`** |
| Eco-régime | — | **`general.erRiFlag = 1`** |

Pour le BBCH, le backend fait lui-même la correspondance entre les cultures du traitement et le référentiel Phytoweb. Ce n'est **pas faisable côté frontend** : environ 99 % des cultures enregistrées utilisent encore un identifiant de l'ancien référentiel (`pwc-…`), qui n'existe plus dans le référentiel actuel (`pwc_…`). Le backend retrouve la culture via son nom. Résultat : **1 397 cultures sur 1 471** sont reconnues, et les 74 restantes sont des catégories génériques comme « céréales » ou « grandes cultures ».

---

## 1. Contrat API (déjà en place côté backend)

### 1.1 `GET /user_preferences`

Voir 04. Ici, seul **`defaultEventType`** est utile : c'est directement la valeur à mettre dans le contrôle `type` du formulaire.

| `defaultTreatmentType` | `defaultEventType` (valeur `type` du formulaire) |
|---|---|
| `surface` | `phyto_surface_treatment` |
| `porridge` | `phyto_porridge_treatment` |
| `quantity` | `phyto_quantity_treatment` |

### 1.2 `GET /phyto_treatments/warnings?idActs=…&cropIds=…`

Un seul appel renvoie **tous** les avertissements du traitement en cours, **déjà filtrés selon les préférences** de l'utilisateur.

| Paramètre | Contenu |
|---|---|
| `idActs` | Les `component_id` des produits du traitement, **plus** le produit en cours de sélection dans la Composition, séparés par des virgules. Les produits personnels (`perso-…`) sont ignorés par le serveur et peuvent être envoyés tels quels. |
| `cropIds` | Les `crop_id` des parcelles/cultures du traitement (`currentTreatmentDraft.parcels_concerned[].crop_id`), séparés par des virgules. Il s'agit des ids de culture **de l'utilisateur**, pas des ids Phytoweb. |

Chaque paramètre est limité à 100 identifiants. Les deux paramètres sont optionnels. Sans `cropIds`, il n'y a pas d'avertissement BBCH, mais les avertissements Eco-régime et horaire fonctionnent.

**Réponse**

```json
{
  "preferences": {
    "erRiWarningFlag": true, "spe8HourWarningFlag": true, "bbchWarningFlag": true,
    "defaultTreatmentType": "surface", "defaultEventType": "phyto_surface_treatment"
  },
  "products": [
    {
      "idAct": "act_0194479e-eb8d-40f3-bbc0-fc5a5329a948",
      "productName": "…",
      "numAut": "…",

      "erRiWarning": "Attention, ce produit ne semble pas autorisé dans le cadre de la campagne Eco-régime réduction d'intrants",
      "hourWarning": true,
      "bbchWarnings": [
        {
          "idCrop": "pwc_eb8330eb-c2da-46e8-85ca-5c57eb40b7c9",
          "cropName": "betteraves sucrières",
          "cropApplicationStade": "2 feuilles (première paire de feuilles) étalées -  9 ou davantage de feuilles étalées (BBCH 12-19)",
          "cropIds": ["00189cbe-8213-4ce9-8271-e7678ae9f17a"],
          "message": "betteraves sucrières : 2 feuilles (première paire de feuilles) étalées -  9 ou davantage de feuilles étalées (BBCH 12-19)"
        }
      ],

      "erRiFlag": true,
      "spe8FlagHoraire": true,
      "bbchCrops": [ "… mêmes éléments que bbchWarnings, sans filtre de préférence …" ]
    }
  ],
  "unresolvedCropIds": []
}
```

**Ce qu'il faut utiliser**

- **À afficher** : `erRiWarning`, `hourWarning` et `bbchWarnings`. Ils tiennent **déjà compte** des préférences : ils valent `null`, `false` ou `[]` si la préférence correspondante est désactivée. **Le frontend n'a pas à relire les préférences pour décider d'afficher un avertissement.**
- **Données brutes** : `erRiFlag`, `spe8FlagHoraire` et `bbchCrops` sont fournis indépendamment des préférences. Ils sont utiles pour déboguer, mais ne servent pas à l'affichage.
- **Champs d'un avertissement BBCH** :
  - `cropName` est le nom Phytoweb de la culture ;
  - `cropApplicationStade` est le stade d'application ;
  - `message` est la ligne prête à afficher, sous la forme `cropName : cropApplicationStade` ;
  - `cropIds` liste les cultures de l'utilisateur concernées.
- **Produits sans avertissement** : un produit inconnu ou personnel est simplement **absent** de `products`.
- **`unresolvedCropIds`** liste les cultures du traitement qui n'ont pas pu être reliées au référentiel Phytoweb, et pour lesquelles aucun avertissement BBCH n'est donc possible. Il n'y a rien à afficher, c'est informatif.

> **Mandats** : pendant l'encodage, l'intercepteur ajoute l'en-tête `X-Workspace-UserId`. L'endpoint utilise alors les cultures **et les préférences** du propriétaire de l'espace, ce qui est nécessaire puisque les cultures lui appartiennent. Il n'y a rien à faire côté frontend.

---

## 2. Type d'encodage par défaut

**Fichier** : [traitement-phyto.component.ts](../src/app/registre/components/traitement-phyto/traitement-phyto.component.ts)

Aujourd'hui, le type par défaut est écrit en dur à deux endroits : `type: ['phyto_surface_treatment', …]` dans `initializeForms()` (vers la ligne 861) et `type: 'phyto_surface_treatment'` dans `initializeTreatmentDraft()` (vers la ligne 907).

**À faire**

1. Injecter `UserPreferencesService` et ajouter une propriété :

   ```ts
   private defaultEventType = 'phyto_surface_treatment';
   ```

2. Remplacer les deux valeurs en dur par `this.defaultEventType`.
3. Dans `ngOnInit()`, **uniquement en création** (`!this.isEditMode && !this.interventionToModify`) :

   ```ts
   this.userPreferencesService.get().subscribe({
     next: prefs => {
       this.defaultEventType = prefs.defaultEventType || 'phyto_surface_treatment';
       this.applyDefaultEventType();
     },
     error: () => {} // on garde Surface
   });
   ```

4. Ajouter la méthode suivante :

   ```ts
   /** Présélectionne le mode d'encodage préféré, sauf si l'utilisateur a déjà choisi ou ajouté des produits. */
   private applyDefaultEventType(): void {
     if (this.isEditMode || this.hasProductsInComposition()) return;
     const typeCtrl = this.formTraitement?.get('type');
     if (!typeCtrl || typeCtrl.dirty) return; // la réponse arrive après un choix manuel : ne pas l'écraser
     typeCtrl.setValue(this.defaultEventType);
     if (this.currentTreatmentDraft) this.currentTreatmentDraft.type = this.defaultEventType;
   }
   ```

5. Dans `resetComponentState()` (vers la ligne 2124), après `this.initializeForms();`, appeler `this.applyDefaultEventType();`. Sinon, le nouveau traitement encodé juste après un enregistrement repart sur Surface.

**En modification**, rien ne change : le type enregistré du traitement est conservé (voir `detectTreatmentType()`).

---

## 3. Avertissements

### 3.1 Chargement : une seule source pour les trois avertissements

Dans le composant, ajouter :

```ts
// Avertissements renvoyés par GET /phyto_treatments/warnings, indexés par idAct.
private warningsByAct = signal<Map<string, any>>(new Map());
private warningsRequest$ = new Subject<string>(); // clé = query string

// à appeler une fois dans ngOnInit()
private initWarnings(): void {
  this.warningsRequest$.pipe(
    debounceTime(250),
    distinctUntilChanged(),
    switchMap(query => query
      ? this.httpClient.get<any>(`${environment.apiRegistre}/phyto_treatments/warnings?${query}`)
          .pipe(catchError(() => of({ products: [] })))
      : of({ products: [] })),
    takeUntil(this.destroy$)              // ou le mécanisme de désinscription déjà en place
  ).subscribe(res => {
    this.warningsByAct.set(new Map((res.products || []).map((p: any) => [p.idAct, p])));
  });
}

/** À appeler à chaque changement de produits ou de cultures (voir 3.2). */
refreshWarnings(): void {
  const idActs = new Set<string>(
    (this.currentTreatmentDraft?.treatment_composition || [])
      .map((c: any) => c.component_id).filter(Boolean)
  );
  if (this.currentEditingProductId) idActs.add(this.currentEditingProductId);
  if (this.currentEditingProductIdBouillie) idActs.add(this.currentEditingProductIdBouillie);

  const cropIds = new Set<string>(
    (this.currentTreatmentDraft?.parcels_concerned || [])
      .map((p: any) => p.crop_id).filter(Boolean)
  );

  const query = idActs.size
    ? `idActs=${encodeURIComponent([...idActs].join(','))}&cropIds=${encodeURIComponent([...cropIds].join(','))}`
    : '';
  this.warningsRequest$.next(query);
}
```

> **Important** : les méthodes appelées depuis le template (voir 3.3 à 3.5) doivent seulement **lire** `warningsByAct()`, **sans jamais lancer de requête HTTP**. Les méthodes actuelles déclenchent un `subscribe()` à chaque cycle de rafraîchissement d'Angular : c'est à ne pas reproduire.

### 3.2 Quand appeler `refreshWarnings()`

- **Sélection d'un produit dans la Composition** : en fin de la méthode qui fixe `this.currentEditingProductId = productId` (vers la ligne 4041) et de son équivalent Bouillie (`currentEditingProductIdBouillie`, vers la ligne 4108). C'est ce qui permet à l'avertissement Eco-régime d'apparaître **dès la sélection**.
- **Ajout ou retrait d'un produit** de `treatment_composition`.
- **Modification de la sélection des parcelles/cultures** (`parcels_concerned`).
- **Arrivée sur l'étape « Répartition »** (`@case ("repartition de mon traitement")`), par sécurité.
- **Ouverture d'un traitement existant en modification**, une fois le brouillon chargé.

Grâce au `debounceTime` et au `distinctUntilChanged`, des appels en rafale ne produisent qu'une seule requête.

### 3.3 Avertissement Eco-régime (partie Composition)

Ajouter une méthode :

```ts
getErRiWarning(productId: string | null): string | null {
  return productId ? this.warningsByAct().get(productId)?.erRiWarning ?? null : null;
}
```

Dans [traitement-phyto.component.html](../src/app/registre/components/traitement-phyto/traitement-phyto.component.html), ajouter le bloc **juste après** l'avertissement « Attention ce produit ne semble autorisé sur… » (`getUnauthorizedCrops`) :

- mode Surface, vers la ligne 519 : avec `currentEditingProductId` ;
- mode Bouillie, vers la ligne 1003 : avec `currentEditingProductIdBouillie` ;
- mode Quantité : même chose, s'il a son propre bloc de sélection de produit.

```html
@if (getErRiWarning(currentEditingProductId); as erRiMessage) {
    <div class="info-box warning-box">
        <div class="info-header"><i class="bi bi-exclamation-triangle-fill"></i> {{ erRiMessage }}</div>
    </div>
}
```

Le texte vient du serveur (`erRiWarning`). Il n'y a pas besoin de le recopier dans le frontend.

### 3.4 Avertissements horaires (partie Répartition)

**Remplacer le contenu** de `getApplicationHoursForDraft()` (vers la ligne 4543), en gardant **la même forme de retour**. Le template (lignes ~1223-1249 et ~1507-1534) n'a alors pas besoin de changer :

```ts
getApplicationHoursForDraft(): { productName: string, productNumAut: string }[] {
  return [...this.warningsByAct().values()]
    .filter((p: any) => p.hourWarning)
    .map((p: any) => ({ productName: p.productName, productNumAut: p.numAut || 'N/A' }));
}
```

- On n'utilise **plus** `product.spe8_flag`, qui reposait sur `general.spe8Flag`. Ce champ peut rester dans `productFromApi` s'il sert ailleurs.
- **Préférence désactivée** : `hourWarning` vaut `false` pour tous les produits, la liste est vide, et le bloc `@if (getApplicationHoursForDraft().length > 0)` disparaît tout seul.

### 3.5 Avertissements BBCH (partie Répartition)

**Remplacer le contenu** de `getBbchWarningsForDraft()` (vers la ligne 4485), là aussi **en gardant la même forme de retour**, sans changer le template (lignes ~1194-1220 et ~1478-1505) :

```ts
getBbchWarningsForDraft(): { cropName: string, stage: string, productName: string }[] {
  const warnings: { cropName: string, stage: string, productName: string }[] = [];
  this.warningsByAct().forEach((p: any) => {
    (p.bbchWarnings || []).forEach((w: any) => warnings.push({
      cropName: w.cropName,
      stage: w.cropApplicationStade,
      productName: p.productName,
    }));
  });
  return warnings;
}
```

Le template affiche déjà **« Produit (cropName) : cropApplicationStade »**. Pour l'affichage strict **« cropName : cropApplicationStade »** demandé, on peut utiliser `w.message`.

- On n'utilise **plus** la recherche du texte « BBCH » dans `cropApplicationStade`, ni la correspondance des cultures par nom (`resolveIdCropByName`) pour le BBCH.
- `getCropAuthorizations()` et `/index/crop_authorizations` **restent utilisés** par `getUnauthorizedCrops()`. Il ne faut pas les supprimer.
- **Préférence désactivée** : `bbchWarnings` est vide, et le bloc disparaît tout seul.

---

## 4. Points d'attention

- **Ordre de déploiement** : d'abord la migration `014_add_user_preferences_table.sql`, puis le backend, puis le frontend. **Les migrations 011, 012 et 013 doivent être passées avant**, car le backend en dépend.
- **Produits personnels** (`perso-…`) : ils ne déclenchent aucun avertissement, puisqu'ils sont absents de Phytoweb.
- **Requête en échec** (réseau coupé…) : `catchError` renvoie une liste vide, donc aucun avertissement ne s'affiche et l'encodage reste possible. C'est voulu : un avertissement manquant ne doit pas bloquer l'utilisateur.
- **Changement de préférences pendant l'encodage** : elles sont relues à chaque appel de `/warnings`. Un changement fait dans Réglages s'applique donc au prochain rafraîchissement.

## 5. Tests à faire

**Données réelles utiles** : le produit `act_0194479e-eb8d-40f3-bbc0-fc5a5329a948`, appliqué sur une culture « Betterave sucrière », déclenche **les trois** avertissements. C'est le cas que j'ai testé côté backend.

1. **Préférence « Bouillie »** puis ouverture d'un nouveau traitement : « Bouillie » est présélectionné. Après enregistrement, le traitement suivant est encore sur « Bouillie ».
2. **Choisir « Quantité » à la main avant que les préférences aient répondu** : le choix n'est pas écrasé.
3. **Modifier un traitement existant en mode Surface**, alors que la préférence est « Quantité » : il reste en Surface.
4. **Eco-régime coché, sélection du produit ci-dessus** : l'avertissement Eco-régime apparaît **dès la sélection**, sous l'avertissement « cultures non autorisées ». Avec Eco-régime décoché, il n'apparaît pas.
5. **Avertissements horaires activés**, produit avec `spe8FlagHoraire = 1` : le bloc horaire apparaît dans Répartition. Il disparaît si la préférence est décochée. Un produit avec seulement `spe8Flag = 1` mais `spe8FlagHoraire = 0` n'affiche **plus** d'avertissement horaire, alors qu'il en affichait un avant.
6. **BBCH activé**, produit ci-dessus sur une culture « Betterave sucrière » : le bloc BBCH affiche « betteraves sucrières : … (BBCH 12-19) ». Il disparaît si la préférence est décochée, ou si la culture est retirée du traitement.
7. **Ajout et retrait de produits ou de parcelles** : les avertissements se mettent à jour, et l'onglet Réseau ne montre qu'une requête `/warnings` par changement.
8. **Encodage dans l'espace d'un autre utilisateur** (mandat) : les avertissements BBCH fonctionnent, car ce sont les cultures du propriétaire qui sont utilisées.
