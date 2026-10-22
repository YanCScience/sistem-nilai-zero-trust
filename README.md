# Sistem Nilai - Zero Trust Security

API gateway bertindak sebagai **Policy Enforcement Point (PEP)** yang terpisah dari service, mengikuti NIST SP 800-207.
Prinsip: *never trust, always verify*, *least privilege*, *assume breach*.

```
Client --(access token + X-Device-ID)--> API Gateway :3000 (PEP + PE/PA + audit log)
                                              |-- X-Gateway-Secret --> Service Nilai :3001
                                              '-- X-Gateway-Secret --> Service Transkrip :3002
Service Nilai --(token service, lewat gateway)--> POST /transkrip/sinkron
Semua komponen berbagi satu database SQLite (db/nilai.db)
```

## Prasyarat

- **Node.js 22.5 atau lebih baru** (database memakai modul bawaan `node:sqlite`, jadi tidak perlu kompilasi native / Visual Studio).
- Warning `ExperimentalWarning: SQLite is an experimental feature` saat menjalankan adalah normal.

## Cara menjalankan

```powershell
npm install
npm run seed      # membuat db/nilai.db + data awal (mereset database)
npm start         # menjalankan gateway (3000), nilai (3001), transkrip (3002); Ctrl+C untuk berhenti
npm test          # tes otomatis end-to-end (memakai db/test.db; hentikan npm start dulu)
```

Port 3000, 3001, dan 3002 harus kosong.

### Konfigurasi
Semua konfigurasi ada di `config.js` dan bisa di-override lewat environment variable. Contoh untuk demo jam akses (PowerShell):

```powershell
$env:ACCESS_HOUR_START = 9; $env:ACCESS_HOUR_END = 10; npm start   # di luar jam akses -> ubah/finalisasi ditolak
$env:ACCESS_HOUR_START = 0; $env:ACCESS_HOUR_END = 24; npm start   # dibuka 24 jam -> diizinkan
Remove-Item Env:ACCESS_HOUR_START, Env:ACCESS_HOUR_END             # kembali ke default 07.00-21.00
```

Variabel lain: `JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_NILAI_SECRET`, `DB_PATH`, `GATEWAY_PORT`, `NILAI_PORT`, `TRANSKRIP_PORT`.

## Data awal (seed)

Password semua akun: `password123`

| Username | Role | NIM | Device ID terdaftar |
|---|---|---|---|
| admin1 | admin | - | DEV-ADMIN-1 |
| dosen1 | dosen (mengampu KP70065004, kelas id 1) | - | DEV-DOSEN-1 |
| dosen2 | dosen (mengampu IF70012003, kelas id 2) | - | DEV-DOSEN-2 |
| mhs1 | mahasiswa | 2210001 | DEV-MHS-1 |
| mhs2 | mahasiswa | 2210002 | DEV-MHS-2 |
| mhs3 | mahasiswa | 2210003 | DEV-MHS-3 |

Client ID service: `service-nilai`, secret: `dev-service-nilai-secret`.

## Contoh pemakaian (PowerShell)

Setiap request user wajib membawa `Authorization: Bearer <token>` dan `X-Device-ID`.

```powershell
# Login sebagai dosen1
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/auth/login `
  -Headers @{ 'X-Device-ID' = 'DEV-DOSEN-1' } -ContentType 'application/json' `
  -Body '{"username":"dosen1","password":"password123"}'
$h = @{ Authorization = "Bearer $($login.access_token)"; 'X-Device-ID' = 'DEV-DOSEN-1' }

Invoke-RestMethod http://localhost:3000/nilai -Headers $h                        # lihat nilai kelas yang diampu
Invoke-RestMethod -Method Put http://localhost:3000/nilai/1 -Headers $h `
  -ContentType 'application/json' -Body '{"nilai_angka":95}'                     # ubah nilai
Invoke-RestMethod -Method Post http://localhost:3000/kelas/1/finalisasi -Headers $h   # finalisasi + sinkron transkrip

# Refresh dan logout (refresh token dicabut saat logout)
Invoke-RestMethod -Method Post http://localhost:3000/auth/refresh -Headers @{ 'X-Device-ID' = 'DEV-DOSEN-1' } `
  -ContentType 'application/json' -Body (@{ refresh_token = $login.refresh_token } | ConvertTo-Json)
Invoke-RestMethod -Method Post http://localhost:3000/auth/logout -Headers @{ 'X-Device-ID' = 'DEV-DOSEN-1' } `
  -ContentType 'application/json' -Body (@{ refresh_token = $login.refresh_token } | ConvertTo-Json)
