// Lance Claude Code et Codex (abonnements de l'utilisateur) pour une conversation,
// avec les MCP RoForge / Roblox Studio / Blender et la mémoire de règles.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { buildPersona } = require('./persona');

const APP_ROOT = path.join(__dirname, '..', '..');
const NODE_MODULES = path.join(APP_ROOT, 'node_modules');

const CLAUDE_EXE = path.join(NODE_MODULES, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const CODEX_EXE = path.join(NODE_MODULES, '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const ROBLOX_MCP_BAT = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'mcp.bat');
const CHRRXS_MCP = path.join(NODE_MODULES, '@chrrxs', 'robloxstudio-mcp', 'dist', 'index.js');

const IMAGE_WORDS = /\b(image|images|icône|icone|icon|miniature|thumbnail|logo|illustration|dessine|dessin|affiche|bannière|banniere|concept art|fond d['’]écran|pub)\b/i;

// coder = qui code le jeu (réglage) : « claude » (Codex fait les images) ou « codex » (Codex seul).
function routeMessage(text, forced, coder = 'claude') {
  if (forced === 'claude' || forced === 'codex') return forced;
  const trimmed = text.trim();
  if (/^@codex\b/i.test(trimmed)) return 'codex';
  if (/^@claude\b/i.test(trimmed)) return 'claude';
  if (coder === 'codex') return 'codex';
  return IMAGE_WORDS.test(trimmed) && /\b(génère|genere|crée|cree|fais|dessine|refais|fait)\b/i.test(trimmed) ? 'codex' : 'claude';
}

// Serveurs MCP communs aux deux agents (le pont roforge reçoit un jeton par conversation).
// La 3D passe toujours par les MeshParts IA de Roblox (MCP officiel) : pas de serveur Blender.

function mcpServers({ settings, bridgeToken, runId, project }) {
  const node = { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  const servers = {};
  if (settings.mcp.roforge) {
    servers.roforge = {
      ...node,
      args: [path.join(APP_ROOT, 'src', 'mcp', 'roforge-mcp.js')],
      env: { ...node.env, ROFORGE_TOKEN: bridgeToken, ROFORGE_RUN: runId, ROFORGE_PORT: '44777' },
    };
  }
  if (settings.mcp.officiel && fs.existsSync(ROBLOX_MCP_BAT)) {
    servers.Roblox_Studio = { command: 'cmd.exe', args: ['/c', ROBLOX_MCP_BAT], env: {} };
    if (process.env.ROBLOX_OPEN_CLOUD_API_KEY) servers.Roblox_Studio.env.ROBLOX_OPEN_CLOUD_API_KEY = process.env.ROBLOX_OPEN_CLOUD_API_KEY;
  }
  if (settings.mcp.chrrxs && fs.existsSync(CHRRXS_MCP)) {
    servers.robloxstudio = { ...node, args: [CHRRXS_MCP, '--auto-install-plugin'] };
  }
  return servers;
}

function agentEnv(settings) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!settings.useApiKeys) {
    // Abonnements Claude / ChatGPT : on ignore les clés API éventuelles.
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
  }
  return env;
}

class Run extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.child = null;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
    if (this.child && !this.child.killed) {
      // taskkill pour arrêter aussi les sous-processus (MCP, shells).
      spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true });
    }
  }
}

