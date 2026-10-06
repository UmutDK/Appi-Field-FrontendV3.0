# Normes responsive — tableau de référence

Ce document résume les normes encadrant la construction d'une application responsive : breakpoints, grille, espacements, dimensions des composants interactifs et échelle typographique.

## Tableau des normes par largeur d'écran

| Largeur écran (px) | Nom breakpoint | Mode | Nb colonnes grille | Marge extérieure (px) | Gouttière (px) | Dimension bouton — hauteur min (px) | Taille police corps (px) | Interligne | Taille police H1 (px) | Taille police H2 (px) | Taille police H3 (px) | Taille police H4 (px) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 – 575,99 | xs | Smartphone | 4 | 16 | 16 | 44 | 14 | 1,4 | 34 | 27 | 22 | 18 |
| 576 – 991,99 | sm/md | Tablette | 8 | 24 | 24 | 44–48 | 16 | 1,5 | 39 | 31 | 25 | 20 |
| 992 – 1199,99 | lg | PC | 12 | 32 | 24 | 40–44 | 16 | 1,5 | 39 | 31 | 25 | 20 |
| 1200 – 1399,99 | xl | PC large | 12 | 32 | 32 | 40 | 18 | 1,6 | 44 | 35 | 28 | 23 |
| ≥ 1400 | xxl | Grand écran / desktop | 12 | 40 (ou container max-width) | 32 | 40 | 18 | 1,6 | 44 | 35 | 28 | 23 |

## Légende et notes de conception

### Échelle typographique
Ratio **1,25** (Major Third) appliqué entre chaque niveau :
- H4 = base × 1,25
- H3 = base × 1,25²
- H2 = base × 1,25³
- H1 = base × 1,25⁴

### Dimension bouton
Cible tactile minimale recommandée par **WCAG 2.5.5** : 44×44px. Material Design recommande 48×48px. Sur PC (souris), 40–44px suffit car le clic est plus précis que le doigt.

### Marge extérieure ≥ 1400px
Au-delà de 1400px, fixer un **max-width de container** (ex. 1320px ou 1440px) centré avec `margin: auto`, plutôt que d'augmenter indéfiniment la marge — pour éviter des lignes de texte trop longues (au-delà de ~75–80 caractères, la lecture devient fatigante).

### Alignement avec les frameworks CSS
- **Bootstrap** : 576 / 768 / 992 / 1200 / 1400px
- **Tailwind** : 640 / 768 / 1024 / 1280 / 1536px

Vérifier la cohérence des breakpoints choisis si un framework est utilisé, ou adapter en connaissance de cause pour un système custom.

### Interligne (line-height)
Exprimé en valeur sans unité (multiplicateur de la taille de police), et non en pixels — pour rester proportionnel si la taille de police change.

### Accessibilité
Respecter un contraste texte/fond minimum de **4.5:1** (WCAG AA) à toutes les tailles d'écran et pour tous les niveaux de titre.

---

## Bonnes pratiques — Formulaires responsive

### 1. Dimensions des champs (inputs)

| Largeur écran | Hauteur input (px) | Largeur input | Padding interne (horizontal) | Padding interne (vertical) |
|---|---|---|---|---|
| Smartphone (xs) | 44–48 | 100% du container (pleine largeur) | 12–16px | 10–12px |
| Tablette (sm/md) | 44–48 | 100% ou 48–70% en formulaire multi-colonnes | 14–16px | 10–12px |
| PC (lg) | 40–44 | Largeur fixe ou % selon grille (max ~480–560px pour un champ texte simple) | 12–16px | 8–10px |
| PC large / Grand écran (xl/xxl) | 40–44 | Idem PC, ne pas dépasser ~600px de large (lisibilité et cohérence visuelle) | 12–16px | 8–10px |

