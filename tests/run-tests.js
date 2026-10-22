// Pengujian end-to-end otomatis. Jalankan: npm test
// Script ini mereset DB (seed), menjalankan semua service, lalu menguji tiap kebutuhan.
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');

// Jam akses dibuka 24 jam agar tes tidak bergantung waktu; tes jam akses dilakukan lewat unit policy.
const env = { ...process.env, ACCESS_HOUR_START: '0', ACCESS_HOUR_END: '24', DB_PATH: path.join(root, 'db', 'test.db') };
process.env.DB_PATH = env.DB_PATH; // agar pembacaan audit_log di proses tes memakai DB tes
execFileSync(process.execPath, [path.join(root, 'db/seed.js')], { env, stdio: 'ignore' });
// Jalankan tiap komponen langsung (bukan lewat run-all.js) agar bisa dimatikan satu per satu
// dengan andal di Windows (kill pada proses induk tidak mematikan proses anaknya).
const procs = ['service-transkrip', 'service-nilai', 'gateway'].map((d) =>
  spawn(process.execPath, [path.join(root, d, 'index.js')], { env, stdio: 'ignore' })
);
const stopAll = () => procs.forEach((p) => p.kill());

const G = 'http://localhost:3000';
const DEV = { admin1: 'DEV-ADMIN-1', dosen1: 'DEV-DOSEN-1', dosen2: 'DEV-DOSEN-2', mhs1: 'DEV-MHS-1', mhs2: 'DEV-MHS-2' };
let pass = 0, fail = 0;