function lines(stream, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) onLine(line);
    }
  });
  stream.on('end', () => buffer.trim() && onLine(buffer.trim()));
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------
function runClaude({ store, project, conv, prompt, images, settings, bridgeToken, runId, runtimeDir }) {
  const run = new Run('claude');
  const configFile = path.join(runtimeDir, `mcp-claude-${runId}.json`);
  fs.writeFileSync(configFile, JSON.stringify({ mcpServers: mcpServers({ settings, bridgeToken, runId, project }) }, null, 2));

  const persona = buildPersona({ store, project, settings, agent: 'claude' });
  const allowed = ['mcp__roforge', 'mcp__Roblox_Studio', 'mcp__robloxstudio','Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite', 'WebSearch', 'WebFetch'];
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', settings.claudeModel || 'opus',
    '--effort', settings.claudeEffort || 'max',
    '--append-system-prompt', persona,
    '--mcp-config', configFile,
    '--strict-mcp-config',
    '--add-dir', settings.libraryPath,
    '--plugin-dir', path.join(APP_ROOT, 'resources', 'plugin-roforge'),
  ];
  if (settings.permissions === 'auto') args.push('--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions');
  else args.push('--permission-mode', 'acceptEdits', '--permission-prompt-tool', 'mcp__roforge__autorisation', '--allowedTools', ...allowed);
  if (conv.claudeSession) args.push('--resume', conv.claudeSession);

  let input = prompt;
  if (images?.length) {
    input += `\n\nImages jointes (ouvre-les avec Read avant de répondre) :\n${images.map((p) => `- ${p}`).join('\n')}`;
  }

  // Outils longs (génération d'image, test de jeu) : délai MCP de 15 min.
  const child = spawn(CLAUDE_EXE, args, { cwd: project.dir, env: { ...agentEnv(settings), MCP_TOOL_TIMEOUT: '900000' }, windowsHide: true });
  run.child = child;
  child.stdin.end(input, 'utf8');

  const blocks = new Map(); // index -> {type, id, name}
  lines(child.stdout, (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.session_id && ev.type === 'system' && ev.subtype === 'init') run.emit('session', ev.session_id);
    if (ev.type === 'stream_event' && !ev.parent_tool_use_id) {
      const e = ev.event;
      if (e.type === 'content_block_start') {
        blocks.set(e.index, e.content_block);
        if (e.content_block.type === 'text') run.emit('text-start');
      } else if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
        run.emit('text', e.delta.text);
      } else if (e.type === 'content_block_delta' && e.delta.type === 'thinking_delta') {
        run.emit('thinking', e.delta.thinking);
      }
    } else if (ev.type === 'assistant' && !ev.parent_tool_use_id) {
      for (const block of ev.message?.content || []) {
        if (block.type === 'tool_use') run.emit('tool', { id: block.id, name: block.name, input: block.input });
      }
    } else if (ev.type === 'user') {
      for (const block of ev.message?.content || []) {
        if (block.type === 'tool_result') {
          const content = Array.isArray(block.content) ? block.content.map((c) => c.text || (c.type === 'image' ? '[image]' : '')).join('\n') : String(block.content ?? '');
          run.emit('tool-result', { id: block.tool_use_id, error: !!block.is_error, text: content.slice(0, 4000) });
        }
      }
    } else if (ev.type === 'rate_limit_event') {
      run.emit('limits', ev.rate_limit_info);
    } else if (ev.type === 'result' || (ev.stop_reason !== undefined && ev.total_cost_usd !== undefined)) {
      run.result = ev;
      if (ev.is_error && ev.result) run.emit('error', String(ev.result));
    }
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => (stderr += c));
  child.on('error', (err) => run.emit('error', err.message));
  child.on('close', (code) => {
    fs.rm(configFile, { force: true }, () => {});
    if (code !== 0 && !run.stopped && !run.result) run.emit('error', stderr.trim().slice(-1500) || `Claude Code s’est arrêté (code ${code})`);
    run.emit('done', { code, stopped: run.stopped, result: run.result });
  });
  return run;
}

// ---------------------------------------------------------------------------
// Codex (images + analyse)
// ---------------------------------------------------------------------------
const tomlString = (s) => `'${String(s).replace(/'/g, '')}'`;

function codexMcpOverrides(servers) {
  const out = [];
  for (const [name, s] of Object.entries(servers)) {
    if (name === 'blender') continue; // Codex ne fait pas la 3D dans RoForge
    out.push('-c', `mcp_servers.${name}.command=${tomlString(s.command)}`);
    out.push('-c', `mcp_servers.${name}.args=[${s.args.map(tomlString).join(',')}]`);
    const env = Object.entries(s.env || {}).map(([k, v]) => `${k}=${tomlString(v)}`).join(',');
    if (env) out.push('-c', `mcp_servers.${name}.env={${env}}`);
  }
  return out;
}

function listImages(dir) {
  const out = new Map();
  const walk = (d, depth) => {
    if (depth > 4 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', '.git', '.roforge'].includes(e.name)) walk(full, depth + 1);
      } else if (/\.(png|jpe?g|webp)$/i.test(e.name)) out.set(full, fs.statSync(full).mtimeMs);
    }
  };
  walk(dir, 0);
  return out;
}

