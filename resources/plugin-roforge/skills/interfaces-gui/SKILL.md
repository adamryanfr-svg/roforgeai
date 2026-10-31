---
name: interfaces-gui
description: Créer des interfaces Roblox (HUD, boutique, inventaire, menus, popups, notifications) de qualité pro, jouables sur téléphone, avec des images générées. À utiliser pour toute GUI.
---

# Interfaces pro (téléphone d'abord)

1. **Références** : regarde 2 à 4 interfaces proches dans la bibliothèque roblox-ai (mcp__roforge__chercher_references) et les images déjà faites du jeu (images/gui/).
2. **Visuels** : chaque panneau, bouton, cadre, barre et icône vient d'une image générée (mcp__roforge__generer_image, fond transparent, avec « cible » : RoForge la téléverse et la pose tout seul). Même lumière, même contour, même palette pour toute la série.
3. **Mise en page** :
   - Tailles en Scale + UIAspectRatioConstraint ; UISizeConstraint pour ne pas exploser sur grand écran.
   - Boutons ≥ 44 px de haut sur téléphone, zones de pouce en bas à droite, rien sous l'encoche (ScreenInsets = DeviceSafeInsets).
   - Panneaux étirables : ImageLabel ScaleType = Slice + SliceCenter.
   - Texte en TextLabel par-dessus l'image (jamais dans l'image) : police lisible (FredokaOne, GothamBold, Montserrat), TextScaled + UITextSizeConstraint, UIStroke fin pour la lisibilité.
4. **Vie** : petits tweens (apparition 0,15 à 0,25 s, rebond léger sur clic), son de clic discret, états survol / appuyé / désactivé.
5. **Données** : la boutique et la monnaie sont validées côté serveur (RemoteFunction), l'interface ne fait qu'afficher.
6. **Vérifier** : mcp__roforge__test_de_jeu (audit de l'interface : hors écran, textes qui débordent, boutons trop petits) et une capture si possible.
