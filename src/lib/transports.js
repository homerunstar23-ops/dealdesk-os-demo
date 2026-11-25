'use strict';
// Outbound transports. Real sending happens ONLY when credentials are configured in env:
//   Email: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM   (Gmail app password, Brevo, Resend SMTP…)
//   SMS:   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID)   — Twilio is paid
// Otherwise the send is simulated: nothing leaves the app, and the outbox records "simulated".
// OUTBOUND_DRY_RUN=1 forces simulation even when credentials exist.
let mailer = null;
function emailConfigured(env = process.env) { return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM); }
function smsConfigured(env = process.env) { return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)); }
function dryRun(config = {}, env = process.env) { return config.forceSimulate === true || env.OUTBOUND_DRY_RUN === '1' || env.NODE_ENV === 'test'; }

async function send(msg, config = {}, env = process.env) {
  if (msg.channel === 'email') {
    if (dryRun(config, env) || !emailConfigured(env)) return { transport: 'simulated-email', simulated: true, id: 'sim-' + Date.now() };
    if (!mailer) mailer = require('nodemailer').createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: Number(env.SMTP_PORT) === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
    const info = await mailer.sendMail({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject || '(no subject)', text: msg.body,
      headers: msg.unsubscribeUrl ? { 'List-Unsubscribe': `<${msg.unsubscribeUrl}>` } : undefined });
    return { transport: 'smtp', id: info.messageId };
  }
  if (msg.channel === 'sms') {
    if (dryRun(config, env) || !smsConfigured(env)) return { transport: 'simulated-sms', simulated: true, id: 'sim-' + Date.now() };
    const p = new URLSearchParams({ To: msg.to, Body: msg.body.slice(0, 1500) });
    if (env.TWILIO_MESSAGING_SERVICE_SID) p.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID); else p.set('From', env.TWILIO_FROM);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: 'POST', body: p,
      headers: { Authorization: 'Basic ' + Buffer.from(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' } });
    const j = await r.json(); if (!r.ok) throw new Error('Twilio: ' + (j.message || r.status));
    return { transport: 'twilio', id: j.sid };
  }
  throw new Error('Unknown channel ' + msg.channel);
}
module.exports = { send, emailConfigured, smsConfigured, dryRun };
