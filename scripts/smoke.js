// Test rapide hors interface : node scripts/smoke.js [claude|codex] "message"
// (à lancer avec RoForge fermé : le pont utilise le port 44777)
const path = require('path');
const { Store } = require('../src/main/store');
const { Bridge } = require('../src/main/bridge');
const { Library } = require('../src/main/library');
const agents = require('../src/main/agents');

const [agent = 'claude', prompt = 'Appelle mcp__roforge__studio_etat puis mcp__roforge__chercher_references avec "shop", et résume en une phrase.'] = process.argv.slice(2);

const store = new Store();
const bridge = new Bridge();
const settings = { ...store.settings(), claudeModel: 'haiku', claudeEffort: 'low', mcp: { roforge: true, officiel: false, chrrxs: false, blender: false } };
const library = new Library(settings.libraryPath);
bridge.handlers['studio/status'] = () => bridge.status();
bridge.handlers['library/search'] = ({ query, limit }) => library.search({ query, limit }).items.map((i) => i.path);
bridge.handlers['permission'] = ({ tool }) => (console.log('[permission]', tool), { allow: true });
for (const op of ['run_luau', 'get_tree', 'get_properties', 'read_script', 'write_script', 'delete', 'get_selection', 'snapshot', 'list_snapshots']) {
  bridge.handlers[`studio/${op}`] = ({ run, ...args }) => bridge.send(op, args);
}
bridge.handlers['studio/logs'] = ({ count = 60 }) => bridge.logs.slice(-count).map((l) => `[${l.kind}] ${l.text}`).join('\n') || '(sortie vide)';
bridge.start();

// Attend que le plugin Studio se reconnecte à ce pont (jusqu'à 20 s).
const waitStudio = async () => {
  for (let i = 0; i < 40 && !bridge.status().connected; i++) await new Promise((r) => setTimeout(r, 500));
  console.log('[studio]', JSON.stringify(bridge.status()));
};

let project = store.projects().find((p) => p.name === 'Test RoForge');
if (!project) project = store.createProject({ name: 'Test RoForge', concept: 'Projet de test automatique.' });
const conv = store.createConversation(project.id, 'smoke');

async function main() {
await waitStudio();
const run = (agent === 'codex' ? agents.runCodex : agents.runClaude)({
  store, project, conv, prompt, images: [], settings, bridgeToken: bridge.token, runId: 'smoke', runtimeDir: store.paths.RUNTIME_DIR,
});
for (const ev of ['session', 'tool', 'tool-result', 'images', 'error']) run.on(ev, (d) => console.log(`[${ev}]`, typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300)));
run.on('text', (t) => process.stdout.write(t));
run.on('done', (d) => {
  console.log('\n[done]', JSON.stringify({ code: d.code, cost: d.result?.total_cost_usd }));
  store.deleteConversation(project.id, conv.id);
  bridge.stop();
  process.exit(0);
});
}
main();