```

`Invoke-RestMethod` melempar error saat server menjawab 401/403. Untuk memperlihatkan penolakan, pakai `curl.exe -i` (bukan `curl`, yang merupakan alias PowerShell) atau Postman:

```powershell
curl.exe -i http://localhost:3000/nilai                       # tanpa token -> 401
curl.exe -i http://localhost:3001/nilai                       # langsung ke service -> 403 (tanpa gateway secret)
```

### Melihat audit log
```powershell
node -e "const db=require('./db'); console.table(db.prepare('SELECT waktu,subjek,endpoint,device,hasil,alasan FROM audit_log ORDER BY id DESC LIMIT 20').all())"
```
Log juga tampil langsung di terminal `npm start` dengan awalan `[AUDIT]`.

## Pemetaan kebutuhan -> kode

| Kebutuhan | Berkas / fungsi |
|---|---|
| Gateway sebagai satu-satunya pintu masuk (PEP) | `gateway/index.js` - middleware `pep`, lalu proxy |
| Policy Engine memutuskan allow/deny + alasan | `gateway/policy.js` - `decide()`, `decideLogin()` |
| 4.1 Access token JWT 10 menit (`sub`, `role`) | `shared/tokens.js` - `signUserToken`; `config.js` (`accessTokenTtl`) |
| 4.1 Refresh token 1 hari, di DB, dapat dicabut | `gateway/auth.js` - `/refresh`, `/logout`; tabel `refresh_tokens` (hanya hash disimpan, dirotasi) |
| 4.1 Token service (`POST /auth/service`, 5 menit) | `gateway/auth.js` - `/service`; klien: `service-nilai/gatewayClient.js` |
| 4.1 Gateway secret | proxy menambah header di `gateway/index.js`; dicek di `shared/serviceGuard.js` |
| 4.1 Verifikasi ulang token di service | `shared/serviceGuard.js` (token wajib valid walau secret benar) |
| 4.2 Kebijakan Tabel 3 + atribut dari DB | `gateway/policy.js` membaca tabel `users`, `kelas`, `nilai` |
| 4.3 Device terdaftar | `policy.js` - `isDeviceRegistered()`; tabel `devices` |
| 4.3 Jam akses (dapat dikonfigurasi) | `policy.js` - `isWithinAccessHours()`; `config.js` (`accessHours`) |
| 4.4 Audit log | `gateway/audit.js`; tabel `audit_log` |
| Finalisasi -> sinkron transkrip via gateway | `service-nilai/index.js` (`/kelas/:id/finalisasi`) -> `POST /transkrip/sinkron` |

## Keputusan desain

- **Defense in depth:** gateway memutuskan akses, tetapi service tetap memverifikasi gateway secret, token, dan kepemilikan data (mahasiswa hanya melihat miliknya, dosen hanya kelasnya). Jika gateway ditembus, service tidak otomatis percaya.
- **Default deny:** endpoint/method di luar Tabel 3 ditolak oleh policy engine.
- **Role diambil dari database**, bukan hanya dari token; jika berbeda, request ditolak.
- **Refresh token dirotasi** dan terikat device; hanya hash SHA-256 yang disimpan di DB. `/auth/refresh` wajib membawa `X-Device-ID` yang sama dengan saat login.
- **Finalisasi aman terhadap kegagalan:** jika sinkron ke transkrip gagal, status final dibatalkan (HTTP 502).
- Pesan error login sama untuk user tidak ada dan password salah (mencegah user enumeration). Perbandingan secret memakai `timingSafeEqual`.
- Database memakai `node:sqlite` bawaan Node supaya tidak butuh kompilasi native.

## Batasan yang diketahui

- JWT memakai secret simetris (HS256) yang dibagi ke service. Di produksi sebaiknya RS256/JWKS dan secret di secret manager.
- Jam akses hanya dicek di gateway (policy engine), tidak di service.
- Secret default di `config.js` hanya untuk pengembangan; ganti lewat environment variable di lingkungan nyata.
- `npm audit` melaporkan kerentanan pada `braces` (dependensi `http-proxy-middleware`, DoS lewat pola glob bersarang). Gateway tidak memproses pola glob dari input pengguna (pencocokan path memakai fungsi biasa), jadi risikonya kecil di sini. `npm audit fix --force` sengaja tidak dijalankan karena menurunkan versi ke 0.2.0 yang tidak kompatibel.

## Struktur

```
config.js            konfigurasi
run-all.js           menjalankan gateway + kedua service
db/                  skema, koneksi, seed
gateway/             index.js (PEP), policy.js (PE), auth.js (PA), audit.js
service-nilai/       Service Nilai + klien ke gateway
service-transkrip/   Service Transkrip
shared/              tokens.js, serviceGuard.js
tests/run-tests.js   tes end-to-end
```