# PDF chat

`POST /chat` requires the existing JWT authentication. Its machine-readable contract is
in [chat.openapi.json](chat.openapi.json). Example body:

```json
{
  "question": "Apa risiko investasi yang dibahas di PDF?",
  "mode": "quick",
  "document_ids": ["550e8400-e29b-41d4-a716-446655440000"]
}
```

For subsequent messages, add `session_id` from the first response. Continue
sending the document selection for each turn. Selections may change between turns;
answers use only the current selection. Session-document records retain the union
of documents used by the session. The response includes `answer`, `message_id`,
`sources` (document, filename, page, chunk), `search_attempts` and `context_sufficient`.

## Modes

Choose `mode` per request, including SSE; the default is `quick`. Use the same
`session_id` to switch modes. The response includes the mode used.

Chat model calls explicitly set Gemini `thinkingConfig.thinkingLevel` to `LOW`
for quick, `MEDIUM` for pro and `HIGH` for ultra, including rewrite/evaluate/answer
calls in that mode. Trace logs and request JSON include the selected thinking level.
These settings control reasoning effort, not a guaranteed response time.

| Mode | Execution | Model history | Retrieval |
| --- | --- | --- | --- |
| quick | One search → concise answer; no rewrite/evaluation call | Latest 4 messages, up to 1,000 characters each | Up to 3 chunks, 6,000 text characters total |
| pro | Rewrite follow-ups → one search → answer; no evaluation call | Active-branch user + assistant messages, newest first when fitting the budget: up to 64,000 characters total, 8,000 per message, defensive limit 1,000 messages | Up to 6 chunks, 24,000 text characters total |
| ultra | LangGraph: rewrite → search → evaluate → retry search if needed → answer | Latest 10 messages, up to 8,000 characters each | Up to 6 chunks per search, at most 3 searches |

History is delivered chronologically to the model. Limits only affect model input;
full user questions and generated answers are stored atomically in all modes.
Pro can therefore use turns originally made in quick. History is conversational
context, not PDF evidence, and citations refer only to the current retrieval.
Quick includes the latest previous user question in its retrieval query to help
resolve short follow-ups without an extra model call. Quick requests a direct
answer, normally at most 150 words, citing at most three sources; the word limit
is a prompt instruction, not a guaranteed exact output limit.
Evidence sent to Gemini contains only `source_id` and `text`; document metadata
stays in the backend for sources. Quick/pro trim evidence before generation, so
citations and returned sources use the same selected chunks.

`context_sufficient` is the evaluator boolean in ultra. Quick/pro return `null`
when retrieval found evidence (not separately evaluated), or `false` for an empty
search. Do not interpret `null` as evidence being sufficient or insufficient.
The default mode and nullable field change previous behavior; existing clients
that require the earlier graph/boolean contract should explicitly send `ultra`.

## Responsibilities

- `ChatController`: authenticated HTTP entry point and validated DTO.
- `ChatService`: coordinates preparation, mode routing, and persistence.
- `ChatRepository`: ownership/readiness checks, active-branch history, atomic writes.
- `chat.graph.ts`: prepare → search → evaluate → generate; inadequate evidence
  can return to search, at most three searches total.
- `ChatModelService`: LangChain prompts and schema-validated model outputs.
- `VectorService`: embedding and Milvus search filtered by user and selected documents.

History is loaded from PostgreSQL along the active parent chain using the mode limits above.
Pro and ultra rewrite follow-ups into standalone questions. Ultra evaluation and
generation receive that resolved question.
An empty initial search returns a fallback without evaluation/generation calls.
Nonempty but insufficient evidence permits a partial answer with missing evidence
acknowledged. Source IDs outside the retrieved evidence are excluded from metadata;
this does not independently verify the truth of a generated answer.

## Concurrency and limits

The graph is compiled once per service; request state is isolated. PostgreSQL owns
conversation history, so application replicas do not depend on local memory or
LangGraph in-memory checkpoints. LLM calls run outside database transactions.
Persistence locks selected documents and the session, rechecks availability, and
checks that the active parent has not changed. A concurrent turn returns `409`;
refresh the session before resubmitting. User and assistant messages plus the new
active leaf are committed together. No schema migration is required.

Generation has a 110-second total deadline and a 30-second deadline per model operation
(including retries, configurable via CHAT_MODEL_TIMEOUT_MS), three-search bound, at most six retrieved
chunks per search, and the existing model retry limit. Requests accept 1–10 document
IDs and questions up to 8,000 characters. `POST /chat` returns JSON; `POST /chat/stream` streams progress, answer text, and the final result.
Global admission control and durable generation jobs are future work
if measured traffic or response times require them. Successful persistence does not
yet record token usage in the existing Completion table. New-turn submissions have
no idempotency key: clients should not automatically retry an uncertain HTTP result.

## Verification

```sh
bun run build
bunx vitest run src/model/chat/ src/model/documents/processing/vector.service.spec.ts
postman simulation run postman/simulations/chat.sim.yaml --port 14901 --output ndjson --no-history
# In a second terminal, using the configured local PostgreSQL:
bun test/integration/chat.cjs
```

The integration harness creates and cleans up its own data. It exercises Nest HTTP
validation, real PostgreSQL transactions and real LangChain HTTP clients against
local Gemini fixtures. Authentication injection and a Milvus adapter isolate the
chat path; live JWT validation, Milvus behavior, Gemini availability and answer
quality are outside this harness. See the simulation context for observed results.

## Progress with SSE

