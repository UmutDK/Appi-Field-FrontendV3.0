# Traitement phyto : méthode d'application (`treatmentType`)

Guide d'implémentation **frontend**. Le backend est déjà prêt (voir § 1).

## Objectif

Enregistrer pour chaque traitement **sa méthode d'application** : pulvérisation, traitement de semences, etc.

Il faut ajouter un **menu déroulant intitulé « Méthode d'application »** dans le formulaire d'encodage d'un traitement, **juste avant** le menu « Efficacité du traitement ». Il propose par défaut **« Pulvérisation »** et permet de choisir parmi 8 méthodes.

Tous les traitements déjà encodés ont reçu la valeur `pulvérisation` lors de la migration.

> ⚠️ **Ne pas confondre avec le type d'encodage.** Le formulaire a déjà un champ `type` / `eventType` (Surface / Bouillie / Quantité), et le code utilise déjà le nom `treatmentType` (par exemple `getTreatmentType()`, ou les variables locales `const treatmentType = ...type`) pour désigner **ce type d'encodage**. Pour éviter toute confusion, le nouveau champ s'appelle **`application_method`** côté formulaire. Il ne s'appelle `treatmentType` que dans les échanges avec l'API.

---

## 1. Contrat API (déjà en place côté backend)

Les routes ne changent pas. Seul un nouveau champ texte est ajouté au traitement : `treatmentType`.

**Valeurs autorisées** (à envoyer **exactement** ainsi : minuscules et accents) :

| Valeur API (`treatmentType`) | Libellé affiché |
|---|---|
| `pulvérisation` *(défaut)* | Pulvérisation |
| `traitement de semences` | Traitement de semences |
| `microgranulé` | Microgranulé |
| `arrosage` | Arrosage |
| `irrigation` | Irrigation |
| `badigeonnage` | Badigeonnage |
| `injection` | Injection |
| `trempage` | Trempage |

**Comportement de chaque route**

| Route | Comportement de `treatmentType` |
|---|---|
| `POST /phyto_treatments` | Optionnel. **Absent ou vide = `"pulvérisation"`.** Une valeur hors de la liste renvoie **`400`** et rien n'est enregistré. |
| `PUT /phyto_treatments/<eventId>` | Optionnel. **Absent = valeur actuelle conservée.** Une valeur hors de la liste renvoie **`400`** et rien n'est modifié. |
| `GET /phyto_treatments` et `GET /phyto_treatments/<eventId>` | Toujours présent dans la réponse. |

**Exemple de création**

```json
POST /phyto_treatments
{
  "eventType": "phyto_surface_treatment",
  "eventDate": "2026-10-27",
  "treatmentType": "traitement de semences",
  "decisionBase": "Non défini",
  "effectiveness": "Pas d'avis",
  "parcelsConcerned": [ ... ],
  "treatmentComposition": [ ... ]
}
```

**Réponse renvoyée en cas de valeur invalide**

```json
400 { "error": "treatmentType invalide (attendu : pulvérisation, traitement de semences, microgranulé, arrosage, irrigation, badigeonnage, injection, trempage)" }
```

La comparaison est **exacte**. Envoyer `"Pulvérisation"` (avec une majuscule) ou `"pulverisation"` (sans accent) renvoie une erreur `400`. Il faut donc toujours envoyer la **valeur** de la liste, jamais le **libellé** affiché.

---

## 2. Modifications à faire

On suit exactement le modèle du menu **« Efficacité du traitement »** (`effectiveness` / `selectedEfficacite` / `EFFICACITE_OPTIONS`). Il s'agit du même type de menu déroulant, construit à la main.

### 2.1 Conversion entre le formulaire et l'API : [registre.service.ts](../src/app/registre/services/registre.service.ts)

**`treatmentToApi`** (vers la ligne 177, à côté de `effectiveness`) :

```ts
treatmentType: t.application_method || 'pulvérisation',
```

**`treatmentFromApi`** (vers la ligne 202, à côté de `effectiveness`) :

```ts
application_method: t.treatmentType || 'pulvérisation',
```

