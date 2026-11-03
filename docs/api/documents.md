# Documents API Reference

Document management is separate from upload/processing. Every endpoint requires `Authorization: Bearer <access-jwt>` and is scoped to the authenticated user.

## Endpoint index

| Method | Path | Function |
| --- | --- | --- |
| GET | `/documents` | Paginated list of active, `READY` documents |
| GET | `/documents/deleted` | Paginated Trash list |
| GET | `/documents/:id` | Document detail + temporary download URL |
| DELETE | `/documents/:id` | Soft-delete a `READY` document |
| POST | `/documents/:id/restore` | Restore a trashed document |
| DELETE | `/documents/:id/permanent` | Permanently delete an unlinked trashed document |

All success responses use `WebResponse` (`message`, optional `data` and `paging`). Exceptions use Nest's error response format.

## 1. List ready documents

**GET `/documents?page=1&limit=10`** — 200 OK

| Query | Type | Required | Validation |
| --- | --- | --- | --- |
| `page` | integer | No | 1–100; default 1 |
| `limit` | integer | No | 1–100; default 10 |

Only records with `userId` matching the access token, `status: READY` and `deletedAt: null` are included. Order: `updatedAt DESC`, then `id DESC`.

```json
{
  "message": "📦 Documents retrieved successfully! Smooth sailing! 😎",
  "data": [{ "id": "550e8400-e29b-41d4-a716-446655440000", "fileName": "report.pdf", "status": "READY", "fileSize": null, "deletedAt": null }],
  "paging": { "currentPage": 1, "pageSize": 10, "totalItems": 1, "totalPages": 1 }
}
```

The shown item is abbreviated; the actual response includes every `Document` model field. `fileSize` is converted from BigInt to a decimal string, or null.

**Errors:** 400 invalid pagination; 401 unauthorized.

## 2. List deleted documents

**GET `/documents/deleted?page=1&limit=10`** — 200 OK

Uses the same query and response shape as `GET /documents`, except the filter is `userId` plus `deletedAt IS NOT NULL` and the response message refers to deleted documents. The list is ordered by `updatedAt DESC`, then `id DESC`.

**Errors:** 400 invalid pagination; 401 unauthorized.

## 3. Get document detail

**GET `/documents/:id`** — 200 OK

| Path | Type | Required | Validation |
| --- | --- | --- | --- |
| `id` | UUID | Yes | Valid UUID |

Returns an active document belonging to the caller, including all `Document` fields and a `download_url` (MinIO presigned GET, expires in 900 seconds). This endpoint does not require `READY` status.

```json
{
  "message": "📦 Document retrieved successfully! Smooth sailing! 😎",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "fileName": "report.pdf",
    "status": "READY",
    "fileSize": null,
    "download_url": "https://storage.example.com/documents/<signed-url>"
  }
}
```

The response item is abbreviated. **Errors:** 400 invalid UUID; 401 unauthorized; 404 not found, not owned, or deleted; storage errors may propagate.

## 4. Soft delete

**DELETE `/documents/:id`** — 200 OK

No request body. Requires an owned document with `status: READY` and `deletedAt: null`. Sets `deletedAt` to the current time; neither MinIO nor Milvus is deleted.

```json
{
  "message": "🗑️ Document deleted successfully! Sayonara! 👋",
  "data": { "id": "550e8400-e29b-41d4-a716-446655440000", "fileName": "report.pdf", "updatedAt": "2026-11-02T07:00:00.000Z" }
}
```

**Errors:** 400 invalid UUID; 401 unauthorized; 404 not found, not owned, already deleted, or not `READY`.

## 5. Restore

**POST `/documents/:id/restore`** — 200 OK

No request body. Requires an owned document with `deletedAt IS NOT NULL`. Clears `deletedAt` without reprocessing.

```json
{
  "message": "♻️ Document restored successfully! Back in action! ✨",
  "data": { "id": "550e8400-e29b-41d4-a716-446655440000", "fileName": "report.pdf", "updatedAt": "2026-11-02T07:00:00.000Z" }
}
```

**Errors:** 400 invalid UUID; 401 unauthorized; 404 not found, not owned, or not deleted.

## 6. Permanent delete

**DELETE `/documents/:id/permanent`** — 200 OK

No request body. Requires an owned document already in Trash. The service checks `session_documents` in a transaction. If any chat session is linked, it rejects deletion with 409 and leaves the relation untouched. Otherwise it deletes document chunks from Milvus (`document_chunks`), removes the MinIO object, and deletes the PostgreSQL document row.

```json
{
  "message": "🗑️ Document permanently deleted successfully! Sayonara! 👋",
  "data": { "id": "550e8400-e29b-41d4-a716-446655440000", "fileName": "report.pdf", "updatedAt": "2026-11-02T07:00:00.000Z" }
}
```

**Errors:** 400 invalid UUID; 401 unauthorized; 404 not found, not owned, or not in Trash; 409 still linked to `SessionDocument`; storage/vector/database errors may propagate.

## Notes

- Upload, processing and SSE progress routes live in [Document Upload](document-upload.md), under `/document-upload`.
- `Document` remains the single Prisma model. No additional upload table is introduced.
- There are no request-body DTOs for these actions; list queries use shared `BaseQueryDto`, and `:id` uses `ParseUUIDPipe`. The shared `q` and `order` fields are reserved for list filtering/sorting and do not change the current list behavior yet.
