# Implement Authentication and Sessions

Implementasikan authentication berbasis username dan password serta pengelolaan session login pada backend NestJS. Pengguna harus dapat mendaftar, login, melihat profil sendiri, memperbarui access token, dan logout dari satu atau seluruh perangkat. Hubungkan identitas hasil autentikasi dengan kontrol akses chat session yang sudah tersedia.

Pelajari struktur proyek, schema Prisma, common module, decorator identitas pengguna, validasi, format respons, dan logging sebelum menulis kode. Ikuti pola kode existing dan tentukan detail implementasi sesuai kebutuhan berikut.

### 1. Module Architecture

- Pisahkan tanggung jawab authentication akun dan pengelolaan token/session dalam modul auth dan session di area model. Daftarkan melalui dependency injection NestJS dan gunakan PrismaService existing untuk PostgreSQL.
- Tempatkan aturan bisnis di service, sementara controller menangani input, cookie, dan pemetaan respons. Gunakan DTO berbasis Zod, validation pipe global, interface respons, strict TypeScript, dan kontrak `WebResponse` existing.
- Gunakan Passport dengan strategi JWT untuk autentikasi Bearer token. Session login disimpan di database dan terpisah dari chat session percakapan.

### 2. Authentication Endpoints

| Method | Path | Kebutuhan |
|---|---|---|
| POST | `/auth/register` | Membuat akun dari `username`, `password`, dan `name` opsional tanpa otomatis login atau membuat session. |
| POST | `/auth/login` | Memvalidasi kredensial, membuat session login, mengembalikan access token melalui `data`, dan memasang refresh token sebagai cookie. |
| GET | `/auth/profile` | Mengembalikan `id`, `username`, dan `name` pengguna yang terautentikasi. |
| POST | `/session/refresh` | Memvalidasi refresh token dari cookie dan mengembalikan access token baru untuk session yang sama. |
| POST | `/auth/logout` | Mencabut session berdasarkan refresh token dari cookie dan menghapus cookie setelah berhasil. |
| POST | `/auth/logout-all` | Mencabut seluruh session milik pengguna yang terautentikasi dan menghapus cookie. |

- Gunakan username yang di-trim, sepanjang 3–50 karakter, dengan karakter huruf, angka, underscore, titik, atau tanda hubung. Password wajib sepanjang 8–100 karakter.
- Registrasi dan login menggunakan username; email tidak menjadi input wajib maupun identitas login. Tolak username yang sudah terdaftar dan simpan password sebagai hash bcrypt.
- Tolak registrasi dan login dengan HTTP 400 jika cookie refresh token masih membuktikan session yang valid. Cookie yang tidak valid tidak menghalangi pengguna mencoba registrasi atau login.
- Kembalikan HTTP 401 dengan pesan kegagalan kredensial yang sama untuk username tidak ditemukan dan password salah. Tangani kegagalan internal tanpa membocorkan detail ke pemanggil.
- Kembalikan profil berdasarkan identitas autentikasi, bukan ID pengguna yang dikirim melalui body atau query. Jangan sertakan password hash atau refresh token pada respons profil maupun body respons login.

### 3. Tokens and Persistent Sessions

- Terbitkan access JWT dengan masa berlaku 15 menit dan refresh JWT selama 7 hari, menggunakan secret terpisah. Keduanya membawa identitas pengguna melalui `sub` dan ID session melalui `sid`.
- Simpan session dengan ID unik, relasi pengguna, hash SHA-256 refresh token yang unik, waktu pembuatan, kedaluwarsa, pencabutan, dan aktivitas terakhir. Jangan simpan refresh token mentah di database.
- Pada setiap autentikasi access token dan validasi refresh token, pastikan session cocok dengan pengguna, belum dicabut, belum kedaluwarsa, dan dimiliki akun aktif yang belum dihapus. Perbarui aktivitas terakhir ketika validasi berhasil.
- Validasi refresh token juga harus mencocokkan hash dengan record session. Tolak token rusak, kedaluwarsa, session tidak tersedia, serta token tanpa ID session yang valid dengan HTTP 401.
- Refresh hanya menerbitkan access token baru; pertahankan refresh token dan batas kedaluwarsa session yang sama.
- Batasi setiap pengguna hingga lima session aktif yang belum kedaluwarsa. Ketika login baru melewati batas, cabut session yang paling lama tidak digunakan, dengan urutan tambahan yang stabil jika waktu aktivitas sama.
- Jaga batas session dan konsistensi logout-all melalui transaksi serta penguncian per pengguna agar tetap benar saat beberapa request berlangsung bersamaan.
- Logout harus mencabut session di database sehingga access token dan refresh token terkait langsung ditolak pada request berikutnya. Logout-all berlaku hanya untuk seluruh session milik pengguna pemanggil.

