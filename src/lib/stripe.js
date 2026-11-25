'use strict';
// Minimal Stripe Payment Links integration (TEST MODE ONLY in v1). Uses the REST API directly via fetch.
// If STRIPE_SECRET_KEY is missing, the app falls back to a manually pasted payment link.
const crypto = require('crypto');

function mode(key = process.env.STRIPE_SECRET_KEY) {
  if (!key) return 'off';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'blocked-live'; // live keys are refused until Cory approves going live
}

async function stripePost(path, params, key, fetchImpl) {
  const body = new URLSearchParams(params).toString();
  const r = await (fetchImpl || fetch)('https://api.stripe.com/v1/' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' }, body
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Stripe error: ' + ((j.error && j.error.message) || r.status));
  return j;
}

// Creates a one-off Price (with inline product) and a Payment Link for it.
async function createPaymentLink({ amountCents, description, dealId, paymentId }, { key = process.env.STRIPE_SECRET_KEY, fetchImpl } = {}) {
  if (mode(key) !== 'test') throw new Error(mode(key) === 'off' ? 'Stripe is not configured' : 'Live Stripe keys are disabled in v1 (test mode only)');
  const price = await stripePost('prices', { currency: 'usd', unit_amount: String(amountCents), 'product_data[name]': description.slice(0, 120), 'metadata[deal_id]': String(dealId), 'metadata[payment_id]': String(paymentId) }, key, fetchImpl);
  const link = await stripePost('payment_links', { 'line_items[0][price]': price.id, 'line_items[0][quantity]': '1', 'metadata[deal_id]': String(dealId), 'metadata[payment_id]': String(paymentId), 'restrictions[completed_sessions][limit]': '1' }, key, fetchImpl);
  return { priceId: price.id, linkId: link.id, url: link.url, livemode: !!link.livemode };
}

// Verifies a Stripe webhook signature header (t=...,v1=...) against the raw body.
function verifyWebhook(rawBody, header, secret, toleranceSec = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(parts.t + '.' + rawBody).digest('hex');
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

module.exports = { mode, createPaymentLink, verifyWebhook };
