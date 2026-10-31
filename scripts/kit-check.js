// Test du kit 3D sans l'interface (RoForge fermé) : electron scripts/kit-check.js
// Ambiance, petite scène de marché avec kit_piece, audit 3D, planche 10 vues et capture de scène.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { Bridge } = require('../src/main/bridge');
const captures = require('../src/main/captures');

const OUT = path.join(__dirname, 'kit-check');

app.whenReady().then(async () => {
  const bridge = new Bridge();
  bridge.start();
  const log = (...a) => console.log(...a);
  try {
    for (let i = 0; i < 60 && !bridge.status().connected; i++) await new Promise((r) => setTimeout(r, 500));
    log('[studio]', JSON.stringify(bridge.status()));
    await new Promise((r) => setTimeout(r, 1500)); // laisse le plugin charger le nouveau cœur
    log('[sauvegarde]', await bridge.send('snapshot', { label: 'avant test kit' }));
    log('[ambiance]', await bridge.send('ambiance', { preset: 'simulator' }));
    const folder = await bridge.send('run_luau', { code: 'local f = workspace:FindFirstChild("MarcheTest") if f then f:Destroy() end f = Instance.new("Folder") f.Name = "MarcheTest" f.Parent = workspace return f' });
    log('[dossier]', JSON.stringify(folder.returned));
    const pieces = [
      { type: 'etal', position: [0, 0, -18], nom: 'Etal', options: { longueur: 9 } },
      { type: 'panneau', position: [-7, 0, -15], rotation: 20, options: { texte: 'Fruits frais' } },
      { type: 'lanterne', position: [5.5, 0, -14] },
      { type: 'lampadaire', position: [-10, 0, -22] },
      { type: 'arbre', position: [12, 0, -24] },
      { type: 'buisson', position: [8, 0, -19] },
      { type: 'rocher', position: [-13, 0, -14] },
      { type: 'tonneau', position: [6.5, 0, -21] },
      { type: 'caisse', position: [-5.5, 0, -20], rotation: 15 },
      { type: 'banc', position: [0, 0, -9], rotation: 180 },
      { type: 'barriere', position: [0, 0, -27] },
    ];
    for (const p of pieces) {
      const r = await bridge.send('kit_piece', { ...p, style: 'simulator', parent: 'Workspace.MarcheTest' });
      log(`[kit] ${p.type} -> ${r.chemin} (${r.pieces} pièces)`);
    }
    const audit = await bridge.send('audit3d', { path: 'Workspace.MarcheTest.Etal' });
    log('[audit Etal]', JSON.stringify(audit.resume), audit.constats.map((c) => `${c.code}:${c.message}`).join(' | '), 'palette', audit.stats.couleurs, 'pièces', audit.stats.pieces);
    const auditAll = await bridge.send('audit3d', { path: 'Workspace.MarcheTest' });
    log('[audit scène]', JSON.stringify(auditAll.resume), auditAll.constats.map((c) => `${c.code}:${c.message}`).join(' | '));
    for (const c of auditAll.constats) if (['A1', 'B2', 'S1', 'NEON'].includes(c.code)) log(`[détail ${c.code}]`, c.instances.slice(0, 10).join(' ; '));
    const vfx = await bridge.send('kit_vfx', { type: 'fumee', cible: 'Workspace.MarcheTest.Lampadaire' });
    log('[vfx]', vfx.attachment);
    const traced = async (op, a) => {
      log(`[→ ${op}]`);
      const r = await bridge.send(op, a);
      log(`[← ${op}]`, JSON.stringify(r).slice(0, 160));
      return r;
    };
    app.on('window-all-closed', () => log('[fenêtres fermées]'));
    const sheet = await captures.isolatedSheet({ send: traced, target: 'Workspace.MarcheTest.Etal', outDir: OUT, name: 'Etal', placeName: bridge.status().place });
    log('[planche]', sheet.planche);
    const scene = await captures.capture({ position: [22, 14, 4], lookAt: [0, 3, -18], placeName: bridge.status().place });
    fs.writeFileSync(path.join(OUT, `scene.${scene.ext}`), scene.buffer);
    log('[scène]', path.join(OUT, `scene.${scene.ext}`));
  } catch (err) {
    log('[erreur]', err.message);
  }
  bridge.stop();
  app.quit();
});
