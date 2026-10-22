// Policy Administrator (PA): login, refresh, logout, dan token service.
// Endpoint /auth/* ditangani langsung oleh gateway (tidak diteruskan ke service).
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const audit = require('./audit');
const policy = require('./policy');
const { signUserToken, signServiceToken } = require('../shared/tokens');

const router = express.Router();
router.use(express.json());

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const deviceOf = (req) => req.headers['x-device-id'];

function reply(req, res, { status, body, subjek, allow, reason }) {
  audit.log({ subjek, endpoint: `${req.method} ${req.originalUrl}`, device: deviceOf(req), allow, reason });
  return res.status(status).json(body);
}

function issueRefreshToken(userId, deviceId) {
  const token = crypto.randomBytes(48).toString('hex');
  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at) VALUES (?,?,?,?)'
  ).run(userId, sha256(token), deviceId, Date.now() + config.refreshTokenTtlMs);
  return token;
}

// POST /auth/login - kredensial valid + device terdaftar
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const deviceId = deviceOf(req);
  const user = username && db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  // Pesan error sama untuk user tidak ada / password salah (hindari user enumeration)
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return reply(req, res, {
      status: 401, body: { error: 'kredensial tidak valid' },
      subjek: username || 'anonymous', allow: false, reason: 'kredensial tidak valid',
    });
  }
  const d = policy.decideLogin(user, deviceId);
  if (!d.allow) {
    return reply(req, res, {
      status: 403, body: { error: d.reason }, subjek: `user:${user.username}`, allow: false, reason: d.reason,
    });
  }
  const accessToken = signUserToken(user);
  const refreshToken = issueRefreshToken(user.id, deviceId);
  return reply(req, res, {
    status: 200,
    body: { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 600 },
    subjek: `user:${user.username}`, allow: true, reason: d.reason,
  });
});

// Cari refresh token yang valid (ada, belum dicabut, belum kedaluwarsa)
function findValidRefresh(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(String(token)));
  if (!row || row.revoked || row.expires_at < Date.now()) return null;
  return row;
}

// POST /auth/refresh - tukar refresh token dengan access token baru (refresh token dirotasi)
router.post('/refresh', (req, res) => {
  const deviceId = deviceOf(req);
  const row = findValidRefresh((req.body || {}).refresh_token);
  if (!row) {
    return reply(req, res, {
      status: 401, body: { error: 'refresh token tidak valid, kedaluwarsa, atau sudah dicabut' },
      subjek: 'anonymous', allow: false, reason: 'refresh token tidak valid/dicabut',
    });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  const subjek = `user:${user.username}`;
  if (row.device_id !== deviceId || !policy.isDeviceRegistered(user.id, deviceId)) {
    return reply(req, res, {
      status: 403, body: { error: 'device tidak cocok dengan refresh token' },
      subjek, allow: false, reason: 'device tidak cocok/tidak terdaftar',
    });
  }
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id); // rotasi
  return reply(req, res, {
    status: 200,
    body: {
      access_token: signUserToken(user),
      refresh_token: issueRefreshToken(user.id, deviceId),
      token_type: 'Bearer', expires_in: 600,
    },
    subjek, allow: true, reason: 'refresh token valid',
  });
});

// POST /auth/logout - mencabut refresh token
router.post('/logout', (req, res) => {
  const row = findValidRefresh((req.body || {}).refresh_token);
  if (!row) {
    return reply(req, res, {
      status: 401, body: { error: 'refresh token tidak valid atau sudah dicabut' },
      subjek: 'anonymous', allow: false, reason: 'refresh token tidak valid/dicabut',
    });
  }
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(row.user_id);
  return reply(req, res, {
    status: 200, body: { message: 'logout berhasil, refresh token dicabut' },
    subjek: `user:${user.username}`, allow: true, reason: 'refresh token dicabut',
  });
});

// POST /auth/service - token service (5 menit, role: service) untuk Service Nilai
router.post('/service', (req, res) => {
  const { client_id, client_secret } = req.body || {};
  const expected = config.serviceClients[client_id];
  const ok =
    expected && client_secret &&
    expected.length === String(client_secret).length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(client_secret)));
  if (!ok) {
    return reply(req, res, {
      status: 401, body: { error: 'client id/secret tidak valid' },
      subjek: `service:${client_id || 'unknown'}`, allow: false, reason: 'client id/secret tidak valid',
    });
  }
  return reply(req, res, {
    status: 200,
    body: { access_token: signServiceToken(client_id), token_type: 'Bearer', expires_in: 300 },
    subjek: `service:${client_id}`, allow: true, reason: 'client id dan secret valid',
  });
});

module.exports = router;