// Rapport du test de jeu automatique : mise en forme, verdict et enregistrement dans le jeu.
const fs = require('fs');
const path = require('path');

function verdict(r) {
  const errors = r.errors?.length || 0;
  const blockers = errors + (r.deaths?.length || 0) + (r.falls || 0);
  if (r.fatal) return { level: 'err', text: 'Test interrompu' };
  if (blockers === 0 && (r.stuck?.length || 0) <= 1) return { level: 'ok', text: 'Rien de bloquant' };
  if (errors > 0) return { level: 'err', text: `${errors} erreur${errors > 1 ? 's' : ''} à corriger` };
  return { level: 'warn', text: 'Problèmes de jouabilité' };
}

const list = (items, fmt) => (items?.length ? items.map((x) => `- ${fmt(x)}`).join('\n') : '- Aucun');

function toMarkdown(r, meta) {
  const v = verdict(r);
  const ui = r.ui || {};
  const eco = r.economy || {};
  const ecoKeys = [...new Set([...Object.keys(eco.start || {}), ...Object.keys(eco.end || {})])];
  return `## Test de jeu — ${v.level === 'ok' ? '✅' : v.level === 'warn' ? '⚠️' : '❌'} ${v.text}
${meta.place ? `Place : **${meta.place}** · ` : ''}${new Date(meta.at).toLocaleString('fr-FR')} · joueur simulé pendant ${r.elapsed ?? r.duration} s

### Erreurs (${r.errors?.length || 0})
${list(r.errors, (e) => `[${e.side}, ${e.t} s${e.count > 1 ? `, ×${e.count}` : ''}] ${e.text}`)}

### Avertissements (${r.warnings?.length || 0})
${list(r.warnings?.slice(0, 15), (e) => `[${e.side}] ${e.text}${e.count > 1 ? ` (×${e.count})` : ''}`)}

### Joueur simulé
- Cibles trouvées : ${r.targets ?? 0} · atteintes : ${r.visited ?? 0}
- Interactions déclenchées (ProximityPrompt) : ${r.prompts ?? 0}${r.promptNames?.length ? ` — ${[...new Set(r.promptNames)].join(', ')}` : ''}
- Blocages : ${r.stuck?.length || 0}${r.stuck?.length ? '\n' + r.stuck.map((s) => `  - à ${s.pos} en allant vers « ${s.cible} » (${s.t} s)`).join('\n') : ''}
- Morts : ${r.deaths?.length || 0}${r.deaths?.length ? ` (${r.deaths.map((d) => `${d.pos} à ${d.t} s`).join(' ; ')})` : ''}
- Chutes hors de la map : ${r.falls || 0}

### Interface
- Écrans actifs : ${ui.screens?.length ? ui.screens.join(', ') : 'aucun'} · boutons visibles : ${ui.buttons ?? 0} · écran ${ui.viewport || '?'}
- Hors de l’écran : ${ui.offscreen?.length ? ui.offscreen.join(', ') : 'aucun'}
- Textes qui débordent : ${ui.overflow?.length ? ui.overflow.join(', ') : 'aucun'}
- Boutons trop petits pour le mobile (< 32 px) : ${ui.tiny?.length ? ui.tiny.join(', ') : 'aucun'}

### Performances
- FPS client : moyenne ${r.perf?.fpsAvg ?? '?'} · minimum ${r.perf?.fpsMin ?? '?'}
- Mémoire client : ${r.perf?.memoryMb ?? '?'} Mo · instances : ${r.perf?.instances ?? '?'} · parts : ${r.perf?.parts ?? '?'}

### Économie (leaderstats / attributs du joueur)
${ecoKeys.length ? ecoKeys.map((k) => `- ${k} : ${eco.start?.[k] ?? '—'} → ${eco.end?.[k] ?? '—'}`).join('\n') : '- Aucune valeur trouvée (pas de leaderstats)'}
${r.engine ? `\n_${r.engine} message${r.engine > 1 ? 's' : ''} du moteur Roblox ignoré${r.engine > 1 ? 's' : ''} (avatar / Studio, pas des bugs du jeu)._\n` : ''}${r.notes?.length ? `\n### Notes\n${r.notes.map((n) => `- ${n}`).join('\n')}` : ''}`;
}

function saveReport(project, report, meta) {
  const dir = path.join(project.dir, '.roforge', 'tests');
  fs.mkdirSync(dir, { recursive: true });
  const at = meta.at;
  const file = path.join(dir, `${at.replace(/[:.]/g, '-')}.json`);
  const v = verdict(report);
  const entry = { id: path.basename(file, '.json'), at, place: meta.place, source: meta.source, verdict: v, markdown: toMarkdown(report, meta), report };
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf8');
  return entry;
}

function listReports(project) {
  const dir = path.join(project.dir, '.roforge', 'tests');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => {
      try {
        const { report, ...rest } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { ...rest, errors: report.errors?.length || 0 };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = { saveReport, listReports, toMarkdown, verdict };
