'use strict';
// Templates used by the automation engine. Seeded into the templates library (category "Automation"
// and "Nurture sequences") and editable there. Footer (disclosure block, physical address,
// unsubscribe link / STOP language) is appended automatically at send time.
// No rate quotes, no approval language, no promised timelines.
const T = (code, category, name, channel, subject, body) => ({ code, category, name, channel, subject, body, source_doc: 'DealDesk automation (v2)' });
const A = 'Automation';
const N = 'Nurture sequences';
module.exports = [
  T('A-intake-ack-email', A, 'New intake — instant acknowledgement (email)', 'email', 'We received your {{LOAN_TYPE}} scenario — {{PROPERTY_SHORT}}',
    'Hi {{FIRST_NAME}},\n\nThanks for sending your {{LOAN_TYPE}} scenario for {{PROPERTY_SHORT}}. A licensed loan officer will review it and follow up.\n\nYou can see where things stand at any time on your secure status page:\n{{PORTAL_LINK}}\n(You will be asked to confirm your email address and the last 4 digits of your phone number.)\n\nThis is not an application, approval, rate quote or commitment to lend.\n\n{{LO_NAME}}'),
  T('A-intake-ack-sms', A, 'New intake — instant acknowledgement (text, consented only)', 'sms', null,
    '{{LO_FIRST}} here: got your {{LOAN_TYPE}} scenario for {{PROPERTY_SHORT}}. Status page: {{PORTAL_LINK}}'),
  T('A-stage-email', A, 'Stage change — status update (email)', 'email', 'Status update — {{PROPERTY_SHORT}}: {{STAGE_LABEL}}',
    'Hi {{FIRST_NAME}},\n\nYour file for {{PROPERTY_SHORT}} is now at: {{STAGE_LABEL}}.\n\nWhat happens now: {{STAGE_NOW}}\n\nWhat we need from you: {{STAGE_NEED}}\n\nSee your checklist and the full timeline here:\n{{PORTAL_LINK}}\n\n{{LO_NAME}}'),
  T('A-stage-sms', A, 'Stage change — status update (text, consented only)', 'sms', null,
    'Update on {{PROPERTY_SHORT}}: now at "{{STAGE_LABEL}}". Details: {{PORTAL_LINK}}'),
  T('A-conditions-email', A, 'Conditions issued (email)', 'email', 'Items needed to keep your file moving — {{PROPERTY_SHORT}}',
    'Hi {{FIRST_NAME}},\n\nUnderwriting has listed items needed before your file for {{PROPERTY_SHORT}} can move toward closing:\n{{CONDITION_LIST}}\n\nPlease upload them on your status page: {{PORTAL_LINK}}\n\nThese are requirements, not a final approval or commitment to lend.\n\n{{LO_NAME}}'),
  T('A-ctc-email', A, 'Clear to close + wire safety (email)', 'email', 'Clear to close — {{PROPERTY_SHORT}} (please read the wire-safety note)',
    'Hi {{FIRST_NAME}},\n\nThe lender has indicated your file for {{PROPERTY_SHORT}} is clear to close. Closing is being coordinated with the title/escrow company.\n\nWIRE SAFETY: always confirm wire instructions by calling the title company at a phone number you already know. Never trust wire instructions or changes sent by email or text — including from me.\n\nStatus page: {{PORTAL_LINK}}\n\n{{LO_NAME}}'),
  T('A-closed-email', A, 'Closed — thank you (email)', 'email', 'Closed — thank you, {{FIRST_NAME}}',
    'Hi {{FIRST_NAME}},\n\nYour loan for {{PROPERTY_SHORT}} has closed. Thank you for working with me — keep a copy of your closing package for your records.\n\nWhenever you are analyzing your next deal, I am happy to walk through it.\n\n{{LO_NAME}}'),
  T('A-docs-reminder-email', A, 'Missing documents reminder (email)', 'email', 'Reminder: items still needed for {{PROPERTY_SHORT}}',
    'Hi {{FIRST_NAME}},\n\nFriendly reminder — these items are still needed for {{PROPERTY_SHORT}}:\n{{ITEM_LIST}}\n\nYou can upload them securely here: {{PORTAL_LINK}}\n\nIf anything is unclear or you need more time, just reply and let me know.\n\n{{LO_NAME}}'),
  T('A-docs-reminder-sms', A, 'Missing documents reminder (text, consented only)', 'sms', null,
    'Reminder from {{LO_FIRST}}: a few items are still needed for {{PROPERTY_SHORT}}. Upload here: {{PORTAL_LINK}}'),
  T('A-daily-digest', A, 'Daily digest for the loan officer (internal)', 'email', 'DealDesk daily digest — {{DATE}}', '{{DIGEST_BODY}}'),
  // Nurture sequences (marketing: require email consent; stop on reply/stage change/opt-out)
  T('N-dscr-explainer', N, 'Investor nurture — DSCR explainer', 'email', 'How lenders commonly size a rental loan',
    'Hi {{FIRST_NAME}},\n\nA quick explainer while you line up your next property: many rental (DSCR) loans compare the monthly rent to the full monthly payment — principal, interest, taxes, insurance and any HOA. That ratio is the DSCR. Each lender sets its own minimums and terms.\n\nIf you want, reply with a property you are looking at and I can walk through what lenders typically look at.\n\n{{LO_NAME}}'),
  T('N-scenario-call', N, 'Investor nurture — offer a scenario call', 'email', 'Want to walk through your numbers?',
    'Hi {{FIRST_NAME}},\n\nIf you have a property under contract or in your sights, I am happy to do a 15-minute call to go over the numbers and the documents lenders usually ask for. Just reply with a couple of times that work.\n\nEducational only — terms are available only after a full application.\n\n{{LO_NAME}}'),
  T('N-partner-intro', N, 'Partner — intro & resources', 'email', 'Resources for your investor clients',
    'Hi {{FIRST_NAME}},\n\nGood connecting. I work with real estate investors on business-purpose financing (rental, fix & flip, bridge, ground-up). I put together free educational tools and checklists your investor clients can use before they talk to a lender. Happy to share them whenever useful.\n\n{{LO_NAME}}'),
  T('N-partner-session', N, 'Partner — educational session invite', 'email', 'Short educational session for investor clients?',
    'Hi {{FIRST_NAME}},\n\nWould a short educational session on how investor loans are commonly sized (DSCR, loan-to-cost, ARV) be useful for your clients or team? No pitch — just the math and the document checklist.\n\n{{LO_NAME}}'),
  T('N-partner-checkin', N, 'Partner — 30-day check-in', 'email', 'Checking in',
    'Hi {{FIRST_NAME}},\n\nChecking in — are any of your investor clients working through financing questions I could help explain? (No referral fees or gifts — just a resource.)\n\n{{LO_NAME}}')
];
module.exports.SEQUENCES = [
  { key: 'investor-lead-21', name: 'Investor lead nurture (21 days)', audience: 'New investor leads at the Lead stage (auto-enrolled from the public intake if they gave email consent)',
    steps: [{ day: 2, template: 'N-dscr-explainer' }, { day: 7, template: 'F-4' }, { day: 12, template: 'N-scenario-call' }, { day: 21, template: 'F-5' }] },
  { key: 'partner-30', name: 'Referral partner intro (30 days)', audience: 'Agents, property managers, wholesalers (email consent required)',
    steps: [{ day: 1, template: 'N-partner-intro' }, { day: 14, template: 'N-partner-session' }, { day: 30, template: 'N-partner-checkin' }] }
];
