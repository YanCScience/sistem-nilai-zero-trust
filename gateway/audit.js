// Audit log (4.4): setiap keputusan akses dicatat ke tabel audit_log + stdout.
const db = require('../db');

const insert = db.prepare(
  'INSERT INTO audit_log (waktu, subjek, endpoint, device, hasil, alasan) VALUES (?,?,?,?,?,?)'
);

function log({ subjek, endpoint, device, allow, reason }) {
  const waktu = new Date().toISOString();
  const hasil = allow ? 'allow' : 'deny';
  insert.run(waktu, subjek || 'anonymous', endpoint, device || null, hasil, reason);
  console.log(
    `[AUDIT] ${waktu} | ${subjek || 'anonymous'} | ${endpoint} | device=${device || '-'} | ${hasil.toUpperCase()} | ${reason}`
  );
}

module.exports = { log };