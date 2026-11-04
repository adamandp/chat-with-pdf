# Document Upload API Reference

Four protected endpoints handle PDF upload reservations and background processing. Use `Authorization: Bearer <access-jwt>` for NestJS requests.

| Method | Path                             | Function                                             |
| ------ | -------------------------------- | ---------------------------------------------------- |
| POST   | `/document-upload/presigned-url` | Create document reservation and signed MinIO PUT URL |
| POST   | `/document-upload/:id/process`   | Queue PDF processing                                 |
| GET    | `/document-upload/:id/progress`  | Stream progress through SSE                          |
| POST   | `/document-upload/:id/retry`     | TODO/coming soon; no retry implementation            |

## 1. Presigned upload URL

**POST `/document-upload/presigned-url`** — 201 Created

**Headers:** `Authorization: Bearer <access-jwt>`, `Content-Type: application/json`.

| Body field   | Type                    | Required | Validation                                                       |
| ------------ | ----------------------- | -------- | ---------------------------------------------------------------- |
| `fileName`   | string                  | Yes      | Trimmed, 1–255 characters, must end in `.pdf` (case-insensitive) |
| `fileSize`   | positive integer        | No       | If provided, must be at most `MAX_PDF_BYTES` (default 20 MiB)    |
| `mimeType`   | string                  | No       | Must be `application/pdf`                                        |
| `sha256Hash` | 64-character hex string | No       | If provided, compared with the uploaded bytes during processing  |

```json
{
  "fileName": "report.pdf",
  "fileSize": 12345,
  "mimeType": "application/pdf",
  "sha256Hash": "<64 hex characters>"
}
```

```json
{
  "message": "🎉 Presigned upload URL created successfully! Welcome aboard! 🚀",
  "data": {
    "document_id": "550e8400-e29b-41d4-a716-446655440000",
    "upload_url": "https://storage.example.com/documents/<signed-url>",
    "expires_in": 900
  }
}
```

Creates a `Document` record owned by the user with `PENDING_UPLOAD` status. The MinIO object key is the document UUID. If URL generation fails, the record is removed. For compatibility with existing frontend clients, `{ "fileName": "report.pdf" }` remains valid. The optional metadata is a declaration, not trusted verification.

**Errors:** 400 invalid request; 401 unauthorized; storage/database failures may propagate.

## 2. Direct upload to MinIO

This is **not** a NestJS route. Send the PDF bytes directly to `upload_url`:

```http
PUT <upload_url>
Content-Type: application/pdf

<PDF binary>
```

The URL itself grants temporary upload permission; do not send the backend Bearer token to MinIO. Set `Content-Type: application/pdf` on the PUT. A successful storage-dependent 2xx response generally has no JSON body.

**Storage limitation:** the current presigned **PUT** URL does not enforce a maximum number of bytes at the MinIO upload boundary. Oversized objects can temporarily occupy storage until cleaned up; size is enforced by the NestJS process endpoint and bounded worker stream. Storage-level enforcement requires a length-restricted presigned POST policy (and a frontend contract change) or a proxy upload endpoint.

## 3. Process document

**POST `/document-upload/:id/process`** — 201 Created

No body. `id` is a UUID. The backend first validates document ownership, then performs a MinIO HEAD request. Missing, empty, oversized, incorrectly typed (`Content-Type` other than `application/pdf`), and declared-size-mismatched objects receive HTTP 400 and are **not queued**. For eligible documents outside the `DELETING`/`DELETED` lifecycle, the service changes status to `QUEUED` and adds a BullMQ job with `jobId = documentId`, passing `userId` and `documentId` to the worker. The worker claims only `QUEUED` documents; stale jobs cannot switch a permanently deleted document back to `PROCESSING` or `READY`.

```json
{
  "message": "🎉 Document processing job created successfully! Welcome aboard! 🚀",
  "data": { "id": "550e8400-e29b-41d4-a716-446655440000", "status": "QUEUED" }
}
```

**Errors:** 400 invalid UUID or missing/invalid uploaded object; 401 unauthorized; 404 missing/inaccessible document; 503 queue insertion failure.

**Existing limitations:** state transition rules and duplicate-job handling are unchanged in this fix; those are separate lifecycle concerns. MinIO HEAD checks metadata but cannot prove file type or digest on its own; the worker verifies the actual bytes.

## 4. Progress SSE

**GET `/document-upload/:id/progress`** — 200 OK (`text/event-stream`)

**Headers:** `Authorization: Bearer <access-jwt>`, `Accept: text/event-stream`. `id` is a UUID. The document must belong to the user and not be deleted.

```text
event: message
data: {"document_id":"550e8400-e29b-41d4-a716-446655440000","status":"PROCESSING","progress":40}

event: heartbeat
data: {}

event: message
data: {"document_id":"550e8400-e29b-41d4-a716-446655440000","status":"READY","progress":100}
```

Immediately sends current PostgreSQL status and BullMQ job progress, then forwards queue events (`waiting`, `active`, `progress`, `completed`, `failed`) via the listener and RxJS. A heartbeat is sent every 15 seconds. The stream closes at `READY` or `FAILED`. In-memory event delivery has no durable replay.

**Errors:** 400 invalid UUID; 401 unauthorized; 404 document unavailable/not owned.

## 5. Retry stub

**POST `/document-upload/:id/retry`**

The route and service method exist with a `TODO: Coming soon` comment. **No retry logic is implemented yet.** Do not use it as a functioning retry endpoint.

## Processing lifecycle

1. Presign creates a `PENDING_UPLOAD` document.
2. Direct MinIO PUT uploads the PDF.
3. Process request sets `QUEUED` and enqueues a BullMQ job.
4. The worker sets `PROCESSING`, repeats the MinIO HEAD check, reads the file with an enforced byte cap, checks the `%PDF-` signature and SHA-256 (matching a client declaration when present), then extracts PDF text, splits into 1000-character chunks (overlap 200), embeds in Gemini batches of 50, and inserts `document_chunks` in Milvus.
5. The worker stores verified `fileSize`, `mimeType`, `sha256Hash`, `pageCount`, `chunkCount`, and `READY`; failed jobs are marked `FAILED` by the queue listener. PDF.js parsing also rejects malformed PDF content.

The worker and queue listener belong to `DocumentUploadModule`. Redis queue name remains `documents`, with one attempt per job, exactly as before the module split.
