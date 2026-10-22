// Koneksi database SQLite bersama (dipakai gateway & kedua service).
// Memakai modul bawaan Node (node:sqlite) -> tidak perlu kompilasi native.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 3000');

// Pembantu transaksi (node:sqlite belum punya db.transaction())
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try {
    const r = fn(...args);
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

module.exports = db;