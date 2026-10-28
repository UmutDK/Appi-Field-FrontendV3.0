# Réglages : nouveau menu « Préférences »

Guide d'implémentation **frontend**. Le backend est déjà prêt (voir § 1).

> Cette note couvre **l'écran de réglage** des préférences. L'utilisation de ces préférences dans le formulaire de traitement (type présélectionné, avertissements) est décrite dans **[05_warnings.md](05_warnings.md)**.

## Objectif

Il faut ajouter un menu **« Préférences »** dans **Mon compte** (Réglages), entre **« Informations de mon exploitation »** et **« WalleSmart »**. Il permet à l'utilisateur de régler 4 préférences d'encodage des traitements :

| Contrôle | Libellé exact | Champ API | Défaut |
|---|---|---|---|
| Case à cocher | Je respecte la campagne Eco-régime réduction d'intrants | `erRiWarningFlag` | décochée (`false`) |
| Case à cocher | Afficher les avertissements horaires lors de l'encodage des traitements | `spe8HourWarningFlag` | cochée (`true`) |
| Case à cocher | Afficher les avertissements bbch lors de l'encodage des traitements | `bbchWarningFlag` | cochée (`true`) |
| Menu déroulant | Type d'encodage de traitements | `defaultTreatmentType` | Surface (`"surface"`) |

Options du menu déroulant :

| Libellé affiché | Valeur API |
|---|---|
| Surface *(défaut)* | `surface` |
| Bouillie | `porridge` |
| Quantité | `quantity` |

---

## 1. Contrat API (déjà en place côté backend)

Base : `environment.apiRegistre`. Authentification par le token Bearer, ajouté automatiquement par l'intercepteur.

### `GET /user_preferences`

Renvoie toujours un objet complet. Si l'utilisateur n'a jamais rien enregistré, l'objet contient les valeurs par défaut.

```json
{
  "erRiWarningFlag": false,
  "spe8HourWarningFlag": true,
  "bbchWarningFlag": true,
  "defaultTreatmentType": "surface",
  "defaultEventType": "phyto_surface_treatment"
}
```

`defaultEventType` est en **lecture seule** : c'est la valeur `type` correspondante du formulaire de traitement (voir 05). Il ne faut pas le renvoyer dans le `PUT`. S'il est envoyé, il est ignoré.

### `PUT /user_preferences`

Mise à jour **partielle** : on n'envoie que les champs modifiés, les autres gardent leur valeur actuelle. La réponse contient les préférences **complètes** à jour, sous la même forme que le `GET`.

```json
PUT /user_preferences
{ "erRiWarningFlag": true }
```

```json
PUT /user_preferences
{ "defaultTreatmentType": "porridge", "bbchWarningFlag": false }
```

