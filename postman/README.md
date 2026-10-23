# Automatic access-token refresh in Postman

Backend tidak otomatis memanggil refresh setelah access token expired. Client (termasuk Postman) yang menjalankan alur tersebut.

## Pasang pada collection yang sudah ada

1. Pilih/buat Environment, set `base_url` ke `http://localhost:3000` (atau URL backend), lalu aktifkan environment tersebut. Tidak perlu membuat variabel refresh token.
2. Collection > Authorization: pilih **Bearer Token**, isi token `{{accessToken}}`. Request API terlindungi memakai **Inherit auth from parent**. Jangan pasang header Authorization/token literal di request tersebut.
3. Collection > Scripts > **Pre-request**: salin seluruh isi `pre-request.js`.
4. Collection > Scripts > **Post-response** (Tests pada UI lama): salin seluruh isi `post-response.js`.
5. Set **No Auth** pada Login, Register, Refresh dan Logout (current device). Logout All tetap mewarisi Bearer Token.
6. Pastikan cookie jar aktif. Kirim `POST {{base_url}}/auth/login` dengan body JSON username/password akunmu. Script menyimpan `data.accessToken` di environment aktif; Postman menyimpan cookie `refreshToken` dari response secara otomatis. Simpan nilai token hanya secara lokal, jangan bagikan/sync nilai kredensialnya.
7. Kirim `GET {{base_url}}/auth/profile`, atau request API terlindungi lainnya.

Gunakan hostname yang sama untuk login dan API (`localhost` dan `127.0.0.1` punya cookie berbeda). Cookie Secure di production memerlukan HTTPS. Script tidak membaca cookie lewat JavaScript; tidak perlu menyalin refresh token atau menambahkan domain ke cookie-script allowlist.

## Perilaku

- Token masih valid: request langsung berjalan dengan token tersebut.
- Token habis masa berlakunya atau tersisa <=30 detik: script menunggu `POST /session/refresh`, menyimpan access token baru, lalu Postman mengirim request utama dengan token baru.
- Token belum ada: script mencoba refresh sekali menggunakan cookie yang masih ada.
- Refresh gagal: token lokal dihapus dan request utama dibatalkan. Jika cookie expired/revoked, login ulang.
- Logout/logout-all sukses: token lokal dibersihkan; backend menghapus cookie dan mencabut sesi.
- Request login/register/logout/refresh tidak menjalankan auto-refresh. Logout memakai cookie, sehingga tidak perlu access token valid.
- Decode `exp` hanya untuk menentukan waktu refresh. Verifikasi signature dan sesi tetap dilakukan backend.
- Script tidak mengulang setiap HTTP 401: token yang belum expired bisa ditolak karena sesi dicabut. Tidak ada retry loop atau pengulangan request perubahan data.

Ini berlaku saat menekan Send satu request maupun saat menjalankan collection. Hindari menimpa accessToken lewat script request/folder lain. Pengujian logout/revocation dan negative-auth sebaiknya menggunakan request **No Auth** dengan header uji eksplisit di luar collection auto-refresh ini.

## Coba tanpa menunggu 15 menit

Set nilai environment `accessToken` menjadi kosong, lalu kirim Profile dengan refresh cookie dari login yang masih valid. Harus ada satu request refresh di Postman Console, lalu Profile sukses. Setelah Logout All, coba lagi: refresh harus gagal dan request Profile dibatalkan.

## References

- https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-send-request
- https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution/
- https://learning.postman.com/docs/sending-requests/response-data/cookies/

## Body register dan login

Gunakan **Body > raw > JSON** untuk kedua endpoint:

```json
{
  "username": "adam",
  "password": "Password123!"
}
```

Register menerima `name` opsional. Email tidak diperlukan. Username 3–50 karakter (huruf, angka, `_`, `.`, `-`); kapitalisasi berpengaruh saat login.
