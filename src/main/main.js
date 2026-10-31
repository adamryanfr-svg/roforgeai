const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { Store, id, now } = require('./store');
const thumbnails = require('./thumbnails');
const specialists = require('./specialists');
const compare = require('./compare');
const clothing = require('./clothing');
const objfile = require('./objfile');
const { Bridge, readCore } = require('./bridge');
const { Library } = require('./library');
const agents = require('./agents');
const { Limits, backupProject, needsBackup } = require('./extras');
const playtest = require('./playtest');
const { readQuotas } = require('./quotas');
const captures = require('./captures');

const APP_ROOT = path.join(__dirname, '..', '..');
const PLUGIN_SOURCE = path.join(APP_ROOT, 'plugin', 'RoForge.lua');
const PLUGINS_DIR = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Plugins');

protocol.registerSchemesAsPrivileged([{ scheme: 'roforge-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

const store = new Store();
const bridge = new Bridge();
const library = new Library(store.settings().libraryPath);
const limits = new Limits(store.paths.RUNTIME_DIR);
const runs = new Map(); // convId -> { run, runId, projectId, message, queue }
const runIds = new Map(); // runId -> convId
const permissions = new Map(); // permId -> resolve
let win = null;

// Vrais quotas (comptes Claude / ChatGPT), mis en cache 45 s ; repli sur les dernières valeurs vues.
let quotaCache = null;
let quotaBackoffUntil = 0;
async function quotas(force = false) {
  // 2 min entre deux lectures (5 min après un refus « trop de requêtes »), même en actualisant à la main.
  const minAge = Date.now() < quotaBackoffUntil ? Infinity : force ? 20000 : 120000;
  if (quotaCache && Date.now() - quotaCache.at < minAge) return quotaCache;
  const fallback = limits.get();
  const q = await readQuotas();
  if (/429/.test(q.claude.error || '') || /429/.test(q.codex.error || '')) quotaBackoffUntil = Date.now() + 5 * 60000;
  if (!q.claude.windows.length) q.claude = { ...fallback.claude, error: q.claude.error, stale: true };
  if (!q.codex.windows.length) q.codex = { ...fallback.codex, error: q.codex.error, stale: true };
  quotaCache = q;
  return q;
}

function emit(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('rf:event', { type, ...payload });
}

// ---------------------------------------------------------------------------
// Plugin Studio : installé / mis à jour automatiquement dans le dossier Plugins
// ---------------------------------------------------------------------------
function installPlugin() {
  try {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    const target = path.join(PLUGINS_DIR, 'RoForge.lua');
    const source = fs.readFileSync(PLUGIN_SOURCE, 'utf8');
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== source) fs.writeFileSync(target, source, 'utf8');
    return { installed: true, path: target, updated: current !== source };
  } catch (err) {
    return { installed: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Routes du pont appelées par le serveur MCP roforge
// ---------------------------------------------------------------------------
function runContext(body) {
  const convId = runIds.get(body.run);
  const entry = convId && runs.get(convId);
  return entry || null;
}

const STUDIO_OPS = ['run_luau', 'get_tree', 'get_properties', 'read_script', 'write_script', 'delete', 'get_selection', 'set_selection', 'snapshot', 'list_snapshots', 'restore_snapshot', 'bounds', 'audit3d', 'kit_piece', 'ambiance', 'kit_vfx', 'isolate', 'unisolate', 'studio_floor', 'mesh_mark', 'mesh_finish', 'mesh_accessory', 'mesh_import'];
for (const op of STUDIO_OPS) {
  bridge.handlers[`studio/${op}`] = ({ run, ...args }) => bridge.send(op, args, op === 'run_luau' ? 120000 : 60000);
}
bridge.handlers['studio/status'] = () => ({ ...bridge.status(), conseil: bridge.status().connected ? undefined : 'Ouvre Roblox Studio avec le jeu : le plugin RoForge se connecte tout seul.' });
bridge.handlers['studio/logs'] = ({ count = 60, errorsOnly = false }) => {
  const logs = errorsOnly ? bridge.logs.filter((l) => l.kind === 'MessageError' || l.kind === 'MessageWarning') : bridge.logs;
  return logs.slice(-count).map((l) => `[${l.kind.replace('Message', '')}] ${l.text}`).join('\n') || '(sortie vide)';
};
// Test de jeu automatique : lancé par l'IA (outil MCP) ou par le bouton « Tester ».
let playtestRunning = false;

// Un ancien plugin (0.1.x, sans cœur téléchargeable) n'a pas la commande « playtest » :
// on lui fait exécuter le cœur actuel via run_luau, jusqu'au prochain redémarrage de Studio.
async function sendPlaytest(duration) {
  const timeout = (duration + 120) * 1000;
  if (!/^0\.1\./.test(bridge.status().version || '')) return bridge.send('playtest', { duration }, timeout);
  const core = readCore().source.replace(/^--!nocheck\s*/, '');
  const code = `local factory = (function()\n${core}\nend)()\nlocal h = factory(plugin, { version = "relais", status = function() end })\nreturn game:GetService("HttpService"):JSONEncode(h.playtest({ duration = ${Number(duration)} }))`;
  const out = await bridge.send('run_luau', { code }, timeout);
  if (!out.ok) throw new Error(out.error);
  return JSON.parse(out.returned[0]);
}
async function runPlaytest(projectId, { duration = 45, source = 'bouton' } = {}) {
  if (playtestRunning) throw new Error('Un test de jeu est déjà en cours.');
  const project = store.project(projectId);
  playtestRunning = true;
  emit('playtest.state', { running: true, projectId, duration });
  try {
    const report = await sendPlaytest(duration);
    const entry = playtest.saveReport(project, report || { fatal: true, notes: ['Aucun rapport reçu'] }, { at: new Date().toISOString(), place: bridge.status().place, source });
    store.addJournal(projectId, `Test de jeu automatique : ${entry.verdict.text}`);
    emit('playtest.report', { projectId, entry: { ...entry, report: undefined } });
    notify('Test de jeu terminé', entry.verdict.text);
    return entry;
  } finally {
    playtestRunning = false;
    emit('playtest.state', { running: false, projectId });
  }
}
bridge.handlers['playtest'] = async ({ run, duration }) => {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  const entry = await runPlaytest(ctx.projectId, { duration, source: 'IA' });
  return entry.markdown;
};

// Génération d'images par Codex (imagegen), appelable par Claude pour chaque GUI.
// Les images produites sont servies en HTTP local pour l'outil upload_image du MCP officiel.
function generateImages(projectId, { prompt, name, size = '512x512', background = false, references = [], folder = 'gui', usage = 'pour l’interface d’un jeu Roblox', brief }) {
  const project = store.project(projectId);
  const settings = store.settings();
  // Une miniature / icône du jeu garde toujours son fond, même demandée via generer_image.
  if (/(minia|thumbnail|icône du jeu|icone du jeu|game icon|fond d.écran|wallpaper)/i.test(`${prompt || ''} ${name || ''}`)) background = true;
  const safeName = String(name || 'image').toLowerCase().replace(/[^\w\-]+/g, '-').slice(0, 60);
  // Chaque génération a son propre dossier de travail : plusieurs images lancées en parallèle
  // ne peuvent plus se mélanger. Le résultat est ensuite rangé dans images/<dossier>/ du jeu.
  const workDir = path.join(store.paths.RUNTIME_DIR, `img-${id()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const target = `${safeName}.png`;
  const finalFile = path.join(project.dir, 'images', folder, target);
  fs.mkdirSync(path.dirname(finalFile), { recursive: true });
  const request = brief ? `${brief}
Enregistre le résultat final exactement ici : ${target} (remplace s’il existe). Réponds seulement avec le chemin du fichier.` : `Génère UNE image avec ton outil de génération d’images, ${usage}.
Sujet : ${prompt}
Taille finale : ${size} pixels.
${background ? 'Avec le fond demandé.' : 'FOND 100 % TRANSPARENT (PNG avec canal alpha), sujet détouré proprement, sans halo ni damier dessiné.'}
Respecte la direction artistique du jeu (dossier ${path.join(project.dir, 'da')} s’il existe). Rendu pro comme les vrais jeux Roblox du top, jamais de style néon.
${references.length ? `Images jointes = références visuelles du VRAI jeu (captures Studio, DA) : garde fidèlement ses formes, couleurs, matières et personnages ; n’invente pas d’éléments absents du jeu.\n` : ''}Enregistre le résultat final exactement ici : ${target} (remplace s’il existe). Réponds seulement avec le chemin du fichier.`;
  const refs = references.filter((f) => fs.existsSync(f));
  return new Promise((resolve, reject) => {
    const run = agents.runCodex({
      store, project, conv: { codexThread: null }, prompt: request, images: refs, settings: { ...settings, mcp: { roforge: false, officiel: false, chrrxs: false, blender: false } },
      bridgeToken: bridge.token, runId: `img-${id()}`, runtimeDir: store.paths.RUNTIME_DIR, imageOnly: true, workDir,
    });
    let files = [];
    let error = null;
    run.on('images', (list) => (files = list));
    run.on('error', (e) => (error = e));
    run.on('done', () => {
      const expected = path.join(workDir, target);
      const produced = fs.existsSync(expected) ? expected : files[0];
      if (!produced) {
        fs.rmSync(workDir, { recursive: true, force: true });
        return reject(new Error(error || 'Codex n’a produit aucune image.'));
      }
      fs.copyFileSync(produced, finalFile);
      fs.rmSync(workDir, { recursive: true, force: true });
      files = [finalFile];
      resolve(files.map((f) => ({ fichier: f, url_upload: bridge.publishFile(f), transparent: agents.hasAlpha(f) })));
    });
  });
}
// Téléverse l'image sur Roblox et, si une cible est donnée, la pose dans l'interface (ImageLabel / ImageButton).
async function implantImage(image, { cible, decoupe }) {
  try {
    const { map, brut } = await captures.uploadImages([image.url_upload], bridge.status().place);
    image.asset = map[image.url_upload] || null;
    if (!image.asset) image.erreur_televersement = brut;
  } catch (err) {
    image.erreur_televersement = err.message;
  }
  if (!image.asset || !cible) return image;
  const slice = Array.isArray(decoupe) && decoupe.length === 4 ? decoupe : null;
  const code = `local t = ${JSON.stringify(cible)}
local node = game
for _, n in string.split(t, ".") do if n ~= "game" and n ~= "" then node = node:FindFirstChild(n) or (node == game and game:GetService(n)) end assert(node, "Cible introuvable : " .. t) end
if node:IsA("ImageLabel") or node:IsA("ImageButton") then
  node.Image = ${JSON.stringify(image.asset)}
elseif node:IsA("GuiObject") then
  local img = node:FindFirstChild("RoForgeImage") or Instance.new("ImageLabel")
  img.Name = "RoForgeImage" img.BackgroundTransparency = 1 img.Size = UDim2.fromScale(1, 1) img.ZIndex = math.max(node.ZIndex - 1, 0)
  img.Image = ${JSON.stringify(image.asset)} img.Parent = node
  node.BackgroundTransparency = 1
  node = img
else error("La cible doit être un objet d'interface") end
${slice ? `node.ScaleType = Enum.ScaleType.Slice node.SliceCenter = Rect.new(${slice.join(', ')})` : 'if node.ScaleType == Enum.ScaleType.Stretch then node.ScaleType = Enum.ScaleType.Fit end'}
return node:GetFullName()`;
  try {
    const r = await bridge.send('run_luau', { code });
    image.pose_sur = r.returned?.[0];
  } catch (err) {
    image.erreur_pose = err.message;
  }
  return image;
}

bridge.handlers['image/generate'] = async ({ run, prompt, name, size, background, references, cible, decoupe, televerser = true }) => {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  const images = await generateImages(ctx.projectId, { prompt, name, size, background, references: references || [] });
  const entry = runs.get(runIds.get(run));
  if (entry) {
    entry.message.images.push(...images.map((i) => i.fichier));
    emit('message', { convId: runIds.get(run), message: entry.message });
  }
  if (televerser) for (const im of images) await implantImage(im, { cible, decoupe });
  const ok = images.every((i) => i.asset);
  return {
    images,
    conseil: ok
      ? `Image déjà téléversée sur Roblox (champ asset)${cible ? ' et posée sur la cible' : ''}. ${cible ? 'Vérifie le rendu avec une capture.' : 'Pose-la tout de suite dans l’interface (Image = asset).'}`
      : 'Le téléversement automatique a échoué (voir erreur_televersement) : réessaie avec mcp__Roblox_Studio__upload_image et url_upload ; si Studio n’est pas connecté à un compte, garde l’interface fonctionnelle avec des Frames stylées et dis-le.',
  };
};
// Ajoute des images au message en cours de la conversation (affichées dans le chat).
function attachToRun(run, files) {
  const convId = runIds.get(run);
  const entry = convId && runs.get(convId);
  if (!entry) return;
  entry.message.images.push(...files);
  emit('message', { convId, message: entry.message });
}

// Planche de vues / captures / comparaison à une référence (MCP officiel screen_capture).
bridge.handlers['views/sheet'] = async ({ run, path: target, count }) => {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  const outDir = path.join(store.project(ctx.projectId).dir, 'images', 'controle');
  const res = await captures.isolatedSheet({ send: (op, args) => bridge.send(op, args), target, outDir, name: target.split('.').pop(), placeName: bridge.status().place, count });
  attachToRun(run, [res.planche]);
  return { ...res, conseil: 'Ouvre la planche (et les vues utiles) avec Read pour juger : silhouette, proportions, couleurs/matières, détails, dessous fermé, symétrie, rien qui flotte.' };
};
bridge.handlers['views/capture'] = async ({ run, position, lookAt, name }) => {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  const img = await captures.capture({ position, lookAt, placeName: bridge.status().place });
  const dir = path.join(store.project(ctx.projectId).dir, 'images', 'captures');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(name || 'capture').toLowerCase().replace(/[^\w\-]+/g, '-')}-${Date.now()}.${img.ext}`);
  fs.writeFileSync(file, img.buffer);
  attachToRun(run, [file]);
  return { fichier: file };
};
// Comparaison MESURÉE à une référence : référence détourée (une fois, par Codex), planche 10 vues du modèle isolé,
// scores silhouette / structure / palette / zones sur la meilleure vue, historique pour suivre les progrès.
async function cutoutReference(projectId, reference) {
  if (agents.hasAlpha(reference)) return reference;
  const project = store.project(projectId);
  const safe = path.basename(reference).replace(/\.\w+$/, '').toLowerCase().replace(/[^\w-]+/g, '-').slice(0, 40);
  const cached = path.join(project.dir, 'images', 'references', `${safe}-detoure.png`);
  if (fs.existsSync(cached)) return cached;
  try {
    const [img] = await generateImages(projectId, {
      name: `${safe}-detoure`, folder: 'references', references: [reference],
      brief: 'Détoure le sujet principal de l’image jointe (le personnage / l’objet au premier plan, avec tout ce qu’il porte et tient) sur un fond 100 % TRANSPARENT (PNG avec canal alpha). Ne redessine pas : garde exactement sa forme, sa pose, ses proportions, ses couleurs et ses détails ; supprime seulement le décor. Même cadrage.',
    });
    if (img && agents.hasAlpha(img.fichier)) return img.fichier;
  } catch {}
  return reference;
}
bridge.handlers['views/compare'] = async ({ run, path: target, reference }) => {
  if (!reference || !fs.existsSync(reference)) throw new Error('Image de référence introuvable');
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  const project = store.project(ctx.projectId);
  const [ref, sheetRes] = await Promise.all([
    cutoutReference(ctx.projectId, reference),
    bridge.handlers['views/sheet']({ run, path: target, count: 10 }),
  ]);
  const histFile = path.join(project.dir, '.roforge', 'comparaisons.json');
  let hist = {};
  try { hist = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch {}
  const key = `${target}|${path.basename(reference)}`;
  const before = hist[key]?.at(-1)?.global ?? null;
  const safe = target.split('.').pop().toLowerCase().replace(/[^\w-]+/g, '-');
  const res = await compare.measure({ reference: ref, shots: sheetRes.vues.map((v) => v.fichier), outFile: path.join(project.dir, 'images', 'controle', `${safe}-comparaison-${Date.now()}.png`), before });
  (hist[key] = hist[key] || []).push({ at: new Date().toISOString(), ...res.scores });
  fs.mkdirSync(path.dirname(histFile), { recursive: true });
  fs.writeFileSync(histFile, JSON.stringify(hist, null, 2));
  attachToRun(run, [res.planche]);
  const g = res.scores.global;
  return {
    ...res,
    avant: before,
    reference_detouree: ref !== reference ? ref : undefined,
    planche_10_vues: sheetRes.planche,
    verdict: g >= 80 ? 'Très proche de la référence.' : g >= 70 ? 'Proche : corrige les zones rouges restantes.' : 'Trop loin de la référence : corrige en priorité les critères les plus bas et les zones faibles.',
    methode: 'Ouvre la planche de comparaison avec Read (1 référence, 2 ton rendu, 3 contours de la référence en magenta sur ton rendu, 4 zones : vert bon, orange moyen, rouge faux). Silhouette basse = proportions / forme générale fausses ; structure basse = parties ou détails mal placés (suis les contours magenta) ; palette basse = couleurs ; zones = où exactement. Corrige les zones_faibles une par une, puis relance comparer_reference. Objectif : global ≥ 75 et aucune zone rouge sur les éléments importants. Note aussi à l’œil ce que les chiffres ne voient pas (visage, motifs, texture).',
  };
};

// Miniatures (1920×1080) et icônes de jeu (512×512) au niveau des jeux du top : brief pro,
// captures du vrai jeu pour la fidélité, miniatures de la bibliothèque pour le style seulement.
bridge.handlers['image/thumbnail'] = async ({ run, sujet, nom, formule = 'action', texte, titre_jeu, format = 'miniature', references = [], modele }) => {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  const jeu = references.filter((f) => fs.existsSync(f)).slice(0, 4);
  // Miniature à recréer : elle passe en tête des références de style et donne sa composition.
  const model = modele && fs.existsSync(modele) ? modele : null;
  const style = model ? [model] : thumbnails.styleRefs(formule);
  const brief = thumbnails.brief({ sujet, formule: model ? 'libre' : formule, texte, titre_jeu, format, nbJeu: jeu.length, nbStyle: style.length, modele: !!model });
  const icon = format === 'icone';
  const images = await generateImages(ctx.projectId, {
    name: nom || (icon ? 'icone-jeu' : 'miniature'), size: icon ? '1024x1024' : '1536x1024', background: true, references: [...jeu, ...style], folder: 'miniatures', brief,
  });
  const [w, h] = icon ? [512, 512] : [1920, 1080];
  for (const im of images) {
    fs.writeFileSync(im.fichier, await captures.fitImage(fs.readFileSync(im.fichier), w, h));
    im.taille = `${w}x${h}`;
    im.transparent = false;
  }
  attachToRun(run, images.map((i) => i.fichier));
  return {
    images,
    conseil: `Ouvre l’image avec Read et juge-la comme un joueur qui fait défiler les jeux : sujet lisible en petit, émotion claire, fidélité au jeu, texte bien écrit. Si un point est raté, relance avec UNE correction précise. ${icon ? 'Icône 512×512' : 'Miniature 1920×1080'} prête pour la page du jeu (Creator Hub › Places › ${icon ? 'Icon' : 'Thumbnails'}).`,
  };
};

// Modèle 3D texturé par l'IA de Roblox, fini et contrôlé d'office (sol, ancrage, pivot, audit, planche 10 vues).
const MESH_STYLES = {
  anime: 'stylized anime cartoon style, crisp hand-painted texture',
  simulator: 'stylized Roblox simulator style, chunky rounded shapes, clean hand-painted texture',
  realiste: 'realistic style, detailed PBR texture',
};
// Consignes courtes : une description longue et répétitive dégrade la forme générée.
const ACCESSORY_HINT = {
  chapeau: { taille: [3, 1.4, 3], texte: 'Roblox avatar hat accessory' },
  cheveux: { taille: [2.6, 2.2, 2.6], texte: 'Roblox avatar hair accessory, hair only' },
  visage: { taille: [1.6, 1, 0.8], texte: 'Roblox avatar face accessory' },
  cou: { taille: [2, 1, 1.6], texte: 'Roblox avatar neck accessory' },
  dos: { taille: [2.5, 3, 1.2], texte: 'Roblox avatar back accessory' },
  taille: { taille: [2.4, 1, 1.6], texte: 'Roblox avatar waist accessory' },
  epaule: { taille: [1.4, 1.4, 1.4], texte: 'Roblox avatar shoulder accessory' },
};
let meshQueue = Promise.resolve();
bridge.handlers['mesh/generate'] = ({ run, ...a }) => {
  const job = meshQueue.then(() => generateModel(run, a));
  meshQueue = job.catch(() => {});
  return job;
};
async function generateModel(run, { description, nom, style = 'anime', taille, position, rotation, parent, accessoire, decoupage, parties, triangles }) {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  const hint = accessoire && ACCESSORY_HINT[accessoire];
  const prompt = [description, hint?.texte, MESH_STYLES[style] || MESH_STYLES.anime, 'game-ready, no neon, no text'].filter(Boolean).join(', ');
  await bridge.send('mesh_mark', {});
  await captures.generateMesh({
    prompt: prompt.slice(0, 1000), size: taille || hint?.taille, segmentation: parties?.length ? 'explicit' : decoupage || (accessoire ? 'none' : 'auto'),
    partNames: parties, maxTriangles: triangles, placeName: bridge.status().place,
  });
  const fini = await bridge.send('mesh_finish', { nom, parent: accessoire ? undefined : parent, position, rotation });
  const audit = await bridge.send('audit3d', { path: fini.chemin });
  const outDir = path.join(store.project(ctx.projectId).dir, 'images', 'controle');
  let planche = null;
  try {
    planche = await captures.isolatedSheet({ send: (op, args) => bridge.send(op, args), target: fini.chemin, outDir, name: nom || 'modele-ia', placeName: bridge.status().place });
    attachToRun(run, [planche.planche]);
  } catch (err) {
    planche = { erreur: err.message };
  }
  const acc = accessoire ? await bridge.send('mesh_accessory', { path: fini.chemin, type: accessoire, parent }) : null;
  store.addJournal(ctx.projectId, `Modèle IA « ${nom || 'ModeleIA'} » généré (${style}${accessoire ? `, accessoire ${accessoire}` : ''}).`);
  return {
    modele: acc ? acc.chemin : fini.chemin,
    pieces: fini.pieces,
    maillages: fini.maillages,
    taille: fini.taille,
    audit: audit.resume,
    constats: (audit.constats || []).map((c) => `${c.code} : ${c.message}`),
    planche: planche.planche || planche.erreur,
    accessoire: acc,
    conseil: 'Ouvre la planche avec Read. Si la forme ou la texture n’est pas au niveau (silhouette, détails, couleurs du jeu), supprime et regénère avec une description plus précise (matières, couleurs hex, formes, détails), ou retexture avec mcp__Roblox_Studio__generate_texture (model "Quality").',
  };
}

// Habille un personnage : textures plates générées (torse, dos, bras, jambes, visage), assemblées dans le
// gabarit Roblox, téléversées puis posées en Shirt / Pants / visage + couleur de peau sur le personnage cible.
bridge.handlers['character/clothes'] = async ({ run, cible, nom = 'perso', style, haut, bas, visage, peau, references = [] }) => {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  const st = style || 'anime cel-shading comme les jeux anime Roblox du top (Blox Fruits, Grand Piece Online)';
  const refs = references.filter((f) => fs.existsSync(f)).slice(0, 3);
  const refNote = refs.length ? '\nImages jointes = le personnage de référence : reprends exactement les motifs, couleurs et détails de CETTE partie du corps.' : '';
  const gen = (suffix, brief, size, background = true) =>
    generateImages(ctx.projectId, { name: `${nom}-${suffix}`, folder: 'vetements', size, background, references: refs, brief: brief + refNote }).then((l) => l[0].fichier);
  const jobs = {};
  if (haut) {
    jobs.hautAvant = gen('haut-avant', clothing.textureBrief('TORSE vu de FACE (poitrine et ventre)', haut.avant || haut, st), '1024x1024');
    jobs.hautDos = gen('haut-dos', clothing.textureBrief('TORSE vu de DOS', haut.dos || `dos assorti : ${haut.avant || haut}`, st), '1024x1024');
    jobs.bras = gen('bras', clothing.textureBrief('UN BRAS vu de face (de l’épaule au poignet, la main n’est PAS incluse)', haut.bras || `bras assortis : ${haut.avant || haut}`, st, true), '1024x1536');
  }
  if (bas) {
    jobs.basAvant = gen('bas-avant', clothing.textureBrief('BASSIN vu de face (ceinture / taille du pantalon)', bas.taille || `haut du pantalon et ceinture : ${bas.jambes || bas}`, st), '1024x1024');
    jobs.jambes = gen('jambes', clothing.textureBrief('UNE JAMBE vue de face (de la hanche à la cheville, chaussure / botte en bas incluse si demandée)', bas.jambes || bas, st, true), '1024x1536');
  }
  if (visage) {
    jobs.visage = generateImages(ctx.projectId, {
      name: `${nom}-visage`, folder: 'vetements', size: '1024x1024', background: false, references: refs,
      brief: `Génère UN visage de personnage Roblox (décalque posé sur une tête cube) avec ton outil de génération d’images, 1024×1024, FOND 100 % TRANSPARENT (PNG alpha).\nVisage : ${visage}\nUniquement les traits dessinés (yeux, sourcils, bouche, rides, cicatrices, moustache / barbe si demandée) centrés, qui occupent la zone centrale ; pas de tête, pas de peau en fond, pas de cheveux autour. Style : ${st}, traits noirs nets.${refNote}`,
    }).then((l) => l[0].fichier);
  }
  const files = {};
  for (const [k, p] of Object.entries(jobs)) files[k] = await p.catch((e) => { throw new Error(`Texture « ${k} » : ${e.message}`); });
  const dir = path.join(store.project(ctx.projectId).dir, 'images', 'vetements');
  const out = {};
  if (haut) {
    out.shirt = path.join(dir, `${nom}-shirt-gabarit.png`);
    fs.writeFileSync(out.shirt, await clothing.composeTemplate({ avant: files.hautAvant, dos: files.hautDos, membre: files.bras }));
  }
  if (bas) {
    out.pants = path.join(dir, `${nom}-pants-gabarit.png`);
    fs.writeFileSync(out.pants, await clothing.composeTemplate({ avant: files.basAvant, dos: files.basAvant, membre: files.jambes }));
  }
  if (files.visage) out.visage = files.visage;
  attachToRun(run, Object.values(out));
  const urls = Object.fromEntries(Object.entries(out).map(([k, f]) => [k, bridge.publishFile(f)]));
  const { map, brut } = await captures.uploadImages(Object.values(urls), bridge.status().place);
  const asset = Object.fromEntries(Object.entries(urls).map(([k, u]) => [k, map[u]]));
  if (Object.values(asset).some((a) => !a)) return { fichiers: out, asset, erreur: `Téléversement incomplet : ${brut}` };
  let applique = null;
  if (cible) {
    const code = `local rig = game
for _, n in string.split(${JSON.stringify(cible)}, ".") do if n ~= "game" and n ~= "" then rig = rig:FindFirstChild(n) or (rig == game and game:GetService(n)) end assert(rig, "Personnage introuvable") end
local recording = game:GetService("ChangeHistoryService"):TryBeginRecording("RoForge vêtements")
${asset.shirt ? `for _, c in rig:GetChildren() do if c:IsA("Shirt") then c:Destroy() end end
local s = Instance.new("Shirt") s.Name = "Haut" s.ShirtTemplate = ${JSON.stringify(asset.shirt)} s.Parent = rig` : ''}
${asset.pants ? `for _, c in rig:GetChildren() do if c:IsA("Pants") then c:Destroy() end end
local p = Instance.new("Pants") p.Name = "Bas" p.PantsTemplate = ${JSON.stringify(asset.pants)} p.Parent = rig` : ''}
${asset.visage ? `local head = rig:FindFirstChild("Head") if head then local f = head:FindFirstChild("face") or Instance.new("Decal") f.Name = "face" f.Face = Enum.NormalId.Front f.Texture = ${JSON.stringify(asset.visage)} f.Parent = head end` : ''}
${peau ? `local bc = rig:FindFirstChildOfClass("BodyColors") or Instance.new("BodyColors") local col = Color3.fromHex(${JSON.stringify(peau)})
bc.HeadColor3 = col bc.LeftArmColor3 = col bc.RightArmColor3 = col bc.TorsoColor3 = col bc.LeftLegColor3 = col bc.RightLegColor3 = col bc.Parent = rig` : ''}
if recording then game:GetService("ChangeHistoryService"):FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
return rig:GetFullName()`;
    applique = (await bridge.send('run_luau', { code })).returned?.[0];
  }
  return {
    fichiers: out, asset, applique_sur: applique,
    conseil: 'Vérifie avec mcp__roforge__planche_vues (ou comparer_reference si tu as une référence) : motifs à la bonne place, raccords épaules / côtés, couleur de peau assortie. Une partie ratée : relance seulement cette partie avec une description corrigée.',
  };
};

// Import dans Studio d'un modèle exporté de Blender (OBJ) : maillage publié + texture téléversée,
// puis contrôle 3D et planche 10 vues d'office.
bridge.handlers['blender/import'] = async ({ run, fichier, nom, position, parent }) => {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  if (!fichier || !fs.existsSync(fichier)) throw new Error('Fichier introuvable (exporte d’abord en OBJ depuis Blender, ou télécharge le ZIP de Claude Design)');
  const safe = String(nom || 'modele').replace(/[^\w-]+/g, '-');
  fichier = objfile.resolveObj(fichier, path.join(store.project(ctx.projectId).dir, 'modeles', safe));
  const mesh = objfile.readObj(fichier);
  if (!mesh.triangles) throw new Error('OBJ vide');
  if (mesh.triangles > 20000) throw new Error(`${mesh.triangles} triangles : trop lourd pour Roblox (max 20 000). Décime dans Blender (modificateur Decimate) puis réexporte.`);
  let texture;
  if (mesh.texture) {
    const url = bridge.publishFile(mesh.texture);
    texture = (await captures.uploadImages([url], bridge.status().place)).map[url];
  }
  const r = await bridge.send('mesh_import', { ...mesh, texture, nom, position, parent }, 180000);
  const audit = await bridge.send('audit3d', { path: r.chemin });
  let planche = null;
  try {
    planche = await captures.isolatedSheet({ send: (op, a) => bridge.send(op, a), target: r.chemin, outDir: path.join(store.project(ctx.projectId).dir, 'images', 'controle'), name: nom || 'blender', placeName: bridge.status().place });
    attachToRun(run, [planche.planche]);
  } catch (err) {
    planche = { erreur: err.message };
  }
  return { ...r, texture, audit: audit.resume, constats: (audit.constats || []).map((c) => `${c.code} : ${c.message}`), planche: planche.planche || planche.erreur };
};

bridge.handlers['image/url'] =({ path: file }) => {
  if (!file || !fs.existsSync(file)) throw new Error('Fichier introuvable');
  return { url_upload: bridge.publishFile(file) };
};

bridge.handlers['library/search'] = ({ query, limit = 12 }) => {
  const { total, items } = library.search({ query, limit });
  return { total, fichiers: items.map((i) => i.path) };
};
bridge.handlers['rules/add'] = ({ run, text, scope }) => {
  const ctx = runContext({ run });
  const rule = store.addRule(ctx?.projectId, { text, scope, source: 'IA' });
  emit('rules.changed', { rule });
  return `Règle enregistrée (${rule.scope === 'jeu' ? 'ce jeu' : 'tous les jeux'}).`;
};
bridge.handlers['journal/add'] = ({ run, text }) => {
  const ctx = runContext({ run });
  if (!ctx) throw new Error('Conversation inconnue');
  store.addJournal(ctx.projectId, text);
  return 'Ajouté au journal.';
};
bridge.handlers['permission'] = ({ run, tool, input }) => {
  const ctx = runContext({ run });
  if (!ctx) return { allow: false, message: 'Conversation inconnue' };
  const settings = store.settings();
  if ((settings.alwaysAllow || []).includes(tool)) return { allow: true };
  const permId = id();
  return new Promise((resolve) => {
    permissions.set(permId, resolve);
    emit('permission', { id: permId, convId: runIds.get(run), projectId: ctx.projectId, tool, input });
    notify('Claude demande ton accord', `Outil : ${tool}`);
  });
};

// ---------------------------------------------------------------------------
// Conversations / agents
// ---------------------------------------------------------------------------
function notify(title, body) {
  if (!store.settings().notifications || (win && win.isFocused())) return;
  new Notification({ title, body, icon: path.join(APP_ROOT, 'resources', 'icon.png') }).show();
}

function startRun(projectId, convId, { text, images = [], agent: forced }) {
  const project = store.project(projectId);
  const conv = store.conversation(projectId, convId);
  const settings = store.settings();
  const agent = agents.routeMessage(text, forced, settings.coder);
  let prompt = text.replace(/^@(codex|claude)\b\s*/i, '');
  // Conversation qui continue une conversation archivée : son résumé accompagne le 1er message.
  if (conv.context && !conv.messages.some((m) => m.role === 'user')) {
    prompt = `Contexte — résumé de la conversation précédente sur ce jeu :\n${conv.context}\n\n---\n\n${prompt}`;
  }

  const userMessage = { id: id(), role: 'user', text, images, agent, created: now() };
  const message = { id: id(), role: 'assistant', agent, text: '', parts: [], images: [], created: now(), done: false };
  conv.messages.push(userMessage, message);
  if (conv.messages.length === 2 && conv.title === 'Nouvelle conversation') conv.title = text.replace(/\s+/g, ' ').slice(0, 48);
  store.saveConversation(projectId, conv);
  emit('conversation.updated', { projectId, conv: { ...conv, messages: undefined } });
  emit('message', { convId, message: userMessage });

  const runId = crypto.randomUUID();
  const runner = agent === 'codex' ? agents.runCodex : agents.runClaude;
  const run = runner({ store, project, conv, prompt, images, settings, bridgeToken: bridge.token, runId, runtimeDir: store.paths.RUNTIME_DIR });
  const entry = runs.get(convId) || { queue: [] };
  Object.assign(entry, { run, runId, projectId, message });
  runs.set(convId, entry);
  runIds.set(runId, convId);
  emit('run.state', { convId, running: true, agent });

  let pushTimer = null;
  const push = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      emit('message', { convId, message });
    }, 60);
  };
  const lastText = () => {
    const last = message.parts[message.parts.length - 1];
    if (last?.type === 'text') return last;
    const part = { type: 'text', text: '' };
    message.parts.push(part);
    return part;
  };

  run.on('session', (sid) => {
    const c = store.conversation(projectId, convId);
    if (agent === 'codex') c.codexThread = sid;
    else c.claudeSession = sid;
    store.saveConversation(projectId, c);
  });
  run.on('text-start', () => {
    if (message.parts.length && message.parts[message.parts.length - 1].type !== 'text') message.parts.push({ type: 'text', text: '' });
  });
  run.on('text', (t) => {
    lastText().text += t;
    push();
  });
  run.on('thinking', () => {
    message.thinking = true;
    push();
  });
  run.on('tool', (tool) => {
    message.parts.push({ type: 'tool', id: tool.id, name: tool.name, input: tool.input, status: 'running' });
    push();
  });
  run.on('tool-result', (r) => {
    const part = message.parts.find((p) => p.type === 'tool' && p.id === r.id);
    if (part) Object.assign(part, { status: r.error ? 'error' : 'done', result: r.text });
    push();
  });
  run.on('images', (files) => {
    message.images.push(...files);
    push();
  });
  run.on('limits', (info) => {
    if (agent === 'claude') limits.recordClaude(info);
  });
  run.on('error', (err) => {
    message.error = err;
    push();
  });
  run.on('done', ({ stopped, result }) => {
    clearTimeout(pushTimer);
    message.done = true;
    message.stopped = stopped;
    message.text = message.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n').trim();
    if (result?.total_cost_usd) message.cost = result.total_cost_usd;
    for (const p of message.parts) if (p.status === 'running') p.status = stopped ? 'stopped' : 'done';
    const c = store.conversation(projectId, convId);
    const i = c.messages.findIndex((m) => m.id === message.id);
    if (i >= 0) c.messages[i] = message;
    store.saveConversation(projectId, c);
    runIds.delete(runId);
    emit('message', { convId, message });
    for (const [permId, resolve] of permissions) {
      resolve({ allow: false, message: 'Tâche terminée' });
      permissions.delete(permId);
    }
    const next = entry.queue.shift();
    if (next && !stopped) {
      emit('queue', { convId, queue: entry.queue });
      startRun(projectId, convId, next);
    } else {
      entry.queue = [];
      runs.delete(convId);
      emit('run.state', { convId, running: false });
      emit('queue', { convId, queue: [] });
      quotas(true).then((q) => emit('limits', { limits: q })).catch(() => {});
      notify('Une conversation a terminé', c.title);
    }
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function saveDataUrl(projectId, dataUrl, name = 'reference') {
  const project = store.project(projectId);
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Image invalide');
  const dir = path.join(project.dir, 'da');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^\w\-]+/g, '_')}-${Date.now()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
  fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
  return file;
}

function listProjectFiles(projectId) {
  const project = store.project(projectId);
  const out = [];
  for (const sub of ['images', 'da', 'modeles']) {
    const dir = path.join(project.dir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (st.isFile()) out.push({ path: full, name: f, folder: sub, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const api = {
  'app.state': async () => ({
    settings: store.settings(),
    projects: store.projects(),
    studio: bridge.status(),
    plugin: installPlugin(),
    officialMcp: fs.existsSync(agents.ROBLOX_MCP_BAT),
    paths: store.paths,
    version: app.getVersion(),
  }),
  'accounts.status': async () => {
    const status = await agents.accountStatus();
    if (status.claude.plan) limits.setClaudePlan(status.claude.plan);
    return status;
  },
  'limits.get': ({ force } = {}) => quotas(force),
  'backup.configure': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Où sauvegarder tes jeux ? (OneDrive, Google Drive, Dropbox, disque externe…)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return store.settings();
    const s = store.updateSettings({ backupDir: r.filePaths[0] });
    setTimeout(autoBackup, 500);
    return s;
  },
  'backup.run': ({ id: projectId }) => runBackup(store.project(projectId)),
  'backup.reveal': () => store.settings().backupDir && shell.openPath(path.join(store.settings().backupDir, 'RoForge-sauvegardes')),
  'theme.set': ({ theme }) => {
    win?.setTitleBarOverlay?.(titleBarColors(theme));
    win?.setBackgroundColor(theme === 'dark' ? '#0d1410' : '#f3f6f2');
    return store.updateSettings({ theme });
  },
  'accounts.login': ({ agent }) => agents.openLogin(agent),
  'accounts.logout': ({ agent }) => agents.logout(agent),

  'settings.update': (patch) => {
    const s = store.updateSettings(patch);
    if (patch.libraryPath) library.setRoot(patch.libraryPath);
    return s;
  },
  'settings.pickBlender': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Où est blender.exe ?', filters: [{ name: 'Blender', extensions: ['exe'] }], properties: ['openFile'] });
    if (r.canceled) return store.settings();
    return store.updateSettings({ blenderPath: r.filePaths[0], mcp: { blender: true } });
  },

  'projects.create': (data) => {
    const project = store.createProject(data);
    store.createConversation(project.id);
    return project;
  },
  'projects.import': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Dossier du jeu à importer', properties: ['openDirectory'] });
    if (r.canceled) return null;
    const project = store.importProject(r.filePaths[0]);
    if (!store.conversations(project.id).length) store.createConversation(project.id);
    return project;
  },
  'projects.update': ({ id: projectId, ...patch }) => store.updateProject(projectId, patch),
  'projects.remove': async ({ id: projectId, trash }) => {
    const project = store.project(projectId);
    store.removeProject(projectId);
    if (trash && !project.imported) await shell.trashItem(project.dir);
    return true;
  },
  'projects.reveal': ({ id: projectId }) => shell.openPath(store.project(projectId).dir),
  'projects.files': ({ id: projectId }) => listProjectFiles(projectId),
  'projects.journal': ({ id: projectId }) => store.journal(projectId),

  'conversations.list': ({ projectId }) => store.conversations(projectId),
  'conversations.open': ({ projectId, convId }) => {
    const conv = store.conversation(projectId, convId);
    const entry = runs.get(convId);
    if (entry) {
      const i = conv.messages.findIndex((m) => m.id === entry.message.id);
      if (i >= 0) conv.messages[i] = entry.message;
    }
    store.updateProject(projectId, { lastOpened: now(), lastConv: convId });
    return { ...conv, running: !!entry, queue: entry?.queue || [] };
  },
  'conversations.create': ({ projectId, specialiste, title }) => store.createConversation(projectId, title, specialiste),
  'conversations.setSpecialist': ({ projectId, convId, specialiste }) => {
    const conv = store.conversation(projectId, convId);
    conv.specialiste = specialiste;
    store.saveConversation(projectId, conv);
    return true;
  },
  'specialists.list': () => specialists.publicList(),
  'conversations.rename': ({ projectId, convId, title }) => {
    const conv = store.conversation(projectId, convId);
    conv.title = title;
    store.saveConversation(projectId, conv);
    return true;
  },
  'conversations.delete': ({ projectId, convId }) => {
    runs.get(convId)?.run.stop();
    store.deleteConversation(projectId, convId);
    return true;
  },
  'conversations.continue': async ({ projectId, convId }) => {
    const project = store.project(projectId);
    const old = store.conversation(projectId, convId);
    const transcript = old.messages
      .map((m) => `${m.role === 'user' ? 'Utilisateur' : m.agent === 'codex' ? 'Codex' : 'Claude'} : ${(m.text || '').slice(0, 2000)}`)
      .join('\n\n')
      .slice(-80000);
    const summary = await agents.claudeText(
      `Voici une conversation de travail sur le jeu Roblox « ${project.name} ». Écris un résumé complet en français pour qu’une nouvelle conversation reprenne sans rien perdre : objectifs, ce qui a été construit (scripts, chemins dans Studio, fichiers, images), décisions et préférences de l’utilisateur, problèmes connus, prochaines étapes. Listes à puces, précis, sans blabla.\n\n${transcript}`,
      store.settings(),
      project.dir
    );
    old.archived = true;
    if (!old.title.endsWith('(archivée)')) old.title = `${old.title} (archivée)`;
    store.saveConversation(projectId, old);
    const conv = store.createConversation(projectId, `Suite — ${old.title.replace(' (archivée)', '')}`.slice(0, 60));
    conv.context = summary;
    conv.previous = old.id;
    conv.messages.push({ id: id(), role: 'assistant', agent: 'claude', text: `**Résumé de la conversation précédente**\n\n${summary}`, parts: [{ type: 'text', text: `**Résumé de la conversation précédente**\n\n${summary}` }], images: [], created: now(), done: true });
    store.saveConversation(projectId, conv);
    return conv;
  },
  'conversations.search':({ projectId, query }) => store.searchConversations(projectId, query),

  'chat.send': ({ projectId, convId, text, images, agent }) => {
    const entry = runs.get(convId);
    if (entry) {
      entry.queue.push({ text, images, agent });
      emit('queue', { convId, queue: entry.queue });
      return { queued: true };
    }
    startRun(projectId, convId, { text, images, agent });
    return { queued: false };
  },
  'chat.stop': ({ convId }) => {
    const entry = runs.get(convId);
    if (entry) {
      entry.queue = [];
      entry.run.stop();
    }
    return true;
  },
  'chat.unqueue': ({ convId, index }) => {
    const entry = runs.get(convId);
    if (entry) entry.queue.splice(index, 1);
    emit('queue', { convId, queue: entry?.queue || [] });
    return true;
  },
  'chat.validate': ({ projectId, convId, messageId }) => {
    const conv = store.conversation(projectId, convId);
    const i = conv.messages.findIndex((m) => m.id === messageId);
    const msg = conv.messages[i];
    const ask = conv.messages.slice(0, i).reverse().find((m) => m.role === 'user');
    msg.validated = true;
    store.saveConversation(projectId, conv);
    return store.addExample({ projectId, title: ask?.text || msg.text.slice(0, 80), text: msg.text.slice(0, 4000), images: msg.images || [] });
  },
  'permission.reply': ({ id: permId, allow, always, tool }) => {
    const resolve = permissions.get(permId);
    permissions.delete(permId);
    if (always && allow && tool) store.updateSettings({ alwaysAllow: [...new Set([...(store.settings().alwaysAllow || []), tool])] });
    resolve?.({ allow, message: allow ? undefined : 'L’utilisateur a refusé.' });
    return true;
  },

  'rules.list': ({ projectId }) => store.rules(projectId),
  'rules.add': ({ projectId, text, scope }) => store.addRule(projectId, { text, scope }),
  'rules.update': ({ projectId, ruleId, text }) => store.updateRule(projectId, ruleId, text),
  'rules.delete': ({ projectId, ruleId }) => store.deleteRule(projectId, ruleId),

  'examples.list': () => store.examples(),
  'examples.remove': ({ id: exampleId }) => store.removeExample(exampleId),

  'library.summary': () => library.summary(),
  'library.search': (q) => library.search(q),
  'gallery.list': (q) => {
    const dir = thumbnails.STYLE_DIR;
    const mine = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => path.join(dir, f)) : [];
    return library.gallery({ ...q, extra: { miniatures: mine } });
  },

  'files.pickImages': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Images de référence', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    return r.canceled ? [] : r.filePaths;
  },
  'files.saveDataUrl': ({ projectId, dataUrl, name }) => saveDataUrl(projectId, dataUrl, name),
  'files.reveal': ({ path: p }) => shell.showItemInFolder(p),
  'files.trash': async ({ path: p }) => {
    await shell.trashItem(p);
    return true;
  },
  'files.open': ({ path: p }) => shell.openPath(p),

  'balance.read': ({ projectId }) => {
    const file = path.join(store.project(projectId).dir, 'equilibrage.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  },
  'balance.save': ({ projectId, data }) => {
    const file = path.join(store.project(projectId).dir, 'equilibrage.json');
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    store.addJournal(projectId, 'Équilibrage enregistré (equilibrage.json).');
    return file;
  },
  'favorites.list': ({ projectId }) => {
    const file = path.join(store.project(projectId).dir, '.roforge', 'favoris.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  },
  'favorites.save': ({ projectId, list }) => {
    fs.writeFileSync(path.join(store.project(projectId).dir, '.roforge', 'favoris.json'), JSON.stringify(list, null, 2), 'utf8');
    return list;
  },
  'playtest.run':({ projectId, duration }) => runPlaytest(projectId, { duration }),
  'playtest.list': ({ projectId }) => playtest.listReports(store.project(projectId)),
  'playtest.state': () => ({ running: playtestRunning }),
  'studio.status': () => bridge.status(),
  'studio.logs': () => bridge.logs.slice(-300),
  'studio.snapshots': () => bridge.send('list_snapshots'),
  'studio.restore': ({ name }) => bridge.send('restore_snapshot', { name }),
  'studio.snapshot': ({ label }) => bridge.send('snapshot', { label }),
  'plugin.install': () => installPlugin(),
  'shell.external': ({ url }) => shell.openExternal(url),
};

ipcMain.handle('rf', async (_event, method, payload) => {
  const fn = api[method];
  if (!fn) throw new Error(`Méthode inconnue : ${method}`);
  return fn(payload || {});
});

// ---------------------------------------------------------------------------
// Sauvegarde automatique : une fois par jour et à la fermeture, si le jeu a changé
// ---------------------------------------------------------------------------
function runBackup(project) {
  const result = backupProject(project, store.settings().backupDir);
  store.updateProject(project.id, { lastBackup: result.at });
  emit('backup', { projectId: project.id, at: result.at });
  return result;
}

function autoBackup(force = false) {
  if (!store.settings().backupDir) return;
  for (const project of store.projects()) {
    const old = !project.lastBackup || Date.now() - new Date(project.lastBackup).getTime() > 24 * 3600 * 1000;
    try {
      if ((force || old) && needsBackup(project)) runBackup(project);
    } catch (err) {
      emit('toast', { kind: 'error', text: `Sauvegarde de « ${project.name} » impossible : ${err.message}` });
    }
  }
}

// ---------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------
function allowedFile(p) {
  const s = store.settings();
  const roots = [store.paths.ROOT, s.libraryPath, ...store.projects().map((x) => x.dir)].filter(Boolean).map((r) => path.resolve(r).toLowerCase());
  const full = path.resolve(p).toLowerCase();
  return roots.some((r) => full.startsWith(r + path.sep) || full === r);
}

function titleBarColors(theme) {
  return theme === 'dark' ? { color: '#0d1410', symbolColor: '#c5d2c9', height: 56 } : { color: '#f3f6f2', symbolColor: '#2b3b31', height: 56 };
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1480, area.width - 40),
    height: Math.min(920, area.height - 40),
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: store.settings().theme === 'dark' ? '#0d1410' : '#f3f6f2',
    title: 'RoForge',
    icon: path.join(APP_ROOT, 'resources', 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors(store.settings().theme),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(APP_ROOT, 'src', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.roforge.atelier');
  protocol.handle('roforge-file', (request) => {
    const file = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!allowedFile(file) || !fs.existsSync(file)) return new Response('introuvable', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  bridge.on('status', (status) => emit('studio', { status }));
  bridge.on('log', (log) => emit('studio.log', { log }));
  const bridgeLog = path.join(store.paths.RUNTIME_DIR, 'pont.log');
  bridge.on('debug', (line) => {
    try {
      if (fs.existsSync(bridgeLog) && fs.statSync(bridgeLog).size > 512 * 1024) fs.renameSync(bridgeLog, `${bridgeLog}.1`);
      fs.appendFileSync(bridgeLog, line + '\n');
    } catch {
      // journal facultatif
    }
  });
  bridge.on('error', (err) => emit('toast', { kind: 'error', text: err.code === 'EADDRINUSE' ? 'Le port 44777 est déjà utilisé : une autre copie de RoForge tourne ?' : err.message }));
  bridge.start();
  installPlugin();
  createWindow();
  setTimeout(autoBackup, 15000);
  setInterval(autoBackup, 3600 * 1000);
});

let quitting = false;
app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  try {
    autoBackup(true);
  } catch {
    // la fermeture ne doit jamais être bloquée
  }
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  for (const entry of runs.values()) entry.run.stop();
  bridge.stop();
  app.quit();
});
