'use strict';
// Borrower-facing stage wording for the investor status portal and automated updates.
// Plain English, no promised timelines, no approval/commitment language. Review with sponsor compliance.
const PORTAL_STAGES = ['Lead', 'Application', 'Processing', 'Underwriting', 'Conditionally Approved', 'Clear to Close', 'Closed'];

const STAGE_INFO = {
  'Lead': {
    label: 'Scenario received',
    now: 'Your loan officer is reviewing the scenario you sent to see which financing options may fit the property and your plans.',
    need: 'Answer any follow-up questions about the property, your plans and your timeline. Keep your purchase contract and property details handy.',
    next: 'If an option looks like a fit, you will usually be invited to complete a full application through the lender\'s process.'
  },
  'Application': {
    label: 'Application',
    now: 'Your application is being set up and the document checklist for your loan type has been created.',
    need: 'Complete the application and upload the items listed under "What we need from you" below.',
    next: 'Once the application and initial documents are in, the file typically moves into processing.'
  },
  'Processing': {
    label: 'Processing',
    now: 'Documents are being collected and checked, and third-party items such as the appraisal, title and insurance are typically being requested through the lender\'s process.',
    need: 'Upload any remaining checklist items and respond to document requests when you can.',
    next: 'When the file is complete, it is typically submitted to the lender\'s underwriting team for review.'
  },
  'Underwriting': {
    label: 'Underwriting review',
    now: 'The lender\'s underwriter is reviewing the file, including the property, the documents and the loan request.',
    need: 'Watch for questions or document requests, and let your loan officer know before making changes that could affect the file (for example, moving funds or changing the vesting entity).',
    next: 'Underwriting typically responds with a list of conditions — items that must be provided or satisfied before closing — or with questions.'
  },
  'Conditionally Approved': {
    label: 'Conditions issued',
    now: 'Underwriting has listed conditions that must be satisfied before the file can move toward closing. Conditions are requirements, not a final approval or commitment to lend.',
    need: 'Provide the items listed under "Conditions from underwriting" below. Each one is reviewed after it is received.',
    next: 'After the conditions are reviewed and cleared, the file may be cleared to close by the lender.'
  },
  'Clear to Close': {
    label: 'Clear to close',
    now: 'The lender has indicated the file is clear to close, and closing is being coordinated with the title or escrow company.',
    need: 'Review closing documents when you receive them and arrange funds to close. WIRE SAFETY: always confirm wire instructions by calling the title company at a phone number you already know — never trust wire instructions or changes sent by email or text.',
    next: 'You sign the closing documents; funding follows the lender\'s and title company\'s process.'
  },
  'Closed': {
    label: 'Closed',
    now: 'This loan has closed. Thank you for working with us.',
    need: 'Keep a copy of your closing package for your records.',
    next: 'Reach out any time you are analyzing your next deal.'
  },
  'Dead': {
    label: 'File inactive',
    now: 'This file is not currently active.',
    need: 'If you would like to restart or have questions, contact your loan officer.',
    next: 'Your loan officer can explain the options available.'
  }
};
const label = (stage) => (STAGE_INFO[stage] || { label: stage }).label;
module.exports = { PORTAL_STAGES, STAGE_INFO, label };
