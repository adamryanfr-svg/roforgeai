// Lance un test de jeu sans l'interface (RoForge fermé) : node scripts/playtest-check.js [durée]
// Charge plugin/core.lua via run_luau : fonctionne même avec un ancien plugin déjà chargé dans Studio.
const fs = require('fs');
const path = require('path');
const { Bridge } = require('../src/main/bridge');
const { toMarkdown } = require('../src/main/playtest');

const duration = Number(process.argv[2] || 30);
const core = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'core.lua'), 'utf8').replace(/^--!nocheck\s*/, '');
const code = `local factory = (function()\n${core}\nend)()
local h = factory(plugin, { version = "test", status = function() end })
return game:GetService("HttpService"):JSONEncode(h.playtest({ duration = ${duration} }))`;

const bridge = new Bridge();
bridge.start();
(async () => {
  for (let i = 0; i < 60 && !bridge.status().connected; i++) await new Promise((r) => setTimeout(r, 500));
  console.log('[studio]', JSON.stringify(bridge.status()));
  try {
    const out = await bridge.send('run_luau', { code }, (duration + 120) * 1000);
    if (!out.ok) throw new Error(out.error);
    const report = JSON.parse(out.returned[0]);
    fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'last-playtest.json'), JSON.stringify(report, null, 2));
    console.log(toMarkdown(report, { at: new Date().toISOString(), place: bridge.status().place }));
  } catch (err) {
    console.log('[erreur]', err.message);
  }
  bridge.stop();
  process.exit(0);
})();
