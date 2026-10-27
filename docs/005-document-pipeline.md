# PDF upload and chat

The implementation lives in this NestJS repository. Shared clients follow
`src/common/ai`, `src/common/storage`, and the existing Prisma/Milvus services.
Features follow the existing `src/model/<feature>` controller/service/module/DTO
structure. LangChain.js handles models, splitting and embeddings; LangGraph.js
controls search, context evaluation and up to three retrieval rounds.

## Run

Use Node 24.15+ LTS and npm. The existing dependency tree has peer conflicts;
install with `npm ci --legacy-peer-deps` and use the committed package-lock.json.
The Bun lockfile predates these npm additions; npm is the maintained lockfile
for this change. Do not run both package managers against this dependency tree.

1. Add the storage/model settings from `.env.example` to `.env`.
2. Start PostgreSQL, MinIO and Milvus. Endpoints must be reachable by the process
   running Nest; a browser must also be able to reach `MINIO_ENDPOINT`.
3. Apply the reviewed migration using
   `npx prisma migrate deploy --config prisma7.config.ts`. This adds upload
   reservations, durable jobs, and stored message sources. It preserves existing data.
4. Run `npx prisma generate --config prisma7.config.ts` and `npm run build`.
5. MinIO must be reachable at startup. `StorageService.onModuleInit()` automatically creates the private bucket if missing, or reuses it if it already exists. No separate storage initialization command is needed.
6. Start the API with `npm run start:prod` (or `npm run start:dev` in development).
   Nest starts background PDF processing in the same process through
   `DocumentWorkerService.onApplicationBootstrap()`. No separate worker command is needed.
   On SIGINT/SIGTERM, processing stops claiming jobs and finishes the active
   document before Nest closes its shared database and vector clients.

There is no Python service, Go proxy, internal bearer secret, or RAG service URL.
HTTP and PDF processing share one process and restart together. Jobs remain
durable in PostgreSQL; a crashed job is recovered by the existing lease logic.
API authentication uses the existing Nest JWT/session guard and `CurrentUser`.
All public request/response keys retain the earlier snake_case contract.
Input validation now uses Nest's existing Zod pipe and returns HTTP 400.

## Frontend flow

The detailed contract is `docs/document-api.yaml`. Authenticate requests to Nest
with the existing bearer access token.

1. `POST /presigned-url` with `{"filename":"report.pdf"}` returns
   `data.upload_id`, `upload_url`, `object_key`, `method=PUT`, and `expires_in=900`.
2. PUT raw PDF bytes directly to `upload_url`. Do not send the Nest token to
   MinIO or wrap the PDF in a multipart form.
3. `POST /documents/upload` with `{"upload_id":"<uuid>"}` returns HTTP 202
   and `data.id`, processing status, metadata and a 15-minute download URL.
   Repeating the reservation returns the same document/job.
4. Poll `GET /documents/<id>` until `ready` or `failed`; this refreshes the URL.
5. `POST /chat` with `{"question":"…","document_ids":["<uuid>"]}` creates
   a conversation. Supply the returned `session_id` for subsequent turns.

The chat response includes `answer`, `sources`, `session_id`, `message_id`,
`search_attempts`, and `context_sufficient`. Citations identify document, filename,
chunk and 1-based page. Existing chat-history endpoints return stored sources.
Context sufficiency is an LLM judgment, not proof of answer correctness.

## Processing guarantees and limits

- Upload finalization validates the PDF, hashes it and freezes a private copy.
  Reusing the temporary PUT URL cannot change that indexed copy. Metadata and
  a durable PostgreSQL job commit in one transaction.
- Workers claim with `FOR UPDATE SKIP LOCKED`. Heartbeat leases recover crashed
  work after 15 minutes. Three failed attempts set the document to `failed`.
  Lease checks prevent an old worker from committing a newer worker's status.
- Extraction preserves page numbers. Split size is 1000 characters with 150
  overlap. Chunk IDs are deterministic. A document becomes `ready` only after
  embeddings and Milvus writes succeed; vectors are filtered by user/document.
