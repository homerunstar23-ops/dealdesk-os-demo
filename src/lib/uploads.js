'use strict';
// Upload validation + storage outside the web root. Files are never served publicly;
// staff download them through an authenticated route as attachments.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sha256, randomToken } = require('./util');

const TYPES = {
  '.pdf': { mime: 'application/pdf', check: b => b.slice(0, 5).toString('latin1') === '%PDF-' },
  '.jpg': { mime: 'image/jpeg', check: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mime: 'image/jpeg', check: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.png': { mime: 'image/png', check: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.heic': { mime: 'image/heic', check: b => b.slice(4, 8).toString('latin1') === 'ftyp' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: b => b.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: b => b.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  '.doc': { mime: 'application/msword', check: b => b.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) },
  '.xls': { mime: 'application/vnd.ms-excel', check: b => b.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) },
  '.csv': { mime: 'text/csv', check: b => !b.includes(0) },
  '.txt': { mime: 'text/plain', check: b => !b.includes(0) }
};
const ALLOWED = Object.keys(TYPES);

function uploader(maxMb) {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 10, fieldSize: 2000 } }).single('file');
}

function validate(file) {
  if (!file || !file.buffer || !file.size) return 'Choose a file to upload.';
  const ext = path.extname(file.originalname || '').toLowerCase();
  const t = TYPES[ext];
  if (!t) return 'That file type is not accepted. Allowed: ' + ALLOWED.join(', ');
  if (!t.check(file.buffer)) return 'The file contents do not match its extension.';
  return null;
}

function safeName(n) { return String(n || 'file').replace(/[^\w.\- ()]+/g, '_').slice(-120); }

function store(dir, file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const stored = randomToken(18) + ext;
  fs.writeFileSync(path.join(dir, stored), file.buffer, { mode: 0o600, flag: 'wx' });
  return { stored, ext, mime: TYPES[ext].mime, sha: sha256(file.buffer), original: safeName(file.originalname) };
}

module.exports = { uploader, validate, store, ALLOWED, TYPES, safeName };
