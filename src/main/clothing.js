// Vêtements de personnage R6/R15 classiques : textures plates (torse avant / dos, bras, jambes) générées à part,
// puis assemblées dans le gabarit officiel Roblox 585 × 559 (Shirt / Pants).
const fs = require('fs');
const { BrowserWindow } = require('electron');

// Gabarit Roblox (Shirt et Pants ont la même disposition) : [x, y, largeur, hauteur].
const TORSO = { F: [231, 74, 128, 128], B: [427, 74, 128, 128], L: [165, 74, 64, 128], R: [361, 74, 64, 128], U: [231, 8, 128, 64], D: [231, 204, 128, 64] };
const RIGHT = { U: [217, 289, 64, 64], D: [217, 485, 64, 64], F: [217, 355, 64, 128], L: [19, 355, 64, 128], B: [85, 355, 64, 128], R: [151, 355, 64, 128] };
const LEFT = { U: [308, 289, 64, 64], D: [308, 485, 64, 64], F: [308, 355, 64, 128], L: [374, 355, 64, 128], B: [440, 355, 64, 128], R: [506, 355, 64, 128] };

const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

// parts : { avant, dos, membre } (chemins PNG) ; renvoie le PNG du gabarit.
async function composeTemplate(parts) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('about:blank');
    const input = {
      avant: dataUrl(parts.avant), dos: dataUrl(parts.dos || parts.avant), membre: dataUrl(parts.membre || parts.avant),
      TORSO, RIGHT, LEFT,
    };
    const png = await win.webContents.executeJavaScript(`(async (I) => {
      const load = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
      const [front, back, limb] = await Promise.all([load(I.avant), load(I.dos), load(I.membre)]);
      const c = document.createElement('canvas'); c.width = 585; c.height = 559;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      // Image recadrée (cover) dans un rectangle ; sx/sw : bande horizontale de la source (0..1).
      const put = (im, [x, y, w, h], sx = 0, sw = 1, flip = false) => {
        const srcW = im.width * sw, k = Math.max(w / srcW, h / im.height);
        const cw = w / k, ch = h / k;
        const ox = im.width * sx + (srcW - cw) / 2, oy = (im.height - ch) / 2;
        g.save();
        if (flip) { g.translate(x + w, y); g.scale(-1, 1); g.drawImage(im, ox, oy, cw, ch, 0, 0, w, h); }
        else g.drawImage(im, ox, oy, cw, ch, x, y, w, h);
        g.restore();
      };
      // Dessus / dessous : une ligne de bord étirée (raccord de couleur sans motif déformé).
      const edgeRow = (im, [x, y, w, h], top) => g.drawImage(im, 0, top ? 2 : im.height - 3, im.width, 1, x, y, w, h);
      const T = I.TORSO;
      put(front, T.F); put(back, T.B);
      put(front, T.L, 0, 0.22); put(front, T.R, 0.78, 0.22);
      edgeRow(front, T.U, true); edgeRow(front, T.D, false);
      for (const [side, flip] of [[I.RIGHT, false], [I.LEFT, true]]) {
        put(limb, side.F, 0, 1, flip); put(limb, side.B, 0, 1, !flip);
        put(limb, side.L, 0, 1, flip); put(limb, side.R, 0, 1, flip);
        edgeRow(limb, side.U, true); edgeRow(limb, side.D, false);
      }
      return c.toDataURL('image/png');
    })(${JSON.stringify(input)})`);
    return Buffer.from(png.split(',')[1], 'base64');
  } finally {
    win.destroy();
  }
}

// Consigne commune pour une texture plate de vêtement / peau.
function textureBrief(what, desc, style, portrait) {
  return `Génère UNE texture PLATE de vêtement pour un personnage Roblox blocky, avec ton outil de génération d’images (${portrait ? '1024×1536, portrait' : '1024×1024'}).
Partie : ${what}.
Contenu : ${desc}
Règles impératives : vue orthographique parfaitement de face, À PLAT comme une texture de jeu ; le motif remplit TOUT le cadre bord à bord (aucune marge, aucun fond, aucun contour de silhouette, aucun personnage, aucune tête, aucune main, aucune perspective, aucune ombre portée, aucun texte).
Style : ${style}. Traits nets, ombrages dessinés (cel-shading) qui donnent du volume (muscles, plis du tissu, coutures, déchirures), couleurs franches mais harmonieuses, qualité des meilleurs jeux anime Roblox. Jamais de néon.
Fond plein (pas de transparence).`;
}

module.exports = { composeTemplate, textureBrief, TORSO, RIGHT, LEFT };
