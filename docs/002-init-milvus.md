# Initialize Milvus Integration

Integrasikan Milvus ke backend NestJS sebagai koneksi database vektor yang dapat digunakan melalui dependency injection, mengikuti struktur dan pola integrasi Prisma yang sudah ada.

Pelajari konfigurasi environment, common module, format respons, dan implementasi health check proyek sebelum menentukan detail teknis. Gunakan strict TypeScript dan pertahankan konsistensi dengan kode existing.

### 1. Milvus Integration

- Gunakan SDK `@zilliz/milvus2-sdk-node` dan sesuaikan dependency serta lockfile yang digunakan proyek.
- Sediakan `MilvusService` dan `MilvusModule` di area common, mengikuti pola `PrismaService` dan `PrismaModule`.
- Buat service menyediakan akses ke operasi SDK Milvus dan tersedia melalui common module global agar dapat di-inject oleh feature service.
- Tunggu kesiapan koneksi saat module dimulai dan tutup koneksi saat module dihentikan, mengikuti lifecycle NestJS.
- Pertahankan integrasi PostgreSQL melalui Prisma yang sudah ada.

### 2. Environment Configuration

Gunakan mekanisme konfigurasi environment existing untuk membaca pengaturan berikut:

| Variable | Kebutuhan |
|---|---|
| `MILVUS_ADDRESS` | Wajib diisi dengan endpoint gRPC Milvus; gunakan `localhost:19530` sebagai contoh lokal. |
| `MILVUS_TOKEN` | Opsional; mendukung pasangan `username:password` atau API key Zilliz Cloud. Nilai kosong berarti tanpa token. |
| `MILVUS_SSL` | Mengaktifkan TLS ketika bernilai `true`; default `false`. |
| `MILVUS_DATABASE` | Nama database yang akan digunakan; default `default`. |

Tambahkan contoh konfigurasi ke `.env.example` dan petunjuk setup serta penggunaan service ke README. Jelaskan konfigurasi lokal dan endpoint TLS/Zilliz Cloud, termasuk bahwa database tujuan harus sudah tersedia. Jangan menuliskan credential nyata ke dokumentasi.

### 3. Health Checks

Gunakan satu `HealthController` dan satu `HealthService` dengan function terpisah untuk setiap database:

- `checkPostgres()` pada `GET /health/postgres` memeriksa koneksi PostgreSQL melalui Prisma.
- `checkMilvus()` pada `GET /health/milvus` memeriksa kesehatan Milvus melalui SDK.

Ganti endpoint health gabungan dengan kedua endpoint tersebut. Setiap function hanya memeriksa database yang menjadi tanggung jawabnya; kegagalan satu pemeriksaan tidak menentukan hasil pemeriksaan lainnya.

Ikuti kontrak `WebResponse<HealthResponse>` yang sudah digunakan. Sertakan return type eksplisit pada function controller dan service.

- Saat sehat, kembalikan HTTP 200 dengan pesan sesuai database dan `data` berisi `status: 'ok'` serta `database: 'up'`.
- Saat koneksi gagal, kembalikan HTTP 503 dengan pesan kegagalan sesuai database dan `data` berisi `status: 'error'` serta `database: 'down'`.
- Perlakukan respons Milvus yang menyatakan tidak sehat sebagai kegagalan, meskipun pemanggilan SDK tidak melempar exception.
- Jangan sertakan detail error internal atau credential dalam respons kegagalan.

### 4. Validation

- Sesuaikan `health.service.spec.ts` untuk menguji pemeriksaan PostgreSQL dan Milvus secara independen, termasuk koneksi gagal serta respons Milvus yang tidak sehat.
- Sesuaikan `health.controller.spec.ts` untuk memastikan setiap function meneruskan pemeriksaan ke function service yang tepat serta meneruskan hasil dan kegagalannya.
- Gunakan mock dependency agar unit test tidak membutuhkan database yang sedang berjalan.
- Pastikan test terkait, build, dan lint berhasil dengan perintah proyek yang tersedia.

**Scope: Inisialisasi koneksi Milvus, konfigurasi environment, integrasi dependency injection, health check, dan dokumentasi penggunaannya. Tidak mencakup pembuatan collection, index, embedding, penyimpanan dokumen, atau pencarian vektor.**
