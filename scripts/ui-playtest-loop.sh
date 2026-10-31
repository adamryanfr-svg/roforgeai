#!/usr/bin/env bash
# Lance N tests de jeu d'affilée depuis l'interface RoForge (lancée avec --remote-debugging-port=9333).
cd "$(dirname "$0")/.." || exit 1
for i in $(seq 1 "${1:-3}"); do
  echo "test $i : $(node scripts/ui-eval.js "window.rf.call('playtest.run',{projectId: state.project.id, duration: 20}).then(r => 'OK ' + r.verdict.text).catch(e => 'ERR ' + e.message)")"
done
