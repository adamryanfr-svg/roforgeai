# RoForge

**L'atelier Roblox avec l'IA** : tu décris ton jeu en français, Claude le construit directement dans Roblox Studio et Codex dessine les images. Tout tourne sur ton PC, avec tes propres abonnements.

## Ce que fait RoForge

- **Construit dans Studio** : scripts, interfaces, maps, systèmes de jeu. Le plugin RoForge s'installe tout seul dans Studio.
- **Modèles 3D pro en MeshPart** : chaque objet (véhicule sale et cabossé, chapeau, cheveux, arme, créature…) est un maillage texturé par l'IA 3D de Roblox, une pièce à la fois. Chaque modèle passe par un contrôle automatique : audit et planche de 10 vues.
- **Images** : icônes, interfaces (PNG transparents), miniatures 1920 × 1080 et icône du jeu, faites par Codex à partir de captures du vrai jeu.
- **Personnages** : rig, vêtements dessinés (Shirt / Pants), visage, accessoires, avec comparaison mesurée à une image de référence.
- **Tests de jeu automatiques** : un bot joue en Play et RoForge en fait un rapport (erreurs, joueurs bloqués, interface hors écran, FPS).
- **Galerie « Recréer »**, équilibrage de l'économie, mémoire de tes règles, journal du jeu, sauvegardes automatiques.
- **Jamais de Toolbox / Creator Store, jamais de néon** : rendu pro comme les jeux du top.

## Ce qu'il te faut

- **Windows 10 ou 11**
- **[Node.js](https://nodejs.org) LTS** (version 20 ou plus)
- **[Roblox Studio](https://create.roblox.com)**
- Un **abonnement Claude** (Pro ou Max) pour construire le jeu
- Un **compte ChatGPT** (facultatif) pour que Codex fasse les images

## Installation

1. Télécharge RoForge : bouton vert **Code › Download ZIP**, puis décompresse-le. Si tu as Git, tu peux aussi lancer :
   ```
   git clone https://github.com/adamryanfr-svg/roforge.git
   ```
2. Double-clique sur **`RoForge.bat`**. Au premier lancement, il installe tout ce qu'il faut (quelques minutes), puis ouvre RoForge.
3. Dans RoForge, va dans **Réglages › Comptes** et connecte Claude (et Codex si tu veux les images). La connexion se fait dans la fenêtre officielle : RoForge ne voit jamais tes identifiants.
4. Ouvre Roblox Studio sur ton jeu. Le plugin RoForge se connecte tout seul (redémarre Studio une fois s'il était déjà ouvert).

Ensuite, crée un jeu dans RoForge et décris ce que tu veux.

## Mise à jour

Retélécharge le ZIP, ou lance `git pull` dans le dossier si tu l'as cloné, puis relance `RoForge.bat`.

## Où sont mes données ?

Tes jeux, conversations et réglages sont dans `Documents\RoForge` sur ton PC. Rien n'est envoyé ailleurs que vers Claude, Codex et Roblox Studio.
