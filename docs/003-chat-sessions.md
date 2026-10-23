# Implement Chat Sessions

Implementasikan modul chat session pada backend NestJS agar pengguna dapat melihat percakapan, mengubah judul, dan mengelola session aktif maupun session yang sudah dihapus.

Pelajari struktur proyek, schema Prisma, common module, format respons, dan konfigurasi logging sebelum menulis kode. Gunakan modul addresses, carts, dan products pada workspace creamy cream sebagai referensi pola controller, service, DTO, validation, dan interface. Sesuaikan detail implementasi dengan kebutuhan proyek ini.

### 1. Module Architecture

- Buat modul chat session di area model dan daftarkan pada aplikasi melalui dependency injection NestJS.
- Gunakan PrismaService existing untuk mengakses PostgreSQL dan relasi chat session yang sudah tersedia. Tidak diperlukan perubahan database schema atau migration.
- Pertahankan controller yang tipis; tempatkan query dan aturan pengelolaan session di service.
- Gunakan satu method untuk setiap operasi: `findAll`, `findDeleted`, `findChats`, `update`, `remove`, `restore`, dan `removePermanently`. Hindari method generik dengan flag yang menggabungkan operasi aktif dan terhapus atau beberapa jenis perubahan session.
- Pisahkan DTO input, schema validation, dan tipe response sesuai pola modul referensi. Gunakan strict TypeScript dan return type eksplisit dengan kontrak `WebResponse` existing.

### 2. Session Endpoints

Sediakan endpoint berikut untuk session milik pengguna yang terautentikasi:

| Method | Path | Kebutuhan |
|---|---|---|
| GET | `/chat-sessions` | Menampilkan daftar session aktif. |
| GET | `/chat-sessions/deleted` | Menampilkan daftar session yang sudah di-soft-delete. |
| GET | `/chat-sessions/:id/chats` | Mengambil seluruh pesan pada satu session aktif. |
| PATCH | `/chat-sessions/:id` | Mengubah judul session aktif melalui body `title`. |
| DELETE | `/chat-sessions/:id` | Melakukan soft delete pada session aktif. |
| POST | `/chat-sessions/:id/restore` | Mengembalikan session yang sudah di-soft-delete. |
| DELETE | `/chat-sessions/:id/permanent` | Menghapus permanen session yang sudah di-soft-delete. |

Urutkan daftar session berdasarkan waktu pembaruan terbaru dengan urutan yang stabil ketika waktunya sama. Untuk isi percakapan, kembalikan seluruh pesan dari yang paling lama, termasuk cabang percakapan dan pesan yang ditandai terhapus; jangan batasi hasil ke jalur active leaf. Gunakan ID sebagai penentu urutan tambahan ketika waktu sama.

### 3. User Identity and Access

- Sediakan decorator `CurrentUser` untuk mengambil identitas dari `request.user.id` yang disiapkan oleh lapisan autentikasi tepercaya.
- Identitas pengguna harus berupa UUID. Kembalikan HTTP 401 jika identitas tidak tersedia atau tidak valid.
- Jangan mengambil identitas pemilik session dari query, body, atau header yang dikirim langsung oleh pemanggil.
- Batasi seluruh pembacaan dan perubahan berdasarkan pemilik session serta status aktif atau terhapus yang sesuai dengan operasinya.
- Kembalikan HTTP 404 untuk session yang tidak ditemukan, milik pengguna lain, atau tidak berada pada status yang sesuai.
- Validasi parameter ID session sebagai UUID. Integrasi login, JWT, dan middleware autentikasi berada di luar pekerjaan ini; sampai lapisan tersebut menyediakan identitas tepercaya, request tanpa identitas harus tetap ditolak.

### 4. Pagination, Validation, and Responses

- Gunakan Zod dan `nestjs-zod`, dengan DTO berbasis `createZodDto` serta `ZodValidationPipe` global melalui common module.
- Letakkan `PaginationDto` bersama schema pagination di `common/common.dto.ts` agar dapat digunakan lintas modul. Gunakan query `page` dan `limit`, masing-masing integer antara 1–100, dengan default `page: 1` dan `limit: 10`.
- Letakkan schema dasar chat session di file validation modul, lalu turunkan schema DTO dan tipe yang relevan dari schema tersebut. Gunakan helper Zod bersama di area utils dan API Zod yang tidak deprecated.
- Untuk perubahan judul, wajibkan teks dengan panjang maksimal 255 karakter, trim spasi di kedua ujungnya, dan tolak judul yang kosong setelah trim. Perubahan ini hanya mengubah judul serta waktu pembaruan session.
- Kembalikan daftar melalui `data` dan metadata `paging` yang berisi `currentPage`, `pageSize`, `totalItems`, dan `totalPages`. Gunakan filter yang sama untuk daftar dan perhitungan total. Hasil kosong tetap mengembalikan daftar kosong beserta metadata pagination.
- Kembalikan pesan percakapan melalui `data`. Untuk update, soft delete, dan restore, kembalikan session yang diperbarui melalui `data`. Hapus permanen mengembalikan pesan keberhasilan.

### 5. Session Lifecycle and Data Integrity

- Soft delete hanya menandai session sebagai terhapus dan memperbarui waktu perubahannya. Pertahankan pesan serta data terkait agar percakapan dapat dipulihkan.
- Restore hanya berlaku pada session terhapus milik pengguna; hapus penanda deleted dan perbarui waktu perubahan session.
- Hapus permanen hanya berlaku pada session yang sudah di-soft-delete. Hapus session beserta pesan, feedback, completion, dan relasi session-document dalam satu transaksi.
- Tangani referensi active leaf dan urutan penghapusan sesuai relasi database agar tidak meninggalkan data parsial atau melanggar foreign key.
- Lindungi proses hapus permanen terhadap restore atau perubahan session yang berlangsung bersamaan melalui penguncian session dalam transaksi.
- Pertahankan record dokumen dan file aslinya saat session dihapus permanen.

### 6. Logging

- Inject `PinoLogger` pada constructor controller dan service, lalu atur context menggunakan nama class masing-masing.
- Pada service, catat awal setiap operasi dengan level trace dan konteks user ID, session ID, atau pagination yang relevan.
- Catat keberhasilan update, soft delete, restore, dan hapus permanen dengan level info. Untuk hapus permanen, catat keberhasilan setelah transaksi selesai.
- Gunakan level warn ketika session yang diminta tidak ditemukan atau tidak tersedia pada status yang diperlukan.

### 7. Validation

- Gunakan unit test dengan mock dependency agar pemeriksaan tidak memerlukan koneksi database aktif.
- Verifikasi penolakan identitas yang tidak tepercaya, validasi DTO melalui ZodValidationPipe, serta default dan konversi pagination.
- Verifikasi pagination dan filter status pada daftar aktif maupun terhapus, pembatasan akses pesan berdasarkan pemilik, serta restore yang hanya berlaku pada session terhapus milik pengguna.
- Pastikan penghapusan data terkait tidak dijalankan jika session terhapus milik pengguna tidak berhasil dikunci untuk penghapusan permanen.
- Pastikan build, test terkait, dan lint berhasil menggunakan perintah proyek yang tersedia.

**Scope: Pengelolaan chat session dan pembacaan pesan existing, beserta integrasi modul, validasi, pagination, kontrol akses berbasis identitas tepercaya, dan logging. Tidak mencakup pembuatan session baru, pengiriman atau pembuatan pesan, pemanggilan LLM, pengelolaan dokumen, maupun operasi Milvus.**
