// Test des modèles IA et des miniatures sans l'interface (RoForge fermé) : electron scripts/forge-check.js
// Chapeau généré de bout en bout, cheveux déjà générés finis en accessoire, essayage sur un mannequin R6,
// puis une miniature pro par Codex recadrée en 1920×1080.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { Bridge } = require('../src/main/bridge');
const { Store } = require('../src/main/store');
const agents = require('../src/main/agents');
const captures = require('../src/main/captures');
const thumbnails = require('../src/main/thumbnails');

const OUT = path.join(__dirname, 'forge-check');
const log = (...a) => console.log(...a);
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

async function finishAndCheck(bridge, fini, name, accessoire) {
  log(`[fini ${name}]`, JSON.stringify(fini));
  const audit = await bridge.send('audit3d', { path: fini.chemin });
  log(`[audit ${name}]`, JSON.stringify(audit.resume), audit.constats.map((c) => `${c.code}:${c.message}`).join(' | '));
  const sheet = await captures.isolatedSheet({ send: (op, a) => bridge.send(op, a), target: fini.chemin, outDir: OUT, name, placeName: bridge.status().place });
  log(`[planche ${name}]`, sheet.planche);
  const acc = await bridge.send('mesh_accessory', { path: fini.chemin, type: accessoire });
  log(`[accessoire ${name}]`, JSON.stringify(acc));
  return acc;
}

async function meshes(bridge) {
  await bridge.send('run_luau', { code: 'for _, c in workspace:GetChildren() do if c.Name == "TestChapeauPaille" or c.Name == "Mannequin" then c:Destroy() end end local f = game.ReplicatedStorage:FindFirstChild("Accessoires") if f then f:Destroy() end' });
  await bridge.send('mesh_mark', {});
  const t0 = Date.now();
  await captures.generateMesh({
    prompt: 'straw hat with thick red ribbon band, woven straw texture, wide round brim with slightly frayed edges, Roblox avatar hat accessory, stylized anime cartoon style, crisp hand-painted texture, game-ready, no neon, no text',
    size: [3, 1.4, 3], segmentation: 'none', placeName: bridge.status().place,
  });
  log('[génération chapeau]', `${Math.round((Date.now() - t0) / 1000)} s`);
  const hat = await finishAndCheck(bridge, await bridge.send('mesh_finish', { nom: 'ChapeauDePaille', position: [0, 0, 0] }), 'ChapeauDePaille', 'chapeau');
  const hairPath = (await bridge.send('run_luau', { code: 'for _, c in workspace:GetChildren() do if c.Name:find("Spiky messy") then return c:GetFullName() end end return nil' })).returned[0];
  let hair = null;
  if (hairPath) hair = await finishAndCheck(bridge, await bridge.send('mesh_finish', { path: hairPath, nom: 'CheveuxPiques', position: [6, 0, 0] }), 'CheveuxPiques', 'cheveux');
  // Essayage : mannequin R6 avec les accessoires, capturé de trois-quarts.
  const fit = await bridge.send('run_luau', {
    code: `local rig = game:GetService("Players"):CreateHumanoidModelFromDescription(Instance.new("HumanoidDescription"), Enum.HumanoidRigType.R6)
rig.Name = "Mannequin" rig.Parent = workspace rig:PivotTo(CFrame.new(0, 3, 12))
for _, p in rig:GetDescendants() do if p:IsA("BasePart") then p.Anchored = true end end
local hum = rig:FindFirstChildOfClass("Humanoid")
local acc = game.ReplicatedStorage.Accessoires
hum:AddAccessory(acc.ChapeauDePaille:Clone())
local head = rig.Head
return string.format("%f,%f,%f", head.Position.X, head.Position.Y, head.Position.Z)`,
  });
  const head = fit.returned[0].split(',').map(Number);
  const shot = await captures.capture({ position: [head[0] + 4, head[1] + 1.5, head[2] - 5], lookAt: head, placeName: bridge.status().place });
  fs.writeFileSync(path.join(OUT, `essayage-chapeau.${shot.ext}`), shot.buffer);
  if (hair) {
    await bridge.send('run_luau', { code: 'local rig = workspace.Mannequin for _, a in rig:GetChildren() do if a:IsA("Accessory") then a:Destroy() end end local acc = game.ReplicatedStorage.Accessoires.CheveuxPiques:Clone() rig:FindFirstChildOfClass("Humanoid"):AddAccessory(acc) local w = acc.Handle:FindFirstChild("AccessoryWeld") acc.Handle.CFrame = w.Part1.CFrame * w.C1 * w.C0:Inverse()' });
    const shot2 = await captures.capture({ position: [head[0] + 4, head[1] + 1.5, head[2] - 5], lookAt: head, placeName: bridge.status().place });
    fs.writeFileSync(path.join(OUT, `essayage-cheveux.${shot2.ext}`), shot2.buffer);
  }
  log('[essayage]', OUT);
  return { hat, hair };
}

async function thumbnail(store) {
  const project = store.projects()[0];
  const ref = fs.readdirSync(OUT).find((f) => /^chapeaudepaille-vue5\./.test(f));
  const jeu = ref ? [path.join(OUT, ref)] : [];
  const style = thumbnails.styleRefs('action');
  const target = path.join(OUT, 'miniature-test.png');
  const brief = `${thumbnails.brief({
    sujet: 'un héros pirate Roblox blocky portant le chapeau de paille du jeu (image 1), gilet rouge ouvert, short bleu, ceinture jaune, sandales, donne un énorme coup de poing élastique à un noob Roblox (cheveux orange, visage paniqué) qui s’écrase dans le sol fissuré',
    formule: 'action', format: 'miniature', nbJeu: jeu.length, nbStyle: style.length,
  })}\nEnregistre le résultat final exactement ici : ${target} (remplace s’il existe). Réponds seulement avec le chemin du fichier.`;
  const t0 = Date.now();
  const files = await new Promise((resolve, reject) => {
    const run = agents.runCodex({
      store, project, conv: { codexThread: null }, prompt: brief, images: [...jeu, ...style],
      settings: { ...store.settings(), mcp: { roforge: false, officiel: false, chrrxs: false, blender: false } },
      bridgeToken: 'test', runId: `test-${Date.now()}`, runtimeDir: store.paths.RUNTIME_DIR, imageOnly: true,
    });
    let list = [];
    let error = null;
    run.on('images', (l) => (list = l));
    run.on('error', (e) => (error = e));
    run.on('done', () => {
      if (fs.existsSync(target) && !list.includes(target)) list.unshift(target);
      return list.length ? resolve(list) : reject(new Error(error || 'aucune image'));
    });
  });
  log('[codex]', `${Math.round((Date.now() - t0) / 1000)} s`, files);
  const final = path.join(OUT, 'miniature-1920x1080.png');
  fs.writeFileSync(final, await captures.fitImage(fs.readFileSync(files[0]), 1920, 1080));
  log('[miniature]', final);
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const bridge = new Bridge();
  bridge.start();
  try {
    for (let i = 0; i < 60 && !bridge.status().connected; i++) await new Promise((r) => setTimeout(r, 500));
    log('[studio]', JSON.stringify(bridge.status()));
    await new Promise((r) => setTimeout(r, 1500));
    if (only !== 'miniature') await meshes(bridge);
    if (only !== 'modeles') await thumbnail(new Store());
  } catch (err) {
    log('[erreur]', err.stack || err.message);
  }
  bridge.stop();
  app.quit();
});
