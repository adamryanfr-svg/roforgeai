// Interface RoForge.
const $ = (sel) => document.querySelector(sel);
const call = (method, payload) => window.rf.call(method, payload);
const esc = window.escapeHtml;
const fileUrl = (p) => `roforge-file://local/${encodeURIComponent(p)}`;
const ic = (name, size) => window.icon(name, size);

const state = {
  settings: null,
  projects: [],
  project: null,
  conversations: [],
  conv: null,
  running: new Set(),
  unseen: new Set(),
  queue: {},
  attachments: [],
  permissions: [],
  studio: { connected: false },
  accounts: null,
  agent: 'auto',
  panel: null,
  refs: { query: '', category: '', group: '', offset: 0, summary: null },
  gallery: { type: 'miniatures', query: '', offset: 0 },
};

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    const text = String(err.message || err).replace(/^Error invoking remote method 'rf': (Error: )?/, '');
    window.lastError = text;
    toast(text, 'error');
  }
}

// ---------------------------------------------------------------------------
// Dialogues
// ---------------------------------------------------------------------------
function dialog(html, onMount) {
  const root = document.createElement('div');
  root.className = 'backdrop';
  root.innerHTML = `<div class="dialog">${html}</div>`;
  const close = () => root.remove();
  root.addEventListener('mousedown', (e) => e.target === root && close());
  $('#modal-root').appendChild(root);
  window.hydrateIcons(root);
  onMount?.(root.querySelector('.dialog'), close);
  return close;
}

function confirmBox(text, okLabel = 'Confirmer', danger = true) {
  return new Promise((resolve) => {
    dialog(`<h2>Confirmer</h2><div>${esc(text)}</div><div class="foot"><button class="btn" data-no>Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`, (m, close) => {
      m.querySelector('[data-no]').onclick = () => (close(), resolve(false));
      m.querySelector('[data-yes]').onclick = () => (close(), resolve(true));
    });
  });
}

function viewImage(src) {
  const root = document.createElement('div');
  root.className = 'backdrop';
  root.innerHTML = /\.mp4$/i.test(src) ? `<video class="viewer" src="${fileUrl(src)}" controls autoplay loop></video>` : `<img class="viewer" src="${fileUrl(src)}">`;
  root.onclick = () => root.remove();
  $('#modal-root').appendChild(root);
}

// ---------------------------------------------------------------------------
// Barre latérale : jeux et conversations
// ---------------------------------------------------------------------------
function renderSidebar() {
  const box = $('#games');
  if (!state.projects.length) {
    box.innerHTML = '<div class="muted" style="padding:6px 8px">Aucun jeu pour l’instant.</div>';
    return;
  }
  box.innerHTML = state.projects
    .map((p) => {
      const active = state.project?.id === p.id;
      const convs = active
        ? `<div class="conv-list">
          <button class="conv-row new" data-newconv>${ic('plus', 14)}<span class="t">Nouvelle conversation</span></button>
          ${state.conversations
            .map(
              (c) => `<button class="conv-row ${state.conv?.id === c.id ? 'active' : ''}" data-conv="${c.id}">
              ${state.running.has(c.id) ? '<span class="spin"></span>' : state.unseen.has(c.id) ? '<span class="unseen" title="Terminé : pas encore vu"></span>' : ''}
              <span class="t">${esc(c.title)}</span><span class="icon-btn x" data-del="${c.id}" title="Supprimer la conversation">${ic('trash', 14)}</span></button>`
            )
            .join('')}</div>`
        : '';
      return `<div class="project ${active ? 'active' : ''}"><button class="project-row" data-project="${p.id}">
        <span class="name">${esc(p.name)}</span>${p.imported ? '<span class="tag">importé</span>' : ''}
        <span class="icon-btn" data-menu="${p.id}" title="Renommer, ouvrir le dossier, supprimer…">${ic('dots', 16)}</span></button>${convs}</div>`;
    })
    .join('');
  box.querySelectorAll('[data-project]').forEach((b) => (b.onclick = (e) => (e.target.closest('[data-menu]') ? gameMenu(b.dataset.project) : openProject(b.dataset.project))));
  box.querySelector('[data-newconv]')?.addEventListener('click', newConversation);
  box.querySelectorAll('[data-conv]').forEach(
    (b) =>
      (b.onclick = async (e) => {
        const del = e.target.closest('[data-del]');
        if (!del) return openConversation(b.dataset.conv);
        if (!(await confirmBox('Supprimer cette conversation ?', 'Supprimer'))) return;
        await call('conversations.delete', { projectId: state.project.id, convId: del.dataset.del });
        if (state.conv?.id === del.dataset.del) state.conv = null;
        await reloadConversations();
        if (!state.conv) state.conversations[0] ? openConversation(state.conversations[0].id) : newConversation();
      })
  );
}

function gameMenu(projectId) {
  const p = state.projects.find((x) => x.id === projectId);
  dialog(
    `<h2>${esc(p.name)}</h2>
    <label class="field">Nom du jeu<input class="input" id="g-name" value="${esc(p.name)}"></label>
    <label class="field">ID de la place Roblox (facultatif)<input class="input" id="g-place" value="${esc(p.placeId || '')}"></label>
    <div class="muted">${esc(p.dir)}${p.imported ? '<br>Ce jeu a été importé : son dossier est en dehors de RoForge.' : ''}</div>
    <div class="row-wrap"><button class="btn small" data-open>Ouvrir le dossier du jeu</button>${state.settings.backupDir ? '<button class="btn small" data-backup>Sauvegarder maintenant</button>' : ''}</div>
    <div class="foot">
      <button class="btn ghost" data-remove>Retirer de RoForge seulement</button>
      ${p.imported ? '' : '<button class="btn danger" data-trash>Mettre à la Corbeille</button>'}
      <button class="btn primary" data-save>Enregistrer</button>
    </div>`,
    (m, close) => {
      m.querySelector('[data-open]').onclick = () => call('projects.reveal', { id: p.id });
      m.querySelector('[data-backup]')?.addEventListener('click', () => safe(async () => (await call('backup.run', { id: p.id }), toast('Jeu sauvegardé'))));
      m.querySelector('[data-save]').onclick = () =>
        safe(async () => {
          await call('projects.update', { id: p.id, name: m.querySelector('#g-name').value.trim() || p.name, placeId: m.querySelector('#g-place').value.trim() });
          close();
          await reloadProjects();
        });
      m.querySelector('[data-remove]').onclick = () => removeGame(p, false, close);
      m.querySelector('[data-trash]')?.addEventListener('click', () => removeGame(p, true, close));
    }
  );
}

async function removeGame(p, trash, close) {
  const ok = await confirmBox(
    trash ? `Le dossier du jeu part dans la Corbeille de Windows : tu pourras le restaurer depuis la Corbeille.` : `Retirer « ${p.name} » de RoForge ? Les fichiers restent sur le disque.`,
    trash ? 'Oui, à la Corbeille' : 'Retirer'
  );
  if (!ok) return;
  await safe(() => call('projects.remove', { id: p.id, trash }));
  close();
  if (state.project?.id === p.id) {
    state.project = null;
    state.conv = null;
  }
  await reloadProjects();
}

async function reloadProjects() {
  const s = await call('app.state');
  state.projects = s.projects;
  state.settings = s.settings;
  if (state.project) state.project = state.projects.find((p) => p.id === state.project.id) || null;
  if (!state.project && state.projects[0]) return openProject(state.projects[0].id);
  renderSidebar();
  renderBackupPill();
  if (!state.project) renderMessages();
}

async function openProject(projectId) {
  state.project = state.projects.find((p) => p.id === projectId);
  await reloadConversations();
  const target = state.conversations.find((c) => c.id === state.project.lastConv) || state.conversations[0];
  if (target) await openConversation(target.id);
  else await newConversation();
  renderBackupPill();
  renderFavorites();
  refreshPanel();
}

async function reloadConversations() {
  if (!state.project) return;
  state.conversations = await call('conversations.list', { projectId: state.project.id });
  renderSidebar();
}

async function newConversation() {
  if (!state.project) return toast('Crée ou choisis d’abord un jeu.');
  const conv = await call('conversations.create', { projectId: state.project.id });
  await reloadConversations();
  await openConversation(conv.id);
}

