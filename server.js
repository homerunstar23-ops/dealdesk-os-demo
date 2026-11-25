'use strict';
// Entry point: loads .env (if present), starts DealDesk OS on PORT (default 4100), bound to HOST (default 127.0.0.1).
const fs = require('fs'); const path = require('path');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });
const { createApp } = require('./src/app');
const app = createApp();
const port = Number(process.env.PORT || 4100), host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`DealDesk OS listening on http://${host}:${port}`));
