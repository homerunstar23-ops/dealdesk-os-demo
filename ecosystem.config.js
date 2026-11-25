// pm2 process file: `pm2 start ecosystem.config.js` (reads .env via server.js)
module.exports = { apps: [{ name: 'dealdesk-os', script: 'server.js', cwd: __dirname, instances: 1, exec_mode: 'fork', autorestart: true, max_memory_restart: '300M', env: { NODE_ENV: 'production', APP_TZ: 'America/New_York' }, out_file: './logs/out.log', error_file: './logs/err.log', time: true }] };
