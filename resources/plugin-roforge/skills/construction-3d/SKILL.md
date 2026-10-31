---
name: construction-3d
description: Construire un modèle, un bâtiment, un décor ou une map dans Roblox Studio avec un rendu pro (comme les vrais jeux du top), jamais néon. À utiliser dès qu'on modélise, construit, décore ou reproduit une référence en 3D.
---

# Construction 3D pro dans Studio

## 1. Avant de poser une seule pièce
1. **Style** : par défaut le style demandé par l'utilisateur ; sinon « simulator pro » (formes généreuses, SmoothPlastic propre, couleurs vives harmonisées) ou « réaliste » (vrais matériaux). Jamais de néon.
2. **Fiche de construction** (écris-la dans ta réponse, courte) :
   - éléments visibles à construire, comptés (ex. 1 comptoir, 2 poteaux, 3 caisses, 12 fruits, 1 auvent rayé à 8 bandes) ;
   - échelle en studs : personnage R15 ≈ 5,5 studs, porte ≈ 7 × 4, marche ≈ 0,8 de haut, table ≈ 3 de haut ;
   - palette hex (4 à 6 teintes) et matières par élément ;
   - lots : lot 1 = un élément maître complet, puis duplication / variantes.
3. **D'après une image de référence** : ouvre-la, liste tout ce qu'elle contient, ne retiens que ce qu'on voit. Si la référence manque et que la demande est vague, fais générer une planche de concept (mcp__roforge__generer_image, avec_fond = true) et fais-la valider avant de construire.
4. **Ambiance d'abord** : mcp__roforge__ambiance (simulator, realiste, coucher, nuit, foret, interieur) avant de juger quoi que ce soit — l'éclairage par défaut de Studio écrase tout.

## 2. Construire
- **Tout objet → mcp__roforge__modele_ia** (cheveux, chapeau, arme, armure, accessoire, créature, véhicule même sale / cabossé, prop, meuble, rocher ou arbre stylisé). C'est un MeshPart texturé généré par l'IA 3D de Roblox : le résultat a la qualité des vrais jeux dès le premier essai, là où un assemblage de Parts fait amateur. Jamais Blender ni Claude Design.
  - **Une pièce = une génération** : le chapeau seul, les cheveux seuls, la cape seule, l'arme seule, puis assemblés. Jamais « un personnage avec chapeau, cheveux et arme » d'un coup.
  - Description en anglais, précise : forme globale, parties, matières, couleurs, détails qui comptent (ex. « old rusty pickup truck, dented doors, mud splashes and dirt stains, cracked windshield »). Pas de « néon », pas de texte.
  - `style` = celui du jeu (anime, simulator, realiste) ; `accessoire` (chapeau, cheveux, visage, cou, dos, taille, epaule) pour un objet porté → Accessory prêt dans ReplicatedStorage.Accessoires (humanoid:AddAccessory).
  - `parties` si on doit animer / recolorer des morceaux (lame + garde + poignée) ; `triangles` 2000-6000 pour un accessoire mobile.
  - Lis la planche renvoyée. Raté (forme molle, détail manquant, mauvaise couleur) → supprime et regénère avec la description corrigée, ou retexture avec mcp__Roblox_Studio__generate_texture (model « Quality »).
- **Architecture, map, sols, plateformes, pièces modulables** → Parts (kit + Luau) ci-dessous.
- **Kit** : mcp__roforge__kit_piece pose des pièces soignées au sol (caisse, tonneau, lanterne, lampadaire, arbre, buisson, rocher, barriere, banc, auvent, etal, panneau, plateforme, escalier, arche) avec la palette du jeu. Sers-t'en comme base, puis ajoute du sur-mesure.
- **Sur-mesure en Luau** (mcp__roforge__executer_luau) : un générateur par élément, paramétré (taille, couleurs), qui crée un Model nommé.
  - Biseaux : noyau + cylindres/coins arrondis aux arêtes visibles (style simulator), ou chanfreins (WedgePart) en réaliste.
  - Détails qui font « pro » : cadres et lattes sur le bois, cerclages sur les tonneaux, plinthes, rebords, poignées, variations de teinte de ±8 % entre pièces voisines, petites imperfections (légères rotations).
  - Formes rondes : Cylinder / Ball ; formes libres facettées : AssetService:CreateEditableMesh ; unions seulement pour les découpes.
- **Interdits** : Material Neon, Highlight décoratif, couleurs fluo, pièces de 0,01 stud, faces superposées de couleurs différentes (z-fighting), pièces qui flottent ou traversent, Toolbox / Creator Store.
- **Organisation** : un Model par objet, nommé en français clair, PrimaryPart = la base, pivot au centre de la base, avant = −Z, Anchored, CanCollide utile seulement, CastShadow coupé sur les tout petits détails.
- **Lumières** : PointLight / SpotLight / SurfaceLight dans du Glass ou SmoothPlastic clair ; Range ≤ 16, peu de sources avec Shadows.
- **Gros décors** : construis par blocs avec task.wait() entre les lots (Studio ne doit pas geler) et parente chaque lot une fois fini.

## 3. Vérifier, toujours
1. mcp__roforge__controle_3d sur le modèle → corrige toutes les **erreurs** (et toute la famille du défaut dans le lot), justifie les avertissements.
2. mcp__roforge__planche_vues → ouvre la planche avec Read : silhouette lisible, proportions, dessous et dos finis, symétrie, rien qui flotte, couleurs cohérentes.
3. Avec une référence : mcp__roforge__comparer_reference → note 6 critères sur 5 (silhouette, proportions, couleurs/matières, densité de détails, éclairage, finition). Sous 4/5 : corrige ce critère et recompare.
4. Présente le résultat avec la planche et dis honnêtement ce qui reste perfectible.
