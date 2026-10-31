// Pont local entre l'app, le plugin Studio et le serveur MCP lancé par les agents.
// Le plugin fait du long-polling sur /plugin/poll ; le MCP appelle /mcp/* .
const http = require('http');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const PORT = 44777;
const POLL_TIMEOUT_MS = 20000;
const COMMAND_TIMEOUT_MS = 60000;
const STALE_MS = 45000;
// Studio qui décroche (gel, rechargement du plugin, Play) : on garde les commandes et on attend qu'il revienne.
const RECONNECT_GRACE_MS = 120000;
const WAIT_CONNECT_MS = 60000;

const fs = require('fs');
const path = require('path');
const PLUGIN_DIR = path.join(__dirname, '..', '..', 'plugin');

// Cœur du plugin servi à Studio (core.lua + kit3d.lua injecté) ; sa version (hash) change dès qu'un fichier change.
function readCore() {
  const core = fs.readFileSync(path.join(PLUGIN_DIR, 'core.lua'), 'utf8');
  const kit = fs.readFileSync(path.join(PLUGIN_DIR, 'kit3d.lua'), 'utf8');
  const source = core.replace('-- @@KIT3D@@ (remplacé par plugin/kit3d.lua quand le pont sert le cœur)', () => kit);
  return { source, version: crypto.createHash('sha1').update(source).digest('hex').slice(0, 12) };
}

class Bridge extends EventEmitter {
  constructor() {
    super();
    this.client = null; // { id, place, placeId, version, lastSeen }
    this.queue = [];
    this.waitingPoll = null;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.logs = [];
    this.handlers = {}; // routes /mcp/* fournies par main.js
    this.files = new Map(); // id -> chemin, images servies pour upload_image (MCP officiel)
    this.token = crypto.randomBytes(16).toString('hex');
  }

  start() {
    this.server = http.createServer((req, res) => this.route(req, res));
    this.server.on('error', (err) => this.emit('error', err));
    this.server.listen(PORT, '127.0.0.1');
    this.staleTimer = setInterval(() => {
      // Pendant un test de jeu, Studio peut ralentir ses requêtes : on ne coupe pas tant qu'une commande attend.
      if (this.client && !this.pending.size && Date.now() - this.client.lastSeen > STALE_MS) this.disconnect();
    }, 5000);
  }

  stop() {
    clearInterval(this.staleTimer);
    this.server?.close();
  }

  status() {
    return this.client
      ? { connected: true, place: this.client.place, placeId: this.client.placeId, version: this.client.version }
      : { connected: false };
  }

