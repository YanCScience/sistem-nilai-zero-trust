// Klien untuk memanggil service lain *melalui gateway* (bukan langsung).
// Service Nilai memakai token service (POST /auth/service), bukan token user.
const config = require('../config');

const CLIENT_ID = 'service-nilai';
let cached = null; // { token, exp }

async function getServiceToken() {
  if (cached && cached.exp > Date.now() + 10_000) return cached.token;
  const r = await fetch(`${config.urls.gateway}/auth/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: config.serviceClients[CLIENT_ID],
    }),
  });
  if (!r.ok) throw new Error(`gagal mengambil token service (${r.status})`);
  const { access_token } = await r.json();
  cached = { token: access_token, exp: Date.now() + 4.5 * 60 * 1000 }; // token berlaku 5 menit
  return access_token;
}

async function sinkronTranskrip(entries) {
  const token = await getServiceToken();
  const r = await fetch(`${config.urls.gateway}/transkrip/sinkron`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entries }),
  });
  if (!r.ok) throw new Error(`sinkron transkrip ditolak (${r.status}): ${await r.text()}`);
  return r.json();
}

module.exports = { sinkronTranskrip };