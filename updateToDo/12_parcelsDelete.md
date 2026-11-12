# Parcelles : suppression refusée si la parcelle est utilisée

Cette fois, **le backend et le frontend sont déjà modifiés**. Ce document liste les changements, à relire et à tester (§ 4).

## Contexte

Avant, `DELETE /parcels/<id>` effaçait seulement la ligne de la table `parcels`, sans vérifier si la parcelle était utilisée. Comme la base n'a aucune clé étrangère, les données liées restaient en place :

- **Cultures** : le lien culture–parcelle (`cropsParcels`) restait. `GET /crops` renvoyait donc un `parcelId` qui ne correspondait plus à rien.
- **Traitements phyto et travaux aux champs** : ils restaient, avec le nom de la parcelle recopié. En revanche, l'**export du registre** perdait l'**adresse** et les **coordonnées**, qui viennent de la table `parcels`.
- **Modification d'un ancien traitement** : sans surface traitée explicite, le recalcul reprend la surface de la parcelle. Parcelle supprimée = surface vide, donc quantités fausses.

Comme l'archivage existe maintenant (note 07), une parcelle utilisée ne peut plus être supprimée : on l'archive.

---

## 1. Backend : [parcels.py](../server/app/routes/parcels.py)

`DELETE /parcels/<parcelId>` :

| Cas | Réponse |
|---|---|
| Parcelle jamais utilisée | **200** `{ "success": true }`, supprimée comme avant |
| Parcelle inexistante | **404** (avant : 200 même si elle n'existait pas) |
| Parcelle utilisée par au moins une culture, un traitement phyto ou un travail aux champs | **409**, rien n'est supprimé |

Corps de la réponse 409 :

```json
{
  "error": "Parcelle utilisée : elle ne peut pas être supprimée, archivez-la plutôt",
  "code": "PARCEL_IN_USE",
  "parcelId": "...",
  "parcelName": "Champ du haut",
  "usage": { "crops": 1, "phytoTreatments": 2, "fieldWorks": 1 }
}
```

- `usage` compte les cultures, traitements et travaux **distincts** liés à la parcelle (nouvelle fonction `_parcel_usage`).
- Aucune migration SQL n'est nécessaire.
- [API_DOCUMENTATION.md](../server/app/API_DOCUMENTATION.md) est mis à jour.

---

## 2. Frontend : service [parcelles-server.service.ts](../src/app/parcelles/services/parcelles-server.service.ts)

- **`ParcelUsage`** (interface) et **`ParcelInUseError`** (classe d'erreur) : quand le serveur répond 409 `PARCEL_IN_USE`, `deleteParcelle()` lève une `ParcelInUseError`, avec `parcelId`, `parcelName` et `usage`. Elle ne lève plus une simple `HttpErrorResponse`.
- **`describeParcelUsage(usage)`** : renvoie un texte lisible, par exemple « 1 culture, 2 traitements phyto et 1 travail aux champs ».
- **`deleteOrArchiveParcelle(id, nom?)`**, nouvelle méthode pour les suppressions depuis l'interface :
  - elle tente la suppression ;
  - si la parcelle est utilisée, elle affiche un `confirm()` qui l'explique et propose **de l'archiver à la place** ;
  - elle renvoie `'deleted'`, `'archived'` ou `'cancelled'`.

---

## 3. Frontend : composants

### 3.1 [parcelles.component.ts](../src/app/parcelles/components/parcelles/parcelles.component.ts)

- **`deleteEditedParcel()`** (bouton « Supprimer » du formulaire de modification) passe par `deleteOrArchiveParcelle()`.
  - Annulé : le formulaire reste ouvert.
  - Archivée : le formulaire se ferme et le bandeau affiche « « X » a été archivée. Vous la retrouverez dans Mes archives. »
- **`deleteSelectedParcelles()`** (suppression multiple) :
  1. les parcelles libres sont supprimées ;
  2. les parcelles utilisées sont mises de côté ;
  3. à la fin, **un seul** `confirm()` les liste avec leur usage et propose de **toutes les archiver** ;
  4. le bandeau indique ensuite combien de parcelles ont été supprimées et combien archivées.
- **`onDel()`** n'est plus appelé dans le HTML, mais je l'ai aligné quand même sur `deleteOrArchiveParcelle()`.

### 3.2 [get-parcelles.component.ts](../src/app/parcelles/components/get-parcelles/get-parcelles.component.ts)

- **`deleteEditedParcel()`** : même changement qu'au § 3.1.

La première confirmation (« Êtes-vous sûr de vouloir supprimer… ? ») n'a pas changé. Le HTML n'a pas été modifié.

---

## 4. Tests à faire

Déjà vérifié :
- compilation TypeScript (`tsc -p tsconfig.app.json`) sans erreur ;
- la route avec une base simulée (cas 404, 200 et 409) ;
- les requêtes de comptage sur la vraie base, en lecture seule.

À tester dans l'application :

1. **Parcelle jamais utilisée** → Supprimer : elle disparaît, comme avant.
2. **Parcelle liée à une culture** → Supprimer, puis confirmer :
   - un second message indique « … utilisée par 1 culture… Voulez-vous l'archiver à la place ? » ;
   - **Annuler** : rien ne change et le formulaire reste ouvert ;
   - **OK** : la parcelle disparaît de la liste et apparaît dans **Mes archives**, et le bandeau de confirmation s'affiche.
3. **Parcelle avec des traitements** : même comportement. Ensuite, l'export du registre affiche toujours l'adresse et les coordonnées de la parcelle.
4. **Suppression multiple** d'un mélange de parcelles libres et utilisées :
   - les libres sont supprimées ;
   - un seul message liste les utilisées ;
   - OK les archive toutes, Annuler les laisse telles quelles.
5. **Mode mandat** (espace d'un autre utilisateur) : même comportement. Le comptage porte sur les données du propriétaire.

## 5. Déploiement

- Backend : remplacer `app/routes/parcels.py` (et `app/API_DOCUMENTATION.md` si tu veux la doc à jour sur le serveur), puis **Restart**.
- Frontend : rebuild et déploiement habituels.
- **Ordre conseillé : backend d'abord.** Les deux autres cas ne cassent rien :
  - frontend nouveau, backend ancien : la suppression se fait comme avant, puisqu'il n'y a jamais de 409 ;
  - backend nouveau, frontend ancien : une parcelle utilisée n'est plus supprimée, mais l'utilisateur ne voit que « Erreur lors de la suppression de la parcelle ».
