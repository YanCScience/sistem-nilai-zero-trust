// API Gateway = Policy Enforcement Point (PEP). Satu-satunya pintu masuk (port 3000).
// Alur tiap request: verifikasi access token -> tanya Policy Engine -> audit log -> proxy ke service.
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('../config');
const audit = require('./audit');
const policy = require('./policy');
const authRouter = require('./auth');
const { verifyAccessToken, extractBearer } = require('../shared/tokens');

const app = express();
app.disable('x-powered-by');

// /auth/* ditangani langsung oleh gateway (PA), tidak diteruskan ke service
app.use('/auth', authRouter);

// ---- PEP: berlaku untuk semua request selain /auth/* ----
function pep(req, res, next) {
  const endpoint = `${req.method} ${req.path}`;
  const deviceId = req.headers['x-device-id'];
  const deny = (status, subjek, reason) => {
    audit.log({ subjek, endpoint, device: deviceId, allow: false, reason });
    return res.status(status).json({ error: 'akses ditolak', alasan: reason });
  };

  // 1. Wajib access token valid (tanda tangan + masa berlaku)
  const token = extractBearer(req);
  if (!token) return deny(401, 'anonymous', 'access token tidak ada');
  let subject;
  try {
    subject = verifyAccessToken(token);
  } catch (e) {
    return deny(401, 'anonymous', `access token tidak valid: ${e.message}`);
  }
  const subjek = `${subject.type}:${subject.sub}(${subject.role})`;

  // 2. Minta keputusan ke Policy Engine
  const decision = policy.decide({
    method: req.method, path: req.path, query: req.query, subject, deviceId,
  });
  if (!decision.allow) return deny(403, subjek, decision.reason);

  // 3. Allow -> catat, lalu teruskan (header X-Gateway-Secret ditambahkan oleh proxy)
  audit.log({ subjek, endpoint, device: deviceId, allow: true, reason: decision.reason });
  next();
}
app.use(pep);

// ---- Proxy ke service. X-Gateway-Secret selalu ditimpa oleh gateway,
//      sehingga nilai kiriman client tidak pernah sampai ke service. ----
const proxyTo = (target, pathFilter) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    pathFilter,
    headers: { 'X-Gateway-Secret': config.gatewaySecret },
  });

// pathFilter berupa fungsi agar pencocokan jelas (bukan glob)
const startsWithSeg = (seg) => (pathname) => pathname === seg || pathname.startsWith(seg + '/');
app.use(proxyTo(config.urls.nilai, (p) => startsWithSeg('/nilai')(p) || startsWithSeg('/kelas')(p)));
app.use(proxyTo(config.urls.transkrip, startsWithSeg('/transkrip')));

// Request lain yang lolos PEP (seharusnya tidak ada, default-deny di policy)
app.use((req, res) => res.status(404).json({ error: 'endpoint tidak ditemukan' }));

if (require.main === module) {
  app.listen(config.ports.gateway, () =>
    console.log(`[gateway] PEP berjalan di port ${config.ports.gateway}`)
  );
}
module.exports = app;