**Règles générales :**
- Hauteur minimale **44px sur mobile/tablette** (cible tactile WCAG 2.5.5), 40px acceptable sur PC (souris).
- **Ne jamais étirer un input texte sur toute la largeur d'un écran desktop** : au-delà de ~600–700px, la lecture/correction devient inconfortable. Limiter avec un `max-width`.
- Sur mobile, privilégier des champs **pleine largeur** (empilés verticalement) plutôt que côte à côte, sauf paires logiques courtes (ex. Code postal / Ville, Jour/Mois/Année).
- Espacement vertical entre deux champs : **16–24px** sur mobile, **20–24px** sur desktop (assez pour éviter les erreurs de tap/clic).

### 2. Boutons de formulaire (submit, actions)

| Largeur écran | Hauteur bouton | Largeur bouton | Position |
|---|---|---|---|
| Smartphone | 44–48px | 100% (pleine largeur) | En bas du formulaire, sticky si formulaire long |
| Tablette | 44–48px | Pleine largeur ou auto (min 120px) | Aligné à droite ou pleine largeur selon contexte |
| PC | 40–44px | Auto, min 100–140px de large, padding horizontal 24–32px | Aligné à droite (ou gauche si RTL), jamais pleine largeur |

**Règles générales :**
- Bouton principal (submit) toujours **visuellement dominant** (couleur pleine, contraste fort) ; bouton secondaire (annuler) en style outline/ghost.
- Espacement minimum **8px** entre deux boutons adjacents pour éviter les clics/taps accidentels.
- Sur mobile, envisager un **bouton sticky en bas de viewport** pour les formulaires longs (évite de devoir scroller pour valider).
- État désactivé (disabled) visuellement distinct (opacité ~40–50%, curseur `not-allowed`) et non focusable au clavier.
- Toujours prévoir les états : `default`, `hover` (desktop uniquement), `focus`, `active/pressed`, `disabled`, `loading` (spinner si action asynchrone).

### 3. Dropdowns / listes déroulantes (select)

| Largeur écran | Hauteur du champ fermé | Comportement à l'ouverture |
|---|---|---|
| Smartphone | 44–48px | Idéalement **picker natif** (bottom sheet / action sheet natif iOS-Android) plutôt qu'un dropdown custom flottant, plus ergonomique au toucher |
| Tablette | 44–48px | Dropdown custom en overlay, ou bottom sheet selon nb d'options |
| PC | 40–44px | Menu déroulant classique ancré sous le champ (max-height avec scroll interne au-delà de ~8-10 items) |

**Règles générales :**
- Toujours afficher une **icône chevron** (▾) indiquant que le champ est cliquable/dépliable.
- Limiter la hauteur de la liste ouverte (`max-height: ~280–320px`) avec scroll interne au-delà de 8-10 options ; ajouter un champ de recherche/filtre si plus de ~15 options.
- Sur mobile, préférer les composants natifs du système (`<select>` HTML natif ou bottom sheet) : ils gèrent nativement clavier, accessibilité et ergonomie tactile mieux qu'un dropdown custom.
- Fermeture du dropdown : clic/tap en dehors, touche `Échap`, ou sélection d'une option.
- État "aucune option sélectionnée" : afficher un placeholder explicite (ex. "Sélectionner un pays") en gris, jamais une option pré-cochée trompeuse.
- Pour les listes à sélection multiple, afficher des **chips/tags** des éléments sélectionnés plutôt qu'une liste texte brute.

### 4. Placeholders

