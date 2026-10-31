---
name: effets-ambiance
description: Régler l'éclairage d'une place et créer des effets visuels (VFX) Roblox propres et crédibles, sans néon : impacts, poussière, étincelles, fumée, pièces, soin, montée de niveau, auras. À utiliser pour l'ambiance, les attaques, les récompenses et le « juice » du jeu.
---

# Effets et ambiance

## Ambiance
- Commence par mcp__roforge__ambiance : simulator (journée vive), realiste (midi neutre), coucher, nuit, foret (brume verte), interieur.
- Ensuite seulement, ajuste à la main : ClockTime, couleur de l'Atmosphere, saturation de ColorCorrection (± 0,15 max).
- Règles : Technology Future, ombres douces, Bloom Intensity ≤ 0,3, pas d'exposition cramée, pas de teinte violette/néon sauf demande.

## VFX
- Base : mcp__roforge__kit_vfx { type, cible } — poussiere, impact, etincelles, fumee, pieces, soin, niveau, aura. Les rafales ont un attribut « Rafale » : `emitter:Emit(emitter:GetAttribute("Rafale"))`.
- Un bon effet = des **couches** : un éclat court et clair, une matière (poussière / fumée) un peu plus lente, parfois des débris qui retombent (Acceleration vers le bas).
- Durées courtes (0,2 à 1 s pour un impact), tailles qui diminuent, transparence qui monte à la fin, LightEmission ≤ 0,5 (sinon ça fait néon).
- Déclenche les effets côté client (LocalScript ou RemoteEvent vers les clients), jamais en boucle permanente sauf aura / fumée d'ambiance.
- Ajoute du « juice » sobre : léger tremblement de caméra (≤ 0,3 s), petit son, chiffre qui monte pour les gains.
- Performance : ≤ 60 particules vivantes par effet courant ; coupe les émetteurs hors de vue.
