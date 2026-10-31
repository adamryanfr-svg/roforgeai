// Captures du viewport de Studio via le MCP officiel Roblox_Studio (outil screen_capture),
// planche de 10 vues d'un modèle et assemblage en une seule image.
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROBLOX_MCP_BAT = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'mcp.bat');

let client = null;
let connecting = null;

async function connect() {
  if (client) return client;
  if (connecting) return connecting;
  if (!fs.existsSync(ROBLOX_MCP_BAT)) throw new Error('MCP officiel Roblox Studio introuvable : installe ou mets à jour Roblox Studio.');
  connecting = (async () => {
    const c = new Client({ name: 'roforge-captures', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: 'cmd.exe', args: ['/c', ROBLOX_MCP_BAT], stderr: 'ignore' });
    transport.onclose = () => (client = null);
    await c.connect(transport);
    client = c;
    return c;
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

function textOf(result) {
  return (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = /No Roblox Studio instances|not connected|ECONNRESET|EPIPE|closed|timed out|Request timed out/i;

// Le MCP officiel perd parfois Studio quelques secondes : on réessaie au lieu d'abandonner.
async function retry(fn, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries || !TRANSIENT.test(err.message || '')) throw err;
      if (/closed|EPIPE|ECONNRESET/i.test(err.message)) client = null;
      await sleep(Math.min(10000, 2000 * i));
    }
  }
}

async function studioId(placeName) {
  return retry(async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'list_roblox_studios', arguments: {} });
    const studios = JSON.parse(textOf(res)).studios || [];
    if (!studios.length) throw new Error('No Roblox Studio instances : ouvre la place dans Studio (Assistant › MCP activé).');
    return (studios.find((s) => s.name === placeName) || studios[0]).id;
  });
}

// Appel d'un outil du MCP officiel, avec reprise sur coupure passagère.
async function callOfficial(name, args, timeout = 120000) {
  return retry(async () => {
    const c = await connect();
    const res = await c.callTool({ name, arguments: { studio_id: await studioId(args.placeName), ...args, placeName: undefined } }, undefined, { timeout });
    if (res.isError && TRANSIENT.test(textOf(res))) throw new Error(textOf(res));
    return res;
  });
}

// Renvoie { buffer, ext } de l'image capturée depuis position vers lookAt.
async function capture({ position, lookAt, placeName, id = 'RoForge' }) {
  const res = await callOfficial('screen_capture', { placeName, capture_id: id, camera_position: position, look_at_position: lookAt }, 60000);
  const img = (res.content || []).find((x) => x.type === 'image');
  if (!img) throw new Error(`Capture impossible : ${textOf(res).slice(0, 300) || 'pas d’image renvoyée'}`);
  return { buffer: Buffer.from(img.data, 'base64'), ext: /png/.test(img.mimeType) ? 'png' : 'jpg' };
}

// Maillage texturé par l'IA 3D de Roblox (generate_mesh) : lancé en tâche de fond puis attendu,
// la génération dépasse souvent la minute.
async function generateMesh({ prompt, size, segmentation = 'auto', partNames, maxTriangles, placeName }) {
  const args = { placeName, textPrompt: prompt, async: true, segmentation };
  if (size) args.size = { x: size[0], y: size[1], z: size[2] };
  if (partNames?.length) args.partNames = JSON.stringify(partNames);
  if (maxTriangles) args.maxTriangles = maxTriangles;
  const started = await callOfficial('generate_mesh', args);
  const text = textOf(started);
  const jobId = (text.match(/"jobId"\s*:\s*"([^"]+)"/) || [])[1];
  if (!jobId) throw new Error(`Génération 3D refusée : ${text.slice(0, 300)}`);
  const done = await callOfficial('wait_job_finished', { placeName, jobId, timeout: 600 }, 660000);
  const result = textOf(done);
  if (/"status"\s*:\s*"(Failed|Cancelled)"/i.test(result) || done.isError) throw new Error(`Génération 3D échouée : ${result.slice(0, 400)}`);
  return result;
}

// ---------------------------------------------------------------------------
// Vues autour d'un modèle (bounds renvoyés par le plugin : centre, taille, avant)
// ---------------------------------------------------------------------------
const V = {
  add: (a, b) => a.map((v, i) => v + b[i]),
  sub: (a, b) => a.map((v, i) => v - b[i]),
  mul: (a, k) => a.map((v) => v * k),
  norm: (a) => {
    const l = Math.hypot(...a) || 1;
    return a.map((v) => v / l);
  },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};

const VIEW_NAMES = ['Face', 'Dos', 'Profil gauche', 'Profil droit', '3/4 avant gauche', '3/4 avant droit', '3/4 arrière gauche', '3/4 arrière droit', 'Dessus', 'Dessous'];

function views(bounds, count = 10) {
  const centre = bounds.centre;
  const radius = Math.max(0.5, Math.hypot(...bounds.taille) / 2);
  // Le modèle remplit ~70 % de l'image (champ vertical de 70°).
  const dist = (radius / Math.tan((35 * Math.PI) / 180)) * 1.12;
  let f = V.norm([bounds.avant[0], 0, bounds.avant[2]]);
  if (!Number.isFinite(f[0]) || Math.hypot(...f) < 0.5) f = [0, 0, -1];
  const up = [0, 1, 0];
  const r = V.norm(V.cross(f, up));
  const dir = (vec, elev) => V.norm(V.add(V.norm(vec), V.mul(up, elev)));
  const dirs = [
    dir(f, 0.12), dir(V.mul(f, -1), 0.12), dir(V.mul(r, -1), 0.12), dir(r, 0.12),
    dir(V.sub(f, r), 0.35), dir(V.add(f, r), 0.35), dir(V.sub(V.mul(f, -1), r), 0.35), dir(V.add(V.mul(f, -1), r), 0.35),
    V.norm(V.add(up, V.mul(f, 0.02))), V.norm(V.add(V.mul(up, -1), V.mul(f, 0.35))),
  ].slice(0, count);
  return dirs.map((d, i) => ({ nom: VIEW_NAMES[i], position: V.add(centre, V.mul(d, dist)), lookAt: centre }));
}

