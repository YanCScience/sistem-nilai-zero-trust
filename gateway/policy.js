// Policy Engine (PE) - memutuskan allow/deny berdasarkan Tabel 3 + atribut dari database.
// Fungsi murni: input konteks request -> { allow, reason }. Tidak menyentuh HTTP.
const db = require('../db');
const config = require('../config');

const allow = (reason) => ({ allow: true, reason });
const deny = (reason) => ({ allow: false, reason });

// ---------- Atribut dari database ----------
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const getKelas = (id) => db.prepare('SELECT * FROM kelas WHERE id = ?').get(id);
const getNilai = (id) => db.prepare('SELECT * FROM nilai WHERE id = ?').get(id);

// ---------- Verifikasi konteks (4.3) ----------
function isDeviceRegistered(userId, deviceId) {
  if (!deviceId) return false;
  return !!db
    .prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?')
    .get(userId, deviceId);
}

function isWithinAccessHours(now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= config.accessHours.start && h < config.accessHours.end;
}

const fmtHours = () =>
  `${String(config.accessHours.start).padStart(2, '0')}.00-${String(config.accessHours.end).padStart(2, '0')}.00`;

// ---------- Keputusan login (POST /auth/login) ----------
// Kredensial diverifikasi oleh modul auth (langkah 5); di sini dicek device-nya.
function decideLogin(user, deviceId) {
  if (!isDeviceRegistered(user.id, deviceId)) {
    return deny('device tidak terdaftar untuk user ini');
  }
  return allow('kredensial valid dan device terdaftar');
}

// ---------- Keputusan akses resource ----------
// ctx: { method, path, query, subject, deviceId, now }
// subject: { type: 'user'|'service', sub, role } hasil verifikasi token (sudah valid)
function decide(ctx) {
  const { method, path, query = {}, subject, deviceId, now } = ctx;

  if (!subject) return deny('tidak ada access token valid');

  // --- Token service (panggilan antar-service) ---
  if (subject.type === 'service') {
    if (method === 'POST' && path === '/transkrip/sinkron') {
      return allow('token service diizinkan untuk sinkron transkrip');
    }
    return deny('token service hanya boleh POST /transkrip/sinkron');
  }

  // --- Token user: user harus ada & device terdaftar ---
  const user = getUser(subject.sub);
  if (!user) return deny('user tidak ditemukan');
  if (user.role !== subject.role) return deny('role pada token tidak sesuai dengan database');
  if (!isDeviceRegistered(user.id, deviceId)) {
    return deny('device tidak terdaftar untuk user ini');
  }

  let m;

  // GET /nilai : mahasiswa (milik sendiri), dosen (kelas yang diampu)
  if (method === 'GET' && path === '/nilai') {
    if (user.role === 'mahasiswa') {
      if (query.mahasiswa_id && Number(query.mahasiswa_id) !== user.id) {
        return deny('mahasiswa hanya boleh melihat nilai miliknya sendiri');
      }
      return allow('mahasiswa melihat nilai sendiri');
    }
    if (user.role === 'dosen') {
      if (query.kelas_id) {
        const k = getKelas(query.kelas_id);
        if (!k || k.dosen_id !== user.id) return deny('kelas bukan yang diampu dosen ini');
      }
      return allow('dosen melihat nilai kelas yang diampu');
    }
    return deny(`role ${user.role} tidak boleh melihat nilai`);
  }

  // PUT /nilai/:id : dosen, kelas diampu, nilai belum final, dalam jam akses
  if (method === 'PUT' && (m = path.match(/^\/nilai\/(\d+)$/))) {
    if (user.role !== 'dosen') return deny('hanya dosen yang boleh mengubah nilai');
    const n = getNilai(m[1]);
    if (!n) return deny('data nilai tidak ditemukan');
    const k = getKelas(n.kelas_id);
    if (!k || k.dosen_id !== user.id) return deny('kelas bukan yang diampu dosen ini');
    if (n.is_final) return deny('nilai sudah final');
    if (!isWithinAccessHours(now)) return deny(`di luar jam akses (${fmtHours()})`);
    return allow('dosen mengubah nilai kelas yang diampu');
  }

  // POST /kelas/:id/finalisasi : dosen, kelas diampu, dalam jam akses
  if (method === 'POST' && (m = path.match(/^\/kelas\/(\d+)\/finalisasi$/))) {
    if (user.role !== 'dosen') return deny('hanya dosen yang boleh memfinalisasi nilai');
    const k = getKelas(m[1]);
    if (!k || k.dosen_id !== user.id) return deny('kelas bukan yang diampu dosen ini');
    if (!isWithinAccessHours(now)) return deny(`di luar jam akses (${fmtHours()})`);
    return allow('dosen memfinalisasi kelas yang diampu');
  }

  // GET /transkrip/:nim : mahasiswa (NIM sendiri), admin (semua)
  if (method === 'GET' && (m = path.match(/^\/transkrip\/([^/]+)$/))) {
    if (user.role === 'admin') return allow('admin melihat semua transkrip');
    if (user.role === 'mahasiswa') {
      if (user.nim === m[1]) return allow('mahasiswa melihat transkrip sendiri');
      return deny('mahasiswa hanya boleh melihat transkrip NIM sendiri');
    }
    return deny(`role ${user.role} tidak boleh melihat transkrip`);
  }

  // POST /transkrip/sinkron : hanya token service -> token user mana pun ditolak
  if (method === 'POST' && path === '/transkrip/sinkron') {
    return deny('endpoint ini hanya untuk token service');
  }

  // Default deny: endpoint di luar kebijakan
  return deny('tidak ada kebijakan yang mengizinkan endpoint ini');
}

module.exports = { decide, decideLogin, isDeviceRegistered, isWithinAccessHours };