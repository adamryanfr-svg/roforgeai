// Comparaison MESURÉE d'un rendu à une image de référence (même principe qu'un contrôle qualité visuel) :
// silhouette (recouvrement des masques), structure (contours), palette (couleurs dominantes), zones (grille 6 × 6),
// et une planche 4 panneaux : référence | rendu | contours de la référence sur le rendu | carte des zones.
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

// Code exécuté dans une fenêtre hors écran (canvas). Reçoit { ref, shots: [dataUrl], grid }.
const PAGE = String.raw`(async (input) => {
  const N = 256, G = input.grid || 6;
  const load = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
  const lab = (r, g, b) => {
    const f = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
    const R = f(r), Gg = f(g), B = f(b);
    let x = (R * 0.4124 + Gg * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + Gg * 0.7152 + B * 0.0722, z = (R * 0.0193 + Gg * 0.1192 + B * 0.9505) / 1.08883;
    const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    x = t(x); y = t(y); z = t(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Fond = régions reliées aux bords : couleurs proches des couleurs de bord (plusieurs teintes : ciel, sol)
  // ou qui varient doucement de proche en proche (dégradés). Le reste est le sujet.
  function segment(d, x0, y0, x1, y1) {
    const labs = new Array(N * N);
    for (let i = 0; i < N * N; i++) labs[i] = lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const border = [];
    for (let x = x0; x <= x1; x++) border.push(y0 * N + x, y1 * N + x);
    for (let y = y0; y <= y1; y++) border.push(y * N + x0, y * N + x1);
    let cs = [0, 0.25, 0.5, 0.75].map((f) => labs[border[Math.floor(f * border.length)]]);
    for (let it = 0; it < 6; it++) {
      const acc = cs.map(() => [0, 0, 0, 0]);
      for (const i of border) { const v = labs[i]; let b = 0, bd = 1e9; cs.forEach((c, j) => { const dd = dist(v, c); if (dd < bd) { bd = dd; b = j; } }); acc[b][0] += v[0]; acc[b][1] += v[1]; acc[b][2] += v[2]; acc[b][3]++; }
      cs = acc.map((a, j) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cs[j]));
    }
    const bg = new Uint8Array(N * N), queue = [];
    for (const i of border) if (!bg[i]) { bg[i] = 1; queue.push(i); }
    while (queue.length) {
      const i = queue.pop(), x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < x0 || yy < y0 || xx > x1 || yy > y1) continue;
        const j = yy * N + xx;
        if (bg[j]) continue;
        const near = dist(labs[j], labs[i]) < 4.5;
        const known = Math.min(...cs.map((c) => dist(labs[j], c))) < 10;
        if (near || known) { bg[j] = 1; queue.push(j); }
      }
    }
    const raw = new Uint8Array(N * N);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) raw[y * N + x] = bg[y * N + x] ? 0 : 1;
    return { mask: mainParts(raw, x0, y0, x1, y1), labs, bgColor: cs[0] };
  }

  // Garde le sujet : la plus grosse tache et celles assez grosses qui ne touchent pas les bords (décor coupé).
  function mainParts(raw, x0, y0, x1, y1) {
    const comp = new Int32Array(N * N).fill(-1), info = [];
    for (let i = 0; i < N * N; i++) if (raw[i] && comp[i] < 0) {
      const id = info.length, st = [i]; comp[i] = id; let area = 0, edge = false, cxs = 0;
      while (st.length) {
        const k = st.pop(), x = k % N, y = (k / N) | 0; area++; cxs += Math.abs(x - N / 2) + Math.abs(y - N / 2);
        if (x <= x0 + 1 || y <= y0 + 1 || x >= x1 - 1 || y >= y1 - 1) edge = true;
        for (const j of [k + 1, k - 1, k + N, k - N]) if (j >= 0 && j < N * N && raw[j] && comp[j] < 0 && Math.abs((j % N) - x) <= 1) { comp[j] = id; st.push(j); }
      }
      info.push({ area, edge, centre: cxs / area });
    }
    if (!info.length) return raw;
    // Tache principale : grande et proche du centre.
    let main = 0;
    info.forEach((c, j) => { if (c.area / (1 + c.centre / N) > info[main].area / (1 + info[main].centre / N)) main = j; });
    const keep = info.map((c, j) => j === main || (!c.edge && c.area > info[main].area * 0.02));
    const mask = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) if (comp[i] >= 0 && keep[comp[i]]) mask[i] = 1;
    return mask;
  }

  // Analyse d'une image : masque du sujet (fond estimé sur les bords), recadrage sur le sujet, contours, couleurs.
  function analyse(img) {
    const c0 = document.createElement('canvas'); c0.width = N; c0.height = N;
    const g0 = c0.getContext('2d');
    const k0 = Math.min(N / img.width, N / img.height);
    g0.drawImage(img, (N - img.width * k0) / 2, (N - img.height * k0) / 2, img.width * k0, img.height * k0);
    const alpha = g0.getImageData(0, 0, N, N).data;
    const ox = Math.round((N - img.width * k0) / 2), oy = Math.round((N - img.height * k0) / 2);
    let transparent = 0, total = 0;
    for (let y = oy + 1; y < N - oy - 1; y++) for (let x = ox + 1; x < N - ox - 1; x++) { total++; if (alpha[(y * N + x) * 4 + 3] < 200) transparent++; }
    const hasAlpha = transparent > total * 0.05 && transparent < total * 0.97;
    if (!hasAlpha) for (let i = 3; i < alpha.length; i += 4) alpha[i] = 255;
    // Image détourée (PNG transparent) : le canal alpha donne le sujet exact, posé sur un gris neutre.
    g0.globalCompositeOperation = 'destination-over'; g0.fillStyle = hasAlpha ? '#d4d8d4' : '#808080'; g0.fillRect(0, 0, N, N); g0.globalCompositeOperation = 'source-over';
    let d = g0.getImageData(0, 0, N, N).data;
    const mask0 = hasAlpha ? (() => { const m = new Uint8Array(N * N); for (let i = 0; i < N * N; i++) m[i] = alpha[i * 4 + 3] >= 128 ? 1 : 0; return m; })() : segment(d, ox + 1, oy + 1, N - ox - 2, N - oy - 2).mask;
    let minX = N, minY = N, maxX = 0, maxY = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (mask0[y * N + x]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const med = [0, 0, 0];
    { const p = ((oy + 1) * N + ox + 1) * 4; med[0] = d[p]; med[1] = d[p + 1]; med[2] = d[p + 2]; }
    if (maxX <= minX || maxY <= minY) { minX = 0; minY = 0; maxX = N - 1; maxY = N - 1; }
    // Recadrage carré centré sur le sujet (normalise position et taille).
    const side = Math.max(maxX - minX, maxY - minY) * 1.08 + 2;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d');
    g.fillStyle = 'rgb(' + med.join(',') + ')'; g.fillRect(0, 0, N, N);
    g.drawImage(c0, cx - side / 2, cy - side / 2, side, side, 0, 0, N, N);
    d = g.getImageData(0, 0, N, N).data;
    // Masque recalculé sur l'image recadrée, en ne gardant que ce qui était sujet avant recadrage.
    const seg = segment(d, 0, 0, N - 1, N - 1);
    const labs = seg.labs, L = new Float32Array(N * N);
    // Sujet après recadrage : le masque d'avant transporté (alpha ou segmentation), croisé avec la segmentation.
    const mask = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sx = Math.round(cx - side / 2 + (x * side) / N), sy = Math.round(cy - side / 2 + (y * side) / N);
      const m0 = sx >= 0 && sy >= 0 && sx < N && sy < N ? mask0[sy * N + sx] : 0;
      mask[y * N + x] = hasAlpha ? m0 : m0 & seg.mask[y * N + x];
    }
    for (let i = 0; i < N * N; i++) L[i] = labs[i][0];
    // Contours (Sobel sur la luminance), seuil relatif.
    const edge = new Float32Array(N * N); let emax = 1;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const a = (yy, xx) => L[(y + yy) * N + x + xx];
      const gx = a(-1, 1) + 2 * a(0, 1) + a(1, 1) - a(-1, -1) - 2 * a(0, -1) - a(1, -1);
      const gy = a(1, -1) + 2 * a(1, 0) + a(1, 1) - a(-1, -1) - 2 * a(-1, 0) - a(-1, 1);
      const m = Math.hypot(gx, gy); edge[y * N + x] = m; if (m > emax) emax = m;
    }
    const sorted = Array.from(edge).filter((v, i) => mask[i]).sort((a, b) => a - b);
    const thr = Math.max(emax * 0.12, sorted[Math.floor(sorted.length * 0.8)] || 0);
    const edges = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) edges[i] = edge[i] >= thr ? 1 : 0;
    return { canvas: c, mask, labs, edges };
  }

  const dilate = (m, r) => {
    const o = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x])
      for (let yy = Math.max(0, y - r); yy <= Math.min(N - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(N - 1, x + r); xx++) o[yy * N + xx] = 1;
    return o;
  };
  // Couleurs dominantes du sujet (k-moyennes en Lab).
  function palette(a, k = 6) {
    const pts = []; for (let i = 0; i < N * N; i += 3) if (a.mask[i]) pts.push(a.labs[i]);
    if (!pts.length) return [];
    let cs = Array.from({ length: k }, (_, j) => pts[Math.floor((j + 0.5) * pts.length / k)]);
    for (let it = 0; it < 8; it++) {
      const acc = cs.map(() => [0, 0, 0, 0]);
      for (const p of pts) { let b = 0, bd = 1e9; cs.forEach((c, j) => { const dd = dist(p, c); if (dd < bd) { bd = dd; b = j; } }); acc[b][0] += p[0]; acc[b][1] += p[1]; acc[b][2] += p[2]; acc[b][3]++; }
      cs = acc.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cs[j]));
      cs.w = acc.map((s) => s[3] / pts.length);
    }
    return cs.map((c, j) => ({ c, w: cs.w ? cs.w[j] : 1 / k }));
  }

  function score(R, S) {
    let inter = 0, uni = 0;
    for (let i = 0; i < N * N; i++) { inter += R.mask[i] & S.mask[i]; uni += R.mask[i] | S.mask[i]; }
    const silhouette = uni ? (100 * inter) / uni : 0;
    const Rd = dilate(R.edges, 3), Sd = dilate(S.edges, 3);
    let tpS = 0, nS = 0, tpR = 0, nR = 0;
    for (let i = 0; i < N * N; i++) { if (S.edges[i]) { nS++; tpS += Rd[i]; } if (R.edges[i]) { nR++; tpR += Sd[i]; } }
    const prec = nS ? tpS / nS : 0, rec = nR ? tpR / nR : 0;
    const structure = prec + rec ? (200 * prec * rec) / (prec + rec) : 0;
    const pR = palette(R), pS = palette(S);
    let pd = 0; for (const a of pR) pd += a.w * Math.min(...pS.map((b) => dist(a.c, b.c)));
    let pd2 = 0; for (const b of pS) pd2 += b.w * Math.min(...pR.map((a) => dist(a.c, b.c)));
    const palette_ = Math.max(0, 100 - ((pd + pd2) / 2) * 2.2);
    // Zones : couverture, couleur moyenne et densité de détails par case.
    const cell = N / G, zones = [];
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      let mr = 0, ms = 0, er = 0, es = 0; const cr = [0, 0, 0], cS = [0, 0, 0];
      for (let y = Math.floor(gy * cell); y < (gy + 1) * cell; y++) for (let x = Math.floor(gx * cell); x < (gx + 1) * cell; x++) {
        const i = y * N + x;
        if (R.mask[i]) { mr++; er += R.edges[i]; cr[0] += R.labs[i][0]; cr[1] += R.labs[i][1]; cr[2] += R.labs[i][2]; }
        if (S.mask[i]) { ms++; es += S.edges[i]; cS[0] += S.labs[i][0]; cS[1] += S.labs[i][1]; cS[2] += S.labs[i][2]; }
      }
      const area = cell * cell;
      if (mr < area * 0.04 && ms < area * 0.04) { zones.push(null); continue; }
      const cov = 100 * (1 - Math.abs(mr - ms) / Math.max(mr, ms, 1));
      const col = mr && ms ? Math.max(0, 100 - dist(cr.map((v) => v / mr), cS.map((v) => v / ms)) * 2.5) : 0;
      const dr = mr ? er / mr : 0, ds = ms ? es / ms : 0;
      const det = 100 * (1 - Math.abs(dr - ds) / Math.max(dr, ds, 0.02));
      const s = 0.4 * cov + 0.35 * col + 0.25 * det;
      const why = [];
      if (cov < 55) why.push(ms < mr ? 'forme manquante ou trop petite' : 'forme en trop ou trop grosse');
      if (col < 55) {
        const a = cr.map((v) => v / Math.max(mr, 1)), b = cS.map((v) => v / Math.max(ms, 1));
        why.push(b[0] > a[0] + 8 ? 'couleur trop claire' : b[0] < a[0] - 8 ? 'couleur trop sombre' : 'teinte différente');
      }
      if (det < 50) why.push(ds < dr ? 'pas assez de détails' : 'trop de détails / bruit');
      zones.push({ x: gx, y: gy, s: Math.round(s), why });
    }
    const valid = zones.filter(Boolean);
    const zonesScore = valid.length ? valid.reduce((a, z) => a + z.s, 0) / valid.length : 0;
    const global = 0.3 * silhouette + 0.25 * structure + 0.25 * zonesScore + 0.2 * palette_;
    return { global: Math.round(global), zones: Math.round(zonesScore), structure: Math.round(structure), palette: Math.round(palette_), silhouette: Math.round(silhouette), grid: zones };
  }

  const R = analyse(await load(input.ref));
  const results = [];
  for (const [i, src] of input.shots.entries()) {
    const S = analyse(await load(src));
    results.push({ i, S, sc: score(R, S) });
  }
  results.sort((a, b) => b.sc.global - a.sc.global);
  const best = results[0];
  // Planche 4 panneaux.
  const P = 384, pad = 12, head = 44;
  const out = document.createElement('canvas'); out.width = P * 2 + pad * 3; out.height = head + P * 2 + pad * 3;
  const g = out.getContext('2d');
  g.fillStyle = '#f3f6f2'; g.fillRect(0, 0, out.width, out.height);
  const sc = best.sc;
  g.fillStyle = '#0c1a12'; g.font = '600 15px Segoe UI';
  g.fillText('Comparaison mesurée — global ' + sc.global + '/100 (zones ' + sc.zones + ', structure ' + sc.structure + ', palette ' + sc.palette + ', silhouette ' + sc.silhouette + ')' + (input.before != null ? ' — avant ' + input.before + '/100' : ''), pad, 28);
  const at = (k) => [pad + (k % 2) * (P + pad), head + pad + Math.floor(k / 2) * (P + pad)];
  const frame = (k) => { const [x, y] = at(k); g.strokeStyle = '#0c1a12'; g.lineWidth = 3; g.strokeRect(x, y, P, P); };
  let [x, y] = at(0); g.drawImage(R.canvas, x, y, P, P); frame(0);
  [x, y] = at(1); g.drawImage(best.S.canvas, x, y, P, P); frame(1);
  [x, y] = at(2); g.drawImage(best.S.canvas, x, y, P, P);
  const ov = document.createElement('canvas'); ov.width = N; ov.height = N; const og = ov.getContext('2d'); const od = og.createImageData(N, N);
  for (let i = 0; i < N * N; i++) if (R.edges[i]) { od.data[i * 4] = 230; od.data[i * 4 + 1] = 40; od.data[i * 4 + 2] = 220; od.data[i * 4 + 3] = 255; }
  og.putImageData(od, 0, 0); g.drawImage(ov, x, y, P, P); frame(2);
  [x, y] = at(3); g.drawImage(best.S.canvas, x, y, P, P);
  const cs = P / G;
  sc.grid.forEach((z, k) => {
    const gx = k % G, gy = Math.floor(k / G);
    g.fillStyle = !z ? 'rgba(90,90,90,0.55)' : z.s >= 70 ? 'rgba(40,170,80,0.45)' : z.s >= 50 ? 'rgba(220,170,40,0.45)' : 'rgba(225,40,70,0.5)';
    g.fillRect(x + gx * cs, y + gy * cs, cs, cs);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.strokeRect(x + gx * cs, y + gy * cs, cs, cs);
  });
  frame(3);
  const names = ['haut', 'haut', 'milieu-haut', 'milieu-bas', 'bas', 'bas'];
  const cols = ['gauche', 'gauche', 'centre-gauche', 'centre-droit', 'droite', 'droite'];
  const pire = sc.grid.filter((z) => z && z.s < 55).sort((a, b) => a.s - b.s).slice(0, 8).map((z) => ({
    zone: (names[Math.floor(z.y * 6 / G)] || 'bas') + ' ' + (cols[Math.floor(z.x * 6 / G)] || 'droite') + ' (case ' + (z.x + 1) + ',' + (z.y + 1) + ')',
    score: z.s, probleme: z.why.join(', ') || 'écart général',
  }));
  return { png: out.toDataURL('image/png'), best: best.i, scores: { global: sc.global, zones: sc.zones, structure: sc.structure, palette: sc.palette, silhouette: sc.silhouette }, all: results.map((r) => ({ vue: r.i, global: r.sc.global })), pire };
})`;

const toDataUrl = (file) => `data:image/${/\.png$/i.test(file) ? 'png' : /\.webp$/i.test(file) ? 'webp' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;

// reference : chemin de l'image ; shots : chemins des vues du modèle (la meilleure est retenue).
async function measure({ reference, shots, outFile, before }) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('about:blank');
    const input = { ref: toDataUrl(reference), shots: shots.map(toDataUrl), grid: 6, before };
    const r = await win.webContents.executeJavaScript(`${PAGE}(${JSON.stringify(input)})`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, Buffer.from(r.png.split(',')[1], 'base64'));
    return { planche: outFile, vue_retenue: shots[r.best], scores: r.scores, par_vue: r.all.map((a) => ({ vue: path.basename(shots[a.vue]), global: a.global })), zones_faibles: r.pire };
  } finally {
    win.destroy();
  }
}

module.exports = { measure };
