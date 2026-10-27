# Document processing simulation

2026-10-27. Local stand-ins for S3 object HEAD/GET and Gemini batch embedding.
The CLI has no signed-in account, so published owner mocks were not searched.
Gemini responses follow https://ai.google.dev/api/embeddings#method:-models.batchembedcontents;
S3 HEAD/GET models only the MinIO SDK path exercised here, without signature verification.

## Purpose

Run the real Nest endpoints, BullMQ worker, PDF.js extraction, chunking and LangChain
HTTP embedding client without live model charges or uploads to the user's MinIO.

## Execution

1. `postman simulation run postman/simulations/document-processing.sim.yaml --port 14900 --output ndjson --no-history`
2. `bun run build`
3. `bun run test/integration/document-processing.cjs`
4. Inspect request events for both `documents` and `gemini`; stop simulation with Ctrl-C.

## Assumptions

- 2026-10-27: PostgreSQL and Redis are real local services; the harness creates and
  removes its own user/documents and uniquely prefixed queue. Live credentials are
  replaced for the simulated HTTP services.
- 2026-10-27: Milvus gRPC uses an in-memory adapter. This run does not verify live
  Milvus schema/index compatibility, S3 signature validation, JWT verification,
  or live Gemini access/model availability.

## Observations

<!-- begin:observations -->
- 2026-10-27: Extracting worker stages into private functions passed process/SSE,
  retry, error cases and shared shutdown tests. Both S3 and Gemini members received
  traffic; Gemini success and provider-503 cases were exercised.
- 2026-10-27: Shared QueueConnectionService passed document processing/SSE/retry
  checks plus shutdown of an active second queue whose worker has no lifecycle
  hooks. S3 and Gemini members both received traffic, including the provider-503 fixture.
- 2026-10-27: Refactor to @nestjs/bullmq passed the same integration suite with
  BullModule, @InjectQueue, @Processor/WorkerHost, and @QueueEventsListener. Both
  HTTP members received requests; success, embedding failure and retry still passed.
- 2026-10-27: After extracting shared QueueService/QueueModule, the integration
  suite passed again. Both S3 and Gemini members received traffic; enqueue,
  SSE, retries and managed shutdown still worked with real Redis/PostgreSQL.
- 2026-10-27: Both members received traffic: S3 HEAD/GET for valid, invalid and
  textless PDFs; Gemini batch embedding returned 200 for the valid PDF and 503 for
  the failure fixture. HTTP ownership/UUID checks, duplicate suppression, SSE
  READY/reconnect, persisted metadata, FAILED without 100, and explicit retry passed.
<!-- end:observations -->

## What didn't work

- 2026-10-27: Initial hand-written mock manifests omitted `version: 1` and used
  `entry` instead of scenario `path`; corrected using a CLI-generated manifest.
- 2026-10-27: Sandbox disallowed HTTP listeners and local DB/Redis access; execution
  required approved local-network commands.