**Règles générales (indépendantes de la largeur d'écran, mais critiques en UX formulaire) :**
- **Ne jamais utiliser le placeholder comme unique label.** Il disparaît dès que l'utilisateur commence à saisir — risque de perte de contexte, notamment sur mobile où le clavier virtuel masque une partie de l'écran. Toujours un `<label>` visible au-dessus ou en floating label.
- Contraste du texte placeholder : gris moyen (ex. `#767676` sur fond blanc) — assez visible pour être lu, assez distinct du texte saisi pour ne pas être confondu avec une valeur déjà remplie (contraste minimum recommandé ~4.5:1 même pour les placeholders si porteurs d'information).
- Contenu du placeholder : **donner un exemple de format attendu**, pas répéter le label (ex. label "Téléphone" + placeholder "06 12 34 56 78", pas placeholder "Entrez votre téléphone").
- Ne jamais utiliser le placeholder pour des instructions critiques (ex. contraintes de mot de passe) : utiliser un texte d'aide (`helper text`) sous le champ, toujours visible.
- Style : police identique à la saisie utilisateur mais en italique **déconseillé** (nuit à la lisibilité) — préférer un poids de police normal ou légèrement plus léger, couleur atténuée suffit à le différencier.

### 5. Style général des inputs et dropdowns

| Élément | Recommandation |
|---|---|
| Bordure (état par défaut) | 1–1,5px, couleur neutre gris clair (ex. `#D0D0D0`) |
| Bordure (état focus) | 2px, couleur d'accent de la marque, + éventuel halo `box-shadow` (0 0 0 3px couleur à 20% opacité) pour l'accessibilité clavier |
| Bordure (état erreur) | 1,5–2px rouge (`#D32F2F` ou équivalent charte), + icône d'alerte dans le champ |
| Bordure (état succès/validé) | 1,5px vert, + icône check (optionnel, utile en validation temps réel) |
| Border-radius | Cohérent avec la charte graphique globale (4–8px habituel ; 0 pour un style plus "flat/carré") |
| Fond | Blanc ou gris très clair (`#F7F7F8`) pour différencier du fond de page |
| Fond (état disabled) | Gris clair (`#F0F0F0`), texte gris moyen, curseur `not-allowed` |
| Label | Toujours visible, 12–14px, au-dessus du champ (ou floating label qui migre au-dessus au focus) |
| Texte d'aide / erreur | 12–13px, sous le champ, couleur neutre (aide) ou rouge (erreur) |
| Icônes dans le champ | Taille 16–20px, alignées verticalement au centre, cliquables si actionnables (ex. œil pour afficher mot de passe, croix pour vider le champ) |

### 6. Disposition du formulaire selon la largeur d'écran

| Largeur écran | Disposition recommandée |
|---|---|
| Smartphone (xs) | **Une seule colonne**, champs empilés verticalement, boutons pleine largeur |
| Tablette (sm/md) | Une colonne, ou deux colonnes pour champs courts/associés (ex. Prénom/Nom, Ville/Code postal) |
| PC (lg à xxl) | Jusqu'à deux colonnes pour formulaires longs (regrouper logiquement les champs), largeur totale du formulaire limitée (~600–800px) pour rester lisible, ne pas étirer sur toute la largeur de l'écran |

### 7. Accessibilité et clavier (transverse à toutes les tailles)
- Tous les champs et boutons doivent être **atteignables et actionnables au clavier** (`Tab`, `Entrée`, `Espace`, `Échap` pour fermer un dropdown).
- Ordre de tabulation (`tabindex`) cohérent avec l'ordre visuel du formulaire.
- Association explicite `label` / `input` via `for`/`id` (ou `aria-label` si le label n'est pas visible), indispensable pour les lecteurs d'écran.
- Messages d'erreur annoncés dynamiquement (`aria-live="polite"` ou `role="alert"`) pour les utilisateurs de lecteurs d'écran.
- Ne jamais s'appuyer uniquement sur la couleur pour indiquer un état (erreur/succès) : toujours coupler avec une icône et/ou un texte.
- Type d'input HTML sémantique adapté (`type="email"`, `type="tel"`, `type="number"`, `inputmode="numeric"`) pour déclencher le bon clavier virtuel sur mobile.

### 8. Validation
- **Validation en temps réel (inline)** dès que possible, déclenchée à la perte de focus (`onBlur`) plutôt qu'à chaque frappe (`onChange`) — évite d'afficher une erreur pendant que l'utilisateur tape encore.
- Message d'erreur **spécifique et actionnable** (ex. "Le mot de passe doit contenir au moins 8 caractères" plutôt que "Champ invalide").
- Sur mobile, s'assurer que le message d'erreur reste visible même quand le clavier virtuel est ouvert (éviter qu'il soit masqué sous le clavier).