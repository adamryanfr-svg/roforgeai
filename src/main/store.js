// Données de RoForge : Documents\RoForge (réglages, jeux, règles, bibliothèque).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(os.homedir(), 'Documents', 'RoForge');
const GAMES_DIR = path.join(ROOT, 'Jeux');
const RUNTIME_DIR = path.join(ROOT, '.contexte');
const EXAMPLES_DIR = path.join(ROOT, 'bibliotheque', 'exemples');

const DEFAULT_SETTINGS = {
  claudeModel: 'opus',
  claudeEffort: 'max',
  codexModel: '',
  permissions: 'demander', // demander | auto
  useApiKeys: false,
  mcp: { roforge: true, officiel: true, chrrxs: false, blender: false },
  blenderPath: '',
  libraryPath: path.join(os.homedir(), 'roblox-ai'),
  notifications: true,
  theme: 'light',
  coder: 'claude', // qui code le jeu : claude (Codex fait les images) ou codex (Codex seul)
  backupDir: '',
};

// Règles livrées : préférences de départ, modifiables ou supprimables dans l'onglet Mémoire.
const DEFAULT_RULES = [
  'Ne jamais utiliser la Toolbox ni le Creator Store : tous les modèles, sons et animations sont créés par nous (parts, MeshParts générés par l’IA de Roblox, animations codées).',
  'Toujours répondre en français, simplement, sans jargon inutile.',
  'Avant une grosse modification dans Studio, faire une sauvegarde de la place (outil sauvegarde_place).',
  'Le code serveur va dans ServerScriptService, le code client dans StarterPlayerScripts / StarterGui, les modules partagés dans ReplicatedStorage. Ne jamais faire confiance au client (validation serveur des achats, dégâts, monnaie).',
  'Les interfaces doivent fonctionner sur mobile : tailles en Scale, UIAspectRatioConstraint, boutons d’au moins 44 px.',
  'Après avoir écrit du code, vérifier la Sortie de Studio (sortie_studio) et corriger les erreurs avant de dire que c’est fini.',
  'Images d’interface générées (boutons, icônes de GUI, cadres, badges) : toujours sans fond (PNG transparent). Miniatures, icônes du jeu, fonds d’écran et décors : TOUJOURS avec leur fond, jamais détourés.',
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

class Store {
  constructor() {
    ensureDir(GAMES_DIR);
    ensureDir(RUNTIME_DIR);
    ensureDir(EXAMPLES_DIR);
    const globalRules = path.join(ROOT, 'connaissances', 'regles.json');
    if (!fs.existsSync(globalRules)) {
      writeJson(globalRules, DEFAULT_RULES.map((text) => ({ id: id(), text, scope: 'tous', source: 'livrée', created: now() })));
    }
  }

  get paths() {
    return { ROOT, GAMES_DIR, RUNTIME_DIR, EXAMPLES_DIR };
  }

  // ---------- réglages ----------
  settings() {
    const saved = readJson(path.join(ROOT, 'reglages.json'), {});
    return { ...DEFAULT_SETTINGS, ...saved, mcp: { ...DEFAULT_SETTINGS.mcp, ...(saved.mcp || {}) } };
  }

  updateSettings(patch) {
    const next = { ...this.settings(), ...patch };
    if (patch.mcp) next.mcp = { ...this.settings().mcp, ...patch.mcp };
    writeJson(path.join(ROOT, 'reglages.json'), next);
    return next;
  }

  // ---------- jeux ----------
  projects() {
    return readJson(path.join(ROOT, 'projets.json'), []).filter((p) => fs.existsSync(p.dir));
  }

  saveProjects(list) {
    writeJson(path.join(ROOT, 'projets.json'), list);
  }

  project(projectId) {
    const p = this.projects().find((x) => x.id === projectId);
    if (!p) throw new Error('Jeu introuvable');
    return p;
  }

  createProject({ name, concept, placeId }) {
    const clean = name.trim().replace(/[<>:"/\\|?*]+/g, '').slice(0, 60) || 'Nouveau jeu';
    let dir = path.join(GAMES_DIR, clean);
    for (let n = 2; fs.existsSync(dir); n++) dir = path.join(GAMES_DIR, `${clean} (${n})`);
    for (const sub of ['.roforge/conversations', 'images', 'da', 'modeles', 'docs']) ensureDir(path.join(dir, sub));
    fs.writeFileSync(
      path.join(dir, 'docs', 'concept.md'),
      `# ${clean}\n\n${concept?.trim() || '_Décris ici la boucle de jeu, la progression et la monétisation._'}\n`,
      'utf8'
    );
    const project = { id: id(), name: path.basename(dir), dir, placeId: placeId || '', created: now(), lastOpened: now(), imported: false };
    this.saveProjects([project, ...this.projects()]);
    return project;
  }

  importProject(dir) {
    const existing = this.projects().find((p) => p.dir.toLowerCase() === dir.toLowerCase());
    if (existing) return existing;
    ensureDir(path.join(dir, '.roforge', 'conversations'));
    const project = { id: id(), name: path.basename(dir), dir, placeId: '', created: now(), lastOpened: now(), imported: true };
    this.saveProjects([project, ...this.projects()]);
    return project;
  }

  updateProject(projectId, patch) {
    const list = this.projects().map((p) => (p.id === projectId ? { ...p, ...patch } : p));
    this.saveProjects(list);
    return list.find((p) => p.id === projectId);
  }

  removeProject(projectId) {
    this.saveProjects(this.projects().filter((p) => p.id !== projectId));
  }

  // ---------- conversations ----------
  convDir(project) {
    return ensureDir(path.join(project.dir, '.roforge', 'conversations'));
  }

  conversations(projectId) {
    const project = this.project(projectId);
    const dir = this.convDir(project);
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .map(({ messages, ...meta }) => ({ ...meta, count: messages.length }))
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }

  conversation(projectId, convId) {
    const conv = readJson(path.join(this.convDir(this.project(projectId)), `${convId}.json`), null);
    if (!conv) throw new Error('Conversation introuvable');
    return conv;
  }

  createConversation(projectId, title = 'Nouvelle conversation', specialiste = 'equipe') {
    const conv = { id: id(), title, specialiste, created: now(), updated: now(), claudeSession: null, codexThread: null, messages: [] };
    this.saveConversation(projectId, conv);
    return conv;
  }

  saveConversation(projectId, conv) {
    conv.updated = now();
    writeJson(path.join(this.convDir(this.project(projectId)), `${conv.id}.json`), conv);
  }

  deleteConversation(projectId, convId) {
    fs.rmSync(path.join(this.convDir(this.project(projectId)), `${convId}.json`), { force: true });
  }

  searchConversations(projectId, query) {
    const q = query.toLowerCase();
    const hits = [];
    for (const meta of this.conversations(projectId)) {
      const conv = this.conversation(projectId, meta.id);
      for (const m of conv.messages) {
        const i = (m.text || '').toLowerCase().indexOf(q);
        if (i >= 0) hits.push({ convId: conv.id, title: conv.title, messageId: m.id, excerpt: m.text.slice(Math.max(0, i - 60), i + 120) });
      }
    }
    return hits.slice(0, 100);
  }

  // ---------- règles (mémoire) ----------
  rulesFile(projectId) {
    return projectId ? path.join(this.project(projectId).dir, '.roforge', 'regles.json') : path.join(ROOT, 'connaissances', 'regles.json');
  }

  rules(projectId) {
    const global = readJson(this.rulesFile(null), []);
    const local = projectId ? readJson(this.rulesFile(projectId), []).map((r) => ({ ...r, scope: 'jeu' })) : [];
    return [...local, ...global];
  }

  addRule(projectId, { text, scope, source = 'toi' }) {
    const file = this.rulesFile(scope === 'jeu' ? projectId : null);
    const list = readJson(file, []);
    const rule = { id: id(), text: text.trim(), scope: scope === 'jeu' ? 'jeu' : 'tous', source, created: now() };
    list.unshift(rule);
    writeJson(file, list);
    return rule;
  }

  updateRule(projectId, ruleId, text) {
    for (const file of [this.rulesFile(null), projectId && this.rulesFile(projectId)].filter(Boolean)) {
      const list = readJson(file, []);
      const rule = list.find((r) => r.id === ruleId);
      if (rule) {
        rule.text = text;
        writeJson(file, list);
        return rule;
      }
    }
    throw new Error('Règle introuvable');
  }

  deleteRule(projectId, ruleId) {
    for (const file of [this.rulesFile(null), projectId && this.rulesFile(projectId)].filter(Boolean)) {
      const list = readJson(file, []);
      const next = list.filter((r) => r.id !== ruleId);
      if (next.length !== list.length) writeJson(file, next);
    }
  }

  // ---------- journal du jeu ----------
  addJournal(projectId, text) {
    const file = path.join(this.project(projectId).dir, '.roforge', 'journal.jsonl');
    fs.appendFileSync(file, JSON.stringify({ t: now(), text }) + '\n', 'utf8');
  }

  journal(projectId) {
    const file = path.join(this.project(projectId).dir, '.roforge', 'journal.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(safeParse)
      .filter(Boolean)
      .reverse();
  }

  // ---------- bibliothèque d'exemples validés ----------
  examples() {
    return readJson(path.join(EXAMPLES_DIR, 'index.json'), []);
  }

  addExample({ projectId, title, text, images = [] }) {
    const list = this.examples();
    const example = { id: id(), projectId, title: title.slice(0, 80), text, images, created: now() };
    list.unshift(example);
    writeJson(path.join(EXAMPLES_DIR, 'index.json'), list);
    return example;
  }

  removeExample(exampleId) {
    writeJson(path.join(EXAMPLES_DIR, 'index.json'), this.examples().filter((e) => e.id !== exampleId));
  }
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

module.exports = { Store, ROOT, writeJson, readJson, ensureDir, id, now };
