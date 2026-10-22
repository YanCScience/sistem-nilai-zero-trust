const path = require('path');

module.exports = {
  ports: {
    gateway: Number(process.env.GATEWAY_PORT || 3000),
    nilai: Number(process.env.NILAI_PORT || 3001),
    transkrip: Number(process.env.TRANSKRIP_PORT || 3002),
  },
  urls: {
    nilai: process.env.NILAI_URL || 'http://localhost:3001',
    transkrip: process.env.TRANSKRIP_URL || 'http://localhost:3002',
    gateway: process.env.GATEWAY_URL || 'http://localhost:3000',
  },
  dbPath: process.env.DB_PATH || path.join(__dirname, 'db', 'nilai.db'),

  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-ganti-di-produksi',
  gatewaySecret: process.env.GATEWAY_SECRET || 'dev-gateway-secret-ganti-di-produksi',

  accessTokenTtl: '10m',                   // access token 10 menit
  refreshTokenTtlMs: 24 * 60 * 60 * 1000,  // refresh token 1 hari
  serviceTokenTtl: '5m',                   // token service 5 menit

  serviceClients: {
    'service-nilai': process.env.SERVICE_NILAI_SECRET || 'dev-service-nilai-secret',
  },

  // jam akses ubah/finalisasi nilai; bisa diubah agar mudah didemokan
  accessHours: {
    start: Number(process.env.ACCESS_HOUR_START || 7),
    end: Number(process.env.ACCESS_HOUR_END || 21),
  },
};