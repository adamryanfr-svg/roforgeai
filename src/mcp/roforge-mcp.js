// Serveur MCP « roforge » lancé par Claude Code / Codex pour chaque conversation.
// Chaque outil est relayé à l'app RoForge (pont local), qui parle au plugin Studio.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const http = require('http');

const PORT = process.env.ROFORGE_PORT || '44777';
const TOKEN = process.env.ROFORGE_TOKEN || '';
const RUN = process.env.ROFORGE_RUN || '';

// http plutôt que fetch : pas de délai maximal (génération d'image, test de jeu).
function call(route, body = {}) {
  const payload = JSON.stringify({ ...body, run: RUN });
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: Number(PORT), path: `/mcp/${route}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'x-roforge-token': TOKEN } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (data.error) reject(new Error(data.error));
            else resolve(data.result);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function tool(server, name, description, shape, route, map = (a) => a) {
  server.tool(name, description, shape, async (args) => {
    try {
      return text(await call(route, map(args)));
    } catch (err) {
      return { content: [{ type: 'text', text: `Erreur : ${err.message}` }], isError: true };
    }
  });
}

const server = new McpServer({ name: 'roforge', version: '0.1.0' });

tool(server, 'studio_etat', 'État de la connexion à Roblox Studio (place ouverte, version du plugin).', {}, 'studio/status');

tool(
  server,
  'executer_luau',
  'Exécute du Luau dans Roblox Studio (contexte plugin, mode édition). print/warn et les valeurs retournées sont renvoyés. Annulable avec Ctrl+Z dans Studio. Pour les gros changements, fais d’abord sauvegarde_place.',
  { code: z.string().describe('Code Luau. Utilise `return` pour renvoyer une valeur.') },
  'studio/run_luau'
);

tool(
  server,
  'arbre',
  'Affiche l’arbre des instances à partir d’un chemin (ex. "Workspace", "ReplicatedStorage.Modules").',
  { chemin: z.string().default('game'), profondeur: z.number().int().min(0).max(6).default(2) },
  'studio/get_tree',
  (a) => ({ path: a.chemin, depth: a.profondeur })
);

tool(
  server,
  'proprietes',
  'Propriétés courantes, attributs et tags d’une instance.',
  { chemin: z.string() },
  'studio/get_properties',
  (a) => ({ path: a.chemin })
);

tool(server, 'lire_script', 'Lit le code source d’un Script / LocalScript / ModuleScript.', { chemin: z.string() }, 'studio/read_script', (a) => ({ path: a.chemin }));

tool(
  server,
  'ecrire_script',
  'Crée ou remplace un script dans Studio. Le chemin inclut le nom du script (ex. "ServerScriptService.Combat").',
  {
    chemin: z.string(),
    source: z.string(),
    classe: z.enum(['Script', 'LocalScript', 'ModuleScript']).default('Script'),
  },
  'studio/write_script',
  (a) => ({ path: a.chemin, source: a.source, className: a.classe })
);

tool(server, 'supprimer', 'Supprime une instance (pas un service).', { chemin: z.string() }, 'studio/delete', (a) => ({ path: a.chemin }));

tool(server, 'selection', 'Instances actuellement sélectionnées par l’utilisateur dans Studio.', {}, 'studio/get_selection');

tool(
  server,
  'sortie_studio',
  'Dernières lignes de la fenêtre Sortie (Output) de Studio : erreurs, warnings, prints.',
  { lignes: z.number().int().min(1).max(300).default(60), erreurs_seulement: z.boolean().default(false) },
  'studio/logs',
  (a) => ({ count: a.lignes, errorsOnly: a.erreurs_seulement })
);

tool(server, 'sauvegarde_place', 'Sauvegarde l’état du jeu (Workspace, scripts, GUI, Lighting…) dans ServerStorage pour pouvoir revenir en arrière.', { nom: z.string().optional() }, 'studio/snapshot', (a) => ({ label: a.nom }));

tool(
  server,
  'generer_image',
  'Fait générer une image par Codex (imagegen, abonnement ChatGPT) pour une interface : fond de panneau, bouton, icône, cadre, barre, badge, titre… PNG transparent par défaut, enregistré dans images/gui/, TÉLÉVERSÉ AUTOMATIQUEMENT sur Roblox (champ asset = rbxassetid) et posé directement sur « cible » si tu la donnes. Une image par appel ; compte 1 à 3 minutes.',
  {
    description: z.string().describe('Ce qu’il faut dessiner, avec le style pro du jeu, jamais néon (ex. "bouton vert arrondi style jeu mobile pro, dégradé subtil, ombre douce, contour fin, sans texte")'),
    nom: z.string().describe('Nom de fichier court, ex. "bouton-acheter"'),
    taille: z.string().default('512x512').describe('ex. 512x512, 1024x256, 1024x1024'),
    avec_fond: z.boolean().default(false).describe('true pour tout ce qui n’est pas de l’interface : décor, planche de concept, fond d’écran (les miniatures et icônes du jeu passent par l’outil miniature, toujours avec fond)'),
    references: z.array(z.string()).default([]).describe('Chemins d’images de référence (captures du jeu via capture_vue, DA, concept) pour une image fidèle au vrai jeu'),
    cible: z.string().optional().describe('Chemin de l’ImageLabel / ImageButton (ou Frame) où poser l’image tout de suite, ex. "StarterGui.Boutique.Fond"'),
    decoupe: z.array(z.number()).length(4).optional().describe('SliceCenter [x0, y0, x1, y1] en pixels pour un panneau / bouton étirable (ScaleType Slice)'),
  },
  'image/generate',
  (a) => ({ prompt: a.description, name: a.nom, size: a.taille, background: a.avec_fond, references: a.references, cible: a.cible, decoupe: a.decoupe })
);

const vec3 = z.array(z.number()).length(3);

tool(
  server,
  'modele_ia',
  'LA méthode pour TOUT objet 3D (cheveux, chapeau, arme, armure, accessoire, créature, véhicule même sale / cabossé, meuble, prop, rocher, arbre stylisé…), une pièce par appel (le chapeau seul, les cheveux seuls) : l’IA 3D de Roblox génère un maillage TEXTURÉ (MeshPart), puis RoForge le nomme, le pose au sol, l’ancre, fixe le pivot, fait le contrôle 3D et la planche 10 vues ; avec accessoire, il devient un Accessory portable (ReplicatedStorage.Accessoires). Compte 1 à 4 minutes. Les Parts / kit_piece restent pour l’architecture, la map et ce qui doit être modulable.',
  {
    description: z.string().describe('Description visuelle COURTE et précise en anglais (1 phrase, sans répétition) : forme, matière, couleurs, 1 ou 2 détails clés, ex. "old rusty pickup truck, dented doors, mud splashes, cracked windshield"'),
    nom: z.string().describe('Nom du modèle en français clair, ex. "CamionRouille"'),
    style: z.enum(['anime', 'simulator', 'realiste']).default('anime'),
    taille: vec3.optional().describe('Boîte en studs [x, y, z] ; par défaut adaptée à l’accessoire'),
    accessoire: z.enum(['chapeau', 'cheveux', 'visage', 'cou', 'dos', 'taille', 'epaule']).optional(),
    position: vec3.optional().describe('Où le poser au sol (y ignoré)'),
    rotation: z.number().optional(),
    parent: z.string().optional(),
    parties: z.array(z.string()).max(8).optional().describe('Découpage explicite en parties nommées (ex. ["lame", "garde", "poignée"]) pour animer / colorer séparément'),
    triangles: z.number().int().min(12).max(20000).optional().describe('Maximum de triangles (perf mobile : 2000 à 6000 pour un accessoire)'),
  },
  'mesh/generate'
);

tool(
  server,
  'vetements',
  'Habille un personnage Roblox (R6 / R15 classique) comme dans les vrais jeux anime : Codex dessine des textures plates (torse avant, dos, bras, bassin, jambes, visage), RoForge les assemble dans le gabarit officiel Shirt / Pants, les téléverse et les pose sur le personnage (+ couleur de peau). C’est ce qui donne les muscles, cicatrices, tenues, plis et bottes dessinés. Les volumes (cheveux, moustache, chapeau, cape, armes, épaulettes) se font ensuite avec modele_ia (accessoire). Compte 2 à 4 minutes.',
  {
    cible: z.string().describe('Chemin du personnage (Model avec Humanoid), ex. "Workspace.HerosPirate"'),
    nom: z.string().default('perso').describe('Préfixe des fichiers'),
    haut: z.object({ avant: z.string(), dos: z.string().optional(), bras: z.string().optional() }).optional().describe('Description précise du haut : avant (ex. "torse nu très musclé, abdos et pectoraux dessinés, cicatrice en croix sur la poitrine, peau bronzée #C98E5E"), dos, bras (ex. "bras nus musclés, veines, tatouage")'),
    bas: z.object({ jambes: z.string(), taille: z.string().optional() }).optional().describe('jambes (ex. "pantalon large kaki #8A9A6B avec plis, bottes noires en bas"), taille (ex. "ceinture-écharpe noire nouée")'),
    visage: z.string().optional().describe('Traits du visage (yeux, sourcils, bouche, cicatrices) — fond transparent'),
    peau: z.string().optional().describe('Couleur de peau hex appliquée au corps, ex. "#C98E5E"'),
    style: z.string().optional(),
    references: z.array(z.string()).default([]).describe('Image(s) de référence du personnage'),
  },
  'character/clothes'
);

tool(
  server,
  'miniature',
  'Miniature de jeu pro (1920×1080) ou icône de jeu (512×512) au niveau des jeux Roblox du top : personnages blocky très expressifs, action, perspective forcée, éclairage dramatique, gros texte cartoon optionnel. Passe des captures du vrai jeu (capture_vue) dans references pour des personnages fidèles. Enregistrée dans images/miniatures/.',
  {
    sujet: z.string().describe('La scène précise : qui, fait quoi, à qui, où, émotion (ex. "le héros du jeu donne un coup de poing géant à un noob qui s’écrase dans le sol fissuré")'),
    nom: z.string().default('miniature'),
    formule: z.enum(['action', 'avant_apres', 'heros', 'epique', 'toi', 'scene', 'libre']).default('action'),
    texte: z.string().optional().describe('Gros texte dans l’image (3 mots max), ex. "DAY 1 → DAY 99", "NOOB vs PRO", "YOU"'),
    titre_jeu: z.string().optional().describe('Nom du jeu pour un petit logo dans le coin'),
    format: z.enum(['miniature', 'icone']).default('miniature'),
    references: z.array(z.string()).default([]).describe('Captures du vrai jeu (personnages, map)'),
    modele: z.string().optional().describe('Chemin d’une miniature à RECRÉER (galerie RoForge ou image de l’utilisateur) : sa composition et son énergie sont reprises avec le jeu de l’utilisateur'),
  },
  'image/thumbnail'
);

tool(
  server,
  'kit_piece',
  'Construit une pièce de décor soignée dans Studio, posée au sol (jamais néon) : caisse, tonneau, lanterne, lampadaire, arbre, buisson, rocher, barriere, banc, auvent, etal, panneau, plateforme, escalier, arche. Base pour monter vite un décor pro, à compléter par du sur-mesure.',
  {
    type: z.string(),
    position: vec3.describe('[x, y, z] ; y est ignoré : la pièce est posée sur le sol'),
    style: z.enum(['simulator', 'realiste']).default('simulator'),
    rotation: z.number().default(0).describe('Degrés autour de Y'),
    nom: z.string().optional(),
    parent: z.string().optional().describe('Chemin du parent, ex. "Workspace.Marche"'),
    palette: z.object({ bois: z.string(), pierre: z.string(), feuille: z.string(), accent: z.string(), accent2: z.string() }).partial().optional().describe('Couleurs hex du jeu'),
    options: z.record(z.any()).optional().describe('ex. { taille, hauteur, longueur, texte, couleur, rayon, cotes, marches, graine }'),
  },
  'studio/kit_piece'
);

tool(
  server,
  'ambiance',
  'Applique un préréglage d’éclairage pro (Future, Atmosphere, ColorCorrection, Bloom faible) : simulator, realiste, coucher, nuit, foret, interieur. À faire AVANT de juger un rendu.',
  { preset: z.enum(['simulator', 'realiste', 'coucher', 'nuit', 'foret', 'interieur']).default('simulator') },
  'studio/ambiance'
);

tool(
  server,
  'kit_vfx',
  'Ajoute un effet de particules propre (textures intégrées, pas de lueur néon) sur une pièce ou un modèle : poussiere, impact, etincelles, fumee, pieces, soin, niveau, aura. Les rafales se déclenchent avec emitter:Emit(emitter:GetAttribute("Rafale")).',
  { type: z.string(), cible: z.string(), couleur: z.string().optional().describe('Teinte hex facultative') },
  'studio/kit_vfx'
);

tool(
  server,
  'controle_3d',
  'Audit qualité d’un modèle 3D (lecture seule) : néon interdit, pièces libres, flottantes, z-fighting, pièces enfouies, modèle qui flotte, PrimaryPart/pivot, palette, nombre de pièces. Corrige toutes les erreurs, puis fais planche_vues.',
  { chemin: z.string(), creature: z.boolean().default(false) },
  'studio/audit3d',
  (a) => ({ path: a.chemin, creature: a.creature })
);

tool(
  server,
  'planche_vues',
  'Capture un modèle sous 10 angles (face, dos, profils, 4 trois-quarts, dessus, dessous) et assemble une planche PNG dans images/controle/. Ouvre ensuite la planche avec Read pour vérifier le rendu sous tous les angles.',
  { chemin: z.string(), vues: z.number().int().min(1).max(10).default(10) },
  'views/sheet',
  (a) => ({ path: a.chemin, count: a.vues })
);

tool(
  server,
  'capture_vue',
  'Capture le viewport de Studio depuis une position vers une cible (sans interface) dans images/captures/ : pour juger une scène, ou comme référence fidèle pour une miniature / icône (à passer dans references de generer_image).',
  { position: vec3, cible: vec3, nom: z.string().default('capture') },
  'views/capture',
  (a) => ({ position: a.position, lookAt: a.cible, name: a.nom })
);

tool(
  server,
  'comparer_reference',
  'Comparaison MESURÉE d’un modèle à une image de référence : référence détourée, planche 10 vues, scores sur 100 (global, silhouette, structure, palette, zones 6×6) sur la meilleure vue, zones faibles expliquées, planche 4 panneaux, score d’avant. Boucle : corrige les zones faibles et recompare jusqu’à global ≥ 75.',
  { chemin: z.string(), reference: z.string().describe('Chemin de l’image de référence') },
  'views/compare',
  (a) => ({ path: a.chemin, reference: a.reference })
);

tool(
  server,
  'url_image',
  'Donne une url_upload (http local) pour une image déjà sur le disque, à passer à mcp__Roblox_Studio__upload_image.',
  { chemin: z.string().describe('Chemin complet du fichier PNG/JPG') },
  'image/url',
  (a) => ({ path: a.chemin })
);

tool(
  server,
  'test_de_jeu',
  'Test de jeu automatique : lance un vrai Play dans Studio, un joueur simulé parcourt la map (pathfinding), déclenche les ProximityPrompts, puis rend un rapport : erreurs serveur/client, blocages, morts, chutes, audit de l’interface (hors écran, textes qui débordent, boutons trop petits), FPS, mémoire, évolution des leaderstats. Les sons sont coupés. À lancer après une grosse fonctionnalité, puis corriger ce que le rapport signale.',
  { duree: z.number().int().min(15).max(300).default(45).describe('Durée du jeu simulé, en secondes') },
  'playtest',
  (a) => ({ duration: a.duree })
);

tool(
  server,
  'chercher_references',
  'Cherche des images de référence dans la bibliothèque roblox-ai (UI, VFX, animations, cutscenes, logos, miniatures, jeux). Renvoie des chemins de fichiers à ouvrir avec Read.',
  { recherche: z.string().describe('Mots-clés en anglais, ex. "shop gui", "slash vfx", "loading screen"'), max: z.number().int().min(1).max(40).default(12) },
  'library/search',
  (a) => ({ query: a.recherche, limit: a.max })
);

tool(
  server,
  'memoriser_regle',
  'Enregistre une règle durable que l’utilisateur a exprimée (« toujours… », « ne jamais… »). portee "jeu" = ce jeu seulement, "tous" = tous les jeux.',
  { texte: z.string(), portee: z.enum(['jeu', 'tous']).default('jeu') },
  'rules/add',
  (a) => ({ text: a.texte, scope: a.portee })
);

tool(
  server,
  'journal_jeu',
  'Ajoute une ligne au journal du jeu (ce qui a été fait), utilisé pour les notes de mise à jour.',
  { texte: z.string() },
  'journal/add',
  (a) => ({ text: a.texte })
);

// Outil de permission utilisé par Claude Code (--permission-prompt-tool) : l'app demande à l'utilisateur.
server.tool(
  'autorisation',
  'Demande à l’utilisateur l’autorisation d’utiliser un outil.',
  { tool_name: z.string(), input: z.any(), tool_use_id: z.string().optional() },
  async (args) => {
    try {
      const decision = await call('permission', { tool: args.tool_name, input: args.input });
      const payload = decision.allow
        ? { behavior: 'allow', updatedInput: args.input }
        : { behavior: 'deny', message: decision.message || 'Refusé par l’utilisateur.' };
      return text(JSON.stringify(payload));
    } catch (err) {
      return text(JSON.stringify({ behavior: 'deny', message: `RoForge indisponible : ${err.message}` }));
    }
  }
);

server.connect(new StdioServerTransport());
