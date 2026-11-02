# Backend Validation & DTO Rules

Aturan ini mengikuti pola yang sudah dipakai di backend: **Zod schema → `createZodDto` → NestJS controller → service**. Tujuannya agar data dari frontend divalidasi sebelum masuk ke logic bisnis, sementara tipe TypeScript tetap bisa digunakan ulang.

## 1. Struktur file

```text
src/model/<feature>/
├── <feature>.validation.ts    # Base Zod schema lengkap
├── <feature>.interface.ts     # Base DTO class + tipe request/response
├── <feature>.controller.ts
├── <feature>.service.ts
└── dto/
    └── <operation>.dto.ts    # Schema turunan + DTO khusus endpoint
```

Ikuti penamaan yang sudah ada pada feature terkait (`DTO` atau `Dto`); tidak perlu mengganti nama semua class lama.

## 2. Base schema harus lengkap dan reusable

- Definisikan schema utama di `<feature>.validation.ts`, termasuk field model seperti `id`, `userId`, `status`, `createdAt`, dan `updatedAt` sesuai kebutuhan entity.
- Pertahankan aturan tipe, panjang string, enum, `nullable`, dan sebagainya di satu sumber.
- **Jangan hapus base schema hanya karena belum dipakai langsung oleh controller.** Schema tersebut menjadi dasar DTO untuk endpoint yang sudah ada maupun yang akan ditambahkan.
- Jika request hanya memakai sebagian field, turunkan schema dengan Zod `.pick()`, `.omit()`, `.extend()`, atau `.partial()` sesuai kontrak endpoint. Jangan membuat ulang validasi field yang sama tanpa alasan.

Contoh sumber saat ini: `documentSchema` di `src/model/documents/documents.validation.ts` dan `BaseChatSessionSchema` di `src/model/chat-session/chat-session.validation.ts`.

## 3. Base schema dibuat menjadi DTO class

Tempatkan DTO dasar di `<feature>.interface.ts` mengikuti pola `CompletionDTO` yang sudah ada di `src/model/chat/chat.interface.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { completionSchema } from './chat.validation';

export class CompletionDTO
  extends createZodDto(completionSchema)
  implements z.infer<typeof completionSchema> {}
```

Class ini dapat digunakan sebagai **tipe TypeScript** untuk properti, parameter, dan return type. `z.infer` menjaga bentuk tipe tetap sesuai schema Zod. Tidak perlu mendefinisikan interface identik secara manual.

**Catatan penting:** memakai DTO sebagai *return type* hanya memberi pemeriksaan TypeScript. Itu **tidak otomatis menjalankan validasi Zod terhadap response**. Validasi runtime terjadi ketika schema diparse atau DTO diproses oleh validation pipe.

## 4. Request DTO khusus endpoint menggunakan `pick`/`omit`

Jangan menggunakan semua field base entity untuk request yang hanya menerima sebagian field. Buat schema turunan dan class request DTO di folder `dto/`.

Contoh nyata: `src/model/chat-session/dto/update-chat-session.dto.ts` untuk rename session.

```ts
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BaseChatSessionSchema } from '../chat-session.validation';

export const UpdateChatSessionSchema = BaseChatSessionSchema.pick({
  title: true,
}).extend({
  title: BaseChatSessionSchema.shape.title.unwrap().trim().min(1),
});

export class UpdateChatSessionDto
  extends createZodDto(UpdateChatSessionSchema)
  implements z.infer<typeof UpdateChatSessionSchema> {}
```

Hasilnya, request rename hanya menerima `title`; frontend tidak perlu dan tidak boleh mengirim `id`, `userId`, `createdAt`, dan field entity lain melalui body tersebut.

Aturan saat membuat DTO:

1. Mulai dari **base Zod schema**, bukan menyalin definisi field secara manual.
2. Gunakan `.pick()` untuk field yang diizinkan, atau `.omit()` saat lebih tepat.
3. Gunakan `.extend()` hanya untuk perubahan aturan spesifik endpoint, seperti mengubah `nullable` menjadi wajib atau menambahkan `.trim()`.
4. Gunakan `.optional()`/`.partial()` hanya bila memang didukung kontrak request. Jangan menyamakan `nullable` dengan `optional`.
5. Tidak perlu membuat request-body DTO untuk endpoint tanpa body. Gunakan DTO query bersama seperti `PaginationDto` atau `ParseUUIDPipe` untuk parameter UUID yang sudah ada.

## 5. Controller wajib memakai DTO class untuk request body

```ts
@Patch(':id')
update(
  @CurrentUser() user: JwtPayload,
  @Param('id', new ParseUUIDPipe()) id: string,
  @Body() body: UpdateChatSessionDto,
) {
  return this.chatSessionService.update(user.sub, id, body);
}
```

`CommonModule` sudah mendaftarkan `ZodValidationPipe` sebagai global `APP_PIPE`. Karena `@Body()` menggunakan class hasil `createZodDto`, Nest dapat menjalankan validasi Zod **sebelum** method service dipanggil. Request yang tidak sesuai schema ditolak oleh validation pipeline.

Jangan mengganti tipe request body menjadi `any`, `unknown`, atau interface TypeScript biasa jika endpoint mengandalkan validasi runtime dari DTO tersebut. Interface/type saja tidak menyediakan metadata class yang dibutuhkan pipe.

## 6. Reuse DTO untuk kontrak response dan tipe internal

Gunakan `Pick`/`Omit` TypeScript dari DTO yang sudah dibuat bila bentuknya sesuai:

```ts
export type ChatHistoryContext = Pick<ChatHistoryDTO, 'role' | 'content'>;

export type DocumentMutationDTO = Pick<
  DocumentDTO,
  'id' | 'fileName' | 'updatedAt'
>;
```

Gunakan `WebResponse<T>` untuk return type endpoint JSON sesuai pola backend:

```ts
Promise<WebResponse<DocumentMutationDTO>>
```

Jika bentuk response memang berbeda dari bentuk base DTO (misalnya `BigInt` diubah menjadi string, ada signed URL, atau event SSE), definisikan tipe response yang mencerminkan **data yang benar-benar dikirim**, bukan memaksakan schema entity mentah.

`Pick<T>` dan `Omit<T>` TypeScript hanya mengubah **tipe**, sedangkan `.pick()` dan `.omit()` Zod menghasilkan **schema validasi runtime**. Jangan tertukar.

## Checklist sebelum membuat atau mengubah endpoint

- [ ] Base schema Zod entity tetap ada dan lengkap.
- [ ] Field request berasal dari schema turunan, bukan menerima seluruh entity tanpa kebutuhan.
- [ ] DTO request berupa class `createZodDto(...)` dan digunakan di `@Body()`/`@Query()` jika memerlukan validasi Zod.
- [ ] `nullable`, `optional`, dan aturan field sesuai kontrak endpoint.
- [ ] Tipe response sesuai data aktual, menggunakan DTO/`Pick`/`Omit` bila cocok.
- [ ] Tidak ada schema/type duplikat yang dibuat hanya untuk mengikuti bentuk folder.
- [ ] Perubahan schema/DTO diuji untuk input valid dan tidak valid.
