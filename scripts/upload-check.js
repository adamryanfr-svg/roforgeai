// Test du téléversement automatique d'une image de GUI (RoForge fermé) : electron scripts/upload-check.js <image.png>
// Publie l'image sur le pont, la téléverse via le MCP officiel, la pose sur un ImageLabel de test puis le retire.
const { app } = require('electron');
const { Bridge } = require('../src/main/bridge');
const captures = require('../src/main/captures');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const bridge = new Bridge();
  bridge.start();
  try {
    const ok = await bridge.waitConnected(30000);
    console.log('[studio]', ok, JSON.stringify(bridge.status()));
    const url = bridge.publishFile(process.argv[process.argv.length - 1]);
    const { map, brut } = await captures.uploadImages([url], bridge.status().place);
    console.log('[asset]', map[url] || 'aucun', brut.slice(0, 200));
    if (map[url]) {
      const r = await bridge.send('run_luau', { code: `local g = Instance.new("ScreenGui") g.Name = "RoForgeTestUpload" local i = Instance.new("ImageLabel") i.Size = UDim2.fromOffset(200, 200) i.Image = "${map[url]}" i.Parent = g g.Parent = game.StarterGui task.wait(1) local s = i.Image g:Destroy() return s` });
      console.log('[pose]', JSON.stringify(r.returned));
    }
  } catch (err) {
    console.log('[erreur]', err.message);
  }
  bridge.stop();
  app.quit();
});