async function openConversation(convId) {
  const conv = await call('conversations.open', { projectId: state.project.id, convId });
  state.conv = conv;
  state.unseen.delete(conv.id);
  if (conv.running) state.running.add(conv.id);
  state.queue[conv.id] = conv.queue || [];
  renderSidebar();
  renderMessages();
  renderQueue();
  renderRunState();
  renderSummaryBanner();
  $('#input').focus();
}

// ---------------------------------------------------------------------------
// Limites d'abonnement
// ---------------------------------------------------------------------------
function resetText(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  const month = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
  return `remise à zéro ${day} ${month} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function gauge(w, kind) {
  const pct = Math.max(0, Math.min(100, Math.round(w.pct ?? 0)));
  const cls = pct >= 95 ? 'full' : pct >= 75 ? 'high' : '';
  return `<div class="gauge"><div class="row"><span>${esc(w.label)}</span><span>${pct} %</span></div>
    <div class="bar ${kind}"><i class="${cls}" style="width:${pct}%"></i></div>${w.resetsAt ? `<div class="reset">${resetText(w.resetsAt)}</div>` : ''}</div>`;
}

async function renderLimits(data, force = false) {
  const l = data || (await call('limits.get', { force }));
  const a = state.accounts;
  const line = (name, plan, ok) => `<div class="agent-line"><span class="dot ${ok ? 'ok' : 'err'}"></span>${name}${plan ? `<span class="sub">${esc(plan)}</span>` : ''}</div>`;
  const block = (q, kind, empty) =>
    q.windows?.length
      ? q.windows.map((w) => gauge(w, kind)).join('') + (q.stale ? `<div class="reset">dernières valeurs connues${q.error ? ` (${esc(q.error)})` : ''}</div>` : '')
      : `<div class="muted">${q.error ? esc(q.error) : empty}</div>`;
  $('#limits').innerHTML = `<div class="head"><span>Limites d’abonnement</span><button class="icon-btn" id="limits-refresh" title="Actualiser les vrais quotas">${ic('refresh', 14)}</button></div>
    ${line('Claude', l.claude.plan || a?.claude.plan, a ? a.claude.loggedIn : true)}
    ${block(l.claude, 'claude', 'Non connecté à ton abonnement Claude')}
    ${line('Codex', l.codex.plan, a ? a.codex.loggedIn : true)}
    ${block(l.codex, 'codex', 'Non connecté à ton compte ChatGPT')}`;
  $('#limits-refresh').onclick = async () => {
    $('#limits-refresh').classList.add('spinning');
    await refreshAccounts();
    await renderLimits(null, true);
  };
}

// ---------------------------------------------------------------------------
// Demandes favorites et conversation avec résumé
// ---------------------------------------------------------------------------
async function renderFavorites() {
  if (!state.project) return ($('#favorites').innerHTML = '');
  state.favorites = await call('favorites.list', { projectId: state.project.id });
  $('#favorites').innerHTML = state.favorites
    .map((f, i) => `<span class="fav" title="${esc(f.text)}"><button class="btn ghost small" data-use="${i}" style="padding:0 2px;height:20px">${ic('star', 12)} ${esc(f.name)}</button><button class="icon-btn" data-rm="${i}" title="Retirer">${ic('x', 11)}</button></span>`)
    .join('');
  $('#favorites').querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => (($('#input').value = state.favorites[Number(b.dataset.use)].text), updateSendState(), $('#input').focus())));
  $('#favorites').querySelectorAll('[data-rm]').forEach(
    (b) =>
      (b.onclick = async () => {
        state.favorites.splice(Number(b.dataset.rm), 1);
        await call('favorites.save', { projectId: state.project.id, list: state.favorites });
        renderFavorites();
      })
  );
}

function favoriteDialog(text) {
  dialog(
    `<h2>Garder comme demande favorite</h2><div class="muted">Un bouton réutilisable apparaît au-dessus de la zone de saisie.</div>
    <label class="field">Nom du bouton (ex. : Vérif. mobile)<input class="input" id="f-name" value="${esc(text.slice(0, 24))}"></label>
    <textarea class="input" id="f-text" rows="4">${esc(text)}</textarea>
    <div class="foot"><button class="btn" data-no>Annuler</button><button class="btn primary" data-yes>Garder</button></div>`,
    (m, close) => {
      m.querySelector('[data-no]').onclick = close;
      m.querySelector('[data-yes]').onclick = async () => {
        const list = [...(state.favorites || []), { name: m.querySelector('#f-name').value.trim() || 'Favori', text: m.querySelector('#f-text').value }];
        await call('favorites.save', { projectId: state.project.id, list });
        close();
        renderFavorites();
      };
    }
  );
}

function renderSummaryBanner() {
  const long = state.conv && !state.conv.archived && state.conv.messages.length >= 40;
  $('#summary-banner').innerHTML = long
    ? `<div class="summary-banner">${ic('warn', 15)}<span class="txt">Claude commence à oublier le début de cette conversation.</span><button class="btn small primary" data-sum>Continuer dans une nouvelle conversation</button></div>`
    : '';
  $('#summary-banner [data-sum]')?.addEventListener('click', continueWithSummary);
}

async function continueWithSummary() {
  if (!(await confirmBox('Continuer dans une nouvelle conversation ? Claude écrit un résumé de celle-ci, qui est archivée (rien n’est perdu).', 'Continuer', false))) return;
  toast('Claude rédige le résumé…');
  const conv = await safe(() => call('conversations.continue', { projectId: state.project.id, convId: state.conv.id }));
  if (!conv) return;
  await reloadConversations();
  await openConversation(conv.id);
  toast('La suite continue dans une nouvelle conversation, avec le résumé de celle-ci.');
}

function sendToAgent(text) {
  $('#input').value = text;
  updateSendState();
  send();
}

function applyCoder() {
  const codex = state.settings?.coder === 'codex';
  $('#input').placeholder = codex
    ? 'Décris ce que tu veux… (réglage « Codex seul » : Codex code et fait les images)'
    : 'Décris ce que tu veux… (les demandes d’images partent à Codex, le reste à Claude)';
  document.querySelector('#agent-seg [data-agent="codex"]').textContent = codex ? 'Codex' : 'Codex · images';
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
const TOOL_LABELS = {
  mcp__roforge__executer_luau: 'Exécute du Luau dans Studio',
  mcp__roforge__arbre: 'Regarde l’arbre du jeu',
  mcp__roforge__proprietes: 'Lit des propriétés',
  mcp__roforge__lire_script: 'Lit un script',
  mcp__roforge__ecrire_script: 'Écrit un script',
  mcp__roforge__supprimer: 'Supprime une instance',
  mcp__roforge__selection: 'Regarde ta sélection',
  mcp__roforge__sortie_studio: 'Lit la Sortie de Studio',
  mcp__roforge__sauvegarde_place: 'Sauvegarde la place',
  mcp__roforge__chercher_references: 'Cherche des références roblox-ai',
  mcp__roforge__memoriser_regle: 'Retient une règle',
  mcp__roforge__journal_jeu: 'Note dans le journal',
  mcp__roforge__studio_etat: 'Vérifie Studio',
  Read: 'Lit un fichier',
  Write: 'Écrit un fichier',
  Edit: 'Modifie un fichier',
  Bash: 'Commande',
  Glob: 'Cherche des fichiers',
  Grep: 'Cherche dans le code',
  TodoWrite: 'Plan de travail',
  WebSearch: 'Recherche web',
  WebFetch: 'Lit une page web',
};

function toolLabel(name) {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  const m = /^mcp__(Roblox_Studio|robloxstudio|blender|roforge)__(.+)$/.exec(name);
  if (m) return `${{ Roblox_Studio: 'Studio', robloxstudio: 'Studio (avancé)', blender: 'Blender', roforge: 'RoForge' }[m[1]]} › ${m[2].replace(/_/g, ' ')}`;
  return name;
}

function toolDetail(p) {
  const i = p.input || {};
  const v = i.chemin || i.path || i.file_path || i.command || i.recherche || i.pattern || i.query || i.description || i.texte || (i.code ? i.code.split('\n')[0] : '');
  return typeof v === 'string' ? v.slice(0, 100) : '';
}

function imagesHtml(list, cls) {
  return list?.length ? `<div class="${cls}">${list.map((p) => `<img src="${fileUrl(p)}" data-src="${esc(p)}" title="${esc(p)}">`).join('')}</div>` : '';
}

function fillMessage(el, m) {
  if (m.role === 'user') {
    const to = m.agent === 'codex' ? 'à Codex' : '';
    el.innerHTML = `<div class="bubble">${to ? `<span class="to">${to}</span>` : ''}${esc(m.text)}</div>
      ${m.images?.length ? `<div class="attachments" style="margin-top:6px">${m.images.map((p) => `<span class="att"><img src="${fileUrl(p)}" data-src="${esc(p)}"></span>`).join('')}</div>` : ''}
      <div class="msg-actions"><button class="btn ghost small" data-act="fav" title="Garder ce message comme demande favorite (bouton réutilisable)">${ic('star', 13)}Favori</button>
      <button class="btn ghost small" data-act="edit" title="Le reprendre dans la zone d’écriture pour le modifier">Reprendre</button></div>`;
  } else {
    const parts = m.parts?.length ? m.parts : [{ type: 'text', text: m.text || '' }];
    let html = '';
    let steps = [];
    const flushSteps = () => {
      if (steps.length) html += `<div class="steps">${steps.join('')}</div>`;
      steps = [];
    };
    for (const p of parts) {
      if (p.type === 'text') {
        if (!p.text.trim()) continue;
        flushSteps();
        html += `<div class="md">${window.renderMarkdown(p.text)}</div>`;
      } else {
        const body = [p.input && Object.keys(p.input).length ? JSON.stringify(p.input, null, 1).slice(0, 3000) : '', p.result ? `→ ${p.result}` : ''].filter(Boolean).join('\n\n');
        steps.push(`<details class="step ${p.status}"><summary><span class="dot"></span><b>${esc(toolLabel(p.name))}</b><span class="d">${esc(toolDetail(p))}</span></summary>${body ? `<pre>${esc(body)}</pre>` : ''}</details>`);
      }
    }
    flushSteps();
    const working = !m.done && !parts.some((p) => p.type === 'text' && p.text.trim());
    el.innerHTML = `<div class="agent-badge ${m.agent}"><span class="sq">${m.agent === 'codex' ? 'C' : 'A'}</span>${m.agent === 'codex' ? 'Codex' : 'Claude'}
        ${m.stopped ? '<span class="muted">· arrêté</span>' : ''}${m.validated ? '<span class="muted">· validé ✓</span>' : ''}</div>
      <div class="assistant">${html}${working ? `<div class="thinking"><span class="spin"></span>${m.thinking ? 'Réfléchit…' : 'Travaille…'}</div>` : ''}</div>
      ${imagesHtml(m.images, 'gen-images')}
      ${m.error ? `<div class="msg-error">${esc(m.error)}</div>` : ''}
      ${m.done ? `<div class="msg-actions">
        <button class="btn ghost small" data-act="validate" title="Le résultat te convient : il est gardé comme exemple pour tes prochains jeux">${ic('check', 14)}Valider</button>
        <button class="btn ghost small" data-act="fix" title="Dis ce qui ne va pas, Claude corrige tout de suite">À corriger</button>
        <button class="btn ghost small" data-act="rule" title="Retenir ce retour comme règle">Retenir comme règle</button>
        <button class="btn ghost small" data-act="copy">${ic('copy', 14)}Copier</button></div>` : ''}`;
  }
  el.querySelectorAll('img[data-src]').forEach((img) => (img.onclick = () => viewImage(img.dataset.src)));
  el.querySelectorAll('.copy-code').forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.closest('pre').querySelector('code').textContent).then(() => toast('Copié'))));
  el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => messageAction(b.dataset.act, m)));
}

function renderMessage(m) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  el.dataset.id = m.id;
  fillMessage(el, m);
  return el;
}

async function messageAction(act, m) {
  if (act === 'copy') return navigator.clipboard.writeText(m.text || '').then(() => toast('Copié'));
  if (act === 'fav') return favoriteDialog(m.text);
  if (act === 'edit') {
    $('#input').value = m.text;
    state.attachments = [...(m.images || [])];
    renderAttachments();
    updateSendState();
    return $('#input').focus();
  }
  if (act === 'fix') {
    $('#input').value = 'À corriger : ';
    updateSendState();
    return $('#input').focus();
  }
  if (act === 'validate') {
    await safe(() => call('chat.validate', { projectId: state.project.id, convId: state.conv.id, messageId: m.id }));
    m.validated = true;
    updateMessage(m);
    toast('Validé : gardé comme exemple pour tes prochains jeux');
    if (state.panel === 'examples') refreshPanel();
    return;
  }
  if (act === 'rule') {
    const prev = state.conv.messages[state.conv.messages.findIndex((x) => x.id === m.id) - 1];
    ruleDialog(prev?.text || '');
  }
}

function ruleDialog(text) {
  dialog(
    `<h2>Retenir ce retour comme règle ?</h2><div class="muted">Claude et Codex l’appliqueront à chaque fois.</div>
    <textarea class="input" id="r-text" rows="3">${esc(text)}</textarea>
    <select id="r-scope"><option value="jeu">Ce jeu seulement</option><option value="tous">Retenue pour tous les jeux</option></select>
    <div class="foot"><button class="btn" data-no>Annuler</button><button class="btn primary" data-yes>Retenir</button></div>`,
    (m, close) => {
      m.querySelector('[data-no]').onclick = close;
      m.querySelector('[data-yes]').onclick = () =>
        safe(async () => {
          await call('rules.add', { projectId: state.project.id, text: m.querySelector('#r-text').value, scope: m.querySelector('#r-scope').value });
          close();
          toast('Règle retenue');
          if (state.panel === 'rules') refreshPanel();
        });
    }
  );
}

function welcomeHtml() {
  const banner = state.settings?.backupDir
    ? ''
    : `<div class="banner">${ic('cloud', 18)}<div class="txt"><b>Tes jeux ne sont sauvegardés nulle part en ligne.</b> Si ton PC tombe en panne, tout est perdu : code, images, conversations. Choisis où les sauvegarder (sur ton propre compte).</div>
      <button class="btn primary small" data-banner="configure">Configurer la sauvegarde</button><button class="btn ghost small" data-banner="later">Plus tard</button></div>`;
  const hide = sessionStorage.getItem('banner-later') ? '' : banner;
  if (!state.project) {
    return `${hide}<div class="welcome"><h1>Ton atelier Roblox</h1><p class="lead">Claude Code et Codex réunis, Roblox Studio connecté automatiquement, ta mémoire de règles toujours appliquée.</p>
      <button class="btn primary" data-welcome="new">${ic('plus', 16)}Créer un nouveau jeu</button></div>`;
  }
  return `${hide}<div class="welcome"><h1>Que construit-on sur ${esc(state.project.name)} ?</h1>
    <p class="lead">Claude code, modélise et teste dans Studio ; Codex crée les images. Tes règles et ta DA sont déjà chargées.</p>
    <div class="path-chip" data-welcome="folder">${ic('folder', 15)}Dossier du jeu : <b>${esc(state.project.dir)}</b></div>
    <div class="suggestions">${[
      'Ajoute un système de renaissances infinies équilibré (gratuit vs payant) avec simulation',
      'Génère l’icône du pass « Argent ×2 » dans la DA du jeu',
      'Fais un HUD argent + boutique pro (inspire-toi des références roblox-ai)',
      'Regarde le jeu ouvert dans Studio et dis-moi ce qu’il contient',
    ]
      .map((s) => `<button class="suggestion">${esc(s)}</button>`)
      .join('')}</div></div>`;
}

function renderMessages() {
  const box = $('#messages');
  if (!state.conv || !state.conv.messages.length) {
    box.innerHTML = welcomeHtml();
    box.querySelectorAll('.suggestion').forEach((b) => (b.onclick = () => (($('#input').value = b.textContent), updateSendState(), $('#input').focus())));
    box.querySelector('[data-welcome="new"]')?.addEventListener('click', newGameDialog);
    box.querySelector('[data-welcome="folder"]')?.addEventListener('click', () => call('projects.reveal', { id: state.project.id }));
    box.querySelector('[data-banner="configure"]')?.addEventListener('click', configureBackup);
    box.querySelector('[data-banner="later"]')?.addEventListener('click', () => (sessionStorage.setItem('banner-later', '1'), renderMessages()));
  } else {
    box.innerHTML = '';
    for (const m of state.conv.messages) box.appendChild(renderMessage(m));
  }
  for (const p of state.permissions.filter((x) => x.convId === state.conv?.id)) box.appendChild(renderPermission(p));
  $('#scroll').scrollTop = $('#scroll').scrollHeight;
}

function updateMessage(m) {
  if (!state.conv) return;
  const i = state.conv.messages.findIndex((x) => x.id === m.id);
  if (i >= 0) state.conv.messages[i] = m;
  else state.conv.messages.push(m);
  const box = $('#messages');
  if (box.querySelector('.welcome')) return renderMessages();
  const scroller = $('#scroll');
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
  const el = box.querySelector(`.msg[data-id="${m.id}"]`);
  if (el) {
    const open = [...el.querySelectorAll('details')].map((d) => d.open);
    fillMessage(el, m);
    el.querySelectorAll('details').forEach((d, k) => (d.open = !!open[k]));
  } else box.insertBefore(renderMessage(m), box.querySelector('.permission'));
  if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
}

function renderPermission(p) {
  const el = document.createElement('div');
  el.className = 'permission';
  el.innerHTML = `<b>${ic('warn', 15)} Claude demande ton accord : ${esc(toolLabel(p.tool))}</b>
    <pre>${esc(JSON.stringify(p.input, null, 1).slice(0, 2500))}</pre>
    <div class="row-wrap"><button class="btn primary small" data-a="yes">Autoriser</button><button class="btn small" data-a="always">Toujours autoriser cet outil</button><button class="btn small danger" data-a="no">Refuser</button></div>`;
  window.hydrateIcons(el);
  el.querySelectorAll('[data-a]').forEach(
    (b) =>
      (b.onclick = async () => {
        await call('permission.reply', { id: p.id, allow: b.dataset.a !== 'no', always: b.dataset.a === 'always', tool: p.tool });
        state.permissions = state.permissions.filter((x) => x.id !== p.id);
        el.remove();
      })
  );
  return el;
}

function renderQueue() {
  const q = state.queue[state.conv?.id] || [];
  $('#queue').innerHTML = q.length
    ? `<div class="muted">En attente : envoyés dans l’ordre quand la tâche en cours est finie.</div>${q.map((item, i) => `<div class="queued"><span>${esc(item.text)}</span><button class="icon-btn" data-i="${i}" title="Retirer">${ic('x', 14)}</button></div>`).join('')}`
    : '';
  $('#queue').querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => call('chat.unqueue', { convId: state.conv.id, index: Number(b.dataset.i) })));
}

function renderRunState() {
  const running = !!state.conv && state.running.has(state.conv.id);
  $('#btn-stop').classList.toggle('hidden', !running);
  $('#btn-send').title = running ? 'Mettre en attente (envoyé quand la tâche en cours est finie)' : 'Envoyer';
}

// ---------------------------------------------------------------------------
// Zone de saisie
// ---------------------------------------------------------------------------
function updateSendState() {
  $('#btn-send').disabled = !$('#input').value.trim();
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 240) + 'px';
}

function renderAttachments() {
  $('#attachments').innerHTML = state.attachments
    .map((p, i) => `<span class="att"><img src="${fileUrl(p)}" data-src="${esc(p)}"><span class="n">${esc(p.split(/[\\/]/).pop())}</span><button class="icon-btn" data-i="${i}" title="Retirer">${ic('x', 12)}</button></span>`)
    .join('');
  $('#attachments').querySelectorAll('button').forEach((b) => (b.onclick = () => (state.attachments.splice(Number(b.dataset.i), 1), renderAttachments())));
  $('#attachments').querySelectorAll('img').forEach((img) => (img.onclick = () => viewImage(img.dataset.src)));
}

function attach(paths) {
  for (const p of paths) if (p && !state.attachments.includes(p)) state.attachments.push(p);
  renderAttachments();
}

async function send() {
  const text = $('#input').value.trim();
  if (!text) return;
  if (!state.project) return toast('Crée d’abord un jeu (Nouveau jeu).');
  if (!state.conv) await newConversation();
  const images = [...state.attachments];
  $('#input').value = '';
  state.attachments = [];
  renderAttachments();
  updateSendState();
  await safe(() => call('chat.send', { projectId: state.project.id, convId: state.conv.id, text, images, agent: state.agent === 'auto' ? undefined : state.agent }));
}

async function handlePastedImage(file) {
  if (!state.project) return toast('Crée d’abord un jeu pour y ranger les images.');
  const real = window.rf.pathOf(file);
  if (real) return attach([real]);
  const reader = new FileReader();
  reader.onload = async () => attach([await call('files.saveDataUrl', { projectId: state.project.id, dataUrl: reader.result, name: 'reference' })]);
  reader.readAsDataURL(file);
}

// ---------------------------------------------------------------------------
// Panneau latéral droit
// ---------------------------------------------------------------------------
const PANEL_TITLES = { gallery: 'Galerie — recréer pour ton jeu', tests: 'Test de jeu automatique', studio: 'Studio', files: 'Images et modèles 3D du jeu', refs: 'Références roblox-ai', rules: 'Mémoire — règles appliquées par les agents', examples: 'Bibliothèque (exemples validés)', journal: 'Journal du jeu', search: 'Chercher dans les conversations' };

function openPanel(name) {
  state.panel = state.panel === name ? null : name;
  $('#rpanel').classList.toggle('hidden', !state.panel);
  document.querySelectorAll('.tool[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === state.panel));
  document.querySelectorAll('.rpanel-body section').forEach((s) => s.classList.toggle('on', s.dataset.section === state.panel));
  $('#rpanel-title').textContent = PANEL_TITLES[state.panel] || '';
  refreshPanel();
  if (state.panel === 'search') $('#conv-search').focus();
}

async function refreshPanel() {
  const p = state.panel;
  if (p === 'refs') return loadRefs(true);
  if (p === 'gallery') return loadGallery(true);
  if (p === 'files') return renderFiles();
  if (p === 'rules') return renderRules();
  if (p === 'studio') return renderStudio();
  if (p === 'examples') return renderExamples();
  if (p === 'journal') return renderJournal();
  if (p === 'tests') return renderTests();
}

// ---------------------------------------------------------------------------
// Test de jeu automatique
// ---------------------------------------------------------------------------
const VERDICT_DOT = { ok: 'ok', warn: 'warn', err: 'err' };

function renderTestStatus() {
  const t = state.playtest;
  $('#btn-run-test').disabled = !!t?.running;
  $('#test-status').innerHTML = t?.running
    ? `<div class="running-test"><span class="spin"></span><div><b>Test en cours dans Studio…</b><br><span class="muted">Le joueur simulé joue ${t.duration ? `pendant ${t.duration} s` : ''}. Ne touche pas au Play en attendant.</span></div></div>`
    : '';
}

function showReport(entry) {
  $('#test-report').innerHTML = `<div class="report ${entry.verdict.level}"><div class="md">${window.renderMarkdown(entry.markdown)}</div>
    <div class="row-wrap" style="margin-top:10px"><button class="btn primary small" data-fix>Demander à Claude de corriger</button><button class="btn small" data-close>Fermer</button></div></div>`;
  $('#test-report [data-close]').onclick = () => ($('#test-report').innerHTML = '');
  $('#test-report [data-fix]').onclick = () => {
    $('#input').value = `Voici le rapport du test de jeu automatique. Corrige les problèmes signalés (erreurs d’abord, puis blocages, interface et performances), puis relance mcp__roforge__test_de_jeu pour vérifier.\n\n${entry.markdown}`;
    updateSendState();
    $('#input').focus();
  };
}

async function renderTests() {
  renderTestStatus();
  if (!state.project) return;
  const list = await call('playtest.list', { projectId: state.project.id });
  $('#tests-list').innerHTML = list.length
    ? list
        .map(
          (e, i) => `<div class="test-row" data-i="${i}"><span class="dot ${VERDICT_DOT[e.verdict.level]}"></span><span class="t"><b>${esc(e.verdict.text)}</b><br><span class="muted">${new Date(e.at).toLocaleString('fr-FR')}${e.source === 'IA' ? ' · lancé par l’IA' : ''}</span></span></div>`
        )
        .join('')
    : '<div class="muted">Aucun test pour l’instant.</div>';
  $('#tests-list').querySelectorAll('.test-row').forEach((row) => (row.onclick = () => showReport(list[Number(row.dataset.i)])));
}

async function runTest() {
  if (!state.project) return toast('Choisis d’abord un jeu.');
  if (!state.studio.connected) return toast('Ouvre d’abord le jeu dans Studio : le plugin RoForge doit être connecté.', 'error');
  $('#test-report').innerHTML = '';
  const entry = await safe(() => call('playtest.run', { projectId: state.project.id, duration: Number($('#test-duration').value) }));
  state.playtest = { running: false };
  renderTestStatus();
  if (entry) {
    showReport(entry);
    renderTests();
  }
}

async function loadRefs(reset) {
  const r = state.refs;
  if (!r.summary) r.summary = await call('library.summary');
  if (!r.summary.available) {
    $('#ref-grid').innerHTML = '';
    $('#ref-count').textContent = `Bibliothèque roblox-ai introuvable (${r.summary.root || ''}). Règle son dossier dans Réglages.`;
    return;
  }
  $('#ref-cats').innerHTML = [{ name: '', count: r.summary.total }, ...r.summary.categories]
    .map((c) => `<button class="chip ${r.category === c.name ? 'on' : ''}" data-c="${esc(c.name)}">${esc(c.name || 'Tout')}<span class="n">${c.count}</span></button>`)
    .join('');
  $('#ref-cats').querySelectorAll('.chip').forEach((b) => (b.onclick = () => ((r.category = b.dataset.c), (r.group = ''), loadRefs(true))));
  const cat = r.summary.categories.find((c) => c.name === r.category);
  $('#ref-groups').innerHTML = cat ? cat.groups.slice(0, 60).map((g) => `<button class="chip ${r.group === g.name ? 'on' : ''}" data-g="${esc(g.name)}">${esc(g.name)}</button>`).join('') : '';
  $('#ref-groups').querySelectorAll('.chip').forEach((b) => (b.onclick = () => ((r.group = r.group === b.dataset.g ? '' : b.dataset.g), loadRefs(true))));
  if (reset) {
    r.offset = 0;
    $('#ref-grid').innerHTML = '';
  }
  const res = await call('library.search', { query: r.query, category: r.category, group: r.group, offset: r.offset, limit: 90 });
  r.offset += res.items.length;
  $('#ref-count').textContent = `${res.total} références · clic = joindre au message · double-clic = agrandir`;
  const frag = document.createDocumentFragment();
  for (const it of res.items) {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.title = it.rel;
    d.innerHTML = it.video ? `<video src="${fileUrl(it.path)}" muted loop preload="metadata"></video><span class="cap">${esc(it.rel)}</span>` : `<img loading="lazy" src="${fileUrl(it.path)}"><span class="cap">${esc(it.rel)}</span>`;
    d.onclick = () => (attach([it.path]), toast('Référence jointe au message'));
    d.ondblclick = () => viewImage(it.path);
    frag.appendChild(d);
  }
  $('#ref-grid').appendChild(frag);
  $('#ref-more').classList.toggle('hidden', r.offset >= res.total);
}

// Galerie « Recréer » : références classées par type ; « Recréer » envoie la référence à l'agent spécialisé.
async function loadGallery(reset) {
  const g = state.gallery;
  if (reset) {
    g.offset = 0;
    $('#gal-grid').innerHTML = '';
  }
  const res = await call('gallery.list', { type: g.type, query: g.query, offset: g.offset, limit: 60 });
  $('#gal-types').innerHTML = res.types.map((t) => `<button class="chip ${t.id === res.type ? 'on' : ''}" data-t="${t.id}">${esc(t.nom)}<span class="n">${t.count}</span></button>`).join('');
  $('#gal-types').querySelectorAll('.chip').forEach((b) => (b.onclick = () => ((g.type = b.dataset.t), loadGallery(true))));
  g.offset += res.items.length;
  const type = res.types.find((t) => t.id === res.type);
  $('#gal-count').textContent = `${res.total} ${type.nom.toLowerCase()} · double-clic = agrandir`;
  const frag = document.createDocumentFragment();
  for (const it of res.items) {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.title = it.rel;
    d.innerHTML = `<img loading="lazy" src="${fileUrl(it.path)}">${it.mine ? '<span class="tag mine">à moi</span>' : ''}<button class="redo">Recréer</button><span class="cap">${esc(it.rel)}</span>`;
    d.onclick = () => recreateDialog(it, type);
    d.ondblclick = (e) => (e.stopPropagation(), viewImage(it.path));
    frag.appendChild(d);
  }
  $('#gal-grid').appendChild(frag);
  $('#gal-more').classList.toggle('hidden', g.offset >= res.total);
}

function recreateBrief(it, type, want) {
  const game = state.project.name;
  const extra = want ? `\nCe que je veux : ${want}` : '';
  if (type.id === 'miniatures' || type.id === 'icones') {
    const icon = type.id === 'icones';
    return `Recrée cette ${icon ? 'icône' : 'miniature'} pour mon jeu « ${game} » avec mcp__roforge__miniature (modele = "${it.path}"${icon ? ', format = icone' : ''}). Prends d’abord 2 à 4 captures du vrai jeu (capture_vue) pour mes personnages et ma map, puis reprends la composition, l’énergie et la mise en page du modèle, sans copier ses personnages, son texte ni son logo.${extra}`;
  }
  if (type.id === 'sfx') return `Crée pour mon jeu « ${game} » les sons inspirés de cette référence (${it.rel}) : sons intégrés Roblox ou générés (jamais la Toolbox), bien mixés en SoundGroups et déclenchés au bon moment. Teste en Play.${extra}`;
  const what = { gui: 'cette interface', vfx: 'cet effet', animations: 'cette animation' }[type.id] || 'cette cinématique';
  return `Recrée dans mon jeu « ${game} », en version ORIGINALE, ${what} de la référence jointe (${it.rel}) : reprends son rendu (formes, couleurs, timing, mise en page) au niveau des jeux du top, sans copier de logo ni d’œuvre. Construis-le dans Studio, teste en Play et vérifie avec des captures.${extra}`;
}

function recreateDialog(it, type) {
  if (!state.project) return toast('Crée ou choisis d’abord un jeu.');
  dialog(
    `<h2>Recréer : ${esc(type.nom.toLowerCase())}</h2>
    <img class="recreate-preview" src="${fileUrl(it.path)}">
    <label class="field">Pour ton jeu, qu’est-ce que tu veux ? (tes persos, le texte, ce qui change…)<textarea class="input" id="rc-want" rows="3" placeholder="Ex. : mon héros frappe le boss, texte « 1 VS 100 »"></textarea></label>
    <label class="check"><input type="radio" name="rc-where" value="solo" checked><span>Nouvelle conversation<small>Une conversation dédiée à cette recréation.</small></span></label>
    <label class="check"><input type="radio" name="rc-where" value="here" ${state.conv ? '' : 'disabled'}><span>Dans la conversation ouverte</span></label>
    <div class="foot"><button class="btn" data-close>Annuler</button><button class="btn primary" data-go>Recréer</button></div>`,
    (m, close) => {
      m.querySelector('[data-close]').onclick = close;
      m.querySelector('#rc-want').focus();
      m.querySelector('[data-go]').onclick = () =>
        safe(async () => {
          const text = recreateBrief(it, type, m.querySelector('#rc-want').value.trim());
          if (m.querySelector('input[name="rc-where"]:checked').value === 'solo') await newConversation();
          close();
          await call('chat.send', { projectId: state.project.id, convId: state.conv.id, text, images: [it.path], agent: state.settings.coder === 'codex' ? 'codex' : 'claude' });
          toast('Envoyé');
        });
    }
  );
}

async function renderFiles() {
  if (!state.project) return ($('#files-grid').innerHTML = '<div class="muted">Choisis un jeu.</div>');
  const files = await call('projects.files', { id: state.project.id });
  $('#files-grid').innerHTML = files.length
    ? files
        .map((f) =>
          /\.(png|jpe?g|webp|gif)$/i.test(f.name)
            ? `<div class="thumb" data-p="${esc(f.path)}" title="${esc(f.folder + '/' + f.name)}"><img loading="lazy" src="${fileUrl(f.path)}"><span class="cap">${esc(f.folder)}/${esc(f.name)}</span></div>`
            : `<div class="thumb" data-p="${esc(f.path)}" data-file="1" title="${esc(f.name)}"><div class="file">📦<br>${esc(f.name)}</div></div>`
        )
        .join('')
    : '<div class="muted">Aucune image dans le dossier du jeu. Demande une image à Codex, ou colle une image de référence dans le chat.</div>';
  $('#files-grid').querySelectorAll('.thumb').forEach((d) => {
    d.onclick = () => (d.dataset.file ? call('files.reveal', { path: d.dataset.p }) : (attach([d.dataset.p]), toast('Image jointe au message')));
    d.ondblclick = () => !d.dataset.file && viewImage(d.dataset.p);
    d.oncontextmenu = async (e) => {
      e.preventDefault();
      if (await confirmBox('Supprimer ce fichier ? Il part à la Corbeille de Windows (récupérable).', 'Oui, à la Corbeille')) {
        await call('files.trash', { path: d.dataset.p });
        renderFiles();
      }
    };
  });
}

async function renderRules() {
  const rules = await call('rules.list', { projectId: state.project?.id });
  $('#rules-list').innerHTML = rules.length
    ? rules.map((r) => `<div class="rule" data-id="${r.id}"><span class="tag">${r.scope === 'jeu' ? 'ce jeu' : 'tous'}</span><div class="text" contenteditable="true">${esc(r.text)}</div><button class="icon-btn" data-del title="Supprimer">${ic('trash', 14)}</button></div>`).join('')
    : '<div class="muted">Aucune règle pour l’instant.</div>';
  $('#rules-list').querySelectorAll('.rule').forEach((el) => {
    el.querySelector('[data-del]').onclick = async () => (await call('rules.delete', { projectId: state.project?.id, ruleId: el.dataset.id }), renderRules());
    el.querySelector('.text').onblur = (e) => call('rules.update', { projectId: state.project?.id, ruleId: el.dataset.id, text: e.target.innerText.trim() });
  });
}

async function renderStudio() {
  const s = state.studio;
  const st = await call('app.state');
  $('#studio-card').innerHTML = s.connected
    ? `<b><span class="dot ok" style="display:inline-block"></span> Plugin Studio connecté</b><br>Place : <b>${esc(s.place || '?')}</b>${s.placeId ? ` · ${s.placeId}` : ''}<br><span class="muted">Plugin RoForge v${esc(s.version || '?')}</span>`
    : `<b><span class="dot warn" style="display:inline-block"></span> En attente de Roblox Studio</b><br><span class="muted">Ouvre Roblox Studio : le plugin (installé par RoForge${st.plugin.installed ? '' : ` — échec : ${esc(st.plugin.error || '')}`}) se connecte tout seul. Si Studio était déjà ouvert, redémarre-le une fois.</span>`;
  const m = st.settings.mcp;
  const row = (on, ok, name, info) => `<div class="mcp"><span class="dot ${!on ? '' : ok ? 'ok' : 'err'}"></span><div><b>${name}</b>${on ? '' : ' <span class="muted">(désactivé)</span>'}<br><span class="muted">${info}</span></div></div>`;
  $('#mcp-list').innerHTML = [
    row(m.roforge, s.connected, 'RoForge (plugin maison)', 'Arbre, scripts, Luau, sortie, sauvegardes de la place, références, mémoire, journal.'),
    row(m.officiel, st.officialMcp, 'MCP natif Roblox_Studio', st.officialMcp ? 'Captures, test en Play, maillages / textures générés, insertion d’assets.' : 'Introuvable : installe ou mets à jour Roblox Studio (il fournit ce MCP).'),
    row(m.chrrxs, true, 'robloxstudio-mcp (chrrxs)', 'Tests et débogage avancés ; installe son propre plugin Studio.'),
  ].join('');
  const logs = await call('studio.logs');
  $('#studio-logs').innerHTML = '';
  for (const l of logs) appendLog(l);
}

function appendLog(l) {
  const box = $('#studio-logs');
  const div = document.createElement('div');
  div.className = `log-${l.kind}`;
  div.textContent = l.text;
  box.appendChild(div);
  while (box.childNodes.length > 400) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

async function renderExamples() {
  const list = await call('examples.list');
  $('#examples-list').innerHTML = list.length
    ? list
        .map(
          (e) => `<div class="card" data-id="${e.id}"><b>${esc(e.title)}</b>
          ${e.images?.length ? `<div class="gen-images">${e.images.map((p) => `<img style="max-height:80px" src="${fileUrl(p)}">`).join('')}</div>` : ''}
          <div class="muted">${esc(e.text.slice(0, 220))}…</div><button class="btn small" data-del style="margin-top:6px">Retirer de la bibliothèque</button></div>`
        )
        .join('')
    : '<div class="muted">Aucun exemple pour l’instant. Valide un résultat dans une conversation : il est ajouté ici.</div>';
  $('#examples-list').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => (await call('examples.remove', { id: b.closest('.card').dataset.id }), renderExamples())));
}

async function renderJournal() {
  if (!state.project) return;
  const list = await call('projects.journal', { id: state.project.id });
  $('#journal-list').innerHTML = list.length
    ? list.map((j) => `<div class="card"><div class="muted">${new Date(j.t).toLocaleString('fr-FR')}</div>${esc(j.text)}</div>`).join('')
    : '<div class="muted">Rien pour l’instant : le journal se remplit dès que l’IA modifie le jeu.</div>';
}

// ---------------------------------------------------------------------------
// Statuts, comptes, sauvegarde, réglages
// ---------------------------------------------------------------------------
async function refreshAccounts() {
  state.accounts = await call('accounts.status');
  const a = state.accounts;
  const both = a.claude.loggedIn && a.codex.loggedIn;
  $('#pill-agents .dot').className = `dot ${both ? 'ok' : a.claude.loggedIn || a.codex.loggedIn ? 'warn' : 'err'}`;
  $('#pill-agents').title = `${a.claude.loggedIn ? 'Connecté à Claude' : 'Non connecté à ton abonnement Claude'} · ${a.codex.loggedIn ? 'Connecté à Codex' : 'Non connecté à ton compte ChatGPT'}`;
}

function renderStudioPill() {
  $('#pill-studio .dot').className = `dot ${state.studio.connected ? 'ok' : 'warn'}`;
  $('#pill-studio span:last-child').textContent = state.studio.connected ? 'Studio connecté' : 'Studio en attente';
  // 3D : toujours des MeshParts texturés par l'IA 3D de Roblox (MCP officiel).
  const meshOk = state.settings?.mcp.officiel;
  $('#pill-blender .dot').className = `dot ${meshOk ? 'ok' : 'err'}`;
  $('#pill-blender').title = meshOk ? 'Modèles 3D : MeshParts texturés par l’IA 3D de Roblox' : 'Active le MCP natif Roblox_Studio (Réglages) pour générer les modèles 3D';
}

function renderBackupPill() {
  const pill = $('#pill-backup');
  const s = state.settings;
  if (!s?.backupDir) {
    pill.className = 'pill backup warn';
    pill.querySelector('span').textContent = 'Pas sauvegardé';
    pill.title = 'Aucune sauvegarde en ligne : clique pour choisir Google Drive, OneDrive, Dropbox ou un dossier synchronisé';
    return;
  }
  const at = state.project?.lastBackup;
  pill.className = 'pill backup ok';
  pill.querySelector('span').textContent = at ? `Sauvegardé ${new Date(at).toLocaleDateString('fr-FR') === new Date().toLocaleDateString('fr-FR') ? 'aujourd’hui' : 'le ' + new Date(at).toLocaleDateString('fr-FR')}` : 'Sauvegarde prête';
  pill.title = `Sauvegarde automatique : une fois par jour et à la fermeture (seulement si le jeu a changé) → ${s.backupDir}`;
}

async function configureBackup() {
  state.settings = await call('backup.configure');
  renderBackupPill();
  renderMessages();
  if (state.settings.backupDir) toast('Sauvegarde configurée : une première sauvegarde de tes jeux démarre.');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#btn-theme').innerHTML = ic(theme === 'dark' ? 'moon' : 'sun', 15);
}

async function openSettings() {
  const s = await call('app.state');
  await refreshAccounts();
  const a = state.accounts;
  const acc = (key, name, info) => `<div class="account"><span class="dot ${a[key].loggedIn ? 'ok' : 'err'}"></span>
    <div class="grow"><b>${name}</b><br><span class="muted">${esc(info)}</span></div>
    ${a[key].loggedIn ? `<button class="btn small" data-logout="${key}">Se déconnecter</button>` : `<button class="btn primary small" data-login="${key}">Se connecter</button>`}</div>`;
  dialog(
    `<h2>Réglages</h2>
    <div class="group"><h3>Comptes</h3>
      ${acc('claude', 'Claude', a.claude.loggedIn ? `Connecté à Claude${a.claude.plan ? ` (${a.claude.plan})` : ''} : ${a.claude.email || a.claude.method}` : 'Non connecté à ton abonnement Claude')}
      ${acc('codex', 'Codex (ChatGPT)', a.codex.loggedIn ? 'Connecté à Codex : ' + a.codex.method : 'Non connecté à ton compte ChatGPT')}
      <div class="muted">La fenêtre officielle de connexion s’ouvre (navigateur). RoForge ne voit jamais tes identifiants.</div>
      <label class="check"><input type="checkbox" id="s-apikeys" ${s.settings.useApiKeys ? 'checked' : ''}><span>Utiliser les clés API de mes variables d’environnement (ANTHROPIC_API_KEY, OPENAI_API_KEY) au lieu de mes abonnements<small>Usage facturé sur tes comptes API.</small></span></label>
    </div>
    <div class="group"><h3>Qui code le jeu ?</h3>
      <label class="check"><input type="radio" name="s-coder" value="claude" ${s.settings.coder !== 'codex' ? 'checked' : ''}><span>Claude code, Codex fait les images<small>Recommandé : Claude construit dans Studio, Codex dessine les visuels (imagegen).</small></span></label>
      <label class="check"><input type="radio" name="s-coder" value="codex" ${s.settings.coder === 'codex' ? 'checked' : ''}><span>Codex seul<small>Codex code le jeu dans Studio et fait aussi les images. Claude reste disponible avec @claude.</small></span></label>
    </div>
    <div class="group"><h3>Agents</h3>
      <label class="check"><input type="checkbox" id="s-auto" ${s.settings.permissions === 'auto' ? 'checked' : ''}><span>Tout autoriser sans demander<small>Sinon, Claude demande ton accord avant les commandes et outils sensibles.</small></span></label>
      <label class="field">Modèle Codex (vide = par défaut du compte ChatGPT)<input class="input" id="s-codex-model" value="${esc(s.settings.codexModel || '')}"></label>
      <label class="check"><input type="checkbox" id="s-notif" ${s.settings.notifications ? 'checked' : ''}><span>Notification Windows quand une longue tâche est finie ou attend ton accord</span></label>
    </div>
    <div class="group"><h3>MCP</h3>
      <label class="check"><input type="checkbox" id="m-roforge" ${s.settings.mcp.roforge ? 'checked' : ''}><span>RoForge (plugin Studio maison)<small>Arbre du jeu, scripts, Luau, sortie, sauvegardes de la place, références, mémoire.</small></span></label>
      <label class="check"><input type="checkbox" id="m-officiel" ${s.settings.mcp.officiel ? 'checked' : ''}><span>MCP natif Roblox_Studio ${s.officialMcp ? '' : '<b style="color:var(--err)">(introuvable)</b>'}<small>Captures, test en Play, maillages / textures générés, insertion d’assets.</small></span></label>
      <label class="check"><input type="checkbox" id="m-chrrxs" ${s.settings.mcp.chrrxs ? 'checked' : ''}><span>robloxstudio-mcp (chrrxs)<small>Tests et débogage avancés de Studio.</small></span></label>
    </div>
    <div class="group"><h3>Sauvegarde</h3>
      <div class="muted">${s.settings.backupDir ? `Dossier : ${esc(s.settings.backupDir)} — automatique une fois par jour et à la fermeture (10 versions gardées par jeu).` : 'Tes jeux ne sont sauvegardés nulle part.'}</div>
      <div class="row-wrap"><button class="btn small" id="s-backup">${s.settings.backupDir ? 'Changer de dossier' : 'Configurer la sauvegarde'}</button>${s.settings.backupDir ? '<button class="btn small" id="s-backup-open">Ouvrir les sauvegardes</button>' : ''}</div>
    </div>
    <div class="group"><h3>Bibliothèque roblox-ai</h3>
      <label class="field">Dossier<input class="input" id="s-lib" value="${esc(s.settings.libraryPath)}"></label>
    </div>
    <div class="muted">RoForge ${esc(s.version)} · Données : ${esc(s.paths.ROOT)}</div>
    <div class="foot"><button class="btn" data-close>Fermer</button><button class="btn primary" data-save>Enregistrer</button></div>`,
    (m, close) => {
      m.querySelectorAll('[data-login]').forEach((b) => (b.onclick = async () => (await call('accounts.login', { agent: b.dataset.login }), toast('Termine la connexion dans la fenêtre qui s’est ouverte.'))));
      m.querySelectorAll('[data-logout]').forEach(
        (b) =>
          (b.onclick = async () => {
            const name = b.dataset.logout === 'codex' ? 'Codex' : 'Claude';
            if (!(await confirmBox(`Se déconnecter de ${name} ? ${name} sera aussi déconnecté sur ce PC (il faudra te reconnecter).`, 'Se déconnecter'))) return;
            await call('accounts.logout', { agent: b.dataset.logout });
            close();
            openSettings();
          })
      );
      m.querySelector('#s-backup').onclick = async () => (await configureBackup(), close(), openSettings());
      m.querySelector('#s-backup-open')?.addEventListener('click', () => call('backup.reveal'));
      m.querySelector('[data-close]').onclick = close;
      m.querySelector('[data-save]').onclick = () =>
        safe(async () => {
          state.settings = await call('settings.update', {
            useApiKeys: m.querySelector('#s-apikeys').checked,
            permissions: m.querySelector('#s-auto').checked ? 'auto' : 'demander',
            coder: m.querySelector('input[name="s-coder"]:checked').value,
            codexModel: m.querySelector('#s-codex-model').value.trim(),
            notifications: m.querySelector('#s-notif').checked,
            libraryPath: m.querySelector('#s-lib').value.trim(),
            mcp: {
              roforge: m.querySelector('#m-roforge').checked,
              officiel: m.querySelector('#m-officiel').checked,
              chrrxs: m.querySelector('#m-chrrxs').checked,
              blender: false,
            },
          });
          state.refs.summary = null;
          close();
          applyCoder();
          renderStudioPill();
          toast('Réglages enregistrés. Les nouvelles conversations les utilisent.');
          refreshPanel();
        });
    }
  );
}

function newGameDialog() {
  dialog(
    `<h2>Créer un nouveau jeu</h2>
    <label class="field">Nom du jeu<input class="input" id="n-name" placeholder="Ex. : anime duel"></label>
    <label class="field">Concept (facultatif)<textarea class="input" id="n-concept" rows="4" placeholder="Boucle de jeu, progression, monétisation envisagée…"></textarea></label>
    <label class="field">ID de la place Roblox (facultatif)<input class="input" id="n-place"></label>
    <div class="muted">RoForge crée le dossier, les règles et charge ta DA. Tu pourras tout ajuster ensuite.</div>
    <div class="foot"><button class="btn" data-no>Annuler</button><button class="btn primary" data-yes>Créer le jeu</button></div>`,
    (m, close) => {
      m.querySelector('#n-name').focus();
      m.querySelector('[data-no]').onclick = close;
      m.querySelector('[data-yes]').onclick = () =>
        safe(async () => {
          const name = m.querySelector('#n-name').value.trim();
          if (!name) return toast('Donne un nom au jeu.');
          const p = await call('projects.create', { name, concept: m.querySelector('#n-concept').value, placeId: m.querySelector('#n-place').value.trim() });
          close();
          const s = await call('app.state');
          state.projects = s.projects;
          await openProject(p.id);
        });
    }
  );
}

// ---------------------------------------------------------------------------
// Événements du processus principal
// ---------------------------------------------------------------------------
window.rf.on((ev) => {
  switch (ev.type) {
    case 'message':
      if (state.conv?.id === ev.convId) updateMessage(ev.message);
      break;
    case 'run.state':
      if (ev.running) state.running.add(ev.convId);
      else {
        state.running.delete(ev.convId);
        if (state.conv?.id !== ev.convId) state.unseen.add(ev.convId);
      }
      renderRunState();
      renderSidebar();
      if (!ev.running) renderSummaryBanner();
      if (!ev.running && state.panel === 'files') renderFiles();
      break;
    case 'conversation.updated':
      reloadConversations().then(() => {
        if (state.conv?.id === ev.conv.id) state.conv.title = ev.conv.title;
      });
      break;
    case 'queue':
      state.queue[ev.convId] = ev.queue;
      if (state.conv?.id === ev.convId) renderQueue();
      break;
    case 'permission':
      state.permissions.push(ev);
      if (state.conv?.id === ev.convId) {
        $('#messages').appendChild(renderPermission(ev));
        $('#scroll').scrollTop = $('#scroll').scrollHeight;
      } else toast('Claude demande ton accord dans une autre conversation');
      break;
    case 'studio':
      state.studio = ev.status;
      renderStudioPill();
      if (state.panel === 'studio') renderStudio();
      toast(ev.status.connected ? `Plugin Studio connecté : ${ev.status.place}` : 'Studio déconnecté');
      break;
    case 'studio.log':
      if (state.panel === 'studio') appendLog(ev.log);
      break;
    case 'rules.changed':
      toast(`Règle retenue : ${ev.rule.text.slice(0, 60)}`);
      if (state.panel === 'rules') renderRules();
      break;
    case 'limits':
      renderLimits(ev.limits);
      break;
    case 'backup':
      call('app.state').then((s) => {
        state.projects = s.projects;
        state.settings = s.settings;
        if (state.project) state.project = s.projects.find((p) => p.id === state.project.id) || state.project;
        renderBackupPill();
      });
      break;
    case 'playtest.state':
      state.playtest = ev;
      $('#tool-tests').classList.toggle('busy', ev.running);
      if (state.panel === 'tests') renderTestStatus();
      break;
    case 'playtest.report':
      if (state.panel === 'tests' && state.project?.id === ev.projectId) renderTests();
      else toast(`Test de jeu terminé : ${ev.entry.verdict.text}`);
      break;
    case 'toast':
      toast(ev.text, ev.kind);
      break;
  }
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
function bind() {
  $('#btn-new-game').onclick = newGameDialog;
  $('#btn-import').onclick = () =>
    safe(async () => {
      const p = await call('projects.import');
      if (!p) return;
      state.projects = (await call('app.state')).projects;
      await openProject(p.id);
    });
  $('#btn-settings').onclick = openSettings;
  $('#pill-agents').onclick = openSettings;
  $('#pill-blender').onclick = openSettings;
  $('#pill-studio').onclick = () => openPanel('studio');
  $('#pill-backup').onclick = () => (state.settings.backupDir && state.project ? safe(async () => (await call('backup.run', { id: state.project.id }), toast('Jeu sauvegardé'))) : configureBackup());
  $('#tool-folder').onclick = () => state.project && call('projects.reveal', { id: state.project.id });
  $('#tool-balance').onclick = () => {
    if (!state.project) return toast('Choisis d’abord un jeu.');
    window.Balance.open({ projectId: state.project.id, call, esc, dialog, toast, sendToClaude: sendToAgent });
  };
  document.querySelectorAll('.tool[data-panel]').forEach((b) => (b.onclick = () => openPanel(b.dataset.panel)));
  $('#rpanel-close').onclick = () => openPanel(state.panel);
  $('#btn-theme').onclick = async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    state.settings = await call('theme.set', { theme: next });
  };

  $('#btn-send').onclick = send;
  $('#btn-stop').onclick = () => state.conv && call('chat.stop', { convId: state.conv.id });
  $('#btn-attach').onclick = async () => attach(await call('files.pickImages'));
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  $('#input').addEventListener('input', updateSendState);
  document.querySelectorAll('#agent-seg button').forEach(
    (b) =>
      (b.onclick = () => {
        state.agent = b.dataset.agent;
        document.querySelectorAll('#agent-seg button').forEach((x) => x.classList.toggle('on', x === b));
      })
  );
  let galTimer = null;
  $('#gal-search').addEventListener('input', (e) => {
    clearTimeout(galTimer);
    galTimer = setTimeout(() => ((state.gallery.query = e.target.value.trim()), loadGallery(true)), 250);
  });
  $('#gal-more').onclick = () => loadGallery(false);
  $('#model-select').onchange = (e) => call('settings.update', { claudeModel: e.target.value });
  $('#effort-select').onchange = (e) => call('settings.update', { claudeEffort: e.target.value });

  document.addEventListener('paste', (e) => {
    for (const item of e.clipboardData?.items || []) if (item.type.startsWith('image/')) handlePastedImage(item.getAsFile());
  });
  const comp = $('#composer');
  document.addEventListener('dragover', (e) => (e.preventDefault(), comp.classList.add('drag')));
  document.addEventListener('dragleave', (e) => !e.relatedTarget && comp.classList.remove('drag'));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    comp.classList.remove('drag');
    for (const f of e.dataTransfer.files) if (f.type.startsWith('image/')) handlePastedImage(f);
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (state.panel !== 'search') openPanel('search');
    }
  });

  let searchTimer;
  $('#conv-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(async () => {
      if (q.length < 2 || !state.project) return ($('#search-results').innerHTML = '');
      const hits = await call('conversations.search', { projectId: state.project.id, query: q });
      $('#search-results').innerHTML = hits.length ? hits.map((h) => `<div class="hit" data-c="${h.convId}"><b>${esc(h.title)}</b><div class="muted">…${esc(h.excerpt)}…</div></div>`).join('') : '<div class="muted">Rien trouvé.</div>';
      $('#search-results').querySelectorAll('.hit').forEach((d) => (d.onclick = () => openConversation(d.dataset.c)));
    }, 250);
  });
  let refTimer;
  $('#ref-search').addEventListener('input', (e) => {
    clearTimeout(refTimer);
    refTimer = setTimeout(() => ((state.refs.query = e.target.value.trim()), loadRefs(true)), 250);
  });
  $('#ref-more').onclick = () => loadRefs(false);
  $('#btn-run-test').onclick = runTest;
  $('#btn-add-rule').onclick = () =>
    safe(async () => {
      const text = $('#rule-input').value.trim();
      if (!text) return;
      await call('rules.add', { projectId: state.project?.id, text, scope: state.project ? $('#rule-scope').value : 'tous' });
      $('#rule-input').value = '';
      renderRules();
    });
  $('#btn-snapshot').onclick = () => safe(async () => toast(`Place sauvegardée : ${await call('studio.snapshot', { label: 'manuel' })}`));
  $('#btn-snapshots').onclick = () =>
    safe(async () => {
      const list = await call('studio.snapshots');
      $('#snapshots').innerHTML = list.length
        ? list.reverse().map((n) => `<div class="rule"><div class="text">${esc(n)}</div><button class="btn small" data-n="${esc(n)}">Restaurer</button></div>`).join('')
        : '<div class="muted">Aucune sauvegarde de la place pour l’instant.</div>';
      $('#snapshots').querySelectorAll('[data-n]').forEach(
        (b) =>
          (b.onclick = async () => {
            if (!(await confirmBox('Remettre la place dans cet état ? L’état actuel sera sauvegardé avant.', 'Restaurer', false))) return;
            await safe(() => call('studio.restore', { name: b.dataset.n }));
            toast('Place restaurée. Pense à l’enregistrer dans Studio si le résultat te convient.');
          })
      );
    });
  $('#btn-plugin').onclick = async () => {
    const r = await call('plugin.install');
    toast(r.installed ? 'Plugin installé : redémarre Studio s’il était ouvert.' : `Échec : ${r.error}`, r.installed ? '' : 'error');
  };
  $('#btn-patch-notes').onclick = () => {
    $('#input').value = 'Écris les notes de mise à jour pour mes joueurs (FR + EN) à partir du journal du jeu et de ce qu’on a fait récemment.';
    updateSendState();
    $('#input').focus();
  };
}

async function init() {
  window.hydrateIcons();
  bind();
  const s = await call('app.state');
  state.settings = s.settings;
  state.projects = s.projects;
  state.studio = s.studio;
  applyTheme(s.settings.theme || 'light');
  $('#model-select').value = s.settings.claudeModel;
  $('#effort-select').value = s.settings.claudeEffort;
  renderStudioPill();
  renderBackupPill();
  renderSidebar();
  renderLimits();
  if (state.projects.length) {
    const last = [...state.projects].sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''))[0];
    await openProject(last.id);
  } else renderMessages();
  applyCoder();
  await refreshAccounts();
  renderLimits();
  setInterval(() => renderLimits(), 60000);
  setInterval(refreshAccounts, 300000);
}

init();
