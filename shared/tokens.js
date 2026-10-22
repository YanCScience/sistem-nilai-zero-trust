// Penerbitan & verifikasi JWT. Dipakai gateway (menerbitkan + verifikasi)
// dan service (verifikasi ulang, 4.1 "Verifikasi ulang di service").
const jwt = require('jsonwebtoken');
const config = require('../config');

const ALG = 'HS256';

function signUserToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, typ: 'user' }, config.jwtSecret, {
    algorithm: ALG,
    expiresIn: config.accessTokenTtl,
  });
}

function signServiceToken(clientId) {
  return jwt.sign({ sub: clientId, role: 'service', typ: 'service' }, config.jwtSecret, {
    algorithm: ALG,
    expiresIn: config.serviceTokenTtl,
  });
}

// Mengembalikan subject { type, sub, role } atau melempar error (tanda tangan salah / kedaluwarsa).
function verifyAccessToken(token) {
  const p = jwt.verify(token, config.jwtSecret, { algorithms: [ALG] });
  if (p.typ === 'service') {
    if (p.role !== 'service') throw new Error('token service tidak valid');
    return { type: 'service', sub: p.sub, role: 'service' };
  }
  if (p.typ === 'user' && p.role && p.sub) {
    return { type: 'user', sub: Number(p.sub), role: p.role };
  }
  throw new Error('klaim token tidak lengkap');
}

// Ambil token dari header "Authorization: Bearer <token>"
function extractBearer(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer (.+)$/i);
  return m ? m[1] : null;
}

module.exports = { signUserToken, signServiceToken, verifyAccessToken, extractBearer };