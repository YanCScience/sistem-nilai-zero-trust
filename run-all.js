// Menjalankan gateway + kedua service sebagai proses terpisah (npm start).
const { spawn } = require('child_process');
const path = require('path');

const procs = [
  ['transkrip', 'service-transkrip/index.js'],
  ['nilai', 'service-nilai/index.js'],
  ['gateway', 'gateway/index.js'],
].map(([name, file]) => {
  const p = spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  p.on('exit', (c) => console.log(`[run-all] ${name} berhenti (kode ${c})`));
  return p;
});
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);