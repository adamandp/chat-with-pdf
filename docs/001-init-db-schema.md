# Initialize Database Schema

Implementasikan initial database schema di schema.prisma

Gunakan strict TypeScript, tanpa `any` atau unsafe type assertions.

### 1. users

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | PK |
| username | VARCHAR(255) | UNIQUE, NULL |
| password_hash | TEXT | NULL |
| role | VARCHAR(20) | NOT NULL, DEFAULT 'user' |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |
| deleted_at | TIMESTAMPTZ | NULL |

### 2. chat_session

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users.id, NOT NULL |
| title | VARCHAR(255) | DEFAULT 'New Chat' |
| answer_mode | VARCHAR(30) | DEFAULT 'document_only' |
| active_leaf_message_id | UUID | FK → chat_history.id, NULL |
| last_message_at | TIMESTAMPTZ | NULL |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |
| deleted_at | TIMESTAMPTZ | NULL |

### 3. chat_history

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | PK |
| session_id | UUID | FK → chat_session.id, NOT NULL |
| parent_message_id | UUID | FK → chat_history.id, NULL |
| version_group_id | UUID | NOT NULL |
| role | VARCHAR(20) | NOT NULL |
| content | TEXT | NOT NULL, DEFAULT '' |
| answer_mode | VARCHAR(30) | NULL |
| status | VARCHAR(20) | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |
| deleted_at | TIMESTAMPTZ | NULL |

### 4. chat_feedback

| Column | Data Type | Constraint |
|---|---|---|
| id | SERIAL | PK |
| chat_history_id | UUID | FK → chat_history.id, NOT NULL, UNIQUE |
| type | ENUM | NOT NULL, LIKE / DISLIKE |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

### 5. completions

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | PK |
| chat_history_id | UUID | FK → chat_history.id, NOT NULL |
| model | VARCHAR(100) | NOT NULL |
| provider | VARCHAR(50) | NOT NULL |
| input_tokens | INTEGER | DEFAULT 0 |
| output_tokens | INTEGER | DEFAULT 0 |
| total_tokens | INTEGER | DEFAULT 0 |
| input_cost | NUMERIC(12,8) | DEFAULT 0 |
| output_cost | NUMERIC(12,8) | DEFAULT 0 |
| total_cost | NUMERIC(12,8) | DEFAULT 0 |
| latency_ms | INTEGER | NULL |
| time_to_first_token_ms | INTEGER | NULL |
| status | VARCHAR(20) | NOT NULL |
| error_message | TEXT | NULL |
| started_at | TIMESTAMPTZ | DEFAULT NOW() |
| completed_at | TIMESTAMPTZ | NULL |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

### 6. documents

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users.id, NOT NULL |
| filename | VARCHAR(255) | NOT NULL |
| file_path | TEXT | NOT NULL |
| file_size | BIGINT | NOT NULL |
| mime_type | VARCHAR(100) | NOT NULL |
| sha256_hash | VARCHAR(64) | NOT NULL |
| page_count | INTEGER | NULL |
| chunk_count | INTEGER | DEFAULT 0 |
| status | VARCHAR(20) | NOT NULL |
| error_message | TEXT | NULL |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |
| deleted_at | TIMESTAMPTZ | NULL |

### 7. session_documents

| Column | Data Type | Constraint |
|---|---|---|
| session_id | UUID | PK, FK → chat_session.id |
| document_id | UUID | PK, FK → documents.id |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

Composite Primary Key: `(session_id, document_id)`.

### Implementation Requirements

- Gunakan **strict TypeScript** dan type-safe Prisma Client.
- Gunakan **camelCase untuk seluruh field Prisma**, sedangkan nama kolom PostgreSQL tetap **snake_case** menggunakan `@map`.
- Contoh: `userId @map("user_id")`, `createdAt @map("created_at")`, `chatHistoryId @map("chat_history_id")`.
- Gunakan PascalCase untuk Prisma models dan `@@map` untuk nama tabel existing.
- Implementasikan seluruh foreign keys, relationships, constraints, default values, dan indexes.
- Gunakan enum untuk feedback `LIKE` dan `DISLIKE`.
- Pastikan satu chat message hanya memiliki maksimal satu feedback.
- Gunakan `sha256_hash` untuk identifikasi dokumen identik. Jangan jadikan UNIQUE secara global.
- Pertahankan tipe PostgreSQL sesuai spesifikasi.
- Hanya tulis kode di schema.prisma sisanya urusan user

**Scope: Database schema initialization dan migration saja.**