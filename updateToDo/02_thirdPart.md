# Traitement phyto : « Traitement effectué par un tiers »

Guide d'implémentation **frontend**. Le backend est déjà prêt (voir § 1).

## Objectif

Quand un traitement est réalisé par un tiers (entrepreneur, voisin, coopérative…), les produits utilisés **ne viennent pas du stock de l'utilisateur**. Ce traitement ne doit donc pas réduire son inventaire.

Le traitement reste un traitement normal partout ailleurs : registre, export, calculs de dose et de surface. **Seul l'inventaire l'ignore.**

Côté interface, il faut ajouter une case à cocher **« Traitement effectué par un tiers »**, décochée par défaut, dans la partie **Type** du formulaire d'encodage d'un traitement, avec une petite infobulle.

---

## 1. Contrat API (déjà en place côté backend)

Les routes ne changent pas. Seul un nouveau champ booléen, `thirdPartFlag`, est ajouté au traitement.

| Route | Comportement de `thirdPartFlag` |
|---|---|
| `POST /phyto_treatments` | Optionnel. **Absent ou `false` = 0** (non coché). `true` = 1. |
| `PUT /phyto_treatments/<eventId>` | Optionnel. **Absent = valeur actuelle conservée.** `true`/`false` = nouvelle valeur. |
| `GET /phyto_treatments` et `GET /phyto_treatments/<eventId>` | Toujours présent dans la réponse, sous la forme **`0` ou `1`** (entier, pas un booléen). |
| `GET /inventories` | Les traitements avec `thirdPartFlag = 1` sont **absents** : pas de déduction du stock, pas de ligne « Traitement » dans l'historique. **Aucune modification nécessaire côté inventaire.** |

**Exemple de création**

```json
POST /phyto_treatments
{
  "eventType": "phyto_surface_treatment",
  "eventDate": "2026-10-27",
  "cleanFlag": false,
  "localizedTreatment": false,
  "thirdPartFlag": true,
  "parcelsConcerned": [ ... ],
  "treatmentComposition": [ ... ]
}
```

