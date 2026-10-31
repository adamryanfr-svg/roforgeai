---
name: miniatures-icones
description: Créer la miniature (thumbnail), l'icône du jeu, les icônes de passes / boutique, des visuels pub ou une planche de concept, fidèles au vrai jeu et de qualité pro. À utiliser pour toute image du jeu demandée à Codex.
---

# Miniatures, icônes et visuels du jeu

## 0. Miniature ou icône du jeu → mcp__roforge__miniature
**Toujours avec leur fond complet (ciel, décor, effets) : jamais détourées, jamais transparentes.** Le fond transparent ne concerne que les images d'interface.
L'outil écrit le brief pro (personnages blocky très expressifs, perspective forcée, éclairage dramatique, effets d'action, lisible en petit), ajoute des miniatures de jeux du top comme références de STYLE et recadre à 1920×1080 / 512×512.
- `sujet` : une scène concrète et drôle ou épique (qui fait quoi à qui, émotion). Ex. « le héros du jeu écrase un noob dans le sol d'un coup de poing géant ».
- `formule` : action (coup / pouvoir), avant_apres (DAY 1 → DAY 99, NOOB → PRO), heros (2-3 personnages côte à côte), epique (gros plan puissance), toi (flèche « YOU »), scene (moment clé du jeu).
- `texte` : 3 mots max, seulement si la formule l'appelle ; `titre_jeu` pour le petit logo.
- `modele` : chemin d'une miniature à RECRÉER (Galerie RoForge, ou image envoyée par l'utilisateur) : sa composition, son cadrage et son énergie sont repris avec les personnages et la map du jeu, sans copier ses personnages, son texte ni son logo.
- `references` : captures du vrai jeu (capture_vue sur le personnage habillé, ambiance appliquée) pour que les personnages soient ceux du jeu.
- Fais 2 variantes (formules différentes) et propose la meilleure.

## 1. Fidélité avant tout
1. Lis le dossier da/ du jeu et regarde les images déjà faites (images/, images/gui/) : une nouvelle image s'aligne sur la série.
2. Si l'image montre quelque chose du jeu (personnage, map, objet), **capture le vrai jeu** : mcp__roforge__ambiance si besoin, puis mcp__roforge__capture_vue sous 2 ou 3 angles flatteurs (trois-quarts, légèrement en hauteur). Passe ces captures dans `references` de mcp__roforge__generer_image.
3. Liste les invariants à garder (formes, couleurs hex, matières, nombre de personnages / objets) et ce qu'il ne faut PAS ajouter.

## 2. Structure du prompt (dans cet ordre)
1. **Usage** : icône d'interface, icône de jeu, miniature, image de boutique, planche de concept, texture répétable, pub.
2. **Sujet exact** : quoi, combien, pose, cadrage.
3. **Style** : celui du jeu (da/). À défaut : « rendu 3D stylisé pro type jeu Roblox du top, volumes nets, légers biseaux, couleurs vives mais harmonisées, lumière studio douce venant d'en haut à gauche, silhouette très lisible ». Jamais néon, jamais fluo.
4. **Fidélité** : « les références sont l'identité visuelle du jeu, pas une capture à recopier ; garder … ; ne pas ajouter … ».
5. **Contraintes** : pas de texte dans les icônes d'interface (le texte se fait en jeu), pas de logo Roblox, pas de filigrane.
6. **Composition** : sujet centré, marges, angle, taille relative.
7. **Format** : taille finale et lisibilité (« lisible à 64 px » pour une icône).

## 3. Formats
- **Icône du jeu** : 512 × 512, sujet unique qui remplit 80 %, fond simple uni ou dégradé (avec_fond = true), lisible en tout petit.
- **Icônes d'interface / passes** : 512 × 512, fond transparent, même cadrage et même lumière pour toute la série. Pour une série ×2 / ×4…, une seule image : le multiplicateur est écrit par l'interface.
- **Miniature** : 1920 × 1080 via mcp__roforge__miniature : une action claire, 1 à 3 personnages max, visages exagérés, perspective forcée, profondeur, gros texte cartoon seulement si utile.
- **Planche de concept 3D** : face, profil, dos et trois-quarts du même objet sur fond neutre clair, même échelle, pour construire ensuite dans Studio.

## 4. Après la génération
- Ouvre l'image avec Read : fidélité, anatomie, lisibilité, transparence réelle (pas de damier dessiné, pas de halo).
- Si c'est raté : relance avec une correction précise (ce qui est faux → ce qu'il faut), une seule chose à la fois.
- Pour l'utiliser en jeu : mcp__Roblox_Studio__upload_image avec url_upload, puis le rbxassetid dans l'ImageLabel / ImageButton.
