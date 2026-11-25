'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { openDb } = require('./db');
const { SqliteStore, csrfMiddleware, requireAuth } = require('./lib/security');
const { page } = require('./views/layout');
const model = require('./lib/model');
const seed = require('./seed');
const { createEngine } = require('./lib/engine');

function createApp(opts = {}) {
  const config = Object.assign({
    dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'dealdesk.db'),
    uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads'),
    sessionSecret: process.env.SESSION_SECRET,
    secureCookies: process.env.COOKIE_SECURE === '1',
    trustProxy: process.env.TRUST_PROXY === '1',
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 15),
    uploadLinkDays: Number(process.env.UPLOAD_LINK_DAYS || 14),
    loginMax: Number(process.env.LOGIN_MAX_ATTEMPTS || 10),
    intakeMax: Number(process.env.INTAKE_MAX_PER_HOUR || 20),
    seedDemo: process.env.SEED_DEMO !== '0',
    stripeKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    stripeFetch: null,
    scheduler: process.env.SCHEDULER !== '0',
    forceSimulate: process.env.OUTBOUND_DRY_RUN === '1',
    demoMode: process.env.DEMO_MODE === '1',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || ''
  }, opts);
  if (!config.sessionSecret) throw new Error('SESSION_SECRET is required (see .env.example)');
  fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });

  const db = opts.db || openDb(config.dbFile);
  seed.ensureBase(db, { adminEmail: process.env.ADMIN_EMAIL || opts.adminEmail, adminPassword: process.env.ADMIN_PASSWORD || opts.adminPassword, adminName: process.env.ADMIN_NAME || opts.adminName });
  if (config.publicBaseUrl) model.setSetting(db, 'public_base_url', config.publicBaseUrl);
  const engine = createEngine({ db, config });
  if (config.seedDemo) { seed.seedDemo(db); seed.seedDemoV2(db, engine); }

  const app = express();
  app.locals.db = db; app.locals.config = config; app.locals.engine = engine;
  engine.start(); // in-app scheduler (node-cron, every minute); off when config.scheduler === false
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: true, directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"], 'upgrade-insecure-requests': config.secureCookies ? [] : null } },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' }
  }));
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: false }));
  app.use('/webhooks/stripe', express.raw({ type: 'application/json', limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 500 }));
  app.use(express.json({ limit: '200kb' }));
  app.use(session({
    name: 'dd.sid', secret: config.sessionSecret, store: new SqliteStore(db), resave: false, saveUninitialized: false, rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 8 * 3600 * 1000 }
  }));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(csrfMiddleware);

  // Render helper with shared chrome.
  app.use((req, res, next) => {
    res.page = (title, active, body, extra = {}) => {
      const flash = req.session.flash; if (flash) delete req.session.flash;
      res.send(page({ title, active, body, user: req.user, csrf: res.locals.csrf, settings: model.getSettings(db), flash, demoMode: config.demoMode, ...extra }));
    };
    req.flash = (msg, type = 'ok') => { req.session.flash = { msg, type }; };
    next();
  });

  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/favicon.svg'));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  require('./routes/auth')(app);
  require('./routes/public')(app);       // /apply, /u/:token, stripe webhook (no login)
  require('./routes/portal')(app);       // /p/:token borrower status portal, /unsub/:token, /webhooks/sms (no login)
  app.use(requireAuth);                   // everything below requires login
  require('./routes/dashboard')(app);
  require('./routes/crm')(app);
  require('./routes/deals')(app);
  require('./routes/library')(app);       // templates + compliance
  require('./routes/settings')(app);
  require('./routes/automation')(app);    // /outbox, /automations

  app.use((req, res) => res.status(404).page('Not found', '', '<h1>Not found</h1><p><a href="/">Back to dashboard</a></p>'));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    res.status(status).send(status === 413 ? 'File too large.' : 'Something went wrong. The error was logged.');
  });
  return app;
}
module.exports = { createApp };
