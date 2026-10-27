# Document upload and processing

All document endpoints require `Authorization: Bearer <accessToken>` and check ownership.

1. `POST /documents/presigned-url`, JSON body `{ "fileName": "example.pdf" }`.
   Returns `201` with `data.document_id`, `data.upload_url`, and `data.expires_in` (900 seconds).
2. `PUT <upload_url>` with the PDF bytes as the binary request body. No backend Bearer token.
3. `POST /documents/<document_id>/process`, no body. Returns `202` with
   `data: { document_id, status: "QUEUED", progress: 0 }` (or `PROCESSING` for an already running job).
4. `GET /documents/<document_id>/progress`, with `Accept: text/event-stream`.
   Can connect before or after starting the process. Reconnecting reads the latest job snapshot.

Example SSE messages (each event ends with a blank line):

```text
data: {"document_id":"<uuid>","progress":10,"status":"PROCESSING"}

data: {"document_id":"<uuid>","progress":95,"status":"PROCESSING"}

data: {"document_id":"<uuid>","progress":100,"status":"READY"}
```

Progress is a weighted measure of work, not elapsed time: read/validate/hash 0–10,
page extraction 10–35, chunking 35–40, embedding + Milvus batches 40–95, final flush + DB 95–100.
`READY` is emitted only after storage completes. `FAILED` includes a safe `error` message;
PDFs without text fail with an OCR-required message. Streams close on READY/FAILED and
send `event: heartbeat` with `{}` every 15 seconds while idle.

In Postman, open the progress GET request with the same Bearer token. In a browser,
use fetch-based SSE to send the Authorization header; native EventSource does not
support setting this header. Disconnecting the stream does not cancel the worker.

`GET /documents/<document_id>` returns persistent metadata and a 15-minute `download_url`.
`fileSize` is a decimal string (or null) because PostgreSQL stores it as BigInt.
File size, MIME type and SHA-256 are calculated from the uploaded bytes; page count
and chunk count are filled during processing. File names come from the presign request.

Repeated process calls reuse one job per document. Failed documents may be retried with
the same POST after failure; retries clear partial Milvus chunks before rebuilding.
READY/DELETING/DELETED return 409; missing, deleted or another user's document returns
404; malformed IDs return 400; unavailable Redis returns 503. The default worker runs
one job at a time per backend instance. QueueEvents forwards Redis events between instances.

## Local setup

Use the existing Redis instance. Default `REDIS_URL=redis://localhost:6379`;
`rediss://` and password/database URLs are supported. Optional `QUEUE_PREFIX`
is `chat-pdf` by default and must match across API/worker instances.
Use Redis persistence and the `noeviction` memory policy for durable job storage.
Run `bun install` and `bun run start:dev`. No new database migration is needed for processing.

## Integration verification

Start the HTTP stand-ins (no paid API calls):

```sh
postman simulation run postman/simulations/document-processing.sim.yaml --port 14900 --output ndjson --no-history
```

In another terminal:

```sh
bun run build
bun run test/integration/document-processing.cjs
```

Tests use the configured local PostgreSQL and Redis, create a unique user and queue
prefix, then remove only their own records/jobs. MinIO object HTTP and Gemini embedding
HTTP are simulated. Milvus gRPC writes use an in-memory adapter: these tests do not
establish compatibility with a live Milvus server or the live Gemini model.
See `postman/simulations/document-processing.context.md` for run observations.

References: [BullMQ events](https://docs.bullmq.io/guide/events/),
[Gemini batch embedding contract](https://ai.google.dev/api/embeddings#method:-models.batchembedcontents).

Shared Redis configuration lives in `src/common/queue` using `BullModule.forRootAsync()`.
DocumentsModule registers its queue with `BullModule.registerQueue()`.
DocumentQueueService injects it with `@InjectQueue()` and handles enqueue/retry.
DocumentWorkerService uses `@Processor()` + `WorkerHost` for PDF processing.
DocumentProgressService uses `@QueueEventsListener()` + `@OnQueueEvent()` for SSE.
Nest's BullMQ integration creates and closes the queue, workers and event listeners.

Read the code in this order:
1. `src/common/queue/queue.module.ts`: shared queue setup.
2. `src/model/documents/documents.module.ts`: register the document queue.
3. `src/model/documents/queue/document-queue.service.ts`: add a job.
4. `src/model/documents/processing/document-worker.service.ts`: STEP 1–7 process the PDF.
5. `src/model/documents/queue/document-progress.service.ts`: forward progress to clients.

## Shared connection lifecycle

`common/queue/queue-connection.service.ts` discovers all registered BullMQ queues,
workers and event listeners once on bootstrap. It attaches connection error logging
and drains active workers before Prisma/storage shutdown. Nest still creates/closes
all BullMQ connections; a feature does not need connection initialization or shutdown hooks.
The `run(queue, operation)` method waits up to five seconds for the existing connection
before executing producer operations or loading an SSE snapshot. It does not create
connections. The deadline applies to readiness, not to the full processing job.
The integration suite also registers a second queue and verifies active work finishes
on shutdown without lifecycle code in that feature's worker.
