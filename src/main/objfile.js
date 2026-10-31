// Lecture d'un OBJ exporté par Blender (axes Roblox : Y en haut, 1 unité = 1 stud) pour l'import dans Studio :
// sommets, UV, triangles (polygones découpés en éventail), couleur par face depuis le Kd du .mtl, texture map_Kd.
const fs = require('fs');
const path = require('path');

function readMtl(file) {
  const mats = {};
  let cur = null;
  if (!fs.existsSync(file)) return mats;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === 'newmtl') mats[(cur = r.join(' '))] = {};
    else if (cur && k === 'Kd') mats[cur].kd = r.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, Number(v))) ** (1 / 2.2) * 255));
    else if (cur && k === 'map_Kd') mats[cur].texture = path.resolve(path.dirname(file), r.join(' '));
  }
  return mats;
}

function readObj(file) {
  const text = fs.readFileSync(file, 'utf8');
  const v = [], uv = [], f = [], fuv = [], fc = [];
  const colors = [], colorIndex = new Map();
  let mats = {}, mat = null, texture = null;
  for (const line of text.split(/\r?\n/)) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === 'v') v.push(+r[0], +r[1], +r[2]);
    else if (k === 'vt') uv.push(+r[0], +r[1]);
    else if (k === 'mtllib') mats = { ...mats, ...readMtl(path.resolve(path.dirname(file), r.join(' '))) };
    else if (k === 'usemtl') {
      mat = mats[r.join(' ')] || null;
      if (mat?.texture && !texture && fs.existsSync(mat.texture)) texture = mat.texture;
    } else if (k === 'f') {
      const idx = r.map((p) => p.split('/').map((n) => parseInt(n, 10)));
      const vi = idx.map((p) => (p[0] < 0 ? v.length / 3 + p[0] + 1 : p[0]));
      const ti = idx.map((p) => (p[1] ? (p[1] < 0 ? uv.length / 2 + p[1] + 1 : p[1]) : 0));
      let ci = 0;
      if (mat?.kd) {
        const key = mat.kd.join(',');
        if (!colorIndex.has(key)) { colors.push(mat.kd); colorIndex.set(key, colors.length); }
        ci = colorIndex.get(key);
      }
      for (let j = 1; j < vi.length - 1; j++) {
        f.push(vi[0], vi[j], vi[j + 1]);
        fuv.push(ti[0], ti[j], ti[j + 1]);
        fc.push(ci);
      }
    }
  }
  const round = (a) => a.map((n) => Math.round(n * 10000) / 10000);
  return { v: round(v), uv: round(uv), f, fuv: uv.length ? fuv : undefined, fc: colors.length ? fc : undefined, couleurs: colors, texture, triangles: f.length / 3 };
}

// Accepte un .obj, un .zip (téléchargement Claude Design) ou un dossier : renvoie le .obj le plus gros.
function resolveObj(input, extractDir) {
  let dir = input;
  if (/\.zip$/i.test(input)) {
    fs.mkdirSync(extractDir, { recursive: true });
    const r = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${input.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`], { windowsHide: true });
    if (r.status !== 0) throw new Error(`ZIP illisible : ${String(r.stderr || '').slice(0, 300)}`);
    dir = extractDir;
  } else if (!fs.statSync(input).isDirectory()) return input;
  const objs = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.obj$/i.test(e.name)) objs.push({ full, size: fs.statSync(full).size });
    }
  };
  walk(dir);
  if (!objs.length) throw new Error('Aucun .obj dans le ZIP / dossier : demande à Claude Design un export OBJ + MTL.');
  return objs.sort((a, b) => b.size - a.size)[0].full;
}

module.exports = { readObj, resolveObj };
