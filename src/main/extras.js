// Limites d'abonnement (Claude / Codex) et sauvegarde des jeux.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJson, writeJson } = require('./store');

const CODEX_HOME = path.join(os.homedir(), '.codex');

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------
const WINDOW_LABELS = { five_hour: 'Session (5 h)', seven_day: 'Semaine', seven_day_opus: 'Semaine (Opus)', seven_day_sonnet: 'Semaine (Sonnet)' };

class Limits {
  constructor(runtimeDir) {
    this.file = path.join(runtimeDir, 'limites.json');
  }

  // Événement rate_limit_event de Claude Code.
  recordClaude(info) {
    const data = readJson(this.file, {});
    const windows = { ...(data.claude?.windows || {}) };
    for (const [key, w] of Object.entries(info?.unifiedWindows || {})) {
      if (w && w.utilization != null) windows[key] = { utilization: w.utilization, resetsAt: w.resetsAt };
    }
    if (!Object.keys(info?.unifiedWindows || {}).length && info?.rateLimitType && info.utilization != null) {
      windows[info.rateLimitType] = { utilization: info.utilization, resetsAt: info.resetsAt };
    }
    data.claude = { ...(data.claude || {}), windows, updated: Date.now() };
    writeJson(this.file, data);
  }

  setClaudePlan(plan) {
    const data = readJson(this.file, {});
    data.claude = { ...(data.claude || {}), plan };
    writeJson(this.file, data);
  }

  // Codex écrit ses limites dans ses journaux de session (~/.codex/sessions/**/rollout-*.jsonl).
  codex() {
    const dir = path.join(CODEX_HOME, 'sessions');
    const files = [];
    const walk = (d, depth) => {
      if (depth > 4 || !fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.name.endsWith('.jsonl')) files.push({ full, mtime: fs.statSync(full).mtimeMs });
      }
    };
    walk(dir, 0);
    files.sort((a, b) => b.mtime - a.mtime);
    const marker = '"rate_limits":{';
    const win = (w) => w && { label: w.window_minutes <= 300 ? '5 h' : 'Semaine', pct: w.used_percent, resetsAt: w.resets_at };
    for (const f of files.slice(0, 30)) {
      const text = fs.readFileSync(f.full, 'utf8');
      // Du plus récent au plus ancien : certaines entrées n'ont pas de fenêtres (primary: null).
      for (let i = text.lastIndexOf(marker); i >= 0; i = text.lastIndexOf(marker, i - 1)) {
        const slice = text.slice(i + marker.length - 1, i + 4000);
        let depth = 0;
        let end = 0;
        for (; end < slice.length; end++) {
          if (slice[end] === '{') depth++;
          else if (slice[end] === '}' && --depth === 0) break;
        }
        try {
          const rl = JSON.parse(slice.slice(0, end + 1));
          const windows = [win(rl.primary), win(rl.secondary)].filter(Boolean);
          if (windows.length) return { plan: rl.plan_type, windows, updated: f.mtime };
        } catch {
          // entrée tronquée : on continue
        }
        if (i === 0) break;
      }
    }
    return { plan: codexPlan(), windows: [] };
  }

  get() {
    const data = readJson(this.file, {});
    const claudeWindows = Object.entries(data.claude?.windows || {})
      .sort(([a], [b]) => Object.keys(WINDOW_LABELS).indexOf(a) - Object.keys(WINDOW_LABELS).indexOf(b))
      .map(([key, w]) => ({ label: WINDOW_LABELS[key] || key, pct: Math.round(w.utilization * 100), resetsAt: w.resetsAt }));
    const codex = this.codex();
    if (!codex.plan) codex.plan = codexPlan();
    return { claude: { plan: data.claude?.plan, windows: claudeWindows, updated: data.claude?.updated }, codex };
  }
}

function codexPlan() {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(CODEX_HOME, 'auth.json'), 'utf8'));
    const payload = JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
    return payload['https://api.openai.com/auth']?.chatgpt_plan_type;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Sauvegarde : copie datée du dossier du jeu dans un dossier choisi
// (OneDrive, Google Drive pour ordinateur, Dropbox, disque externe…).
// ---------------------------------------------------------------------------
const SKIP = new Set(['node_modules', '.git', 'out']);
const KEEP = 10;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

function latestChange(dir) {
  let latest = 0;
  const walk = (d, depth) => {
    if (depth > 6) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  };
  walk(dir, 0);
  return latest;
}

function backupProject(project, backupDir) {
  if (!backupDir) throw new Error('Aucun dossier de sauvegarde choisi (Réglages › Sauvegarde).');
  const root = path.join(backupDir, 'RoForge-sauvegardes', project.name);
  const target = path.join(root, stamp());
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(project.dir, target, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
  const versions = fs.readdirSync(root).sort();
  for (const old of versions.slice(0, Math.max(0, versions.length - KEEP))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  return { at: new Date().toISOString(), path: target };
}

function needsBackup(project) {
  if (!project.lastBackup) return true;
  return latestChange(project.dir) > new Date(project.lastBackup).getTime();
}

module.exports = { Limits, backupProject, needsBackup };
