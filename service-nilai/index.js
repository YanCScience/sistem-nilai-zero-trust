// Service Nilai (port 3001) - Resource: data nilai dan kelas.
const express = require('express');
const config = require('../config');
const db = require('../db');
const serviceGuard = require('../shared/serviceGuard');
const { sinkronTranskrip } = require('./gatewayClient');

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(serviceGuard('nilai'));

// Hanya token user yang boleh mengakses endpoint di service ini
app.use((req, res, next) => {
  if (req.subject.type !== 'user') return res.status(403).json({ error: 'token service tidak diizinkan' });
  req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.subject.sub);
  if (!req.user) return res.status(403).json({ error: 'user tidak ditemukan' });
  next();
});

// GET /nilai - mahasiswa: hanya miliknya; dosen: hanya kelas yang diampu
app.get('/nilai', (req, res) => {
  const base = `SELECT n.id, n.kelas_id, k.kode AS kelas_kode, k.nama AS kelas_nama,
                       u.nim, u.nama AS mahasiswa, n.nilai_angka, n.is_final
                FROM nilai n JOIN kelas k ON k.id = n.kelas_id JOIN users u ON u.id = n.mahasiswa_id`;
  if (req.user.role === 'mahasiswa') {
    return res.json(db.prepare(`${base} WHERE n.mahasiswa_id = ? ORDER BY n.id`).all(req.user.id));
  }
  if (req.user.role === 'dosen') {
    let sql = `${base} WHERE k.dosen_id = ?`;
    const args = [req.user.id];
    if (req.query.kelas_id) { sql += ' AND n.kelas_id = ?'; args.push(Number(req.query.kelas_id)); }
    return res.json(db.prepare(`${sql} ORDER BY n.id`).all(...args));
  }
  res.status(403).json({ error: 'role tidak boleh melihat nilai' });
});

// PUT /nilai/:id - dosen, kelas yang diampu, nilai belum final
app.put('/nilai/:id', (req, res) => {
  const n = db
    .prepare('SELECT n.*, k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?')
    .get(req.params.id);
  if (!n) return res.status(404).json({ error: 'nilai tidak ditemukan' });
  if (req.user.role !== 'dosen' || n.dosen_id !== req.user.id) {
    return res.status(403).json({ error: 'bukan dosen pengampu kelas ini' });
  }
  if (n.is_final) return res.status(409).json({ error: 'nilai sudah final' });

  const v = (req.body || {}).nilai_angka;
  if (typeof v !== 'number' || v < 0 || v > 100) {
    return res.status(400).json({ error: 'nilai_angka harus angka 0-100' });
  }
  db.prepare('UPDATE nilai SET nilai_angka = ? WHERE id = ?').run(v, n.id);
  res.json({ id: n.id, nilai_angka: v });
});

// POST /kelas/:id/finalisasi - finalisasi, lalu sinkron ke Service Transkrip via gateway
app.post('/kelas/:id/finalisasi', async (req, res) => {
  const kelas = db.prepare('SELECT * FROM kelas WHERE id = ?').get(req.params.id);
  if (!kelas) return res.status(404).json({ error: 'kelas tidak ditemukan' });
  if (req.user.role !== 'dosen' || kelas.dosen_id !== req.user.id) {
    return res.status(403).json({ error: 'bukan dosen pengampu kelas ini' });
  }
  if (kelas.finalisasi) return res.status(409).json({ error: 'kelas sudah difinalisasi' });

  const rows = db
    .prepare(`SELECT u.nim, n.nilai_angka FROM nilai n JOIN users u ON u.id = n.mahasiswa_id
              WHERE n.kelas_id = ? AND n.nilai_angka IS NOT NULL`)
    .all(kelas.id);
  if (rows.length === 0) return res.status(400).json({ error: 'belum ada nilai untuk difinalisasi' });

  const setFinal = (v) =>
    db.transaction(() => {
      db.prepare('UPDATE kelas SET finalisasi = ? WHERE id = ?').run(v, kelas.id);
      db.prepare('UPDATE nilai SET is_final = ? WHERE kelas_id = ?').run(v, kelas.id);
    })();

  setFinal(1);
  try {
    const entries = rows.map((r) => ({
      nim: r.nim, kelas_kode: kelas.kode, kelas_nama: kelas.nama, nilai_angka: r.nilai_angka,
    }));
    const hasil = await sinkronTranskrip(entries); // lewat gateway, pakai token service
    res.json({ message: 'kelas difinalisasi dan transkrip disinkronkan', kelas: kelas.kode, sinkron: hasil });
  } catch (e) {
    setFinal(0); // sinkron gagal -> batalkan finalisasi agar data tetap konsisten
    console.error('[nilai] sinkron gagal:', e.message);
    res.status(502).json({ error: 'sinkron transkrip gagal, finalisasi dibatalkan', detail: e.message });
  }
});

if (require.main === module) {
  app.listen(config.ports.nilai, () => console.log(`[nilai] berjalan di port ${config.ports.nilai}`));
}
module.exports = app;