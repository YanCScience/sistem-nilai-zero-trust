// Service Transkrip (port 3002) - Resource: data transkrip mahasiswa.
const express = require('express');
const config = require('../config');
const db = require('../db');
const serviceGuard = require('../shared/serviceGuard');

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(serviceGuard('transkrip'));

// GET /transkrip/:nim - mahasiswa: hanya NIM sendiri, admin: semua
// (gateway sudah memutuskan; service mengecek ulang dari token = defense in depth)
app.get('/transkrip/:nim', (req, res) => {
  const { subject } = req;
  if (subject.type !== 'user') return res.status(403).json({ error: 'token service tidak boleh membaca transkrip' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(subject.sub);
  if (!user) return res.status(403).json({ error: 'user tidak ditemukan' });
  const allowed = user.role === 'admin' || (user.role === 'mahasiswa' && user.nim === req.params.nim);
  if (!allowed) return res.status(403).json({ error: 'tidak berhak melihat transkrip ini' });

  const mhs = db.prepare('SELECT nama, nim FROM users WHERE nim = ?').get(req.params.nim);
  if (!mhs) return res.status(404).json({ error: 'NIM tidak ditemukan' });
  const rows = db
    .prepare('SELECT kelas_kode, kelas_nama, nilai_angka FROM transkrip WHERE nim = ? ORDER BY kelas_kode')
    .all(req.params.nim);
  res.json({ nim: mhs.nim, nama: mhs.nama, transkrip: rows });
});

// POST /transkrip/sinkron - hanya token service. Body: { entries: [{nim, kelas_kode, kelas_nama, nilai_angka}] }
app.post('/transkrip/sinkron', (req, res) => {
  if (req.subject.type !== 'service') {
    return res.status(403).json({ error: 'endpoint ini hanya untuk token service' });
  }
  const entries = (req.body || {}).entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries wajib berupa array tidak kosong' });
  }
  for (const e of entries) {
    if (!e.nim || !e.kelas_kode || !e.kelas_nama || typeof e.nilai_angka !== 'number') {
      return res.status(400).json({ error: 'entri tidak valid' });
    }
  }
  const upsert = db.prepare(`
    INSERT INTO transkrip (nim, kelas_kode, kelas_nama, nilai_angka) VALUES (@nim,@kelas_kode,@kelas_nama,@nilai_angka)
    ON CONFLICT(nim, kelas_kode) DO UPDATE SET nilai_angka = excluded.nilai_angka, kelas_nama = excluded.kelas_nama`);
  db.transaction(() => entries.forEach((e) => upsert.run(e)))();
  res.json({ message: 'transkrip disinkronkan', jumlah: entries.length });
});

if (require.main === module) {
  app.listen(config.ports.transkrip, () =>
    console.log(`[transkrip] berjalan di port ${config.ports.transkrip}`)
  );
}
module.exports = app;