  disconnect() {
    this.client = null;
    this.emit('status', this.status());
    // Les commandes en cours ne sont abandonnées que si Studio ne revient pas pendant le délai de grâce.
    clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => {
      if (this.client) return;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Studio s’est déconnecté et n’est pas revenu : rouvre la place dans Studio.'));
      }
      this.pending.clear();
      this.queue = [];
    }, RECONNECT_GRACE_MS);
  }

  // Attend que le plugin soit (re)connecté.
  waitConnected(ms = WAIT_CONNECT_MS) {
    if (this.client) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok) => {
        clearTimeout(timer);
        this.off('status', onStatus);
        resolve(ok);
      };
      const onStatus = (st) => st.connected && done(true);
      const timer = setTimeout(() => done(false), ms);
      this.on('status', onStatus);
    });
  }

  // Envoie une commande au plugin et attend sa réponse.
  async send(op, args = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (!this.client && !(await this.waitConnected())) throw new Error('Roblox Studio n’est pas connecté. Ouvre Studio : le plugin RoForge se connecte tout seul.');
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Studio n’a pas répondu à « ${op} » à temps`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.queue.push({ id, op, args });
      this.log(`file ${op} ${id.slice(0, 8)} (poll en attente : ${!!this.waitingPoll})`);
      this.flushPoll();
    });
  }

  flushPoll() {
    if (this.waitingPoll && this.queue.length) {
      const { res, timer } = this.waitingPoll;
      clearTimeout(timer);
      this.waitingPoll = null;
      // Connexion du plugin déjà fermée : on garde les commandes pour le prochain poll.
      if (res.writableEnded || res.destroyed || res.socket?.destroyed) return this.log('poll mort, commandes gardées');
      const commands = this.queue.splice(0);
      this.log(`envoi ${commands.map((c) => c.op).join(', ')}`);
      json(res, { commands, coreVersion: readCore().version });
    }
  }

  // Rend un fichier local accessible en http://127.0.0.1:44777/fichier/<id>.<ext> (seulement ceux publiés ici).
  publishFile(file) {
    const fileId = crypto.createHash('sha1').update(file + this.token).digest('hex').slice(0, 20);
    this.files.set(fileId, file);
    return `http://127.0.0.1:${PORT}/fichier/${fileId}${path.extname(file).toLowerCase()}`;
  }

  log(text) {
    this.emit('debug', `${new Date().toISOString()} ${text}`);
  }

  async route(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    try {
      if (url.pathname.startsWith('/plugin/')) return this.routePlugin(url, req, res);
      if (url.pathname.startsWith('/fichier/')) {
        const file = this.files.get(path.basename(url.pathname).replace(/\.\w+$/, ''));
        if (!file || !fs.existsSync(file)) return json(res, { error: 'introuvable' }, 404);
        const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const data = fs.readFileSync(file);
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
        return res.end(data);
      }
      if (url.pathname.startsWith('/mcp/')) {
        if (req.headers['x-roforge-token'] !== this.token) return json(res, { error: 'jeton invalide' }, 403);
        const handler = this.handlers[url.pathname.slice(5)];
        if (!handler) return json(res, { error: 'route inconnue' }, 404);
        const body = await readBody(req);
        try {
          json(res, { result: await handler(body) });
        } catch (err) {
          json(res, { error: err.message || String(err) });
        }
        return;
      }
      json(res, { name: 'RoForge', ok: true, studio: this.status() });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
  }

  async routePlugin(url, req, res) {
    const action = url.pathname.slice('/plugin/'.length);
    if (action === 'core') return json(res, readCore());
    if (action === 'poll') {
      const id = url.searchParams.get('client');
      if (!this.client || this.client.id !== id) return json(res, { reconnect: true });
      this.client.lastSeen = Date.now();
      const coreVersion = readCore().version;
      if (this.queue.length) {
        const commands = this.queue.splice(0);
        this.log(`envoi direct ${commands.map((c) => c.op).join(', ')}`);
        return json(res, { commands, coreVersion });
      }
      if (this.waitingPoll) {
        clearTimeout(this.waitingPoll.timer);
        json(this.waitingPoll.res, { commands: [], coreVersion });
      }
      const timer = setTimeout(() => {
        if (this.waitingPoll?.res === res) this.waitingPoll = null;
        json(res, { commands: [], coreVersion: readCore().version });
      }, POLL_TIMEOUT_MS);
      this.waitingPoll = { res, timer };
      // « close » sur la RÉPONSE (connexion fermée par Studio) — pas sur la requête,
      // qui se ferme dès que la requête GET est lue.
      res.on('close', () => {
        if (this.waitingPoll?.res === res) {
          clearTimeout(timer);
          this.waitingPoll = null;
        }
      });
      return;
    }
    const body = await readBody(req);
    if (action === 'hello') {
      // Un seul Studio à la fois : le dernier ouvert prend la main.
      this.client = { id: body.client, place: body.place, placeId: body.placeId, version: body.version, lastSeen: Date.now() };
      clearTimeout(this.graceTimer);
      this.emit('status', this.status());
      return json(res, { ok: true, coreVersion: readCore().version });
    }
    // Un résultat se reconnaît à l'id de sa commande : accepté même si le plugin s'est reconnecté entre-temps.
    if (action === 'result' && this.pending.has(body.id)) {
      if (this.client && body.client === this.client.id) this.client.lastSeen = Date.now();
    } else if (!this.client || body.client !== this.client.id) return json(res, { reconnect: true });
    else this.client.lastSeen = Date.now();
    if (action === 'result') {
      this.log(`résultat ${body.id?.slice(0, 8)} ok=${body.ok}${body.ok ? '' : ` ${String(body.error).slice(0, 200)}`}`);
      const p = this.pending.get(body.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(body.id);
        if (body.ok) p.resolve(body.result);
        else p.reject(new Error(body.error || 'Erreur dans Studio'));
      }
      return json(res, { ok: true });
    }
    if (action === 'logs') {
      for (const log of body.logs || []) {
        this.logs.push(log);
        this.emit('log', log);
      }
      if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000);
      return json(res, { ok: true });
    }
    if (action === 'bye') {
      this.disconnect();
      return json(res, { ok: true });
    }
    json(res, { error: 'action inconnue' }, 404);
  }
}

function json(res, data, status = 200) {
  if (res.writableEnded) return;
  const body = JSON.stringify(data ?? null);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

module.exports = { Bridge, PORT, readCore };
