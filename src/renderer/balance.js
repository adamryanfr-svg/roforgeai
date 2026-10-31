// Simulateur d'équilibrage : joueur gratuit vs joueur payant (passes), paliers jusqu'au Td et au-delà.
(function () {
  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg', 'Uvg', 'Dvg', 'Tvg', 'Qavg', 'Qivg', 'Sxvg', 'Spvg', 'Ocvg', 'Novg', 'Tg'];

  const DEFAULTS = {
    revenuBase: 1,
    coutDepart: 10,
    coutMultiplicateur: 1.15,
    gainParAchat: 1,
    palierTousLes: 10,
    palierMultiplicateur: 2,
    coutRenaissance: 1e6,
    renaissanceCroissance: 10,
    bonusRenaissance: 1,
    dureeHeures: 24,
    multiplicateurs: [
      { nom: 'Boost du groupe', valeur: 2, part: 0.25, gratuit: true },
      { nom: 'Pass Argent ×2', valeur: 2, part: 1, gratuit: false, prixRobux: 199 },
      { nom: 'Pass VIP', valeur: 2, part: 1, gratuit: false, prixRobux: 299 },
    ],
  };

  function abreger(x) {
    if (!Number.isFinite(x)) return '∞';
    if (Math.abs(x) < 1000) return String(Math.round(x * 10) / 10);
    const i = Math.floor(Math.log10(Math.abs(x)) / 3);
    if (i >= SUFFIXES.length) return x.toExponential(2).replace('e+', 'e');
    const v = x / Math.pow(1000, i);
    return `${v >= 100 ? Math.round(v) : Math.round(v * 100) / 100}${SUFFIXES[i]}`;
  }

  function duree(s) {
    if (!Number.isFinite(s)) return 'jamais';
    if (s < 60) return `${Math.round(s)} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 >= 1 ? ` ${String(Math.round(s % 60)).padStart(2, '0')}` : ''}`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
    return `${Math.floor(s / 86400)} j ${Math.floor((s % 86400) / 3600)} h`;
  }

  // Joueur qui achète dès qu'il peut et renaît dès que la renaissance est payable.
  function simuler(a, payant) {
    const fin = Math.max(0.1, a.dureeHeures) * 3600;
    const boost = (a.multiplicateurs || [])
      .filter((m) => m.gratuit || payant)
      .reduce((acc, m) => acc * (1 + (Math.max(0, m.valeur) - 1) * Math.min(1, Math.max(0, m.part ?? 1))), 1);
    const paliers = [];
    for (let e = 3; e <= 93; e += 3) paliers.push({ valeur: Math.pow(10, e), t: null });
    const res = { points: [], paliers, renaissances: [], murs: [], premierAchat: Infinity, achats: 0, total: 0, bignum: false };
    let t = 0, argent = 0, total = 0, n = 0, reb = 0, dernierAchat = 0, prochainPoint = 0;
    const pas = fin / 4000;
    while (t < fin) {
      const dt = t < 600 ? Math.min(1, pas) : pas;
      const revenu =
        a.revenuBase * (1 + a.gainParAchat * n) * (a.palierTousLes > 0 ? Math.pow(a.palierMultiplicateur, Math.floor(n / a.palierTousLes)) : 1) * (1 + a.bonusRenaissance * reb) * boost;
      argent += revenu * dt;
      total += revenu * dt;
      t += dt;
      let achete = false;
      for (let k = 0; k < 10000; k++) {
        const cout = a.coutDepart * Math.pow(a.coutMultiplicateur, n);
        if (argent < cout || !Number.isFinite(cout)) break;
        argent -= cout;
        n++;
        res.achats++;
        achete = true;
      }
      if (a.coutRenaissance > 0) {
        const coutR = a.coutRenaissance * Math.pow(Math.max(1, a.renaissanceCroissance), reb);
        if (argent >= coutR) {
          reb++;
          argent = 0;
          n = 0;
          res.renaissances.push(t);
          achete = true;
        }
      }
      if (achete) {
        if (res.premierAchat === Infinity) res.premierAchat = t;
        const trou = t - dernierAchat;
        if (dernierAchat > 0 && trou > 600 && trou > 0.2 * t) res.murs.push({ debut: dernierAchat, duree: trou });
        dernierAchat = t;
      }
      for (const p of paliers) if (p.t === null && total >= p.valeur) p.t = t;
      if (t >= prochainPoint) {
        res.points.push({ t, total });
        prochainPoint += fin / 400;
      }
      if (total > 1e300) {
        res.bignum = true;
        break;
      }
    }
    const trouFinal = t - dernierAchat;
    if (dernierAchat > 0 && trouFinal > 600 && trouFinal > 0.2 * t) res.murs.push({ debut: dernierAchat, duree: trouFinal });
    res.points.push({ t, total });
    res.total = total;
    res.fin = t;
    res.revenuFinal = a.revenuBase * (1 + a.gainParAchat * n) * (1 + a.bonusRenaissance * reb) * boost;
    return res;
  }

  function totalA(res, t) {
    let prev = res.points[0];
    for (const p of res.points) {
      if (p.t >= t) return prev.total + ((p.total - prev.total) * (t - prev.t)) / Math.max(1e-9, p.t - prev.t);
      prev = p;
    }
    return prev.total;
  }

  function tempsPour(res, valeur) {
    for (const p of res.points) if (p.total >= valeur) return p.t;
    return Infinity;
  }

  function alertes(a, g, p) {
    const out = [];
    if (g.premierAchat > 30) out.push({ niveau: 'err', texte: `Début trop lent : premier achat à ${duree(g.premierAchat)} (viser moins de 30 s).` });
    else if (g.premierAchat > 20) out.push({ niveau: 'warn', texte: `Premier achat à ${duree(g.premierAchat)} : un peu lent (viser 10 à 20 s).` });
    for (const m of g.murs.sort((x, y) => y.duree - x.duree).slice(0, 3))
      out.push({ niveau: 'err', texte: `Mur pour le joueur gratuit : ${duree(m.duree)} sans rien pouvoir acheter (à partir de ${duree(m.debut)}).` });
    const atteints = g.paliers.filter((x) => x.t !== null);
    for (let i = 1; i < atteints.length; i++) {
      const ecart = atteints[i].t - atteints[i - 1].t;
      if (ecart > 3 * 3600) out.push({ niveau: 'warn', texte: `Long passage de ${abreger(atteints[i - 1].valeur)} à ${abreger(atteints[i].valeur)} : ${duree(ecart)} pour le joueur gratuit.` });
    }
    const ref = totalA(g, Math.min(3600, g.fin));
    const tp = tempsPour(p, ref);
    const ratio = Number.isFinite(tp) && tp > 0 ? Math.min(3600, g.fin) / tp : 1;
    if (ratio > 4) out.push({ niveau: 'err', texte: `Le joueur payant va ×${ratio.toFixed(1)} plus vite : le gratuit risque d’abandonner (viser ×1,5 à ×3).` });
    else if (ratio > 1.05) out.push({ niveau: 'ok', texte: `Le joueur payant atteint en ${duree(tp)} ce que le gratuit a en ${duree(Math.min(3600, g.fin))} (×${ratio.toFixed(1)}).` });
    if (!g.renaissances.length) out.push({ niveau: 'warn', texte: 'Pas de renaissance : vérifier que le contenu suffit pour la durée visée.' });
    if (a.coutMultiplicateur <= 1) out.push({ niveau: 'err', texte: 'Le multiplicateur de prix doit être > 1, sinon l’économie explose.' });
    if (a.palierTousLes > 0 && Math.pow(a.palierMultiplicateur, 1 / a.palierTousLes) >= a.coutMultiplicateur)
      out.push({ niveau: 'err', texte: `Le bonus de palier (×${a.palierMultiplicateur} tous les ${a.palierTousLes}) doit rester sous le coût ×${a.coutMultiplicateur}/niveau, sinon tout explose.` });
    if (g.bignum || p.bignum) out.push({ niveau: 'warn', texte: 'Valeurs au-delà de 1e300 : dans le jeu, un module BigNum doit prendre le relais (jamais inf ni nan).' });
    if (!out.some((x) => x.niveau !== 'ok')) out.unshift({ niveau: 'ok', texte: 'Aucun mur ni blocage détecté sur la durée simulée.' });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Graphique (SVG) : argent gagné au total, échelle logarithmique
  // ---------------------------------------------------------------------------
  function graphique(g, p, hoverT) {
    const W = 640, H = 270, L = 54, R = 12, T = 12, B = 28;
    const fin = Math.max(g.fin, p.fin);
    const maxLog = Math.max(3, Math.ceil(Math.log10(Math.max(10, g.total, p.total))));
    const x = (t) => L + (t / fin) * (W - L - R);
    const y = (v) => H - B - (Math.log10(Math.max(1, v)) / maxLog) * (H - T - B);
    const chemin = (res) => res.points.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.total).toFixed(1)}`).join('');
    let grid = '';
    const stepLog = Math.max(3, Math.ceil(maxLog / 6 / 3) * 3);
    for (let e = 0; e <= maxLog; e += stepLog) {
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(Math.pow(10, e))}" y2="${y(Math.pow(10, e))}" class="g"/><text x="${L - 6}" y="${y(Math.pow(10, e)) + 4}" text-anchor="end">${abreger(Math.pow(10, e))}</text>`;
    }
    for (let k = 0; k <= 4; k++) {
      const t = (fin * k) / 4;
      grid += `<text x="${x(t)}" y="${H - 8}" text-anchor="middle">${duree(t)}</text>`;
    }
    let hover = '';
    if (hoverT != null) {
      const hx = x(hoverT);
      hover = `<line x1="${hx}" x2="${hx}" y1="${T}" y2="${H - B}" class="h"/>
        <circle cx="${hx}" cy="${y(totalA(g, hoverT))}" r="4" class="free"/><circle cx="${hx}" cy="${y(totalA(p, hoverT))}" r="4" class="paid"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="eq-chart" data-fin="${fin}" data-l="${L}" data-r="${R}" data-w="${W}">${grid}
      <path d="${chemin(g)}" class="free"/><path d="${chemin(p)}" class="paid"/>${hover}</svg>`;
  }

  // ---------------------------------------------------------------------------
  // Dialogue
  // ---------------------------------------------------------------------------
  const FIELDS = [
    ['Économie de base', [
      ['revenuBase', 'Revenu de départ (argent / s)'],
      ['coutDepart', 'Prix du 1er achat'],
      ['coutMultiplicateur', 'Prix × à chaque achat', 'ex. 1,15'],
      ['gainParAchat', 'Revenu + par achat', '1 = +100 % du revenu de départ'],
    ]],
    ['Paliers', [
      ['palierTousLes', 'Palier tous les N achats', '0 = pas de palier'],
      ['palierMultiplicateur', 'Revenu × à chaque palier'],
    ]],
    ['Renaissances', [
      ['coutRenaissance', 'Argent requis pour renaître', '0 = pas de renaissance'],
      ['renaissanceCroissance', 'Prix × à chaque renaissance'],
      ['bonusRenaissance', 'Bonus / renaiss.', 'Additif : 1 = +100 % par renaissance'],
    ]],
    ['Simulation', [['dureeHeures', 'Durée simulée (heures)']]],
  ];

  function open({ projectId, call, esc, dialog, toast, sendToClaude }) {
    let a = JSON.parse(JSON.stringify(DEFAULTS));
    let hoverT = null;
    let res = null;
    dialog(
      `<div class="eq">
        <div class="eq-head"><h2>Simulateur d’équilibrage</h2><span class="muted">Joueur gratuit vs joueur payant (passes), qui achète dès qu’il peut. Fichier du jeu : equilibrage.json</span></div>
        <div class="eq-body">
          <div class="eq-form" id="eq-form"></div>
          <div class="eq-main">
            <div class="eq-legend"><span><i class="free"></i>Joueur gratuit</span><span><i class="paid"></i>Joueur payant (passes)</span><span class="muted" id="eq-hover">Argent gagné au total au fil du temps</span></div>
            <div id="eq-chart"></div>
            <div class="eq-cards" id="eq-cards"></div>
            <div class="eq-grid2"><div><div class="section-label">Alertes</div><div id="eq-alerts" class="stack"></div></div>
            <div><div class="section-label">Paliers</div><table class="eq-table" id="eq-tiers"></table></div></div>
          </div>
        </div>
        <div class="foot">
          <button class="btn ghost" data-reset>Valeurs par défaut</button>
          <button class="btn" data-analyse title="Claude lit l’économie actuelle du jeu dans Studio et remplit le simulateur">Analyser le jeu actuel</button>
          <span class="spacer"></span>
          <button class="btn" data-close>Fermer</button>
          <button class="btn" data-save>Enregistrer</button>
          <button class="btn primary" data-apply title="Enregistre puis demande à Claude d’appliquer ces valeurs au code du jeu et de vérifier par un test de jeu">Appliquer au jeu</button>
        </div>
      </div>`,
      async (m, close) => {
        m.classList.add('wide');
        const saved = await call('balance.read', { projectId });
        if (saved?.parametres) a = { ...a, ...saved.parametres };

        const form = m.querySelector('#eq-form');
        const renderForm = () => {
          form.innerHTML =
            FIELDS.map(
              ([title, fields]) => `<div class="eq-group"><div class="section-label">${title}</div>${fields
                .map(([k, label, hint]) => `<label class="eq-field"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input class="input" data-k="${k}" value="${a[k]}"></label>`)
                .join('')}</div>`
            ).join('') +
            `<div class="eq-group"><div class="section-label">Multiplicateurs (passes, boosts)</div>
              ${a.multiplicateurs
                .map(
                  (mu, i) => `<div class="eq-mult" data-i="${i}">
                  <input class="input" data-m="nom" value="${esc(mu.nom)}" placeholder="Nom">
                  <label title="×"><input class="input" data-m="valeur" value="${mu.valeur}"></label>
                  <label title="Part du temps actif (1 = toujours)"><input class="input" data-m="part" value="${mu.part ?? 1}"></label>
                  <label class="check" title="Coché : tout le monde l’a (boost offert). Décoché : payant (pass)."><input type="checkbox" data-m="gratuit" ${mu.gratuit ? 'checked' : ''}>gratuit</label>
                  <button class="icon-btn" data-del title="Retirer">${window.icon('x', 13)}</button></div>`
                )
                .join('')}
              <div class="muted">× valeur · part du temps actif · coché = tout le monde l’a (boost offert), décoché = payant (pass).</div>
              <button class="btn small" data-add>${window.icon('plus', 13)}Ajouter un multiplicateur</button></div>`;
          form.querySelectorAll('[data-k]').forEach((inp) => (inp.oninput = () => ((a[inp.dataset.k] = parseNum(inp.value)), recompute())));
          form.querySelectorAll('.eq-mult').forEach((row) => {
            const mu = a.multiplicateurs[Number(row.dataset.i)];
            row.querySelectorAll('[data-m]').forEach((inp) => {
              inp.oninput = inp.onchange = () => {
                const k = inp.dataset.m;
                mu[k] = k === 'gratuit' ? inp.checked : k === 'nom' ? inp.value : parseNum(inp.value);
                recompute();
              };
            });
            row.querySelector('[data-del]').onclick = () => (a.multiplicateurs.splice(Number(row.dataset.i), 1), renderForm(), recompute());
          });
          form.querySelector('[data-add]').onclick = () => (a.multiplicateurs.push({ nom: 'Nouveau pass', valeur: 2, part: 1, gratuit: false }), renderForm(), recompute());
        };

        let timer;
        const recompute = () => {
          clearTimeout(timer);
          timer = setTimeout(draw, 120);
        };
        const draw = () => {
          const g = simuler(a, false);
          const p = simuler(a, true);
          res = { gratuit: g, payant: p };
          m.querySelector('#eq-chart').innerHTML = graphique(g, p, hoverT);
          const svg = m.querySelector('svg.eq-chart');
          svg.onmousemove = (e) => {
            const r = svg.getBoundingClientRect();
            const W = Number(svg.dataset.w), L = Number(svg.dataset.l), R = Number(svg.dataset.r), fin = Number(svg.dataset.fin);
            const px = ((e.clientX - r.left) / r.width) * W;
            hoverT = Math.max(0, Math.min(fin, ((px - L) / (W - L - R)) * fin));
            m.querySelector('#eq-hover').textContent = `${duree(hoverT)} : gratuit ${abreger(totalA(g, hoverT))} · payant ${abreger(totalA(p, hoverT))}`;
            m.querySelector('#eq-chart').innerHTML = graphique(g, p, hoverT);
            const again = m.querySelector('svg.eq-chart');
            again.onmousemove = svg.onmousemove;
          };
          m.querySelector('#eq-cards').innerHTML = [
            ['Total gratuit', abreger(g.total)],
            ['Total payant', abreger(p.total)],
            ['Renaissances (gratuit / payant)', `${g.renaissances.length} / ${p.renaissances.length}`],
            ['Premier achat', duree(g.premierAchat)],
          ]
            .map(([k, v]) => `<div class="eq-card"><span class="muted">${k}</span><b>${v}</b></div>`)
            .join('');
          m.querySelector('#eq-alerts').innerHTML = alertes(a, g, p)
            .map((x) => `<div class="eq-alert ${x.niveau}"><span class="dot ${x.niveau === 'ok' ? 'ok' : x.niveau}"></span>${esc(x.texte)}</div>`)
            .join('');
          const rows = g.paliers.filter((x, i) => x.t !== null || p.paliers[i].t !== null).slice(0, 16);
          m.querySelector('#eq-tiers').innerHTML =
            `<tr><th>Palier</th><th>Gratuit</th><th>Payant</th></tr>` +
            (rows.length
              ? rows.map((x) => `<tr><td>${abreger(x.valeur)}</td><td>${duree(x.t ?? Infinity)}</td><td>${duree(p.paliers.find((y) => y.valeur === x.valeur)?.t ?? Infinity)}</td></tr>`).join('')
              : '<tr><td colspan="3" class="muted">Aucun palier atteint</td></tr>');
        };

        const save = async () => {
          const data = {
            version: 1,
            parametres: a,
            resume: {
              totalGratuit: res.gratuit.total,
              totalPayant: res.payant.total,
              premierAchat: res.gratuit.premierAchat,
              renaissancesGratuit: res.gratuit.renaissances.length,
              paliers: res.gratuit.paliers.filter((x) => x.t !== null).map((x) => ({ valeur: x.valeur, nom: abreger(x.valeur), tGratuit: Math.round(x.t), tPayant: Math.round(res.payant.paliers.find((y) => y.valeur === x.valeur)?.t ?? -1) })),
              alertes: alertes(a, res.gratuit, res.payant).map((x) => x.texte),
            },
            enregistre: new Date().toISOString(),
          };
          await call('balance.save', { projectId, data });
          return data;
        };

        m.querySelector('[data-reset]').onclick = () => ((a = JSON.parse(JSON.stringify(DEFAULTS))), renderForm(), draw());
        m.querySelector('[data-close]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => (await save(), toast('Équilibrage enregistré dans equilibrage.json.'));
        m.querySelector('[data-apply]').onclick = async () => {
          await save();
          close();
          sendToClaude(
            `Applique l’équilibrage enregistré dans equilibrage.json (à la racine du dossier du jeu) au code du jeu : prix de départ, multiplicateur de prix, revenu, paliers, renaissances et multiplicateurs (passes / boosts). Centralise ces valeurs dans un ModuleScript de configuration (ReplicatedStorage), garde la logique côté serveur, gère les très grands nombres avec un module BigNum si on dépasse 1e300 (jamais inf ni nan), affiche les montants avec les suffixes K, M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc, Ud, Dd, Td… Ensuite lance mcp__roforge__test_de_jeu pour vérifier.`
          );
        };
        m.querySelector('[data-analyse]').onclick = () => {
          close();
          sendToClaude(
            `Analyse la courbe d’économie actuelle du jeu ouvert dans Studio (prix, revenus, multiplicateurs, renaissances, passes) et propose des paliers jusqu’au Td. Écris ensuite le résultat dans equilibrage.json à la racine du dossier du jeu, au format : { "version": 1, "parametres": { "revenuBase", "coutDepart", "coutMultiplicateur", "gainParAchat", "palierTousLes", "palierMultiplicateur", "coutRenaissance", "renaissanceCroissance", "bonusRenaissance", "dureeHeures", "multiplicateurs": [{ "nom", "valeur", "part", "gratuit", "prixRobux" }] } } pour que je puisse le simuler dans RoForge (bouton Équilibrage).`
          );
        };
        renderForm();
        draw();
      }
    );
  }

  function parseNum(v) {
    const n = Number(String(v).replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  window.Balance = { open, simuler, abreger, duree };
})();