**Erreurs (`400`, rien n'est enregistré)**

- Un des 3 indicateurs n'est pas un booléen. Il faut envoyer `true`/`false`, pas `"Oui"` ni `"true"`.
- `defaultTreatmentType` n'est pas l'une des valeurs `surface`, `porridge` ou `quantity`. Il faut envoyer la **valeur**, jamais le libellé (`"Bouillie"` est refusé).

> **Mandats** : l'intercepteur n'ajoute **jamais** l'en-tête `X-Workspace-UserId` sur les pages `/reglage`. Les préférences réglées ici sont donc toujours celles de l'**utilisateur connecté**, même s'il travaille dans l'espace d'un autre utilisateur grâce à un mandat. Il n'y a rien à faire pour ça.

---

## 2. Modifications à faire

### 2.1 Service

Créer `src/app/reglage/services/user-preferences.service.ts` :

```ts
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type DefaultTreatmentType = 'surface' | 'porridge' | 'quantity';

export interface UserPreferences {
  erRiWarningFlag: boolean;
  spe8HourWarningFlag: boolean;
  bbchWarningFlag: boolean;
  defaultTreatmentType: DefaultTreatmentType;
  defaultEventType?: string; // lecture seule
}

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private http = inject(HttpClient);
  private url = `${environment.apiRegistre}/user_preferences`;

  get(): Observable<UserPreferences> {
    return this.http.get<UserPreferences>(this.url);
  }

  update(changes: Partial<Omit<UserPreferences, 'defaultEventType'>>): Observable<UserPreferences> {
    return this.http.put<UserPreferences>(this.url, changes);
  }
}
```

Le service est déclaré `providedIn: 'root'` parce que le formulaire de traitement l'utilise aussi (voir 05).

### 2.2 Composant `preferences`

Créer `src/app/reglage/components/preferences/` (fichiers `.ts`, `.html`, `.scss`), sur le modèle de `wallesmart/`, qui est un composant autonome avec `SharedModule` et des signaux.

**Comportement attendu**

- **À l'ouverture** : appeler `get()`, afficher un indicateur de chargement, puis remplir le formulaire avec la réponse.
- **Enregistrement automatique** à chaque changement, sans bouton « Enregistrer » : cocher ou décocher une case, ou choisir une option du menu, envoie immédiatement un `PUT` avec **uniquement le champ modifié**.
  - Si on préfère un bouton « Enregistrer », envoyer les 4 champs en une seule fois. Les deux approches fonctionnent avec l'API.
- **Après chaque `PUT` réussi** : remplacer l'état local par la réponse, qui fait foi, et afficher une courte confirmation (« Préférences enregistrées »).
- **En cas d'erreur** : remettre la valeur précédente et afficher un message d'erreur.

**Structure du template** (à adapter au style des autres cartes de réglage) :

```html
<div class="preferences-section">
  <div class="preferences-card">
    <h2 class="preferences-card__title"><i class="bi bi-sliders me-2"></i>Préférences</h2>

    @if (isLoading()) {
      <div class="text-center py-3"><span class="spinner-border spinner-border-sm text-primary"></span></div>
    } @else {
      <div class="form-check mb-3">
        <input class="form-check-input" type="checkbox" id="prefErRi"
               [checked]="prefs().erRiWarningFlag"
               (change)="save('erRiWarningFlag', $any($event.target).checked)">
        <label class="form-check-label" for="prefErRi">
          Je respecte la campagne Eco-régime réduction d'intrants
        </label>
      </div>

      <div class="form-check mb-3">
        <input class="form-check-input" type="checkbox" id="prefSpe8"
               [checked]="prefs().spe8HourWarningFlag"
               (change)="save('spe8HourWarningFlag', $any($event.target).checked)">
        <label class="form-check-label" for="prefSpe8">
          Afficher les avertissements horaires lors de l'encodage des traitements
        </label>
      </div>

      <div class="form-check mb-3">
        <input class="form-check-input" type="checkbox" id="prefBbch"
               [checked]="prefs().bbchWarningFlag"
               (change)="save('bbchWarningFlag', $any($event.target).checked)">
        <label class="form-check-label" for="prefBbch">
          Afficher les avertissements bbch lors de l'encodage des traitements
        </label>
      </div>

      <label class="simple-label" for="prefTreatmentType">Type d'encodage de traitements</label>
      <select id="prefTreatmentType" class="form-select"
              [value]="prefs().defaultTreatmentType"
              (change)="save('defaultTreatmentType', $any($event.target).value)">
        @for (opt of treatmentTypeOptions; track opt.value) {
          <option [value]="opt.value">{{ opt.label }}</option>
        }
      </select>
    }
  </div>
</div>
```

- **Menu déroulant** : un `<select>` natif suffit. Pour rester homogène avec le formulaire de traitement, on peut aussi reprendre le menu maison `operator-dropdown-container` utilisé pour « Efficacité du traitement ».
- **Options du menu** :

  ```ts
  readonly treatmentTypeOptions = [
    { value: 'surface',  label: 'Surface' },
    { value: 'porridge', label: 'Bouillie' },
    { value: 'quantity', label: 'Quantité' },
  ];
  ```

- **Infobulles** (facultatif) : sur la ligne Eco-régime, on peut ajouter une infobulle `matTooltip` : *« Un avertissement s'affichera si vous sélectionnez un produit qui ne semble pas autorisé dans le cadre de cette campagne. »*

### 2.3 Ajout dans le menu Mon compte : [reglage.component](../src/app/reglage/components/reglage/)

**`reglage.component.ts`**

- Importer `PreferencesComponent` et l'ajouter aux `imports` du composant.
- Ajouter `'preferences'` à l'union de `activeSection`.
- Ajouter `'preferences': 'Préférences'` dans `sectionLabels`, entre `'infos-exploitation'` et `'wallesmart'`.

**`reglage.component.html`**, à **trois** endroits, toujours entre « exploitation » et « WalleSmart » :

1. **Navigation mobile** (`.reglage-mobile-nav`, entre les boutons « Mon exploitation » et « WalleSmart », vers la ligne 23) :

   ```html
   <button type="button" class="reglage-mobile-btn"
       [class.active]="activeSection() === 'preferences'"
       (click)="activeSection.set('preferences')">
       <i class="bi bi-sliders"></i>
       <span>Préférences</span>
   </button>
   ```

2. **Navigation sur ordinateur** (`.reglage-nav`, entre « Informations de mon exploitation » et « WalleSmart », vers la ligne 83) :

   ```html
   <button type="button" class="reglage-nav__item"
       [class.active]="activeSection() === 'preferences'"
       (click)="activeSection.set('preferences')">
       <i class="bi bi-sliders"></i>
       <span>Préférences</span>
   </button>
   ```

3. **Contenu** (`.reglage-content`, vers la ligne 139) :

   ```html
   @if (activeSection() === 'preferences') {
       <app-preferences></app-preferences>
   }
   ```

---

## 3. Points d'attention

- **Ordre de déploiement** : d'abord la migration SQL `server/migrations/014_add_user_preferences_table.sql`, puis le backend, puis le frontend. La migration crée la table et l'**initialise pour les 594 utilisateurs existants**, avec les valeurs par défaut.
- **Nouveaux utilisateurs** : rien à faire. Le `GET` renvoie les valeurs par défaut tant qu'ils n'ont rien enregistré, et leur ligne est créée en base à leur premier `PUT`.
- **Ancienne route `/preferences`** (table `preferences`) : elle a été **supprimée** côté backend. La page « mes-preferences » qui l'appelait doit être retirée, voir **[06_removeMesPreferences.md](06_removeMesPreferences.md)**. Ne pas la confondre avec `/user_preferences`.
- **Toujours envoyer des valeurs**, jamais des libellés : `true`/`false` pour les cases, et `surface`/`porridge`/`quantity` pour le menu.

## 4. Tests à faire

1. **Premier accès d'un utilisateur existant** : Eco-régime décoché, les deux cases d'avertissement cochées, le menu sur « Surface ».
2. **Cocher la case Eco-régime** : la requête `PUT` contient `{"erRiWarningFlag": true}`. Après rechargement de la page, la case est toujours cochée.
3. **Choisir « Bouillie »** : la requête `PUT` contient `{"defaultTreatmentType": "porridge"}`. Après rechargement, « Bouillie » est toujours affiché.
4. **Décocher les deux cases d'avertissement**, recharger : elles sont toujours décochées.
5. **Mobile** : le bouton « Préférences » apparaît entre « Mon exploitation » et « WalleSmart ». Même chose dans la navigation sur ordinateur.
6. **Couper le réseau puis modifier une préférence** : la valeur précédente est remise et un message d'erreur s'affiche.
7. **Dans l'espace d'un autre utilisateur via un mandat**, modifier une préférence dans Réglages : c'est bien la préférence de l'utilisateur **connecté** qui change.
