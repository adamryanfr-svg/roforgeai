// Affiche les limites lues par RoForge : node scripts/limits-check.js
const os = require('os');
const { Limits } = require('../src/main/extras');
console.log(JSON.stringify(new Limits(os.tmpdir()).codex(), null, 1));