### 2.2 Composant : [traitement-phyto.component.ts](../src/app/registre/components/traitement-phyto/traitement-phyto.component.ts)

**a) Liste des options et état du menu.** Elles se placent à côté de `EFFICACITE_OPTIONS`, vers la ligne 3412, et s'inspirent de `selectedEfficacite` / `toggleEfficaciteDropdown` / `closeEfficaciteDropdown` / `selectEfficacite`, vers les lignes 3437-3454 :

```ts
public readonly APPLICATION_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'pulvérisation',          label: 'Pulvérisation' },
  { value: 'traitement de semences', label: 'Traitement de semences' },
  { value: 'microgranulé',           label: 'Microgranulé' },
  { value: 'arrosage',               label: 'Arrosage' },
  { value: 'irrigation',             label: 'Irrigation' },
  { value: 'badigeonnage',           label: 'Badigeonnage' },
  { value: 'injection',              label: 'Injection' },
  { value: 'trempage',               label: 'Trempage' },
];

public selectedApplicationMethod: string = 'pulvérisation';
public showApplicationMethodDropdown: boolean = false;

public get selectedApplicationMethodLabel(): string {
  return this.APPLICATION_METHOD_OPTIONS.find(o => o.value === this.selectedApplicationMethod)?.label || 'Pulvérisation';
}

public toggleApplicationMethodDropdown(): void {
  this.showApplicationMethodDropdown = !this.showApplicationMethodDropdown;
}

public closeApplicationMethodDropdown(): void {
  setTimeout(() => { this.showApplicationMethodDropdown = false; }, 150);
}

public selectApplicationMethod(value: string): void {
  this.selectedApplicationMethod = value;
  this.showApplicationMethodDropdown = false;
  if (this.formTraitement) {
    this.formTraitement.patchValue({ application_method: value }, { emitEvent: false });
  }
}
```

**b) Endroits où le champ doit être ajouté.** On ajoute `application_method` partout où `effectiveness` est déjà géré :

| Où | Ligne (environ) | À ajouter |
|---|---|---|
| Création de `formTraitement` (`formBuilder.group`) | ~879 | `application_method: ['pulvérisation'],` |
| `initializeTreatmentDraft()` | ~922 | `application_method: 'pulvérisation',` |
| Copie des valeurs du formulaire dans le brouillon (`Object.assign(this.currentTreatmentDraft, {...})`) | ~1336 | `application_method: formValues.application_method \|\| 'pulvérisation',` |
| Préremplissage en modification (`patchValue` depuis `editingTreatment`) | ~1905 | `application_method: this.editingTreatment.application_method \|\| 'pulvérisation',` |
| Juste après, à côté de `this.selectedEfficacite = ...` | ~1910 | `this.selectedApplicationMethod = this.editingTreatment.application_method \|\| 'pulvérisation';` |
| Second préremplissage en modification | ~2341 | même ligne que ~1905 |
| Juste après, à côté de `this.selectedEfficacite = ...` | ~2346 | même ligne que ~1910 |
| Remise à zéro du formulaire (« Réinitialiser les dropdowns simples ») | ~2155 | `this.selectedApplicationMethod = 'pulvérisation';` |

> Les préremplissages sont indispensables. Sinon, à l'ouverture d'un traitement en « Trempage », le menu affiche « Pulvérisation », et l'enregistrement remplace silencieusement la valeur par `pulvérisation`.

### 2.3 Template : [traitement-phyto.component.html](../src/app/registre/components/traitement-phyto/traitement-phyto.component.html)

Insérer ce bloc **juste avant** le commentaire `<!-- Efficacité du traitement -->`, vers la ligne 153. C'est une copie du bloc « Efficacité » avec les noms adaptés :

