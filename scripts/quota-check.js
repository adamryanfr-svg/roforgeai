// Vérifie la lecture des vrais quotas : node scripts/quota-check.js
const { readQuotas } = require('../src/main/quotas');
readQuotas().then((q) => console.log(JSON.stringify(q, null, 1)));
