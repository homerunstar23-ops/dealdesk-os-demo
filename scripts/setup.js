'use strict';
// One-time setup: writes .env with a random SESSION_SECRET and admin password (if .env doesn't exist),
// and saves the admin login to secrets/admin-login.txt (chmod 600). Never prints the password.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const root = path.join(__dirname, '..'); const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) { console.log('.env already exists — leaving it unchanged.'); process.exit(0); }
const email = process.argv[2] || process.env.ADMIN_EMAIL || 'admin@dealdesk.local';
const pw = crypto.randomBytes(18).toString('base64url');
const env = [
  '# DealDesk OS environment — keep private (chmod 600). See .env.example for all options.',
  'PORT=4100', 'HOST=127.0.0.1', 'NODE_ENV=production',
  'SESSION_SECRET=' + crypto.randomBytes(32).toString('hex'),
  'ADMIN_EMAIL=' + email, 'ADMIN_NAME=Cory Jones', 'ADMIN_PASSWORD=' + pw,
  'SEED_DEMO=1', 'COOKIE_SECURE=0', 'TRUST_PROXY=0', '# STRIPE_SECRET_KEY=sk_test_...   (test mode only in v1)', ''
].join('\n');
fs.writeFileSync(envFile, env, { mode: 0o600 });
fs.mkdirSync(path.join(root, 'secrets'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(root, 'secrets', 'admin-login.txt'), `DealDesk OS admin login (local)\nURL: http://localhost:4100/login\nEmail: ${email}\nPassword: ${pw}\n\nChange this password after first login (Settings > Change password).\nThe password is only used to create the first admin; changing it in the app does not update this file.\n`, { mode: 0o600 });
console.log('Wrote .env and secrets/admin-login.txt (both chmod 600).');
