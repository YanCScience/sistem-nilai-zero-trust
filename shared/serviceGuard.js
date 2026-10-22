// Middleware keamanan untuk service (assume breach: service tidak percaya pada jaringan).
// 1) X-Gateway-Secret harus benar -> service tidak bisa diakses langsung, harus lewat gateway.
// 2) Access token / token service harus valid (tanda tangan + masa berlaku),
//    walaupun gateway secret benar.
const crypto = require('crypto');
const config = require('../config');
const { verifyAccessToken, extractBearer } = require('./tokens');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function serviceGuard(serviceName) {
  return (req, res, next) => {
    if (!safeEqual(req.headers['x-gateway-secret'], config.gatewaySecret)) {
      console.log(`[${serviceName}] TOLAK: X-Gateway-Secret tidak ada/salah (${req.method} ${req.path})`);
      return res.status(403).json({ error: 'hanya dapat diakses melalui gateway' });
    }
    const token = extractBearer(req);
    if (!token) return res.status(401).json({ error: 'access token tidak ada' });
    try {
      req.subject = verifyAccessToken(token);
    } catch (e) {
      console.log(`[${serviceName}] TOLAK: token tidak valid (${e.message})`);
      return res.status(401).json({ error: 'access token tidak valid atau kedaluwarsa' });
    }
    next();
  };
}

module.exports = serviceGuard;