```html
<!-- Méthode d'application -->
<article class="col-lg-6">
    <p></p>
    <div style="display:flex; align-items:center; gap:6px; margin-bottom:5px;">
        <label class="simple-label" id="traitementMethodeLabel" style="margin:0;">Méthode d'application</label>
    </div>
    <div class="operator-dropdown-container">
        <button type="button"
                class="operator-select-btn has-value"
                aria-labelledby="traitementMethodeLabel"
                (click)="toggleApplicationMethodDropdown()"
                (blur)="closeApplicationMethodDropdown()">
            <span class="operator-btn-text">
                <span class="simple-option-name">{{ selectedApplicationMethodLabel }}</span>
            </span>
            <span class="operator-btn-icons">
                <i class="bi" [class.bi-chevron-down]="!showApplicationMethodDropdown" [class.bi-chevron-up]="showApplicationMethodDropdown"></i>
            </span>
        </button>
        @if (showApplicationMethodDropdown) {
            <ul class="operator-dropdown-list">
                @for (opt of APPLICATION_METHOD_OPTIONS; track opt.value) {
                    <li>
                        <button type="button"
                                class="operator-option"
                                [class.selected]="selectedApplicationMethod === opt.value"
                                (mousedown)="$event.preventDefault(); selectApplicationMethod(opt.value)">
                            {{ opt.label }}
                        </button>
                    </li>
                }
            </ul>
        }
    </div>
</article>
```

- **Libellé du champ** : **« Méthode d'application »**. C'est aussi le titre de la colonne correspondante dans l'export du registre.
- **Style** : rien à ajouter. Les classes `operator-*` sont celles du menu « Efficacité ».
- **Mise en page** : le menu est visible en création **et** en modification. Comme les deux menus sont en `col-lg-6`, « Méthode d'application » et « Efficacité » se retrouvent côte à côte sur grand écran, et « Base décisionnelle » passe à la ligne suivante.

### 2.4 Affichage (facultatif, conseillé)

Dans le **détail** d'un traitement du registre, afficher la méthode à partir de `application_method`, avec son libellé et la majuscule initiale.

---

## 3. Points d'attention

- **Ordre de déploiement** : d'abord la migration SQL `server/migrations/013_add_phyto_treatments_treatment_type.sql`, puis le backend, puis le frontend. Le nouveau backend lit et écrit cette colonne : déployé sans la migration, il casserait l'enregistrement des traitements.
  - Les migrations 011 et 012 doivent être passées avant la 013, car celle-ci place la colonne après `thirdPartFlag`.
- **Toujours envoyer la valeur, jamais le libellé.** Par exemple `"pulvérisation"` et non `"Pulvérisation"`. Sinon, le serveur renvoie une erreur `400`.
- **Gestion de l'erreur `400`** : elle ne devrait jamais arriver si on utilise la liste d'options. Si elle arrive, afficher le message `error` renvoyé par le serveur plutôt qu'une erreur générique.
- **Export du registre** : rien à faire côté frontend. Le backend ajoute déjà une colonne **« Méthode d'application »** dans l'export Excel et PDF, juste après « Type de traitement ». Le libellé y est affiché avec une majuscule, par exemple « Traitement de semences ».

## 4. Tests à faire

1. **Nouveau traitement** : le menu affiche « Pulvérisation » par défaut. Enregistrer sans y toucher : la requête envoie `"treatmentType": "pulvérisation"`.
2. **Choisir « Traitement de semences » puis enregistrer** : la requête envoie `"treatmentType": "traitement de semences"`, en minuscules avec les espaces.
3. **Rouvrir ce traitement en modification** : le menu affiche bien « Traitement de semences ». Enregistrer sans rien changer conserve la valeur.
4. **Modifier la méthode d'un traitement existant** : la nouvelle valeur est bien enregistrée.
5. **Traitement encodé avant la mise à jour** : il s'affiche en « Pulvérisation ».
6. **Après avoir encodé un traitement en « Arrosage »**, ouvrir un nouveau formulaire : le menu revient bien à « Pulvérisation ».
7. **Les 8 options** s'enregistrent sans erreur `400`, y compris celles qui ont un accent (`pulvérisation`, `microgranulé`).
8. **Export du registre** (Excel et PDF) : la colonne « Méthode d'application » est présente et correspond à ce qui a été encodé.
