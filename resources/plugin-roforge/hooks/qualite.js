// Contrôle qualité avant que l'IA ne termine (hook Stop de Claude Code) : relit ce qu'elle a fait
// depuis le dernier message de l'utilisateur et la renvoie au travail s'il manque une vérification.
// 3D construite sans controle_3d + planche_vues, scripts écrits sans test_de_jeu, images de GUI non posées.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_ROUNDS = 3; // évite une boucle infinie si une vérification est impossible

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function lines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

const isHumanTurn = (e) => {
  if (e.type !== 'user' || e.isMeta) return false;
  const c = e.message?.content;
  if (typeof c === 'string') return !c.includes('Stop hook feedback') && !c.startsWith('<local-command');
  return Array.isArray(c) && c.some((b) => b.type === 'text' && !String(b.text).includes('Stop hook feedback')) && !c.some((b) => b.type === 'tool_result');
};

const BUILD_CODE = /Instance\.new\(\s*["'](Part|MeshPart|WedgePart|CornerWedgePart|TrussPart|Model|UnionOperation|SpecialMesh)["']|CreateEditableMesh/;
const SCRIPT_CODE = /Instance\.new\(\s*["'](Script|LocalScript|ModuleScript)["']|\.Source\s*=|UpdateSourceAsync/;

function main() {
  const input = readStdin();
  const all = lines(input.transcript_path);
  let start = 0;
  for (let i = all.length - 1; i >= 0; i--) if (isHumanTurn(all[i])) { start = i; break; }
  const turn = all.slice(start + 1);
  // Nombre de relances déjà faites pour ce message de l'utilisateur (fichier d'état par session).
  const stateFile = path.join(os.tmpdir(), `roforge-qualite-${String(input.session_id || 'x').replace(/\W/g, '')}.json`);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  if (state.turn !== start) state = { turn: start, rounds: 0 };
  if (state.rounds >= MAX_ROUNDS) return;

  const calls = [];
  const results = new Map();
  for (const e of turn) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use') calls.push({ id: b.id, name: String(b.name || ''), input: b.input || {} });
      if (b.type === 'tool_result') results.set(b.tool_use_id, JSON.stringify(b.content || ''));
    }
  }
  const idx = (pred) => calls.reduce((last, c, i) => (pred(c) ? i : last), -1);
  const code = (c) => String(c.input.code || c.input.source || c.input.script || '');

  const lastBuild = idx((c) =>
    /roforge__(kit_piece|modele_ia|importer_blender|vetements)$|Roblox_Studio__(generate_mesh|generate_procedural_model)$/.test(c.name) ||
    (/roforge__executer_luau$|Roblox_Studio__(execute_luau|multi_edit)$/.test(c.name) && BUILD_CODE.test(code(c))));
  const lastAudit = idx((c) => /roforge__(controle_3d|importer_blender)$/.test(c.name));
  const lastSheet = idx((c) => /roforge__(planche_vues|comparer_reference|modele_ia|importer_blender)$/.test(c.name));
  const lastLook = idx((c) => c.name === 'Read' && /\.(png|jpe?g)$/i.test(String(c.input.file_path || '')));
  const lastScript = idx((c) =>
    /roforge__ecrire_script$|Roblox_Studio__multi_edit$/.test(c.name) ||
    (/roforge__executer_luau$|Roblox_Studio__execute_luau$/.test(c.name) && SCRIPT_CODE.test(code(c))));
  const lastTest = idx((c) => /roforge__test_de_jeu$|Roblox_Studio__start_stop_play$/.test(c.name));
  const lastOutput = idx((c) => /roforge__sortie_studio$|Roblox_Studio__get_console_output$/.test(c.name));

  const todo = [];
  if (lastBuild >= 0) {
    if (lastAudit < lastBuild && !/roforge__(modele_ia|vetements)$/.test(calls[lastBuild].name)) todo.push('lance mcp__roforge__controle_3d sur chaque modèle construit ou modifié et corrige TOUTES les erreurs (et les avertissements justifiables)');
    if (lastSheet < lastBuild) todo.push('fais mcp__roforge__planche_vues sur chaque modèle construit ou modifié');
    if (lastLook < Math.max(lastBuild, lastSheet)) todo.push('ouvre la planche avec Read et juge-la sans complaisance (silhouette, proportions, détails, couleurs, finition dos/dessous, comparaison aux meilleurs jeux) ; si un point fait amateur, corrige-le puis refais planche_vues');
  }
  // Référence fournie par l'utilisateur : comparaison mesurée obligatoire, et boucle tant que le score est faible.
  const human = all[start]?.message?.content;
  const hasRef = Array.isArray(human) && human.some((b) => b.type === 'image');
  const compares = calls.filter((c) => /roforge__comparer_reference$/.test(c.name));
  if (lastBuild >= 0 && hasRef && !compares.length) todo.push('l’utilisateur a donné une image de référence : lance mcp__roforge__comparer_reference (chemin de la référence) sur le modèle et corrige les zones faibles');
  const lastCompare = compares.at(-1);
  if (lastCompare) {
    const g = Number(((results.get(lastCompare.id) || '').match(/\\?"global\\?"\s*:\s*(\d+)/) || [])[1]);
    if (g && g < 75 && calls.indexOf(lastCompare) >= lastBuild) todo.push(`la comparaison mesurée donne ${g}/100 : corrige les zones_faibles (forme, couleurs, détails, accessoires manquants) puis relance comparer_reference ; vise au moins 75`);
  }
  if (lastScript >= 0 && lastTest < lastScript) todo.push('lance mcp__roforge__test_de_jeu pour tester le code écrit, lis le rapport et corrige chaque erreur signalée');
  else if (lastScript >= 0 && lastOutput < lastScript && lastTest < 0) todo.push('lis la sortie de Studio (mcp__roforge__sortie_studio) et corrige les erreurs');

  const images = calls.filter((c) => /roforge__generer_image$/.test(c.name));
  const unplaced = images.filter((c) => {
    const r = results.get(c.id) || '';
    if (/pose_sur/.test(r)) return false;
    const after = calls.slice(calls.indexOf(c) + 1);
    return !after.some((a) => /rbxassetid/.test(JSON.stringify(a.input)));
  });
  if (unplaced.length) todo.push(`pose dans l’interface les images générées qui ne sont pas encore utilisées (${unplaced.map((c) => c.input.nom || 'image').join(', ')}) : Image = leur asset rbxassetid, ScaleType adapté, puis capture pour vérifier`);

  if (!todo.length) return;
  state.rounds += 1;
  try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `Contrôle qualité RoForge — avant de terminer, sans rien demander à l’utilisateur :\n- ${todo.join('\n- ')}\nEnsuite seulement, fais ton résumé final.`,
  }));
}

main();