### 4. Global Access Control

- Lindungi endpoint secara default melalui guard global. Sediakan decorator `Public` untuk registrasi, login, refresh, logout berbasis cookie, dan endpoint root aplikasi.
- Endpoint profil, logout-all, chat session, dan endpoint lain tanpa penanda public harus memerlukan Bearer access token yang valid beserta session database yang aktif.
- Pastikan `request.user` berasal dari strategi autentikasi tepercaya. Bersihkan identitas request sebelum guard memproses autentikasi agar identitas sebelumnya tidak dapat melewati pemeriksaan.
- Sesuaikan `CurrentUser` agar identitas `sub` dapat digunakan sebagai `id` oleh modul chat session existing. Pertahankan validasi UUID dan penolakan HTTP 401 saat identitas tidak tersedia atau tidak valid.
- Pertahankan pembatasan kepemilikan dan perilaku pengelolaan chat session yang sudah ada.

### 5. Login Rate Limits

- Batasi percobaan pada endpoint login hingga 30 request per IP dan 10 request per username dalam jendela 15 menit. Normalisasi username dengan trim dan lowercase untuk penghitungan rate limit.
- Gunakan counter PostgreSQL yang diperbarui secara atomik agar pembatasan berlaku lintas instance, restart aplikasi, dan request bersamaan. Simpan key bucket sebagai hash serta waktu reset yang memungkinkan counter kedaluwarsa digunakan kembali.
- Gunakan IP dari request sesuai kebijakan proxy aplikasi; jangan langsung mempercayai header `X-Forwarded-For` dari pemanggil.
- Kembalikan HTTP 429 dan header `Retry-After` ketika salah satu batas terlampaui.

### 6. Database and Application Integration

- Tambahkan schema dan migration untuk session authentication, aktivitas terakhir session, serta counter rate limit berikut relasi dan index yang relevan. Penghapusan pengguna harus menghapus session authentication terkait.
- Tambahkan field `name` opsional dan `email` opsional yang unik pada pengguna, serta constraint database untuk keunikan username tanpa membedakan kapitalisasi. Email hanya disiapkan pada schema, tanpa alur autentikasi email.
- Integrasikan cookie parser. Cookie `refreshToken` harus `httpOnly`, menggunakan `sameSite: 'lax'`, berlaku 7 hari, dan memakai `secure` pada production.
- Baca `ACCESS_JWT_SECRET`, `REFRESH_JWT_SECRET`, dan `FRONTEND_ORIGINS` melalui konfigurasi environment. Sertakan contoh tanpa credential nyata pada `.env.example`, dengan secret berbeda dan acak.
- Aktifkan CORS dengan credentials untuk daftar origin frontend yang dipisahkan koma; gunakan `http://localhost:3001` sebagai default. Izinkan header `Content-Type` dan `Authorization` serta metode HTTP aplikasi yang diperlukan.
- Sesuaikan dependency dan lockfile proyek untuk integrasi authentication. Pertahankan pola PinoLogger dan sembunyikan header authorization, cookie, serta set-cookie dari log.

### 7. Validation

- Gunakan unit test dengan mock dependency untuk validasi DTO, autentikasi akun, pemetaan respons controller, cookie, guard global, token, session, pencabutan, pembaruan aktivitas, dan rate limit.
- Verifikasi registrasi tidak membuat session, refresh token tidak masuk body login, akses tanpa identitas ditolak, serta token dengan session dicabut atau akun tidak aktif tidak dapat digunakan.
- Sediakan pengujian integrasi dengan PostgreSQL untuk alur registrasi hingga logout, pembatasan lima session berdasarkan aktivitas terakhir, login bersamaan, logout-all, dan counter rate limit yang atomik. Bersihkan data yang dibuat oleh pengujian.
- Sesuaikan pengujian existing yang terdampak proteksi global dan dependency session. Pastikan build, test terkait, dan lint berhasil menggunakan perintah proyek yang tersedia.

**Scope: Authentication username/password, profil pengguna sendiri, JWT dengan session PostgreSQL, refresh access token, logout, pembatasan session dan percobaan login, proteksi endpoint, serta integrasi konfigurasi, cookie, CORS, logging, dan pengujian. Tidak mencakup OAuth, verifikasi email, reset password, pengelolaan profil, daftar perangkat, rotasi refresh token, maupun penambahan fitur percakapan atau dokumen.**