// PNG avec canal alpha (type de couleur 4 ou 6, ou palette avec bloc tRNS).
function hasAlpha(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32BE(0) !== 0x89504e47) return false;
    const colorType = buf[25];
    if (colorType === 4 || colorType === 6) return true;
    return colorType === 3 && buf.includes(Buffer.from('tRNS'));
  } catch {
    return false;
  }
}

// workDir : dossier de travail propre à ce tour (images générées en parallèle) ; seules ses images
// et celles de son propre fil Codex sont prises, jamais celles d'un autre tour lancé en même temps.
function runCodex({ store, project, conv, prompt, images, settings, bridgeToken, runId, imageOnly = false, workDir }) {
  const run = new Run('codex');
  const persona = buildPersona({ store, project, settings, agent: 'codex' });
  const dir = workDir || project.dir;
  const imagesDir = workDir || path.join(project.dir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const codexImagesDir = path.join(os.homedir(), '.codex', 'generated_images');
  const before = new Map([...listImages(dir), ...listImages(codexImagesDir)]);
  let threadId = null;
  const startedAt = Date.now();

  const common = ['--json', '--skip-git-repo-check', '--enable', 'image_generation', ...codexMcpOverrides(mcpServers({ settings, bridgeToken, runId, project }))];
  if (settings.permissions === 'auto') common.push('--dangerously-bypass-approvals-and-sandbox');
  else common.push('-s', 'workspace-write');
  if (settings.codexModel) common.push('-m', settings.codexModel);
  // Réflexion poussée pour le code et le design ; plus légère pour une simple image.
  common.push('-c', `model_reasoning_effort="${imageOnly ? 'medium' : 'high'}"`);
  for (const img of images || []) common.push('-i', img);

  const args = conv.codexThread
    ? ['exec', ...common, 'resume', conv.codexThread, '-']
    : ['exec', '-C', dir, ...common, '-'];
  // imageOnly : appel direct par l'outil generer_image (consigne déjà complète, sans conversation).
  const input = conv.codexThread || imageOnly ? prompt : `${persona}\n\n---\n\nDemande de l’utilisateur :\n${prompt}`;

  const child = spawn(CODEX_EXE, args, { cwd: dir, env: agentEnv(settings), windowsHide: true });
  run.child = child;
  child.stdin.end(input, 'utf8');

  lines(child.stdout, (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    const item = ev.item || {};
    if (ev.type === 'thread.started' && ev.thread_id) run.emit('session', (threadId = ev.thread_id));
    else if (ev.type === 'item.started' && item.type === 'command_execution') run.emit('tool', { id: item.id, name: 'Commande', input: { command: item.command } });
    else if (ev.type === 'item.started' && item.type === 'mcp_tool_call') run.emit('tool', { id: item.id, name: `mcp__${item.server}__${item.tool}`, input: item.arguments || {} });
    else if (ev.type === 'item.started' && /image/.test(item.type || '')) run.emit('tool', { id: item.id, name: 'Génération d’image', input: { prompt: item.prompt || '' } });
    else if (ev.type === 'item.completed') {
      if (item.type === 'agent_message') {
        run.emit('text-start');
        run.emit('text', item.text || '');
      } else if (item.type === 'reasoning') run.emit('thinking', item.text || '');
      else if (item.type === 'command_execution' || item.type === 'mcp_tool_call' || /image/.test(item.type || '')) {
        const text = item.aggregated_output || JSON.stringify(item.result || item.error || item.saved_path || '', null, 1);
        run.emit('tool-result', { id: item.id, error: item.status === 'failed', text: String(text).slice(0, 4000) });
      } else if (item.type === 'file_change') run.emit('tool', { id: item.id, name: 'Fichiers modifiés', input: { changes: item.changes } });
    } else if (ev.type === 'turn.failed' || ev.type === 'error') run.emit('error', ev.error?.message || ev.message || 'Erreur Codex');
    else if (ev.type === 'turn.completed') run.result = ev;
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => (stderr += c));
  child.on('error', (err) => run.emit('error', err.message));
  child.on('close', (code) => {
    // Images créées pendant le tour. Si Codex n'a rien enregistré dans le jeu, ses images
    // brutes (~/.codex/generated_images) sont copiées dans images/.
    const fresh = (map) => [...map].filter(([file, mtime]) => mtime >= startedAt - 1000 && before.get(file) !== mtime).map(([file]) => file);
    const created = fresh(listImages(dir));
    if (!created.length) {
      const own = workDir ? (threadId ? path.join(codexImagesDir, threadId) : null) : codexImagesDir;
      for (const file of own ? fresh(listImages(own)) : []) {
        const target = path.join(imagesDir, path.basename(file));
        try {
          fs.copyFileSync(file, target);
          created.push(target);
        } catch {
          // fichier verrouillé : ignoré
        }
      }
    }
    if (created.length) {
      run.emit('images', created);
      const opaque = created.filter((f) => !hasAlpha(f));
      if (opaque.length && !imageOnly && !/(fond|minia|thumbnail|icône du jeu|icone du jeu|game icon|décor|decor|wallpaper|pub)/i.test(prompt)) {
        run.emit('text-start');
        run.emit('text', `\n\n⚠️ Image sans transparence : ${opaque.map((f) => path.basename(f)).join(', ')}. Demande « refais-la sans fond » pour la corriger.`);
      }
    }
    if (code !== 0 && !run.stopped && !run.result) run.emit('error', stderr.trim().slice(-1500) || `Codex s’est arrêté (code ${code})`);
    run.emit('done', { code, stopped: run.stopped, result: run.result });
  });
  return run;
}

// Texte simple généré par Claude, sans outils (résumés de conversation).
function claudeText(prompt, settings, cwd) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text', '--model', settings.claudeModel === 'haiku' ? 'haiku' : 'sonnet', '--strict-mcp-config', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task'];
    const child = spawn(CLAUDE_EXE, args, { cwd, env: agentEnv(settings), windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error(err.trim().slice(-500) || `Claude s’est arrêté (code ${code})`))));
    child.stdin.end(prompt, 'utf8');
  });
}

