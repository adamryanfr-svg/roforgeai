// Miniatures (1920×1080) et icônes de jeu (512×512) au niveau des jeux du top : brief pro,
// captures du vrai jeu pour la fidélité, miniatures de la bibliothèque pour le style seulement.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./store');

const THUMB_STYLE_DIR = path.join(ROOT, 'bibliotheque', 'miniatures');
const THUMB_FORMULAS = {
  action: 'ACTION : le héros frappe / lance son pouvoir vers une victime ou un ennemi en plein écran ; impact au centre avec débris, poussière, fissures du sol, traînée de vitesse ; la victime a une expression comique de choc ou de douleur (yeux exorbités, bouche grande ouverte, larmes).',
  avant_apres: 'AVANT / APRÈS : image coupée en deux par une barre verticale blanche/noire ; à gauche la version faible (terne, triste, petite), à droite la version forte (brillante, fière, énorme) ; grosse flèche courbe rouge ou jaune de gauche à droite ; un titre court en haut de chaque moitié.',
  heros: 'HÉROS : 2 ou 3 personnages côte à côte en plan américain, chacun sur un fond de couleur différente avec une énergie (feu, éclair, aura) dans sa teinte, séparés par des diagonales nettes ; regards déterminés vers la caméra.',
  epique: 'ÉPIQUE : un seul personnage en gros plan très proche (visage + torse), puissance qui explose autour (aura, cheveux qui flottent, éclairs, particules dorées), contre-plongée, expression intense.',
  toi: 'TOI : une situation intrigante vue de loin (cachette, piège, foule, poursuite) et une grosse flèche rouge avec le mot « YOU » / « TOI » qui pointe le personnage du joueur.',
  scene: 'SCÈNE : un moment clé du jeu en plan large (la map, la foule, la base) avec un personnage en premier plan qui réagit de façon exagérée (pointe du doigt, crie, rit) ; profondeur nette au premier plan, fond lisible.',
  libre: '',
};
function brief({ sujet, formule, texte, titre_jeu, format, nbJeu, nbStyle, modele }) {
  const icon = format === 'icone';
  return [
    `Génère UNE ${icon ? 'icône de jeu Roblox (carré 1:1, 1024×1024)' : 'miniature (thumbnail) de jeu Roblox au format paysage (1536×1024, sera recadrée en 16:9 : garde tout l’important dans la bande centrale, rien de vital dans les 8 % du haut et du bas)'} avec ton outil de génération d’images, au niveau des miniatures des jeux Roblox du top (millions de visites).`,
    `Sujet : ${sujet}`,
    THUMB_FORMULAS[formule] ? `Formule : ${THUMB_FORMULAS[formule]}` : '',
    'Rendu obligatoire :',
    '- Personnages Roblox blocky (tête cube arrondie, corps et membres en blocs, mains en blocs ou gants), mais rendus comme une illustration 3D haut de gamme : volumes modelés, textures nettes, vêtements détaillés.',
    '- Visages cartoon TRÈS expressifs dessinés sur la tête (gros yeux, sourcils marqués, bouche ouverte, dents, larmes / sueur si comique).',
    '- Poses dynamiques exagérées, perspective forcée (le poing ou la main vers la caméra paraît énorme), angle de caméra dramatique (contre-plongée ou plongée).',
    '- Éclairage de studio dramatique : lumière principale franche + contre-jour coloré qui découpe les silhouettes ; ombres de contact ; couleurs saturées mais harmonieuses, contraste fort sujet / fond.',
    '- Effets d’action dessinés : débris, poussière, éclats, fissures, traînées de vitesse, auras ou flammes stylisées — énergie peinte, pas de néon fluo plat.',
    '- Composition : 1 à 3 sujets maximum, le sujet principal occupe 50 à 70 % de l’image, lisible même en tout petit (comme dans la liste des jeux sur mobile), fond simple légèrement flou (ciel, sol, décor du jeu).',
    texte ? `- Texte : écris exactement « ${texte} » en ÉNORMES lettres cartoon grasses, contour noir épais + ombre portée, remplissage blanc ou jaune dégradé, parfaitement orthographié, 3 mots maximum.` : '- Aucun texte dans l’image.',
    titre_jeu ? `- Logo du jeu « ${titre_jeu} » petit dans un coin (en bas à droite), lettrage stylisé coloré avec contour, lisible.` : '- Pas de logo.',
    '- Interdits : logo Roblox, filigrane, interface de jeu, cadre, bordure, damier, texte parasite.',
    nbJeu ? `Images jointes 1 à ${nbJeu} = captures du VRAI jeu : reprends fidèlement ses personnages (tenues, couleurs, accessoires), sa map et ses objets.` : '',
    modele ? `Image jointe ${nbJeu + 1} = la miniature MODÈLE à recréer : reprends sa composition (placement des sujets, cadrage, angle de caméra), son énergie, son éclairage et sa façon de poser le texte, mais avec les personnages, la map et le nom de CE jeu ; ne recopie ni ses personnages, ni son texte, ni son logo.` : nbStyle ? `Images jointes ${nbJeu + 1} à ${nbJeu + nbStyle} = références de STYLE seulement (qualité de rendu, énergie, composition, lisibilité) : ne copie ni leurs personnages, ni leurs textes, ni leurs logos.` : '',
    'Fond plein (pas de transparence).',
  ].filter(Boolean).join('\n');
}
function styleRefs(formule, max = 2) {
  if (!fs.existsSync(THUMB_STYLE_DIR)) return [];
  const files = fs.readdirSync(THUMB_STYLE_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const prefix = { action: 'action', avant_apres: 'avant-apres', heros: 'heros', epique: 'epique', toi: 'toi', scene: 'scene' }[formule] || 'action';
  const pick = files.filter((f) => f.startsWith(prefix));
  return (pick.length ? pick : files).slice(0, max).map((f) => path.join(THUMB_STYLE_DIR, f));
}

module.exports = { brief, styleRefs, STYLE_DIR: THUMB_STYLE_DIR };
