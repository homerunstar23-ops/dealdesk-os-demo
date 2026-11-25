'use strict';
// Shared view pieces for the automation features (deal portal panel, outbox tables).
const { html, raw, fmtDateTime, fmtDate } = require('../lib/util');
const { csrfInput } = require('./layout');
const stages = require('../lib/stages');

const STATUS_CLS = { queued: 'st-requested', held: 'warn', sent: 'ok', failed: 'err', blocked: 'err', canceled: 'muted' };
const STATUS_LABEL = { queued: 'queued', held: 'held for review', sent: 'sent', failed: 'failed', blocked: 'blocked by consent', canceled: 'canceled' };
const statusBadge = (st, transport) => html`<span class="badge ob-${st} ${STATUS_CLS[st] || ''}">${STATUS_LABEL[st] || st}${st === 'sent' && transport && transport.startsWith('simulated') ? ' (simulated)' : ''}</span>`;

function portalPanel(db, engine, d, csrf) {
  const l = engine.activePortal(d.id);
  const url = l ? engine.portalUrl(d.id, { create: false }) : null;
  const ups = db.prepare('SELECT body, source, created_at FROM portal_updates WHERE deal_id = ? ORDER BY created_at DESC, id DESC LIMIT 5').all(d.id);
  const vis = db.prepare("SELECT COUNT(*) n FROM conditions WHERE deal_id = ? AND borrower_visible = 1 AND status = 'requested'").get(d.id).n;
  return html`<section class="card portal-panel" id="portal"><div class="card-head"><h2>Borrower status portal</h2>${l ? html`<a class="btn small ghost" href="${url}" target="_blank" rel="noopener">Preview ↗</a>` : ''}</div>
<p class="small muted">Investor sees: step timeline (now: <strong>${stages.label(d.stage)}</strong>), plain-English next steps, your expected next-step date (${d.next_step_date ? fmtDate(d.next_step_date) : html`<a href="#next-step">not set</a>`}), ${vis} requested item(s) with upload buttons, updates you post below, and your contact card. Never shown: internal notes, red flags, underwriting notes, items marked internal.</p>
${l ? html`<div class="copy-row"><input readonly value="${url}" id="portal-url-${d.id}" aria-label="Portal link"><button class="btn small" type="button" data-copy="#portal-url-${d.id}">Copy link</button></div>
<p class="small">Verification: <strong>${l.verify_mode === 'email_phone4' ? 'email + last 4 of phone' : l.verify_mode === 'email' ? 'email on file' : 'none (link only)'}</strong> · viewed ${l.view_count}× ${l.last_viewed_at ? html`(last ${fmtDateTime(l.last_viewed_at)})` : ''}${l.failed_count ? html` · <span class="err-text">${l.failed_count} failed attempt(s)</span>` : ''}</p>
<form method="post" action="/deals/${d.id}/portal/revoke" class="inline" data-confirm="Turn off this link? The borrower will need a new one.">${csrfInput(csrf)}<button class="btn small ghost">Revoke link</button></form>` : html`<p>No active link.</p>`}
<form method="post" action="/deals/${d.id}/portal" class="inline">${csrfInput(csrf)}<select name="verify_mode" aria-label="Verification"><option value="email_phone4">Email + last 4 of phone</option><option value="email">Email only</option><option value="none">Link only</option></select><button class="btn small">${l ? 'Replace link' : 'Create link'}</button></form>
<form method="post" action="/deals/${d.id}/portal/update" class="stack mt">${csrfInput(csrf)}<label class="field"><span>Post an update to the borrower's feed</span><textarea name="body" rows="2" maxlength="1000" required placeholder="Plain English. No approval language, rates or promised dates."></textarea></label><button class="btn small">Post update</button></form>
${ups.length ? html`<ul class="feed compact">${ups.map(u => html`<li><time>${fmtDateTime(u.created_at)}</time> <span class="badge muted">${u.source}</span><p>${u.body}</p></li>`)}</ul>` : ''}</section>`;
}

function outboxRows(rows, csrf, { compact = false } = {}) {
  if (!rows.length) return html`<p class="muted">No messages.</p>`;
  return html`<table class="outbox"><thead><tr>${compact ? '' : html`<th><span class="sr">Select</span></th>`}<th>Status</th><th>Message</th><th>To</th><th>Rule</th><th>When</th><th></th></tr></thead><tbody>${rows.map(m => html`<tr>
${compact ? '' : html`<td>${m.status === 'held' ? html`<input type="checkbox" name="ids" value="${m.id}" form="bulk-approve" aria-label="Select message ${m.id}">` : ''}</td>`}
<td>${statusBadge(m.status, m.transport)}<div class="small muted">${m.channel.toUpperCase()} · ${m.purpose}</div></td>
<td><a href="/outbox/${m.id}"><strong>${m.subject || m.body.slice(0, 70) + (m.body.length > 70 ? '…' : '')}</strong></a>${m.reason ? html`<div class="small muted">${m.reason}</div>` : ''}${m.basis ? html`<div class="small ok-text">Basis: ${m.basis}</div>` : ''}</td>
<td class="small">${m.contact_name ? html`<a href="/contacts/${m.contact_id}">${m.contact_name}</a><br>` : ''}${m.to_addr || '—'}${m.deal_name && !compact ? html`<br><a href="/deals/${m.deal_id}">${m.deal_name}</a>` : ''}</td>
<td class="small">${m.rule_key || 'manual'}${m.template_code ? html`<br><span class="tag">${m.template_code}</span>` : ''}</td>
<td class="small">${m.sent_at ? html`Sent ${fmtDateTime(m.sent_at)}` : html`Created ${fmtDateTime(m.created_at)}${m.status === 'queued' && m.send_after ? html`<br>Send after ${fmtDateTime(m.send_after)}` : ''}`}</td>
<td class="actions">${compact ? '' : html`${['held', 'failed'].includes(m.status) ? html`<form method="post" action="/outbox/${m.id}/approve" class="inline">${csrfInput(csrf)}<button class="btn tiny">Approve & send</button></form>` : ''}
${['held', 'queued', 'failed'].includes(m.status) ? html`<form method="post" action="/outbox/${m.id}/cancel" class="inline">${csrfInput(csrf)}<button class="btn tiny ghost">Cancel</button></form>` : ''}`}</td></tr>`)}</tbody></table>`;
}
const OUTBOX_SQL = `SELECT o.*, TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) contact_name, d.name deal_name FROM outbox o LEFT JOIN contacts c ON c.id = o.contact_id LEFT JOIN deals d ON d.id = o.deal_id`;
function dealOutbox(db, dealId) {
  const rows = db.prepare(OUTBOX_SQL + ' WHERE o.deal_id = ? ORDER BY o.id DESC LIMIT 10').all(dealId);
  return html`<section class="card"><div class="card-head"><h2>Automated messages for this deal</h2><a class="btn small ghost" href="/outbox?deal_id=${dealId}">Open in Outbox</a></div>${outboxRows(rows, '', { compact: true })}</section>`;
}
module.exports = { portalPanel, outboxRows, dealOutbox, statusBadge, OUTBOX_SQL, STATUS_LABEL };
