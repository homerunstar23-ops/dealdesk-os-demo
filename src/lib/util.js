'use strict';
const crypto = require('crypto');

// ---- HTML templating with auto-escaping -------------------------------------------------
class Safe { constructor(s) { this.s = String(s); } toString() { return this.s; } }
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"'`=]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' }[c]));
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
function html(strings, ...vals) { let out = strings[0]; vals.forEach((v, i) => { out += render(v) + strings[i + 1]; }); return new Safe(out); }
const raw = (s) => new Safe(s);

// ---- Formatting ---------------------------------------------------------------------------
const money = (v, d = 0) => (v == null || v === '' || !isFinite(v)) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d) + '%';
const ratio = (v) => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(2) + 'x';
const tz = process.env.APP_TZ || 'America/New_York';
function todayISO(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function fmtDate(s) { if (!s) return '—'; const d = s.length <= 10 ? new Date(s + 'T12:00:00Z') : new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')); if (isNaN(d)) return s; return d.toLocaleDateString('en-US', { timeZone: s.length <= 10 ? 'UTC' : tz, month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateTime(s) { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')); if (isNaN(d)) return s; return d.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; }

// ---- Input validation ---------------------------------------------------------------------
// Any standalone 9-digit SSN/ITIN-shaped number (123-45-6789, 123 45 6789, 123456789) is redacted from free text.
const SSN_RE = /(?<![\d$.,-])(?:\d{3}-\d{2}-\d{4}|\d{3} \d{2} \d{4}|\d{9})(?![\d.,-]?\d)/g;
function str(v, max = 200) { if (v == null) return null; v = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim(); if (!v) return null; return v.slice(0, max); }
function text(v, max = 5000) { v = str(v, max); return v ? v.replace(SSN_RE, '[redacted-number]') : v; } // free text: auto-redact SSN-like numbers
function num(v, { min = -1e12, max = 1e12 } = {}) { if (v == null || v === '') return null; const n = Number(String(v).replace(/[$,%\s]/g, '')); if (!isFinite(n)) return null; return Math.min(max, Math.max(min, n)); }
function int(v, opts) { const n = num(v, opts); return n == null ? null : Math.round(n); }
function oneOf(v, list, dflt = null) { return list.includes(v) ? v : dflt; }
function bool(v) { return v === '1' || v === 'on' || v === 'true' || v === true || v === 1 ? 1 : 0; }
function date(v) { v = str(v, 10); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v)) ? v : null; }
function email(v) { v = str(v, 254); return v && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) ? v.toLowerCase() : null; }
function phone(v) { v = str(v, 30); return v && /^[0-9+().\-\s]{7,30}$/.test(v) ? v : null; }
function url(v) { v = str(v, 1000); if (!v) return null; try { const u = new URL(v); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; } }

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// Same-origin "go back" target from the Referer header (Referrer-Policy is same-origin).
function backTo(req, fallback) { try { const u = new URL(req.get('referer')); if (u.host === req.get('host')) return u.pathname + u.search; } catch (e) { /* no referer */ } return fallback; }

module.exports = { backTo, html, raw, esc, Safe, money, pct, ratio, todayISO, fmtDate, fmtDateTime, str, text, num, int, oneOf, bool, date, email, phone, url, sha256, randomToken, SSN_RE };
