'use strict';
const crypto = require('crypto');
const session = require('express-session');

// express-session store backed by the app's SQLite DB (no extra service needed).
class SqliteStore extends session.Store {
  constructor(db) {
    super(); this.db = db;
    this.getQ = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
    this.setQ = db.prepare('INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires');
    this.delQ = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.gcQ = db.prepare('DELETE FROM sessions WHERE expires <= ?');
    this.gc = setInterval(() => this.gcQ.run(Date.now()), 15 * 60 * 1000); this.gc.unref();
  }
  get(sid, cb) { try { const r = this.getQ.get(sid, Date.now()); cb(null, r ? JSON.parse(r.sess) : null); } catch (e) { cb(e); } }
  set(sid, sess, cb) { try { const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 864e5; this.setQ.run(sid, JSON.stringify(sess), exp); cb && cb(null); } catch (e) { cb && cb(e); } }
  destroy(sid, cb) { try { this.delQ.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

// Synchronizer-token CSRF protection (token kept in the session).
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}
function verifyCsrf(req) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const want = req.session && req.session.csrf;
  if (!want || typeof sent !== 'string' || sent.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(want));
}
// Checks every state-changing request except multipart routes (those call verifyCsrf after parsing).
function csrfMiddleware(req, res, next) {
  res.locals.csrf = csrfToken(req);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.is('multipart/form-data')) return next();
  if (req.path === '/webhooks/stripe' || req.path === '/webhooks/sms') return next(); // verified by provider signature instead
  if (!verifyCsrf(req)) return res.status(403).send('Invalid or missing security token. Go back, refresh the page and try again.');
  next();
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    const u = req.app.locals.db.prepare('SELECT id, email, name, role FROM users WHERE id = ? AND active = 1').get(req.session.userId);
    if (u) { req.user = u; res.locals.user = u; return next(); }
  }
  if (req.accepts(['html', 'json']) === 'json' && req.path.startsWith('/api/')) return res.status(401).json({ error: 'auth required' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}
function requireAdmin(req, res, next) { if (req.user && req.user.role === 'admin') return next(); res.status(403).send('Admins only.'); }

module.exports = { SqliteStore, csrfToken, verifyCsrf, csrfMiddleware, requireAuth, requireAdmin };
