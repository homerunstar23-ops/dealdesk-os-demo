'use strict';
// Tiny server-rendered SVG charts (no JS, no inline styles: works under the strict CSP and prints cleanly).
const { html } = require('../lib/util');

// Horizontal bars. rows: [{label, value, text, cls}]
function hbars(rows, { title = '', labelW = 190, w = 640, rowH = 34, max } = {}) {
  const m = max || Math.max(1, ...rows.map(r => r.value || 0)); const barW = w - labelW - 120; const h = rows.length * rowH + 6;
  return html`<svg class="chart hbars" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}" preserveAspectRatio="xMinYMin meet"><title>${title}</title>
${rows.map((r, i) => { const y = i * rowH + 4; const bw = r.value ? Math.max(3, Math.round((r.value / m) * barW)) : 0; return html`<g class="${r.cls || ''}">
<text x="0" y="${y + rowH / 2 + 1}" class="c-label" dominant-baseline="middle">${r.label}</text>
<rect x="${labelW}" y="${y + 6}" width="${barW}" height="${rowH - 14}" rx="5" class="c-track"></rect>
<rect x="${labelW}" y="${y + 6}" width="${bw}" height="${rowH - 14}" rx="5" class="c-bar"></rect>
<text x="${labelW + barW + 10}" y="${y + rowH / 2 + 1}" class="c-val" dominant-baseline="middle">${r.text != null ? r.text : r.value}</text></g>`; })}</svg>`;
}
// Vertical columns. cols: [{label, value, text}]
function columns(cols, { title = '', w = 640, h = 220 } = {}) {
  const m = Math.max(1, ...cols.map(c => c.value || 0)); const pad = 28; const cw = (w - pad) / Math.max(1, cols.length); const ch = h - 54;
  return html`<svg class="chart cols" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}" preserveAspectRatio="xMinYMin meet"><title>${title}</title>
<line x1="${pad / 2}" y1="${ch + 22}" x2="${w - pad / 2}" y2="${ch + 22}" class="c-axis"></line>
${cols.map((c, i) => { const bh = c.value ? Math.max(3, Math.round((c.value / m) * ch)) : 0; const x = pad / 2 + i * cw + cw * 0.2; return html`<g>
<rect x="${x}" y="${ch + 22 - bh}" width="${cw * 0.6}" height="${bh}" rx="5" class="c-bar"></rect>
<text x="${x + cw * 0.3}" y="${ch + 16 - bh}" class="c-val" text-anchor="middle">${c.text != null ? c.text : c.value}</text>
<text x="${x + cw * 0.3}" y="${ch + 40}" class="c-label" text-anchor="middle">${c.label}</text></g>`; })}</svg>`;
}
module.exports = { hbars, columns };