- Defaults: 20 MiB, 2000 pages, 30000 chunks, ten selected documents per chat,
  ten prior messages from the active branch. Scanned PDFs need OCR, which is
  outside this implementation. No streaming response is added.
- The graph has a 110-second cancellation budget. Model/storage failures do
  not save partial chat messages. Concurrent writes to the same conversation
  return HTTP 409; retry after refreshing history.
- Changing embedding provider, model, or dimensions requires a new
  `MILVUS_COLLECTION` and re-indexing. PDF.js and the TypeScript splitter can
  produce different text boundaries from Python; re-index existing Python
  documents into a new collection rather than mixing chunk implementations.
- Set MinIO CORS for the actual frontend origin and a lifecycle policy for
  temporary uploads/orphaned objects. Presigned PUT sizes are validated at
  finalization; the PUT itself does not enforce the application size limit.

## Verification

`npm run build`, `npm test`, and `npm run lint` cover compilation and unit checks.
The opt-in `npm run test:rag` runs the HTTP pipeline using actual Nest JWT auth,
Prisma/PostgreSQL, MinIO, Milvus and LangChain/LangGraph calls.

Use `compose.test.yaml` for an isolated `rag_test` database on 15432 and MinIO
on 19000. Build `chat-pdf-minio:local` using `infrastructure/minio/Dockerfile`,
or set `MINIO_TEST_IMAGE` to an existing trusted image. Tests store data in tmpfs.
Start `postman simulation run postman/simulations/pdf-rag.sim.yaml --port 14900 --output ndjson`.
Set process variables (overriding `.env`):

```text
RUN_RAG_INTEGRATION=1
DATABASE_URL=postgresql://rag_test:rag_test_only@127.0.0.1:15432/rag_test
MINIO_ENDPOINT=127.0.0.1:19000
MINIO_ENDPOINT=127.0.0.1:19000
MINIO_ACCESS_KEY=rag-test
MINIO_SECRET_KEY=rag-test-only-password
MINIO_BUCKET=rag-test
MILVUS_ADDRESS=localhost:19530
MILVUS_COLLECTION=test_nest_rag_pipeline
LLM_PROVIDER=openai
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=local-dummy
OPENAI_BASE_URL=http://127.0.0.1:14900/llm/v1
LOG_LEVEL=error
```

Apply migrations to that isolated database first. Run `npm run test:rag`.
The fixtures model HTTP response shapes and deterministic embeddings; they
verify application behavior, not model quality. A live Gemini run uses the
Gemini provider and key, its own `test_` collection, and optionally `LIVE_PDF_PATH`
for a PDF explicitly authorized to be sent to Gemini. Default PDF is synthetic.
The suite only accepts database name `rag_test` and a `test_` collection.

## AI health

Call `GET /health/ai` with the existing bearer access token. The endpoint sends a small real request to the configured chat model and returns HTTP 200 with `data: {status: ok, ai: up}` when it responds with nonempty text. Configuration errors, provider failures, empty responses and the ten-second timeout return HTTP 503 with `data: {status: error, ai: down}`. Provider details and API keys are not exposed. This checks the chat provider only, consumes provider quota, and does not probe embeddings, PostgreSQL or Milvus.

The isolated HTTP client test can be run with `RUN_AI_HEALTH_INTEGRATION=1 npx vitest run --config vitest.config.e2e.ts test/ai-health.e2e-spec.ts`. For simulation, use the same OpenAI fixture settings above; for a live check, select Gemini with the key in `.env`. The test fixture exercises HTTP routing and the real model client without starting database/vector clients; application authentication remains the existing global guard.

## MinIO health

`GET /health/minio` uses the existing bearer access token and checks access to
the configured bucket without uploading/downloading files. Returns HTTP 200
with `data: {status: ok, minio: up}` or HTTP 503 with
`data: {status: error, minio: down}` when the bucket is missing, inaccessible,
or the server cannot be reached. Provider details and credentials are not exposed.

MinIO uses one shared `StorageService` client, constructed once like the Prisma/Milvus clients. DocumentsService owns presigned URLs and object I/O; PdfService owns file validation, limits, hashing and extraction. The same MINIO_ENDPOINT is used for backend requests and browser presigned URLs.
