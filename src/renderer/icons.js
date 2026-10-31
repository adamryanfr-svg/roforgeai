// Icônes au trait (SVG maison), injectées dans les <i data-icon="…">.
(function () {
  const P = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5A3.8 3.8 0 0 1 17.5 18z"/><path d="M12 15v-5M9.5 12.5 12 10l2.5 2.5"/>',
    studio: '<path d="M7 3.5 20.5 7 17 20.5 3.5 17z"/><path d="M11 10.5l2.6.7-.7 2.6-2.6-.7z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
    memory: '<path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10.5 3 3 0 0 0 5.5 13 3 3 0 0 0 8 18h1zM15 4a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 3 3 3 0 0 1-1.5 2.5A3 3 0 0 1 16 18h-1zM9 4h6v14H9"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    journal: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="m7 15 4-5 3 3 5-7"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z"/>',
    play:'<path d="M7 4.5v15l12.5-7.5z"/>',
    send:'<path d="M12 19V5M6 11l6-6 6 6"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
    team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14.5 14.6A4.5 4.5 0 0 1 21 18.5"/>',
    wand: '<path d="m4 20 11-11M14 4v3M12.5 5.5h3M19 9v2M18 10h2M18.5 3.5l-1 1"/><path d="m13 8 3 3"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  };
  function svg(name, size = 16) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  }
  function hydrate(root = document) {
    root.querySelectorAll('i[data-icon]').forEach((i) => {
      if (!i.firstChild) i.innerHTML = svg(i.dataset.icon, Number(i.dataset.size) || 16);
    });
  }
  window.icon = svg;
  window.hydrateIcons = hydrate;
  document.addEventListener('DOMContentLoaded', () => hydrate());
})();
