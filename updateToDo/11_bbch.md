# Traitement phyto : enregistrement du stade phénologique (BBCH)

Guide d'implémentation **frontend**. Le backend est déjà prêt (voir § 1). Il y a **4 petites modifications** à faire.

## Contexte

Le formulaire de traitement a un champ « Mentionnez un stade phénologique » (`formControlName="bbch"`, étape Répartition), mais la valeur saisie **n'était jamais enregistrée** :

- la table `phytoTreatments` n'avait pas de colonne pour la stocker ;
- [`treatmentToApi()`](../src/app/registre/services/registre.service.ts) ne l'envoyait pas au serveur ;
- [`treatmentFromApi()`](../src/app/registre/services/registre.service.ts) ne la relisait pas.

Résultat : le BBCH disparaissait à chaque enregistrement. La colonne « BBCH » du carnet de champ affichait toujours « / », « N/A » ou « Non spécifié », et la colonne « Stade phénologique » de l'export restait vide.

---

## 1. Contrat API (déjà en place)

Le traitement a un nouveau champ texte **`bbch`** :

| Route | Comportement de `bbch` |
|---|---|
| `POST /phyto_treatments` | Optionnel. Texte libre (ex. `"BBCH 31"`), 255 caractères au maximum. Vide ou absent = `null`. |
| `PUT /phyto_treatments/<id>` | **Absent = valeur conservée.** `""` ou `null` = valeur effacée. |
| `GET /phyto_treatments`, `GET /phyto_treatments/<id>` | Toujours présent : `string` ou `null` |

L'export du registre (Excel et PDF) remplit maintenant la colonne **« Stade phénologique »** avec ce champ.

---

## 2. Modifications à faire

### 2.1 Envoi au serveur : [registre.service.ts](../src/app/registre/services/registre.service.ts), `treatmentToApi()` (ligne 163)

Ajouter, par exemple à côté de `remarks` :

```ts
// Stade phénologique (texte libre). `undefined` (champ absent du brouillon) n'est pas envoyé :
// le serveur conserve alors la valeur existante. Une chaîne vide efface la valeur.
bbch: t.bbch,
```

> **Ne pas** écrire `t.bbch || ''`. Certains enregistrements partiels, comme la sauvegarde automatique de la remarque via `updatePhytoTreatmentFinal`, passent par cette fonction avec un objet qui n'a pas toujours `bbch`. Envoyer `''` effacerait alors le stade enregistré. Avec `t.bbch`, une valeur `undefined` n'est pas envoyée et le serveur garde l'ancienne.

### 2.2 Lecture depuis le serveur : même fichier, `treatmentFromApi()` (ligne 192)

```ts
bbch: t.bbch || '',
```

Le préremplissage en modification fonctionne alors sans autre changement, puisque `traitement-phyto.component.ts` lit déjà `editingTreatment.bbch` (lignes 1933, 2378 et 3771). De même, les vues suivantes lisent déjà `bbch` :

- la **vue globale** du carnet ([registre-get-vue-globale.component.ts](../src/app/registre/components/registre-get-vue-globale/registre-get-vue-globale.component.ts), `traitement.bbch`) ;
- le **détail d'une culture** ([culture-detail-popup.component.ts](../src/app/registre/components/culture-detail-popup/culture-detail-popup.component.ts), ligne 114, `originalData.bbch`).

### 2.3 Carnet de champ : mauvais nom de champ

Deux composants lisent `t.bbch_target`, un champ de l'ancien système qui n'existe plus, au lieu de `t.bbch` :

| Fichier | Ligne | Remplacer | Par |
|---|---|---|---|
| [registre-get.component.ts](../src/app/registre/components/registre-get/registre-get.component.ts) | 229 | `bbch: t.bbch_target \|\| 'Non spécifié',` | `bbch: t.bbch \|\| 'Non spécifié',` |
| [archives.component.ts](../src/app/registre/components/archives/archives.component.ts) | 307 | `bbch: t.bbch_target \|\| 'Non spécifié',` | `bbch: t.bbch \|\| 'Non spécifié',` |

### 2.4 Rien à changer dans le formulaire

Le champ, le contrôle `bbch` du formulaire, `saveBbch()` et la recopie dans `currentTreatmentDraft.bbch` (ligne 3906) sont déjà en place. Seuls l'envoi et la lecture manquaient.

---

## 3. Déploiement

1. Migration SQL `server/migrations/020_add_phyto_treatments_bbch.sql`, **avant** le backend.
2. Backend : fichiers `app/routes/phyto_treatments.py` et `app/utils/exports.py`.
3. Frontend.

**Si le frontend part avant le backend**, rien ne casse : l'ancien serveur ignore le champ `bbch`. La valeur ne sera simplement pas enregistrée tant que le backend n'est pas déployé.

**Les traitements déjà encodés n'ont pas de BBCH**, puisqu'il n'a jamais été enregistré. Ils continueront d'afficher « / » ou « Non spécifié » tant qu'on ne les modifie pas.

## 4. Tests à faire

1. **Nouveau traitement avec « BBCH 31 »** : la requête `POST` contient `"bbch": "BBCH 31"`.
   - « BBCH 31 » apparaît dans la colonne BBCH de la vue globale, dans le détail de la culture et dans le carnet.
2. **Rouvrir ce traitement en modification** : le champ est prérempli avec « BBCH 31 ».
3. **Changer en « BBCH 59 »**, puis enregistrer : la nouvelle valeur est affichée.
4. **Vider le champ**, puis enregistrer : le stade disparaît (« / » ou « Non spécifié »).
5. **Modifier seulement la remarque d'un traitement qui a un BBCH**, avec la sauvegarde automatique : le BBCH est conservé.
6. **Export du registre** (Excel et PDF) : la colonne « Stade phénologique » contient « BBCH 31 » pour ce traitement.
