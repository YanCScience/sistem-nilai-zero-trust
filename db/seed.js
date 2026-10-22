// Mengisi data awal. Jalankan: npm run seed  (akan mereset database)
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('../config');

for (const f of [config.dbPath, config.dbPath + '-wal', config.dbPath + '-shm']) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
const db = require('./index');

const PASSWORD = 'password123';
const hash = bcrypt.hashSync(PASSWORD, 10);

const addUser = db.prepare(
  'INSERT INTO users (username, password_hash, role, nama, nim) VALUES (?,?,?,?,?)'
);
const addDevice = db.prepare('INSERT INTO devices (user_id, device_id) VALUES (?,?)');

const users = [
  ['admin1', 'admin', 'Admin Prodi', null, 'DEV-ADMIN-1'],
  ['dosen1', 'dosen', 'Dr. Budi Santoso', null, 'DEV-DOSEN-1'],
  ['dosen2', 'dosen', 'Dr. Citra Lestari', null, 'DEV-DOSEN-2'],
  ['mhs1', 'mahasiswa', 'Andi Pratama', '2210001', 'DEV-MHS-1'],
  ['mhs2', 'mahasiswa', 'Sari Wulandari', '2210002', 'DEV-MHS-2'],
  ['mhs3', 'mahasiswa', 'Rudi Hartono', '2210003', 'DEV-MHS-3'],
];
const ids = {};
db.transaction(() => {
  for (const [username, role, nama, nim, dev] of users) {
    const r = addUser.run(username, hash, role, nama, nim);
    ids[username] = r.lastInsertRowid;
    addDevice.run(r.lastInsertRowid, dev);
  }

  // 2 kelas dengan dosen berbeda
  const addKelas = db.prepare('INSERT INTO kelas (kode, nama, dosen_id) VALUES (?,?,?)');
  const k1 = addKelas.run('KP70065004', 'Keamanan Informasi', ids.dosen1).lastInsertRowid;
  const k2 = addKelas.run('IF70012003', 'Basis Data', ids.dosen2).lastInsertRowid;

  // Semua mahasiswa terdaftar di kedua kelas dengan nilai awal
  const addNilai = db.prepare(
    'INSERT INTO nilai (kelas_id, mahasiswa_id, nilai_angka) VALUES (?,?,?)'
  );
  for (const m of ['mhs1', 'mhs2', 'mhs3']) {
    addNilai.run(k1, ids[m], 80);
    addNilai.run(k2, ids[m], 75);
  }
})();

console.log('Seed selesai. Password semua akun:', PASSWORD);