Send the same authenticated JSON body to `POST /chat/stream` with
`Content-Type: application/json` and optionally `Accept: text/event-stream`.
In Postman, duplicate the chat request and change only the URL to `/chat/stream`.
Every JSON payload has the envelope `{type, data}`; `type` matches the SSE event name.
The final answer is at `payload.data.answer`, with no extra response wrapper.
The response uses HTTP 200 and `Content-Type: text/event-stream`:

```text
event: progress
data: {"type":"progress","data":{"stage":"preparing","message":"Memahami pertanyaan dan konteks percakapan."}}

event: progress
data: {"type":"progress","data":{"stage":"searching","message":"Mencari informasi di dokumen.","attempt":1}}

event: progress
data: {"type":"progress","data":{"stage":"evaluating","message":"Memeriksa kecukupan informasi.","attempt":1}}

event: progress
data: {"type":"progress","data":{"stage":"answering","message":"Menyusun jawaban dan sumber."}}

event: token
data: {"type":"token","data":{"text":"Jawaban [1]."}}

event: progress
data: {"type":"progress","data":{"stage":"saving","message":"Menyimpan percakapan."}}

event: done
data: {"type":"done","data":{"mode":"ultra","session_id":"...","message_id":"...","answer":"...","sources":[],"search_attempts":1,"context_sufficient":true}}
```

The progress example above uses `ultra`; quick/pro omit the evaluating stage.
Search/evaluation may repeat up to three times only in ultra. Empty retrieval skips evaluation.
Progress events are execution statuses, not model reasoning. Append each `token.data.text` in order to display the answer as it arrives. The `done` event contains the complete answer and citations after persistence; do not append its answer a second time. Tokens are provisional: if an `error` or unexpected EOF occurs before `done`, the turn has not been confirmed saved. When no relevant chunks are found, the answer may arrive only in `done`.

Validation, authentication, ownership and document readiness failures before the
stream begins retain normal HTTP error responses. After headers are sent, errors
use `event: error` with `{type: "error", data: {status_code, message}}`, then close the stream. A 200
status alone is not success: clients must receive `done`. Unexpected EOF is an
uncertain outcome and must not trigger automatic replay of the POST.

The server sends heartbeat comments every 15 seconds while connected. Closing the
connection aborts graph/model work and prevents saving if disconnected before the
save starts. A database transaction already running may finish after disconnect;
refresh history before retrying. Progress is transient and has no replay support.

For browser clients, use streaming `fetch` with POST and the bearer token. Native
`EventSource` does not support this JSON POST contract. Decode response.body with a
streaming TextDecoder, buffer incomplete frames, and split SSE frames at blank lines;
network chunks do not necessarily align with event boundaries. On navigation or
cancel, abort the fetch. Proxies must permit unbuffered SSE; the endpoint sends
`X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`.

## Provider limits

Provider rate limits and exhausted quota are returned as HTTP 429 by `POST /chat`.
After SSE starts, `POST /chat/stream` sends `{type: "error", data: {status_code: 429,
message: "..."}}` and closes. Other generation failures remain 503. Detection uses
LangChain rate-limit error names and structured provider 429 fields, including
wrapped causes. No raw provider response or credentials are exposed to clients.
Quota errors may need provider quota changes; do not assume an immediate retry
will succeed. Neither error creates a partial message pair.

Model/total generation timeouts return 504 (or error.data.status_code 504 once SSE
starts), with no saved message pair. The deadline races the model promise and aborts
the SDK signal, so even an unresponsive SDK cannot hold the stream indefinitely.
This bounds waiting; it does not fix provider latency.

## Trace logs

### Per-session request JSON

Set `CHAT_DEBUG_REQUESTS=true` and restart the backend to save each subsequent chat
model invocation to `logs/llm-requests/<session_id>/`. The root can be changed with
`CHAT_DEBUG_REQUESTS_DIR`. `session_id` here is the chat session ID returned by the
chat API, independent of authentication claims. The default is disabled.

Files are named `<UTC timestamp>_<rewrite|evaluate|answer>_<call UUID>.json`.
Each contains `session_id`, `turn_id` (shared by model calls from one HTTP turn),
`call_id`, mode, model/deadline/retry settings, and `request.system`,
`request.input` (question, supplied history/evidence), and the output JSON schema
when structured output is used. `representation: "langchain_input"` means this is
the input before SDK conversion, not a raw Gemini HTTP capture. It records one
file per logical model invocation, not one per internal SDK retry.

The same prompt object is used for invocation and logging. Files are written
before the model call, so timed-out and failed calls are also available. If writing
fails, a warning is logged and chat generation continues. Empty retrieval without
a model call creates no request file; older requests cannot be reconstructed.

All modes and turns append distinct files in the same session folder, including
concurrent requests and turns that fail before database persistence. Logs contain
full prompt/PDF text; `logs/` is already Git-ignored. API keys, bearer tokens and
cookies are not copied into diagnostic metadata. Retention is manual and files
are local to the replica that handled the request.

Set `LOG_LEVEL=trace` and restart the server. Chat operations log `started`,
`waiting` every 10 seconds, `completed` or `failed`, with `operationId` and
`elapsedMs`. Operations include `load_context`, `retrieve`, `rewrite`, `evaluate`,
`answer` and `save`. Pino request context correlates entries with the HTTP request.
Model metadata includes configured model, deadline, chunk count and character
counts; prompts, document text and answers are not logged.

LangChain callbacks add `llm_started`, `llm_response_received`, and `llm_failed`.
A response callback followed by operation failure points to post-response processing
(such as parsing); waiting without a response means the model operation is still
pending. These are logical SDK events, not HTTP wire traces: retries and provider
queueing cannot be distinguished from them alone. A late callback may arrive after
a deadline if underlying work takes time to cancel; the deadline still closes SSE.
