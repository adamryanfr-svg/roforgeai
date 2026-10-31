// Vrais quotas d'abonnement, lus à la source :
// - Claude : point d'accès d'usage du compte claude.ai (le même que /usage dans Claude Code),
//   avec le jeton OAuth local de Claude Code (~/.claude/.credentials.json).
// - Codex : « codex app-server » (JSON-RPC sur stdio), méthode account/rateLimits/read.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const CODEX_EXE = path.join(__dirname, '..', '..', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');

const CLAUDE_LABELS = { five_hour: 'Session (5 h)', seven_day: 'Semaine', seven_day_opus: 'Semaine (Opus)', seven_day_sonnet: 'Semaine (Sonnet)' };

async function claudeQuotas() {
  const file = path.join(os.homedir(), '.claude', '.credentials.json');
  const creds = JSON.parse(fs.readFileSync(file, 'utf8')).claudeAiOauth;
  if (!creds?.accessToken) throw new Error('Non connecté à Claude');
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${creds.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Claude : HTTP ${res.status}`);
  const data = await res.json();
  const windows = Object.entries(CLAUDE_LABELS)
    .filter(([key]) => data[key] && data[key].utilization != null)
    .map(([key, label]) => ({ label, pct: Math.round(data[key].utilization), resetsAt: data[key].resets_at ? Math.floor(new Date(data[key].resets_at).getTime() / 1000) : null }));
  return { plan: creds.subscriptionType, windows, extra: data.extra_usage?.is_enabled ? data.extra_usage : undefined };
}

function codexQuotas() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CODEX_EXE)) return reject(new Error('Codex absent'));
    const child = spawn(CODEX_EXE, ['app-server'], { windowsHide: true });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Codex : pas de réponse'));
    }, 20000);
    const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read' });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          if (msg.error) return reject(new Error(`Codex : ${msg.error.message}`));
          const rl = msg.result?.rateLimits || msg.result || {};
          const win = (w) =>
            w && { label: (w.windowDurationMins || w.window_minutes || 0) <= 300 ? '5 h' : 'Semaine', pct: Math.round(w.usedPercent ?? w.used_percent ?? 0), resetsAt: w.resetsAt ?? w.resets_at ?? null };
          resolve({ plan: rl.planType || rl.plan_type, windows: [win(rl.primary), win(rl.secondary)].filter(Boolean), credits: rl.credits });
        }
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'roforge', title: 'RoForge', version: '0.1.0' } } });
  });
}

async function readQuotas() {
  const [claude, codex] = await Promise.allSettled([claudeQuotas(), codexQuotas()]);
  return {
    claude: claude.status === 'fulfilled' ? claude.value : { windows: [], error: claude.reason.message },
    codex: codex.status === 'fulfilled' ? codex.value : { windows: [], error: codex.reason.message },
    at: Date.now(),
  };
}

module.exports = { readQuotas };
