# Document Upload API Reference

Four protected endpoints handle PDF upload reservations and background processing. Use `Authorization: Bearer <access-jwt>` for NestJS requests.

| Method | Path | Function |
| --- | --- | --- |
| POST | `/document-upload/presigned-url` | Create document reservation and signed MinIO PUT URL |
| POST | `/document-upload/:id/process` | Queue PDF processing |
| GET | `/document-upload/:id/progress` | Stream progress through SSE |
| POST | `/document-upload/:id/retry` | TODO/coming soon; no retry implementation |

## 1. Presigned upload URL

**POST `/document-upload/presigned-url`** — 201 Created

**Headers:** `Authorization: Bearer <access-jwt>`, `Content-Type: application/json`.

| Body field | Type | Required | Validation |
| --- | --- | --- | --- |
| `fileName` | string or null | Yes | String length 1–255; current schema permits null |

```json
{ "fileName": "report.pdf" }
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

Creates a `Document` record owned by the user with `PENDING_UPLOAD` status. The MinIO object key is the document UUID. If URL generation fails, the record is removed.

**Errors:** 400 invalid request; 401 unauthorized; storage/database failures may propagate.

## 2. Direct upload to MinIO

This is **not** a NestJS route. Send the PDF bytes directly to `upload_url`:

```http
PUT <upload_url>
Content-Type: application/pdf

<PDF binary>
```

The URL itself grants temporary upload permission; do not send the backend Bearer token to MinIO. A successful storage-dependent 2xx response generally has no JSON body.

## 3. Process document

**POST `/document-upload/:id/process`** — 201 Created

No body. `id` is a UUID. For an owned, non-trashed document outside the `DELETING`/`DELETED` lifecycle, the service changes status to `QUEUED` and adds a BullMQ job with `jobId = documentId`, passing `userId` and `documentId` to the worker. The worker claims only `QUEUED` documents; stale jobs cannot switch a permanently deleted document back to `PROCESSING` or `READY`.

```json
{
  "message": "🎉 Document processing job created successfully! Welcome aboard! 🚀",
  "data": { "id": "550e8400-e29b-41d4-a716-446655440000", "status": "QUEUED" }
}
```

**Errors:** 400 invalid UUID; 401 unauthorized; 503 initial update/queue insertion failure; a missing document can fail during the final lookup.

**Existing limitations:** outside the deletion guards, the service does not fully validate status transitions, HEAD-verify the MinIO object, verify file size/MIME/hash, or explicitly handle duplicate calls beyond reusing the job ID. A missing/ineligible document returns 404; queue failures return 503 without overwriting permanent-deletion states.

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
4. The worker sets `PROCESSING`, fetches MinIO bytes, extracts PDF text, splits into 1000-character chunks (overlap 200), embeds in Gemini batches of 50, and inserts `document_chunks` in Milvus.
5. The worker stores `pageCount`, `chunkCount`, and `READY`; failed jobs are marked `FAILED` by the queue listener.

The worker and queue listener belong to `DocumentUploadModule`. Redis queue name remains `documents`, with one attempt per job, exactly as before the module split.
