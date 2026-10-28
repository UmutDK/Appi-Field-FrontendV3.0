# Suppression de la page « mes-preferences »

Guide d'implémentation **frontend**. Le backend est déjà mis à jour.

## Contexte

L'ancienne page **« mes-preferences »** (`/mes-preferences`) enregistrait le type de pulvérisateur, le mode d'encodage et les cultures suivies, via la route backend **`/preferences`**. Elle s'affichait automatiquement juste après la création d'un compte.

Côté backend :

- la route `/preferences` est **supprimée** : `GET` et `POST` renvoient désormais **404** ;
- sa table est supprimée par la migration `015_drop_preferences_table.sql`. Elle était vide en production : aucune donnée n'est perdue ;
- elle est remplacée par **Réglages > Préférences** (`/user_preferences`, voir [04_preferences.md](04_preferences.md)).

**La page doit donc être retirée**, sinon elle produit des erreurs 404 dès la fin de chaque création de compte.

---

## Modifications à faire

### 1. Supprimer le module

Supprimer **tout le dossier** `src/app/mes-preferences/` :

```
mes-preferences-routing.module.ts
mes-preferences.module.ts
components/mes-preferences/mes-preferences.component.{ts,html,scss}
model/mes-preferences.ts
services/mes-preferences.service.ts
```

Aucun autre fichier n'importe ce module : seules les deux références ci-dessous pointent vers lui.

### 2. Retirer la route : [app.routes.ts](../src/app/app.routes.ts)

Supprimer la ligne 13 :

```ts
{ path:'mes-preferences', loadChildren:()=>import('./mes-preferences/mes-preferences.module').then(m=>m.MesPreferencesModule), canActivate: [AuthGuard]},
```

Un ancien lien vers `/mes-preferences` tombera alors sur la route `**` et redirigera vers `erreur`. Si on préfère éviter ça, on peut garder une redirection à la place :

```ts
{ path:'mes-preferences', redirectTo:'gestion-des-operations', pathMatch:'full' },
```

### 3. Rediriger la fin de création de compte : [creation-compte.service.ts](../src/app/creation-compte/services/creation-compte.service.ts)

Ligne 67, dans `onUpdateSignal()` :

```ts
// avant
this.router.navigateByUrl('mes-preferences');
// après
this.router.navigateByUrl('gestion-des-operations');
```

`gestion-des-operations` est la page vers laquelle « mes-preferences » renvoyait après validation (`onSuivant()`). Le parcours d'inscription reste donc le même, avec une étape de moins.

> On pourrait aussi rediriger vers Réglages > Préférences pour que le nouvel utilisateur règle tout de suite ses préférences. Mais `/reglage` ouvre par défaut la section « Informations personnelles » (`activeSection`), et ouvrir directement la section Préférences demanderait un paramètre de route. Les valeurs par défaut conviennent pour démarrer, d'où le choix de `gestion-des-operations`.

---

## Points d'attention

- **Ordre de déploiement** : ce changement frontend doit partir **en même temps** que le backend qui supprime `/preferences`. Si le backend part seul, la page actuelle produira des 404 à chaque création de compte, jusqu'au déploiement du frontend.
- **Informations abandonnées** : le type de pulvérisateur (« J'utilise un pulvérisateur de plus de 20 L. ») et les cultures suivies (maraîchage, grandes cultures, etc.) ne sont plus demandés nulle part. Ils n'étaient de toute façon jamais enregistrés en base.

## Tests à faire

1. **Créer un compte** : à la fin du parcours, l'utilisateur arrive sur `gestion-des-operations`, sans erreur dans la console ni requête `/preferences` dans l'onglet Réseau.
2. **Saisir `/mes-preferences` dans l'URL** : on est redirigé vers `erreur`, ou vers `gestion-des-operations` si la redirection a été gardée.
3. **`ng build`** passe, sans import orphelin vers `mes-preferences`.
