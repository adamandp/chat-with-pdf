# Chat simulation

2026-10-27: Run `postman simulation run postman/simulations/chat.sim.yaml --port 14901 --output ndjson --no-history`,
then `bun run build` and `bun test/integration/chat.cjs` in a second terminal.
Requires local PostgreSQL from DATABASE_URL; sandbox execution needs local-network permission.
The harness cleans up only the user and related data it creates.

## Fixtures and assumptions

Local fixtures model Gemini `generateContent` and `embedContent` response envelopes
used by the installed LangChain client. The previous document fixture modeled
`batchEmbedContents`, which is not the embedQuery path: chat has a separate fixture.
Published-owner lookup was skipped using this repository's established signed-out
Postman setup. No Gemini live credentials are sent. Model content is deterministic.
Milvus is an adapter fixture; PostgreSQL is real. JWT is injected by test middleware.

## Observed run

2026-10-27: Both chat-model and gemini members received request events. Integration
passed validation, ownership, readiness, persisted sources/message pairs, follow-up
history, concurrent turns (201 + 409), provider 503 without new messages, empty
retrieval fallback and deleted-session rejection. Provider failure retried once.

This proves local application/client wiring and database behavior against the
fixtures, not live model quality, live Milvus compatibility or JWT validation.

2026-10-27 SSE run: the same HTTP harness also verifies ordered progress stages,
final `done` with two persisted messages, pre-stream 400/404 responses, and a
post-header provider failure delivered as `error` without `done`. Both simulation
members received traffic. Disconnect cancellation and reverse-proxy buffering were
not exercised by this harness.

2026-10-27 envelope update: integration checks every SSE JSON payload has exactly
`type` and `data`, type matches the SSE event, done.data is the persisted chat result,
and error.data contains the status code. Build and targeted lint passed as well.

2026-10-27 quota classification run: Gemini fixture returned real HTTP 429 with
RESOURCE_EXHAUSTED to the installed LangChain client. JSON endpoint returned 429;
SSE retained HTTP 200 and emitted error.data.status_code 429. Existing provider
503 scenarios still passed, and failed quota requests saved no messages. Both
simulation members received traffic; live provider quotas were not exercised.

2026-10-27 deadline run: harness config sets a 5-second model deadline; Gemini
fixture delays for 8 seconds. SSE emitted 504 before fixture completion and saved
no messages; existing success/429/503/concurrency scenarios passed. Three unit
tests additionally cover a never-resolving SDK, cancellation, and timer cleanup.
Production default is 30 seconds per operation; total graph deadline is 110 seconds.

2026-10-27 trace run: real LangChain clients against simulation emitted evaluate
started/llm_response_received, answer completed and timeout failed trace events.
Existing integration checks passed. Unit tests verify waiting intervals, shared
operationId, elapsed time, failure propagation and timer cleanup without output
content in logs. SDK retries are not individually captured by these callbacks.

2026-10-27 mode run (`bun run build`, `bun test/integration/chat.cjs`): both
chat-model and gemini members received traffic. Quick/pro/ultra, default and invalid
mode, cross-mode sessions, compact versus full stored history, chronological 64k
context budget and direct-mode SSE/error paths passed. Gemini fixture additionally
checked pro history on actual rewrite/answer HTTP payloads and rejected document
metadata in evidence. This remains fixture evidence, not live Gemini performance.
Bun execution requires local-network permission; sandbox-only PostgreSQL access
returned ECONNREFUSED, while the permitted run completed and cleaned up its data.

2026-10-27 thinking run (`bun test/integration/chat-thinking.cjs`): chat-model
received three concurrent requests with LOW/MEDIUM/HIGH verified in Gemini HTTP
payloads by the fixture. Per-session JSON matched each mode. The embeddings member
was silent because this focused check calls ChatModelService directly. No database
or live Gemini was used. Local-network permission was required for Bun fetch.
