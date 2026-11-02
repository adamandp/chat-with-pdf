# Document upload and processing

Current implementation: `DocumentUploadModule`. All Nest routes require the user's Bearer access token. The direct upload to MinIO uses the signed URL instead.

1. `POST /document-upload/presigned-url` with `{ "fileName": "example.pdf" }`. Creates a `PENDING_UPLOAD` document row and returns `document_id`, `upload_url` and `expires_in` (900 seconds).
2. `PUT <upload_url>` directly to MinIO with PDF bytes. The object key is the document UUID.
3. `POST /document-upload/:id/process` with no body. Updates the record to `QUEUED` and adds a BullMQ job (`jobId = documentId`).
4. `GET /document-upload/:id/progress` with `Accept: text/event-stream`. The endpoint returns an initial status/job snapshot followed by queue events; heartbeat every 15 seconds. `READY` or `FAILED` closes the stream.
5. Once `READY`, the document is returned by `GET /documents`. The document list deliberately excludes all other statuses.

## Worker stages

The processor downloads the PDF from MinIO, extracts page text with PDF.js, splits text with chunk size 1000 and overlap 200, embeds batches of 50 chunks using Gemini and inserts them into Milvus `document_chunks`. It then updates PostgreSQL `pageCount`, `chunkCount` and status `READY`.

Progress steps: 5 (start), 15 (download), 40 (extraction), 60 (chunking), 70 (enrichment), 90 (embedding), 95 (vector insert), 100 (metadata saved).

`DocumentsListener` handles BullMQ `waiting`, `active`, `progress`, `completed` and `failed` events and forwards status to the upload service's SSE stream. On failure the listener persists `FAILED` and the error message.

## Source files

- `src/model/document-upload/document-upload.module.ts` — queue/worker/listener registration.
- `src/model/document-upload/document-upload.controller.ts` — upload endpoints.
- `src/model/document-upload/document-upload.service.ts` — presign, enqueue and progress SSE.
- `src/model/document-upload/queue/documents.processor.ts` — PDF processing.
- `src/model/document-upload/queue/document-progress.service.ts` — queue status events.
- `src/common/queue/queue.module.ts` — shared BullMQ configuration.

Retry has a route and service TODO only; no retry logic is implemented. The existing process path does not validate the MinIO object's size, MIME type, hash or status transition before enqueueing.

See the [current Document Upload API](api/document-upload.md) and [Documents API](api/documents.md) for frontend contracts. Older pipeline documents in `docs/` may describe removed implementations and are not the active API specification.
