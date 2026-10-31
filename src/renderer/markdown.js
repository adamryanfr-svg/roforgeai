// Petit rendu Markdown sûr (le HTML est échappé avant transformation).
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inline(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  }

  function render(src) {
    const out = [];
    const blocks = src.replace(/\r/g, '').split(/```/);
    blocks.forEach((block, i) => {
      if (i % 2 === 1) {
        const nl = block.indexOf('\n');
        const lang = nl > 0 ? block.slice(0, nl).trim() : '';
        const code = nl > 0 ? block.slice(nl + 1) : block;
        out.push(`<pre class="code"><div class="code-lang">${esc(lang || 'code')}<button class="copy-code">Copier</button></div><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
        return;
      }
      let list = null;
      const flush = () => {
        if (list) out.push(`</${list}>`);
        list = null;
      };
      for (const line of block.split('\n')) {
        let m;
        if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
          flush();
          out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`);
        } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
          if (list !== 'ul') { flush(); out.push('<ul>'); list = 'ul'; }
          out.push(`<li>${inline(m[1])}</li>`);
        } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
          if (list !== 'ol') { flush(); out.push('<ol>'); list = 'ol'; }
          out.push(`<li>${inline(m[1])}</li>`);
        } else if (/^\|.*\|$/.test(line.trim())) {
          flush();
          if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
          const cells = line.trim().slice(1, -1).split('|').map((c) => `<td>${inline(c.trim())}</td>`).join('');
          out.push(`<table class="md-table"><tr>${cells}</tr></table>`);
        } else if (line.trim() === '') {
          flush();
        } else {
          flush();
          out.push(`<p>${inline(line)}</p>`);
        }
      }
      flush();
    });
    return out.join('').replace(/<\/table><table class="md-table">/g, '');
  }

  window.renderMarkdown = render;
  window.escapeHtml = esc;
})();
