// Test de la comparaison mesurée : electron scripts/compare-check.js <reference> <rendu...>
const { app } = require('electron');
const path = require('path');
const { measure } = require('../src/main/compare');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const [ref, ...shots] = process.argv.slice(2).filter((a) => !a.startsWith('-') && /\.(png|jpe?g|webp)$/i.test(a));
  try {
    const r = await measure({ reference: ref, shots, outFile: path.join(__dirname, 'compare-check', 'comparaison.png'), before: null });
    console.log(JSON.stringify(r, null, 1));
  } catch (e) { console.log('[erreur]', e.stack); }
  app.quit();
});
