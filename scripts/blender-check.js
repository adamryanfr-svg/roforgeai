// Test de l'import Blender → Studio (RoForge fermé) : electron scripts/blender-check.js <fichier.obj>
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { Bridge } = require('../src/main/bridge');
const captures = require('../src/main/captures');
const { readObj } = require('../src/main/objfile');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const bridge = new Bridge();
  bridge.start();
  try {
    console.log('[studio]', await bridge.waitConnected(30000));
    await new Promise((r) => setTimeout(r, 1500));
    const mesh = readObj(process.argv[process.argv.length - 1]);
    console.log('[obj]', mesh.triangles, 'triangles', mesh.couleurs.length, 'couleurs');
    const r = await bridge.send('mesh_import', { ...mesh, nom: 'CoffreBlender', position: [0, 0, -10] }, 180000);
    console.log('[import]', JSON.stringify(r));
    const audit = await bridge.send('audit3d', { path: r.chemin });
    console.log('[audit]', JSON.stringify(audit.resume), (audit.constats || []).map((c) => c.code + ':' + c.message).join(' | '));
    const out = path.join(__dirname, 'blender-check');
    const sheet = await captures.isolatedSheet({ send: (op, a) => bridge.send(op, a), target: r.chemin, outDir: out, name: 'CoffreBlender', placeName: bridge.status().place, count: 6 });
    console.log('[planche]', sheet.planche);
  } catch (e) { console.log('[erreur]', e.message); }
  bridge.stop();
  app.quit();
});
