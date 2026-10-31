// Ajoute une règle pour tous les jeux si elle n'existe pas : node scripts/add-rule.js "texte"
const { Store } = require('../src/main/store');
const text = process.argv[2];
const store = new Store();
const exists = store.rules(null).some((r) => r.text === text);
if (!exists) store.addRule(null, { text, scope: 'tous', source: 'toi' });
console.log(exists ? 'déjà présente' : 'ajoutée', '—', store.rules(null).length, 'règles');
