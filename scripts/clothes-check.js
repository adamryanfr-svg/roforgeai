// Test des vêtements de personnage (RoForge fermé) : electron scripts/clothes-check.js <reference>
// Rig R6 « BarbeBlanche » → 6 textures Codex en parallèle → gabarits Shirt / Pants → téléversement → habillage,
// puis comparaison mesurée à la référence.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { Bridge } = require('../src/main/bridge');
const { Store } = require('../src/main/store');
const agents = require('../src/main/agents');
const captures = require('../src/main/captures');
const clothing = require('../src/main/clothing');
const { measure } = require('../src/main/compare');

const OUT = path.join(__dirname, 'clothes-check');
const ST = 'anime cel-shading comme les jeux anime Roblox du top (Blox Fruits, Grand Piece Online)';

function codexImage(store, project, brief, refs, file) {
  return new Promise((resolve, reject) => {
    const run = agents.runCodex({
      store, project, conv: { codexThread: null }, prompt: `${brief}\nImages jointes = le personnage de référence : reprends exactement les motifs et couleurs de CETTE partie.\nEnregistre le résultat final exactement ici : ${file} (remplace s’il existe). Réponds seulement avec le chemin du fichier.`,
      images: refs, settings: { ...store.settings(), mcp: { roforge: false, officiel: false, chrrxs: false, blender: false } },
      bridgeToken: 'test', runId: `t-${Date.now()}-${Math.random()}`, runtimeDir: store.paths.RUNTIME_DIR, imageOnly: true,
    });
    let list = [];
    run.on('images', (l) => (list = l));
    run.on('done', () => (fs.existsSync(file) ? resolve(file) : list[0] ? resolve(list[0]) : reject(new Error('pas d’image'))));
  });
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ref = process.argv[process.argv.length - 1];
  const bridge = new Bridge();
  bridge.start();
  const store = new Store();
  const project = store.projects()[0];
  try {
    console.log('[studio]', await bridge.waitConnected(30000));
    await new Promise((r) => setTimeout(r, 1500));
    await bridge.send('run_luau', { code: `local old = workspace:FindFirstChild("BarbeBlanche") if old then old:Destroy() end
local d = Instance.new("HumanoidDescription")
local rig = game:GetService("Players"):CreateHumanoidModelFromDescription(d, Enum.HumanoidRigType.R6)
rig.Name = "BarbeBlanche" rig.Parent = workspace rig:PivotTo(CFrame.new(0, 3, -20))
for _, p in rig:GetDescendants() do if p:IsA("BasePart") then p.Anchored = true end end
for _, c in rig:GetChildren() do if c:IsA("Shirt") or c:IsA("Pants") or c:IsA("ShirtGraphic") then c:Destroy() end end
return rig:GetFullName()` });
    const t0 = Date.now();
    const parts = {
      avant: [clothing.textureBrief('TORSE vu de FACE (poitrine et ventre)', 'torse nu très musclé, pectoraux et abdominaux dessinés avec traits noirs, grande cicatrice en croix sur la poitrine et plusieurs cicatrices, peau bronzée #C99266', ST), 'torse-avant.png'],
      dos: [clothing.textureBrief('TORSE vu de DOS', 'dos nu très musclé, omoplates et muscles dorsaux dessinés, quelques cicatrices, peau bronzée #C99266', ST), 'torse-dos.png'],
      bras: [clothing.textureBrief('UN BRAS vu de face (de l’épaule au poignet, la main n’est PAS incluse)', 'bras nu énorme et musclé, biceps et veines dessinés, cicatrices fines, peau bronzée #C99266', ST, true), 'bras.png'],
      taille: [clothing.textureBrief('BASSIN vu de face (ceinture / taille du pantalon)', 'large écharpe-ceinture noire nouée sur un pantalon kaki #8E9A6A', ST), 'bassin.png'],
      jambes: [clothing.textureBrief('UNE JAMBE vue de face (de la hanche à la cheville, chaussure / botte en bas incluse si demandée)', 'pantalon ample kaki #8E9A6A avec plis et ombrages dessinés, bas du pantalon rentré dans une grande botte noire brillante sur le tiers inférieur', ST, true), 'jambe.png'],
    };
    const files = {};
    await Promise.all(Object.entries(parts).map(async ([k, [brief, name]]) => {
      files[k] = await codexImage(store, project, brief, [ref], path.join(OUT, name));
    }));
    console.log('[textures]', `${Math.round((Date.now() - t0) / 1000)} s`, JSON.stringify(files));
    const shirt = path.join(OUT, 'shirt-gabarit.png');
    const pants = path.join(OUT, 'pants-gabarit.png');
    fs.writeFileSync(shirt, await clothing.composeTemplate({ avant: files.avant, dos: files.dos, membre: files.bras }));
    fs.writeFileSync(pants, await clothing.composeTemplate({ avant: files.taille, dos: files.taille, membre: files.jambes }));
    const u1 = bridge.publishFile(shirt), u2 = bridge.publishFile(pants);
    const { map } = await captures.uploadImages([u1, u2], bridge.status().place);
    console.log('[assets]', map[u1], map[u2]);
    await bridge.send('run_luau', { code: `local rig = workspace.BarbeBlanche
local s = Instance.new("Shirt") s.ShirtTemplate = "${map[u1]}" s.Parent = rig
local p = Instance.new("Pants") p.PantsTemplate = "${map[u2]}" p.Parent = rig
local bc = rig:FindFirstChildOfClass("BodyColors") or Instance.new("BodyColors") local col = Color3.fromHex("#C99266")
bc.HeadColor3 = col bc.LeftArmColor3 = col bc.RightArmColor3 = col bc.TorsoColor3 = col bc.LeftLegColor3 = col bc.RightLegColor3 = col bc.Parent = rig
return true` });
    await new Promise((r) => setTimeout(r, 4000)); // chargement des textures
    const sheet = await captures.isolatedSheet({ send: (op, a) => bridge.send(op, a), target: 'Workspace.BarbeBlanche', outDir: OUT, name: 'BarbeBlanche', placeName: bridge.status().place, count: 6 });
    const cmp = await measure({ reference: ref, shots: sheet.vues.map((v) => v.fichier), outFile: path.join(OUT, 'comparaison.png'), before: 23 });
    console.log('[comparaison]', JSON.stringify(cmp.scores), cmp.planche);
  } catch (e) { console.log('[erreur]', e.stack || e.message); }
  bridge.stop();
  app.quit();
});