// Assemble les images en une planche (grille 5 × 2) avec un titre par vue.
async function composeSheet(images, title) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('about:blank');
    const payload = images.map((im) => ({ src: `data:image/${im.ext === 'png' ? 'png' : 'jpeg'};base64,${im.buffer.toString('base64')}`, label: im.label }));
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      const items = ${JSON.stringify(payload)};
      const imgs = await Promise.all(items.map((it) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = it.src; })));
      const cols = Math.min(5, imgs.length), rows = Math.ceil(imgs.length / cols);
      const cw = 480, ch = Math.round(cw * imgs[0].height / imgs[0].width), head = 56, lab = 30;
      const c = document.createElement('canvas');
      c.width = cols * cw + (cols + 1) * 10; c.height = head + rows * (ch + lab) + (rows + 1) * 10;
      const g = c.getContext('2d');
      g.fillStyle = '#f3f6f2'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#0c1a12'; g.font = 'bold 26px Segoe UI'; g.fillText(${JSON.stringify(title)}, 14, 38);
      imgs.forEach((im, k) => {
        const x = 10 + (k % cols) * (cw + 10), y = head + 10 + Math.floor(k / cols) * (ch + lab + 10);
        g.drawImage(im, x, y + lab, cw, ch);
        g.fillStyle = '#17734a'; g.font = '600 18px Segoe UI'; g.fillText((k + 1) + '. ' + items[k].label, x + 4, y + 22);
      });
      return c.toDataURL('image/png');
    })()`);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  } finally {
    win.destroy();
  }
}

// Planche d'un modèle isolé : send(op, args) parle au plugin (isolate → bounds → captures → unisolate).
async function isolatedSheet({ send, target, outDir, name, placeName, count = 10 }) {
  await send('isolate', { path: target });
  try {
    const bounds = await send('bounds', { path: target });
    // Vue 10 (dessous) : le sol neutre est masqué le temps de la capture.
    return await sheet({ bounds, outDir, name, placeName, count, beforeView: (i) => send('studio_floor', { visible: i !== 9 }) });
  } finally {
    await send('unisolate', { path: target }).catch(() => {});
  }
}

async function sheet({ bounds, outDir, name, placeName, count = 10, beforeView }) {
  fs.mkdirSync(outDir, { recursive: true });
  const safe = String(name).toLowerCase().replace(/[^\w\-]+/g, '-').slice(0, 50) || 'modele';
  const shots = [];
  const all = views(bounds, count);
  // Premier rendu après l'isolement souvent vide ou sans texture : une capture d'échauffement jetée.
  await capture({ position: all[0].position, lookAt: all[0].lookAt, placeName, id: 'RoForge_0' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  for (const [i, v] of all.entries()) {
    if (beforeView) await beforeView(i);
    const img = await capture({ position: v.position, lookAt: v.lookAt, placeName, id: `RoForge_${i + 1}` });
    const file = path.join(outDir, `${safe}-vue${i + 1}.${img.ext}`);
    fs.writeFileSync(file, img.buffer);
    shots.push({ ...img, label: v.nom, file });
  }
  const sheetFile = path.join(outDir, `${safe}-planche.png`);
  fs.writeFileSync(sheetFile, await composeSheet(shots, `${name} — ${shots.length} vues`));
  return { planche: sheetFile, vues: shots.map((s) => ({ nom: s.label, fichier: s.file })) };
}

// Téléverse des images (servies par le pont en http local) sur Roblox : { url: "rbxassetid://…" }.
async function uploadImages(urls, placeName) {
  const res = await callOfficial('upload_image', { placeName, imagePaths: urls }, 180000);
  const text = textOf(res);
  if (res.isError) throw new Error(`Téléversement refusé : ${text.slice(0, 300)}`);
  const map = {};
  for (const m of text.matchAll(/"([^"]+)"\s*:\s*"(rbxassetid:\/\/\d+)"/g)) map[m[1]] = m[2];
  const ids = text.match(/rbxassetid:\/\/\d+/g) || [];
  if (urls.length === 1 && !map[urls[0]] && ids[0]) map[urls[0]] = ids[0];
  return { map, brut: text.slice(0, 500) };
}

// Recadre (cover) et redimensionne une image à la taille exacte voulue (miniature 1920×1080, icône 512×512).
async function fitImage(buffer, width, height) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('about:blank');
    const src = `data:image/png;base64,${buffer.toString('base64')}`;
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      const im = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = ${JSON.stringify(src)}; });
      const c = document.createElement('canvas'); c.width = ${width}; c.height = ${height};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      const k = Math.max(c.width / im.width, c.height / im.height), w = im.width * k, h = im.height * k;
      g.drawImage(im, (c.width - w) / 2, (c.height - h) / 2, w, h);
      return c.toDataURL('image/png');
    })()`);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  } finally {
    win.destroy();
  }
}

module.exports = { capture, sheet, isolatedSheet, views, generateMesh, fitImage, uploadImages };
