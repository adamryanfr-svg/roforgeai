---
name: controle-3d
description: Contrôler la qualité d'un modèle ou d'un décor 3D Roblox avant de le présenter (audit automatique, planche 10 vues, comparaison à la référence). À utiliser après toute construction 3D et quand l'utilisateur dit que ça « fait amateur ».
---

# Contrôle 3D

## Boucle obligatoire avant de dire « c'est fini »
1. **Audit** : mcp__roforge__controle_3d { chemin } (creature = true pour un animal / personnage).
   - `NEON` : remplacer par SmoothPlastic/Glass + vraie lumière. Toujours une erreur.
   - `S1` pièce ni ancrée ni soudée → Anchored ou WeldConstraint.
   - `B2` pièce flottante / `B2M` modèle qui flotte → reposer sur son support (raycast vers le bas).
   - `A1` faces superposées de couleurs différentes (z-fighting) → décaler de 0,02 ou fusionner.
   - `A6` pièce trop fine → épaissir à ≥ 0,05.
   - `B1` pièce enfouie → supprimer si invisible, sinon la sortir.
   - `C1` pas de PrimaryPart / pivot excentré → corriger l'organisation.
   - `PAL` palette dispersée ou monotone → regrouper en 4 à 8 teintes avec variations légères.
   - `DET` trop peu de pièces → ajouter les détails qui manquent (cadres, rebords, accessoires).
   Corrige toute la famille d'un défaut, pas seulement la première occurrence, puis relance l'audit.
2. **Planche** : mcp__roforge__planche_vues { chemin } puis Read de la planche. Vérifie :
   - silhouette lisible de loin, proportions crédibles par rapport à un personnage de 5,5 studs ;
   - dos, côtés et dessous finis (pas de face oubliée, couleurs et motifs qui continuent) ;
   - symétrie quand l'objet doit l'être ; yeux / membres complets pour une créature ;
   - rien qui flotte, rien qui traverse, aucun scintillement visible ;
   - densité de détails homogène (pas un côté riche et un côté vide).
3. **Référence** (si l'utilisateur en a donné une) : mcp__roforge__comparer_reference { chemin, reference }.
   Note sur 5 : silhouette, proportions, couleurs/matières, densité de détails, éclairage, finition/VFX. Tout critère sous 4 → corriger en priorité, recomparer. Donne les notes à l'utilisateur.

## Limites à dire honnêtement
L'audit lit les boîtes englobantes : il ne voit ni les faces internes des maillages, ni les UV, ni le rig, ni le style. Un audit propre ne prouve pas que c'est beau : la planche et l'avis de l'utilisateur restent indispensables.
