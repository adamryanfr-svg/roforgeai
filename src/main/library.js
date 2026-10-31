// Index de la bibliothèque de références roblox-ai (github.com/izzyfrm/roblox-ai).
const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4']);

// Synonymes français → mots des noms de fichiers (anglais).
const SYNONYMS = {
  boutique: 'shop', magasin: 'shop', inventaire: 'inventory', menu: 'menu', bouton: 'button', boutons: 'buttons',
  chargement: 'loading', ecran: 'screen', écran: 'screen', miniature: 'thumbnail', miniatures: 'thumbnails', logo: 'logo',
  icone: 'icon', icône: 'icon', icones: 'icons', icônes: 'icons', effet: 'effects', effets: 'effects', explosion: 'explosions',
  eclair: 'lightning', éclair: 'lightning', feu: 'fire', glace: 'ice', aura: 'aura', coup: 'impact', impact: 'impact',
  attaque: 'combat', combat: 'combat', epee: 'sword', épée: 'sword', animation: 'animation', cinematique: 'cinematic',
  cinématique: 'cinematic', interface: 'user-interface', hud: 'hud', sombre: 'dark', mignon: 'cute', dessin: 'cartoon',
  'dessin-anime': 'cartoon', course: 'racing', voiture: 'racing', foot: 'soccer', football: 'soccer', pixel: 'pixel',
  carte: 'card', cartes: 'card-game', quete: 'quest', quête: 'quest', dialogue: 'dialogue', simulateur: 'simulator',
  horreur: 'horror', obby: 'obby', tycoon: 'tycoon', anime: 'anime', boss: 'boss', santé: 'health', vie: 'health',
};

// Galerie « Recréer » : les références classées par type de création, chacune liée à l'agent
// spécialisé qui sait la refaire en version originale pour le jeu de l'utilisateur.
const GALLERY = [
  { id: 'miniatures', nom: 'Miniatures', agent: 'miniatures', re: /^(game-refs|thumbnails)\// },
  { id: 'icones', nom: 'Icônes et logos', agent: 'miniatures', re: /^(logos|visual-refs\/icons|previews\/icons-user-interface)\// },
  { id: 'vfx', nom: 'VFX', agent: 'vfx', re: /^(vfx\/|previews\/(effects-|vfx|sprite-sheet-effects))/ },
  { id: 'gui', nom: 'GUI', agent: 'gui', re: /^(ui-styles\/|style-refs\/|previews\/([\w-]*user-interface|loading)\/)/ },
  { id: 'animations', nom: 'Animations', agent: 'animation', re: /^(animations\/|visual-refs\/animation|previews\/(animation|animated|sprite-sheet-animation))/ },
  { id: 'cinematiques', nom: 'Cinématiques', agent: 'equipe', re: /^(cutscenes\/|previews\/(cinematic|cutscene|intro)\/)/ },
  { id: 'sfx', nom: 'Sons (idées)', agent: 'sfx', re: /^(sfx\/|previews\/(sound-effects|music))/ },
];

class Library {
  constructor(root) {
    this.setRoot(root);
  }

  setRoot(root) {
    this.root = root;
    this.items = null;
    this.categories = [];
  }

  available() {
    return !!this.root && fs.existsSync(this.root);
  }

  index() {
    if (this.items) return this.items;
    this.items = [];
    if (!this.available()) return this.items;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
          const rel = path.relative(this.root, full).split(path.sep);
          this.items.push({
            path: full,
            rel: rel.join('/'),
            category: rel.length > 1 ? rel[0] : 'autres',
            group: rel.length > 2 ? rel[1] : '',
            words: rel.join(' ').toLowerCase().replace(/[-_./\\]+/g, ' '),
            video: entry.name.toLowerCase().endsWith('.mp4'),
          });
        }
      }
    };
    walk(this.root);
    const counts = {};
    for (const item of this.items) {
      counts[item.category] ??= { name: item.category, count: 0, groups: {} };
      counts[item.category].count++;
      if (item.group) counts[item.category].groups[item.group] = (counts[item.category].groups[item.group] || 0) + 1;
    }
    this.categories = Object.values(counts)
      .map((c) => ({ ...c, groups: Object.entries(c.groups).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) }))
      .sort((a, b) => b.count - a.count);
    return this.items;
  }

  // Recherche par mots (tous les mots doivent apparaître dans le chemin).
  search({ query = '', category = '', group = '', limit = 200, offset = 0 } = {}) {
    const items = this.index();
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => SYNONYMS[t] || t);
    const filtered = items.filter(
      (it) =>
        (!category || it.category === category) &&
        (!group || it.group === group) &&
        terms.every((t) => it.words.includes(t.replace(/-/g, ' ')))
    );
    return { total: filtered.length, items: filtered.slice(offset, offset + limit).map(({ words, ...rest }) => rest) };
  }

  // extra : images hors bibliothèque ajoutées en tête d'un type (ex. miniatures de l'utilisateur).
  gallery({ type = 'miniatures', query = '', offset = 0, limit = 60, extra = {} } = {}) {
    const items = this.index();
    const counts = GALLERY.map((g) => ({ id: g.id, nom: g.nom, agent: g.agent, count: items.filter((it) => g.re.test(it.rel)).length + (extra[g.id]?.length || 0) }));
    const g = GALLERY.find((x) => x.id === type) || GALLERY[0];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean).map((t) => SYNONYMS[t] || t);
    const mine = (extra[g.id] || []).map((p) => ({ path: p, rel: `mes-${g.id}/${path.basename(p)}`, words: path.basename(p).toLowerCase(), mine: true }));
    const list = [...mine, ...items.filter((it) => g.re.test(it.rel))].filter((it) => !it.video && terms.every((t) => it.words.includes(t.replace(/-/g, ' '))));
    return { types: counts, type: g.id, agent: g.agent, total: list.length, items: list.slice(offset, offset + limit).map(({ words, ...rest }) => rest) };
  }

  summary() {
    this.index();
    return { root: this.root, available: this.available(), total: this.items.length, categories: this.categories };
  }
}

module.exports = { Library, GALLERY };
