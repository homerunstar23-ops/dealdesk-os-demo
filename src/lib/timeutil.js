'use strict';
// Time-zone helpers for quiet hours (no external deps).
const STATE_TZ = {
  AL: 'America/Chicago', AR: 'America/Chicago', IA: 'America/Chicago', IL: 'America/Chicago', KS: 'America/Chicago', LA: 'America/Chicago', MN: 'America/Chicago', MO: 'America/Chicago', MS: 'America/Chicago', ND: 'America/Chicago', NE: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', TX: 'America/Chicago', WI: 'America/Chicago',
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Denver', MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles', AK: 'America/Anchorage', HI: 'Pacific/Honolulu'
};
const DEFAULT_TZ = 'America/New_York';
function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
function contactTz(c) { if (c && c.timezone && validTz(c.timezone)) return c.timezone; return (c && STATE_TZ[(c.state || '').toUpperCase()]) || DEFAULT_TZ; }
function parts(date, tz) {
  const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).forEach(x => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
function tzOffsetMs(date, tz) { const p = parts(date, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000; }
// UTC Date for a wall-clock time in tz.
function zonedTime(y, m, d, h, mi, tz) { const guess = new Date(Date.UTC(y, m - 1, d, h, mi)); const off = tzOffsetMs(guess, tz); const r = new Date(guess.getTime() - off); const off2 = tzOffsetMs(r, tz); return off2 === off ? r : new Date(guess.getTime() - off2); }
// Returns `now` if inside [start, end) local hours, else the next local `start` o'clock.
function nextAllowed(now, tz, start = 8, end = 21) {
  const p = parts(now, tz);
  if (p.h >= start && p.h < end) return now;
  let { y, m, d } = p;
  if (p.h >= end) { const t = new Date(Date.UTC(y, m - 1, d) + 864e5); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
  return zonedTime(y, m, d, start, 0, tz);
}
function localDate(now, tz = DEFAULT_TZ) { const p = parts(now, tz); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
function localHour(now, tz = DEFAULT_TZ) { return parts(now, tz).h; }
const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5);
// SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO -> Date
function parseTs(s) { if (!s) return null; if (s instanceof Date) return s; return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z'); }
module.exports = { STATE_TZ, DEFAULT_TZ, contactTz, nextAllowed, localDate, localHour, iso, addDays, parseTs, validTz, parts };
