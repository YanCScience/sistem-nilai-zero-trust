-- Atribut user (dibaca Policy Engine). nim hanya terisi untuk mahasiswa.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  nama          TEXT NOT NULL,
  nim           TEXT UNIQUE
);

-- Device terdaftar per user
CREATE TABLE IF NOT EXISTS devices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  UNIQUE (user_id, device_id)
);

-- Refresh token disimpan agar bisa dicabut. Yang disimpan hanya hash-nya.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  device_id  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kelas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kode        TEXT NOT NULL UNIQUE,
  nama        TEXT NOT NULL,
  dosen_id    INTEGER NOT NULL REFERENCES users(id),
  finalisasi  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nilai (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kelas_id     INTEGER NOT NULL REFERENCES kelas(id),
  mahasiswa_id INTEGER NOT NULL REFERENCES users(id),
  nilai_angka  REAL,
  is_final     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kelas_id, mahasiswa_id)
);

CREATE TABLE IF NOT EXISTS transkrip (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nim         TEXT NOT NULL,
  kelas_kode  TEXT NOT NULL,
  kelas_nama  TEXT NOT NULL,
  nilai_angka REAL NOT NULL,
  UNIQUE (nim, kelas_kode)
);

-- Audit log keputusan akses
CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  waktu    TEXT NOT NULL,
  subjek   TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  device   TEXT,
  hasil    TEXT NOT NULL CHECK (hasil IN ('allow','deny')),
  alasan   TEXT NOT NULL
);