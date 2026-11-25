'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { html, str, email, url, fmtDateTime } = require('../lib/util');
const { field, csrfInput } = require('../views/layout');
const { requireAdmin } = require('../lib/security');
const model = require('../lib/model');
const seed = require('../seed');
const stripe = require('../lib/stripe');

const PROFILE = [['lo_name', 'Your name (as licensed)'], ['lo_title', 'Title'], ['nmls_id', 'Your NMLS #'], ['company_name', 'Sponsoring company (legal name)'], ['company_short', 'Company short name'], ['company_nmls_id', 'Company NMLS #'], ['phone', 'Business phone'], ['physical_address', 'Physical mailing address (CAN-SPAM)'], ['state_disclosures', 'Required state license disclosures'], ['booking_link', 'Booking link (https)'], ['tool_link', 'Educational tool link (https)'], ['public_base_url', 'Public base URL of this app (for upload links)'], ['public_brand', 'Name shown on the public intake form']];

module.exports = (app) => {
  const db = app.locals.db; const cfg = app.locals.config;
  app.get('/settings', (req, res) => {
    const s = model.getSettings(db);
    const users = db.prepare('SELECT id, email, name, role, active, last_login_at FROM users ORDER BY id').all();
    const demo = db.prepare('SELECT COUNT(*) n FROM deals WHERE is_demo = 1').get().n + db.prepare('SELECT COUNT(*) n FROM contacts WHERE is_demo = 1').get().n;
    res.page('Settings', '/settings', html`<h1>Settings</h1><div class="grid2">
<section class="card"><h2>Loan officer profile (merge fields & disclosures)</h2><p class="small muted">Used in templates, estimates and the public form footer. Confirm wording with your sponsor's compliance team.</p>
<form method="post" action="/settings/profile" class="form-grid">${csrfInput(res.locals.csrf)}${PROFILE.map(([k, l]) => field(k, l, { value: s[k], type: k === 'state_disclosures' || k === 'physical_address' ? 'textarea' : 'text', cls: k === 'state_disclosures' || k === 'physical_address' ? 'span2' : '' }))}
<div class="span2"><button class="btn">Save profile</button></div></form></section>
<section class="card"><h2>Change password</h2><form method="post" action="/settings/password" class="form-grid">${csrfInput(res.locals.csrf)}
${field('current', 'Current password', { type: 'password', required: true, autocomplete: 'current-password' })}${field('next', 'New password (12+ chars)', { type: 'password', required: true, autocomplete: 'new-password' })}
<div class="span2"><button class="btn small">Change password</button></div></form>
<h2>Users</h2><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th></tr></thead><tbody>${users.map(u => html`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role}${u.active ? '' : ' (disabled)'}</td><td>${fmtDateTime(u.last_login_at)}</td></tr>`)}</tbody></table>
${req.user.role === 'admin' ? html`<form method="post" action="/settings/users" class="form-grid">${csrfInput(res.locals.csrf)}${field('name', 'Name', { required: true })}${field('email', 'Email', { type: 'email', required: true })}
${field('password', 'Temporary password (12+ chars)', { type: 'password', required: true, autocomplete: 'new-password' })}${field('role', 'Role', { type: 'select', options: [['staff', 'Staff (processor/assistant)'], ['admin', 'Admin']] })}<div class="span2"><button class="btn small">Add user</button> <span class="small muted">v1: all users see all records. Granular permissions are on the roadmap.</span></div></form>` : ''}</section>
<section class="card"><h2>Integrations</h2><dl class="dl"><dt>Stripe</dt><dd>${{ test: 'Test mode key configured', off: 'Not configured — manual payment links', 'blocked-live': 'Live key detected and DISABLED (v1 is test-mode only)' }[stripe.mode(cfg.stripeKey)]}</dd>
<dt>Stripe webhook</dt><dd>${cfg.stripeWebhookSecret ? 'Configured (POST /webhooks/stripe)' : 'Not configured — mark payments paid manually'}</dd><dt>Email / SMS sending</dt><dd>Off in v1 (copy-to-clipboard templates only)</dd>
<dt>Uploads</dt><dd>Stored outside the web root · max ${cfg.maxUploadMb} MB · links expire after ${cfg.uploadLinkDays} days by default</dd></dl></section>
<section class="card"><h2>Data</h2>${req.user.role === 'admin' ? html`<p><a class="btn small" href="/settings/backup">Download database backup</a> <span class="small muted">Contains borrower data — store encrypted. Uploaded files are backed up separately (see SECURITY.md).</span></p>
${demo ? html`<form method="post" action="/settings/delete-demo" data-confirm="Delete all DEMO records?">${csrfInput(res.locals.csrf)}<button class="btn small danger">Delete demo data (${demo} demo deals + contacts)</button></form>` : html`<p class="muted">No demo data present.</p>`}` : html`<p class="muted">Admins only.</p>`}</section></div>`);
  });
  app.post('/settings/profile', (req, res) => {
    PROFILE.forEach(([k]) => {
      let v = str(req.body[k], k === 'state_disclosures' || k === 'physical_address' ? 1000 : 200) || '';
      if (['booking_link', 'tool_link'].includes(k) && v && !url(v)) v = '';
      if (k === 'public_base_url' && v && !/^https?:\/\/[^\s]+$/.test(v)) v = '';
      model.setSetting(db, k, v);
    });
    model.log(db, { action: 'settings.updated', detail: 'Profile settings updated', user_id: req.user.id });
    req.flash('Profile saved.'); res.redirect('/settings');
  });
  app.post('/settings/password', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const next = String(req.body.next || '');
    if (!bcrypt.compareSync(String(req.body.current || ''), u.password_hash)) { req.flash('Current password is incorrect.', 'err'); return res.redirect('/settings'); }
    if (next.length < 12 || next.length > 200) { req.flash('New password must be 12–200 characters.', 'err'); return res.redirect('/settings'); }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 12), u.id);
    db.prepare('DELETE FROM sessions WHERE sid != ? AND sess LIKE ?').run(req.sessionID, '%"userId":' + u.id + '%');
    model.log(db, { action: 'password.changed', user_id: u.id });
    req.flash('Password changed. Other sessions were signed out.'); res.redirect('/settings');
  });
  app.post('/settings/users', requireAdmin, (req, res) => {
    const e = email(req.body.email), n = str(req.body.name, 100), p = String(req.body.password || ''), role = req.body.role === 'admin' ? 'admin' : 'staff';
    if (!e || !n || p.length < 12) { req.flash('Name, valid email and a 12+ character password are required.', 'err'); return res.redirect('/settings'); }
    try { db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)').run(e, n, bcrypt.hashSync(p, 12), role); } catch { req.flash('That email already has an account.', 'err'); return res.redirect('/settings'); }
    model.log(db, { action: 'user.created', detail: 'User added: ' + e + ' (' + role + ')', user_id: req.user.id });
    req.flash('User added.'); res.redirect('/settings');
  });
  app.get('/settings/backup', requireAdmin, async (req, res, next) => {
    try {
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ddbk-')), 'dealdesk-backup.db');
      await db.backup(tmp);
      model.log(db, { action: 'backup.downloaded', user_id: req.user.id });
      res.download(tmp, `dealdesk-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(path.dirname(tmp), { recursive: true, force: true }, () => {}));
    } catch (e) { next(e); }
  });
  app.post('/settings/delete-demo', requireAdmin, (req, res) => {
    const files = db.prepare('SELECT stored_name FROM files WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = 1)').all();
    files.forEach(f => { try { fs.unlinkSync(path.join(cfg.uploadDir, path.basename(f.stored_name))); } catch (e) { /* gone */ } });
    seed.deleteDemo(db);
    model.log(db, { action: 'demo.deleted', detail: 'Demo data deleted', user_id: req.user.id });
    req.flash('Demo data deleted.'); res.redirect('/settings');
  });
};