// ---------------------------------------------------------------------------
// Connexion aux comptes
// ---------------------------------------------------------------------------
function execJson(exe, args) {
  return new Promise((resolve) => {
    if (!fs.existsSync(exe)) return resolve(null);
    const child = spawn(exe, args, { windowsHide: true, env: agentEnv({ useApiKeys: true }) });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(null));
  });
}

async function accountStatus() {
  const claudeOut = await execJson(CLAUDE_EXE, ['auth', 'status']);
  let claude = { installed: fs.existsSync(CLAUDE_EXE), loggedIn: false };
  try {
    const parsed = JSON.parse(claudeOut.slice(claudeOut.indexOf('{')));
    claude = { ...claude, loggedIn: !!parsed.loggedIn, email: parsed.email, method: parsed.authMethod, plan: parsed.subscriptionType };
  } catch {
    // pas de JSON : non connecté
  }
  const codexOut = (await execJson(CODEX_EXE, ['login', 'status'])) || '';
  const codex = { installed: fs.existsSync(CODEX_EXE), loggedIn: /logged in/i.test(codexOut) && !/not logged/i.test(codexOut), method: codexOut.trim().split('\n').pop() };
  return { claude, codex };
}

// Ouvre une console avec la connexion officielle (navigateur) ; RoForge ne voit jamais les identifiants.
function openLogin(agent) {
  const exe = agent === 'codex' ? CODEX_EXE : CLAUDE_EXE;
  const args = agent === 'codex' ? 'login' : 'auth login';
  const title = agent === 'codex' ? 'RoForge - connexion Codex' : 'RoForge - connexion Claude';
  spawn('cmd.exe', ['/c', 'start', `"${title}"`, 'cmd', '/k', `"${exe}" ${args}`], { detached: true, windowsHide: false, shell: false, windowsVerbatimArguments: true }).unref();
}

async function logout(agent) {
  return execJson(agent === 'codex' ? CODEX_EXE : CLAUDE_EXE, agent === 'codex' ? ['logout'] : ['auth', 'logout']);
}

module.exports = { runClaude, runCodex, routeMessage, accountStatus, openLogin, logout, hasAlpha, claudeText, CLAUDE_EXE, CODEX_EXE, ROBLOX_MCP_BAT };