**Exemple de réponse** (`GET` ou retour d'un `POST`/`PUT`) :

```json
{ "eventId": "...", "eventType": "phyto_surface_treatment", "cleanFlag": 0, "thirdPartFlag": 1, ... }
```

> Envoyer un **vrai booléen** (`true`/`false`). Il ne faut pas reproduire la convention `'Oui'`/`'Non'` du formulaire : la chaîne `"Non"` serait lue comme **vraie** par le serveur, puisque toute chaîne non vide l'est.
>
> L'ancienne valeur est conservée si le champ est absent d'un `PUT`. C'est un filet de sécurité, mais le formulaire doit **toujours envoyer** le champ, pour que décocher la case soit bien pris en compte.

---

## 2. Modifications à faire

Tout se passe dans le module registre. On suit le même modèle que `clean_flag` et `localized_treatment`, avec une différence : le champ du formulaire est un **booléen**, pas `'Oui'`/`'Non'`, puisque c'est une case à cocher.

### 2.1 Conversion entre le formulaire et l'API : [registre.service.ts](../src/app/registre/services/registre.service.ts)

**`treatmentToApi`** (vers la ligne 175), ajouter à côté de `cleanFlag` :

```ts
thirdPartFlag: !!t.third_part_flag,
```

**`treatmentFromApi`** (vers la ligne 193), ajouter :

```ts
third_part_flag: !!t.thirdPartFlag,   // le serveur renvoie 0/1
```

### 2.2 Formulaire : [traitement-phyto.component.ts](../src/app/registre/components/traitement-phyto/traitement-phyto.component.ts)

Ajouter `third_part_flag` à chacun des endroits où `clean_flag` est déjà géré :

| Où | Ligne (environ) | À ajouter |
|---|---|---|
| Création de `formTraitement` (`formBuilder.group`) | ~874 | `third_part_flag: [false],` |
| `initializeTreatmentDraft()` | ~917 | `third_part_flag: false,` |
| Copie des valeurs du formulaire dans le brouillon (`Object.assign(this.currentTreatmentDraft, {...})`) | ~1333 | `third_part_flag: !!formValues.third_part_flag,` |
| Préremplissage en modification (`patchValue` depuis `editingTreatment`) | ~1899 | `third_part_flag: !!this.editingTreatment.third_part_flag,` |
| Second préremplissage en modification | ~2338 | `third_part_flag: !!this.editingTreatment.third_part_flag,` |
| Préremplissage depuis un traitement existant (`patchValue` depuis `treatment`) | ~3650 | `third_part_flag: !!treatment.third_part_flag,` |

> Ne pas oublier les préremplissages. Sinon, la case réapparaît décochée lors d'une modification, et l'enregistrement remet le flag à 0 : le traitement serait de nouveau déduit de l'inventaire.

### 2.3 Template : [traitement-phyto.component.html](../src/app/registre/components/traitement-phyto/traitement-phyto.component.html)

La case se place dans la partie **Type**, juste **après** le bloc des types d'encodage (Surface / Bouillie / Quantité), c'est-à-dire après le `@if (!isEditMode) { ... } @else { ... }` (vers la ligne 94) et avant le champ « Date de traitement ».

Elle doit être visible **en création comme en modification**. Contrairement au type d'encodage, ce flag peut être modifié après coup. Elle doit donc rester **hors** du `@if (!isEditMode)`.

```html
<article class="col-lg-12">
    <div class="form-check third-part-check">
        <input class="form-check-input"
               type="checkbox"
               id="thirdPartFlag"
               formControlName="third_part_flag">
        <label class="form-check-label simple-label" for="thirdPartFlag">
            Traitement effectué par un tiers
        </label>
        <i class="bi bi-info-circle-fill popup-tooltip-icon"
           matTooltip="Cochez cette case si le traitement a été réalisé par un tiers (entrepreneur, voisin…) avec ses propres produits. Les quantités de produits de ce traitement ne seront pas déduites de votre inventaire. Le traitement reste enregistré normalement dans votre registre."
           matTooltipPosition="above">
        </i>
    </div>
</article>
```

- **Infobulle** : on réutilise le même système que l'infobulle « Type d'encodage » (`matTooltip` et la classe `popup-tooltip-icon`, vers la ligne 19). `MatTooltipModule` est donc déjà importé dans ce composant.
- **Style** : aligner la case et l'icône sur une ligne, avec un `display:flex; align-items:center; gap:6px;` comme pour le libellé « Type d'encodage ».

### 2.4 Affichage (facultatif, conseillé)

- **Liste et détail des traitements du registre** : afficher un petit badge **« Tiers »** sur les traitements dont `third_part_flag` vaut `true`. L'utilisateur comprend ainsi pourquoi ces traitements ne figurent pas dans son inventaire.
- **Écran inventaire** : rien à faire, le serveur a déjà exclu ces traitements.

---

## 3. Points d'attention

- **Ordre de déploiement** : d'abord la migration SQL `server/migrations/012_add_phyto_treatments_third_part_flag.sql`, puis le backend, puis le frontend. Le nouveau backend lit cette colonne : déployé sans la migration, il casserait **l'inventaire et l'enregistrement des traitements**.
- **Traitements existants** : ils valent tous 0 après la migration. Aucun changement pour eux.
- **Modification a posteriori** : cocher la case sur un traitement existant le retire immédiatement de l'inventaire, et la décocher l'y remet. Le stock est recalculé à chaque lecture, il n'y a rien à synchroniser.
- **Registre et export** : les traitements effectués par un tiers y restent présents. Le registre étant un document réglementaire, ce comportement est voulu.

## 4. Tests à faire

1. **Création sans cocher la case** : le traitement est déduit de l'inventaire, comme avant.
2. **Création en cochant la case** : le produit utilisé n'est **pas** déduit, et aucune ligne « Traitement » n'apparaît dans son historique d'inventaire. Le traitement apparaît bien dans le registre.
3. **Modification d'un traitement coché** : la case est **cochée** à l'ouverture du formulaire, et l'enregistrement sans rien changer la laisse cochée. Vérifier que l'inventaire ne bouge pas.
4. **Décocher la case sur un traitement existant puis enregistrer** : le traitement est de nouveau déduit de l'inventaire.
5. **Infobulle** : elle s'affiche au survol de l'icône, sur ordinateur, et à l'appui, sur mobile.
6. **Requête réseau** : dans les outils du navigateur, `thirdPartFlag` est envoyé comme un booléen (`true`/`false`), jamais comme `"Oui"`/`"Non"`.