const call = async (method, url, { token, device, body, headers = {} } = {}) => {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h['X-Device-ID'] = device;
  const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
};
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + extra}`);
};
const login = async (u, device = DEV[u]) =>
  call('POST', `${G}/auth/login`, { device, body: { username: u, password: 'password123' } });

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(G); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  await new Promise(r => setTimeout(r, 500));

  // --- 4.1 Autentikasi ---
  const mhs1 = (await login('mhs1')).json;
  check('login valid + device terdaftar -> 200', !!mhs1.access_token);
  check('login device tidak terdaftar -> 403', (await login('mhs1', 'DEV-ASING')).status === 403);
  check('login password salah -> 401', (await call('POST', `${G}/auth/login`, { device: DEV.mhs1, body: { username: 'mhs1', password: 'x' } })).status === 401);
  const dosen1 = (await login('dosen1')).json;
  const dosen2 = (await login('dosen2')).json;
  const admin = (await login('admin1')).json;
  const mhs2 = (await login('mhs2')).json;

  const noToken = await call('GET', `${G}/nilai`, { device: DEV.mhs1 });
  check('tanpa token -> 401', noToken.status === 401);
  const badToken = await call('GET', `${G}/nilai`, { token: mhs1.access_token + 'x', device: DEV.mhs1 });
  check('token dipalsukan -> 401', badToken.status === 401);

  const ref = await call('POST', `${G}/auth/refresh`, { device: DEV.mhs1, body: { refresh_token: mhs1.refresh_token } });
  check('refresh valid -> access token baru', ref.status === 200 && !!ref.json.access_token);
  const refOld = await call('POST', `${G}/auth/refresh`, { device: DEV.mhs1, body: { refresh_token: mhs1.refresh_token } });
  check('refresh token lama (dirotasi) ditolak', refOld.status === 401);
  const lo = await call('POST', `${G}/auth/logout`, { device: DEV.mhs1, body: { refresh_token: ref.json.refresh_token } });
  check('logout -> 200', lo.status === 200);
  const afterLogout = await call('POST', `${G}/auth/refresh`, { device: DEV.mhs1, body: { refresh_token: ref.json.refresh_token } });
  check('refresh setelah logout ditolak (dicabut)', afterLogout.status === 401);

  const svc = await call('POST', `${G}/auth/service`, { body: { client_id: 'service-nilai', client_secret: 'dev-service-nilai-secret' } });
  check('token service dengan client valid -> 200', svc.status === 200);
  check('token service dengan secret salah -> 401', (await call('POST', `${G}/auth/service`, { body: { client_id: 'service-nilai', client_secret: 'salah' } })).status === 401);

  // --- Gateway secret & verifikasi ulang di service ---
  const direct = await call('GET', 'http://localhost:3001/nilai', { token: mhs1.access_token });
  check('akses langsung service tanpa gateway secret -> 403', direct.status === 403);
  const secretNoToken = await call('GET', 'http://localhost:3001/nilai', { headers: { 'X-Gateway-Secret': 'dev-gateway-secret-ganti-di-produksi' } });
  check('gateway secret benar tapi tanpa token -> 401', secretNoToken.status === 401);
  const secretBadToken = await call('GET', 'http://localhost:3002/transkrip/2210001', { token: 'abc.def.ghi', headers: { 'X-Gateway-Secret': 'dev-gateway-secret-ganti-di-produksi' } });
  check('gateway secret benar tapi token palsu -> 401', secretBadToken.status === 401);

  // --- 4.2 Kebijakan: GET /nilai ---
  const n1 = await call('GET', `${G}/nilai`, { token: mhs1.access_token, device: DEV.mhs1 });
  check('mhs1 lihat nilai: hanya milik sendiri', n1.status === 200 && n1.json.length === 2 && n1.json.every(x => x.nim === '2210001'));
  const nd = await call('GET', `${G}/nilai`, { token: dosen1.access_token, device: DEV.dosen1 });
  check('dosen1 lihat nilai: hanya kelas diampu', nd.status === 200 && nd.json.length === 3 && nd.json.every(x => x.kelas_kode === 'KP70065004'));
  check('dosen1 minta kelas dosen2 -> 403', (await call('GET', `${G}/nilai?kelas_id=2`, { token: dosen1.access_token, device: DEV.dosen1 })).status === 403);
  check('admin lihat nilai -> 403', (await call('GET', `${G}/nilai`, { token: admin.access_token, device: DEV.admin1 })).status === 403);
  check('device tidak cocok pada request -> 403', (await call('GET', `${G}/nilai`, { token: mhs1.access_token, device: DEV.mhs2 })).status === 403);
  check('tanpa X-Device-ID -> 403', (await call('GET', `${G}/nilai`, { token: mhs1.access_token })).status === 403);

  // --- PUT /nilai/:id ---
  const idK1 = nd.json[0].id;
  const idK2 = (await call('GET', `${G}/nilai`, { token: dosen2.access_token, device: DEV.dosen2 })).json[0].id;
  check('dosen1 ubah nilai kelasnya -> 200', (await call('PUT', `${G}/nilai/${idK1}`, { token: dosen1.access_token, device: DEV.dosen1, body: { nilai_angka: 90 } })).status === 200);
  check('dosen1 ubah nilai kelas dosen2 -> 403', (await call('PUT', `${G}/nilai/${idK2}`, { token: dosen1.access_token, device: DEV.dosen1, body: { nilai_angka: 90 } })).status === 403);
  check('mahasiswa ubah nilai -> 403', (await call('PUT', `${G}/nilai/${idK1}`, { token: mhs1.access_token, device: DEV.mhs1, body: { nilai_angka: 100 } })).status === 403);

  // --- Finalisasi + sinkron ---
  check('dosen1 finalisasi kelas dosen2 -> 403', (await call('POST', `${G}/kelas/2/finalisasi`, { token: dosen1.access_token, device: DEV.dosen1 })).status === 403);
  check('mahasiswa finalisasi -> 403', (await call('POST', `${G}/kelas/1/finalisasi`, { token: mhs1.access_token, device: DEV.mhs1 })).status === 403);
  const fin = await call('POST', `${G}/kelas/1/finalisasi`, { token: dosen1.access_token, device: DEV.dosen1 });
  check('dosen1 finalisasi kelasnya -> 200 + sinkron', fin.status === 200 && fin.json.sinkron?.jumlah === 3, JSON.stringify(fin.json));
  check('ubah nilai setelah final -> 403', (await call('PUT', `${G}/nilai/${idK1}`, { token: dosen1.access_token, device: DEV.dosen1, body: { nilai_angka: 50 } })).status === 403);

  // --- Transkrip ---
  const t1 = await call('GET', `${G}/transkrip/2210001`, { token: mhs1.access_token, device: DEV.mhs1 });
  check('mhs1 lihat transkrip sendiri (hasil sinkron)', t1.status === 200 && t1.json.transkrip.length === 1 && t1.json.transkrip[0].nilai_angka === 90, JSON.stringify(t1.json));
  check('mhs1 lihat transkrip mhs2 -> 403', (await call('GET', `${G}/transkrip/2210002`, { token: mhs1.access_token, device: DEV.mhs1 })).status === 403);
  check('admin lihat transkrip semua NIM -> 200', (await call('GET', `${G}/transkrip/2210002`, { token: admin.access_token, device: DEV.admin1 })).status === 200);
  check('dosen lihat transkrip -> 403', (await call('GET', `${G}/transkrip/2210001`, { token: dosen1.access_token, device: DEV.dosen1 })).status === 403);

  // --- POST /transkrip/sinkron hanya token service ---
  const body = { entries: [{ nim: '2210001', kelas_kode: 'X', kelas_nama: 'X', nilai_angka: 100 }] };
  check('token user (admin) ke sinkron -> 403', (await call('POST', `${G}/transkrip/sinkron`, { token: admin.access_token, device: DEV.admin1, body })).status === 403);
  check('token user (dosen) ke sinkron -> 403', (await call('POST', `${G}/transkrip/sinkron`, { token: dosen1.access_token, device: DEV.dosen1, body })).status === 403);
  check('token service ke sinkron -> 200', (await call('POST', `${G}/transkrip/sinkron`, { token: svc.json.access_token, body })).status === 200);
  check('token service ke /nilai -> 403', (await call('GET', `${G}/nilai`, { token: svc.json.access_token })).status === 403);

  // --- 4.3 Jam akses (unit policy dengan waktu tertentu; env tes membuka 24 jam) ---
  const policy = require('../gateway/policy');
  const cfg = require('../config');
  cfg.accessHours.start = 7; cfg.accessHours.end = 21;
  const at = (h) => new Date(2026, 0, 5, h, 0, 0);
  check('jam akses 12.00 -> dalam jam', policy.isWithinAccessHours(at(12)));
  check('jam akses 06.00 -> di luar jam', !policy.isWithinAccessHours(at(6)));
  check('jam akses 21.00 -> di luar jam', !policy.isWithinAccessHours(at(21)));

  // --- 4.4 Audit ---
  const db = require('../db');
  const a = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE hasil='allow'").get().c;
  const d = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE hasil='deny'").get().c;
  check('audit log mencatat allow & deny', a > 0 && d > 0, `allow=${a} deny=${d}`);

  console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
  stopAll();
  // Hapus DB uji (di Windows file bisa masih terkunci sebentar; abaikan jika gagal, sudah di .gitignore)
  setTimeout(() => {
    for (const f of [env.DB_PATH, env.DB_PATH + '-wal', env.DB_PATH + '-shm']) {
      try { require('fs').rmSync(f, { force: true }); } catch {}
    }
    process.exit(fail ? 1 : 0);
  }, 500);
})().catch((e) => { console.error(e); stopAll(); process.exit(1); });