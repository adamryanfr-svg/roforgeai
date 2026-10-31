---
name: personnage
description: Créer un personnage Roblox (héros, boss, PNJ, skin d'un perso d'anime) fidèle à une référence et de qualité pro comme Blox Fruits / GPO — corps, vêtements dessinés, visage, cheveux, accessoires, armes. À utiliser dès qu'on fait ou reproduit un personnage.
---

# Personnage pro, fidèle à la référence

Un personnage Roblox de jeu du top = **corps blocky** + **vêtements dessinés** (Shirt / Pants : muscles, cicatrices, plis, bottes) + **visage dessiné** + **volumes en accessoires** (cheveux, moustache, chapeau, bandana, cape, épaulettes, armes). Un rig nu avec une cape, ce n'est PAS fini.

## 1. Analyse de la référence (écris-la)
Ouvre l'image et liste TOUT, de la tête aux pieds, avec couleurs hex :
- peau (teinte), visage (yeux, bouche, rides, cicatrices) ;
- haut : torse nu ou vêtement, muscles, cicatrices, tatouages, motifs ; bras ;
- bas : pantalon, ceinture / écharpe, plis, bottes ;
- volumes : cheveux, moustache / barbe, couvre-chef, cape (couleur dedans / dehors), épaulettes, bijoux, arme (forme exacte, longueur, couleurs) ;
- proportions et pose (silhouette massive ? épaules larges ?).
Rien de la liste ne doit manquer à la fin.

## 2. Construction (dans cet ordre)
1. **Rig** : `Players:CreateHumanoidModelFromDescription` (R6 pour un style anime blocky), nommé, ancré pour l'édition. Échelle via BodyHeightScale / BodyWidthScale si le perso est massif.
2. **Vêtements + peau + visage** : `mcp__roforge__vetements` avec la référence dans `references`, des descriptions précises par partie (avant, dos, bras, jambes, taille) et `peau` en hex. C'est ce qui fait le « pro ».
3. **Volumes** :
   - tout volume (cheveux, moustache, barbe, cape, fourrure, armes, armures, épaulettes, bijoux, boucliers) → `mcp__roforge__modele_ia`, **une pièce par génération** (les cheveux seuls, le chapeau seul, l'arme seule), avec `accessoire` pour ce qui est porté ; soude les armes à la main / au dos (Accessory ou Motor6D).
4. Ajuste chaque accessoire (position, taille, rotation) jusqu'à ce qu'il soit à sa place exacte comme sur la référence.

## 3. Contrôle (boucle obligatoire)
1. `mcp__roforge__comparer_reference` (chemin du personnage, chemin de la référence) → scores mesurés + zones faibles.
2. Corrige les zones rouges : forme manquante → accessoire manquant ou mal placé ; couleur → peau / tissu ; détails → texture trop pauvre (relance la partie de `vetements` concernée).
3. Recommence jusqu'à **global ≥ 75** et aucune zone rouge sur la tête, le torse et l'arme. Regarde aussi la planche toi-même : les chiffres ne voient pas tout (expression, motifs).
4. Résumé final : score avant → après, ce qui a été corrigé.
