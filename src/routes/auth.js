'use strict';
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { html } = require('../lib/util');
const { page, field, csrfInput } = require('../views/layout');
const model = require('../lib/model');

// Dummy hash so timing is similar whether or not the email exists.
const DUMMY = bcrypt.hashSync('not-a-real-password-xx', 12);

module.exports = (app) => {
  const db = app.locals.db; const cfg = app.locals.config;
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: cfg.loginMax, standardHeaders: 'draft-7', legacyHeaders: false,
    skipSuccessfulRequests: true, handler: (req, res) => res.status(429).send(loginForm(res.locals.csrf, req.body && req.body.next, 'Too many login attempts. Wait 15 minutes and try again.')) });

  const loginForm = (csrf, next, error) => page({ title: 'Log in', csrf, demoMode: cfg.demoMode, body: html`<div class="card login">
    <h1>Log in</h1><p class="muted">Internal system — authorized users only.</p>
    ${error ? html`<div class="flash err">${error}</div>` : ''}
    <form method="post" action="/login">${csrfInput(csrf)}<input type="hidden" name="next" value="${next || '/'}">
    ${field('email', 'Email', { type: 'email', required: true, autocomplete: 'username' })}
    ${field('password', 'Password', { type: 'password', required: true, autocomplete: 'current-password' })}
    <button class="btn">Log in</button></form></div>` });

  app.get('/login', (req, res) => { if (req.session.userId) return res.redirect('/'); res.send(loginForm(res.locals.csrf, req.query.next)); });

  app.post('/login', loginLimiter, (req, res, next) => {
    const email = String(req.body.email || '').trim().slice(0, 254); const pw = String(req.body.password || '').slice(0, 200);
    const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    const ok = bcrypt.compareSync(pw, u ? u.password_hash : DUMMY) && !!u;
    if (!ok) { model.log(db, { action: 'login.failed', detail: email, ip: req.ip }); return res.status(401).send(loginForm(res.locals.csrf, req.body.next, 'Email or password is incorrect.')); }
    let dest = String(req.body.next || '/'); if (!dest.startsWith('/') || dest.startsWith('//')) dest = '/';
    req.session.regenerate(err => { // new session id on login (prevents fixation)
      if (err) return next(err);
      req.session.userId = u.id;
      db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(u.id);
      model.log(db, { action: 'login', user_id: u.id, ip: req.ip });
      req.session.save(() => res.redirect(dest));
    });
  });

  app.post('/logout', (req, res) => { const uid = req.session.userId; req.session.destroy(() => { if (uid) model.log(db, { action: 'logout', user_id: uid }); res.clearCookie('dd.sid'); res.redirect('/login'); }); });
};
