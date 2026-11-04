# Chat AI API Reference

Authenticated chat detail, generation, fork, feedback, branching, and version-selection endpoints. The generation, regenerate, and edit endpoints use **POST Server-Sent Events** (SSE).

## Endpoint index

| Method | Endpoint | Authentication | Description |
| --- | --- | --- | --- |
| GET | `/chat/:id/details` | Bearer access token | Get session details, attached documents, active messages, and feedback |
| POST | `/chat/send` | Bearer access token | Generate RAG answer as SSE |
| POST | `/chat/:id/fork` | Bearer access token | Copy the selected ancestor path into a new session |
| POST | `/chat/:messageId/feedback` | Bearer access token | Toggle LIKE/DISLIKE on an assistant answer (204) |
| POST | `/chat/:messageId/regenerate` | Bearer access token | Regenerate any completed assistant answer as a new branch (SSE) |
| POST | `/chat/:messageId/edit` | Bearer access token | Edit a user question and branch the conversation (SSE) |
| PATCH | `/chat/:messageId/activate` | Bearer access token | Restore the selected completed version's descendant branch |

## 1. Send Chat Message

**POST /chat/send**

Saves a user message and assistant generation state, searches selected PDF chunks, then streams answer deltas.

### Request

**Headers:**

```http
Authorization: Bearer <access-jwt>
Content-Type: application/json
Accept: text/event-stream
```

**Cookie:** none required.

| Field | Type | Required | Validation / behavior |
| --- | --- | --- | --- |
| `question` | string | Yes | Trimmed, 1–8000 chars |
| `documentIds` | UUID[] | No | If present, 1–10 IDs |
| `sessionId` | UUID | No | Missing means create a new session |
| `mode` | enum | No | `quick`, `pro`, `ultra` |
| `answerMode` | enum | No | `general`, `document_only` |

```json
{
  "question": "What was the annual revenue?",
  "documentIds": ["c55ec1cb-452a-4383-8d6b-ad18a13f1a11"],
  "sessionId": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
  "mode": "quick",
  "answerMode": "document_only"
}
```

**Validation note:** `documentIds` is optional for both answer modes. With `document_only` and no matching PDF evidence, the stream returns the no-evidence explanation without calling the chat model. Input Zod object is strict: unexpected fields are rejected.

### Success response — 200 OK (SSE)

**Response header:** `Content-Type: text/event-stream`.

**Raw SSE frames (illustrative):**

```text
event: started
data: {"id":"550e8400-e29b-41d4-a716-446655440000","sessionId":"6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6","status":"streaming"}

event: sources
data: {"sources":[{"documentId":"c55ec1cb-452a-4383-8d6b-ad18a13f1a11","chunkId":"<chunk-uuid>","pageNumber":12,"filename":"annual-report.pdf"}]}

event: token
data: {"content":"Based on the document, "}

event: token
data: {"content":"the revenue increased."}

event: done
data: {"id":"550e8400-e29b-41d4-a716-446655440000","sessionId":"6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6","status":"completed","content":"Based on the document, the revenue increased.","sources":[{"documentId":"c55ec1cb-452a-4383-8d6b-ad18a13f1a11","chunkId":"<chunk-uuid>","pageNumber":12,"filename":"annual-report.pdf"}],"mode":"quick"}
```

| Event | Data fields | Meaning |
| --- | --- | --- |
| `started` | `id`, `sessionId`, `status: streaming` | Assistant message created |
| `sources` | `sources[]` | Matching evidence; can be empty |
| `token` | `content` | Incremental **delta**, repeatable |
| `done` | `id`, `sessionId`, `status: completed`, `content`, `sources`, `mode` | Final complete answer |
| `error` | `messageId`, `message` | Failure after stream has started |

**Failure frame example:**

```text
event: error
data: {"messageId":"550e8400-e29b-41d4-a716-446655440000","message":"Chat generation failed"}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid DTO |
| 401 | Missing or invalid access token |
| 404 | Session ID missing, deleted, or owned by a different user |
| 409 | Another generation is currently streaming in this session |

Errors thrown **before** SSE begins use HTTP status codes. Errors occurring **after** streaming starts use an SSE `error` event (HTTP is already 200).

### Behavior and implementation notes

- The controller uses `@Sse('send', { method: RequestMethod.POST })`. **Native EventSource cannot POST**; use a fetch stream reader or equivalent client.
- If `sessionId` is omitted, the service creates a new session whose title is the first 100 chars of the question.
- The service stores a user message, streaming assistant message, completion record, and active leaf pointer before the stream opens.
- `sources[]` items use camelCase `documentId`, `chunkId`, `pageNumber`, and nullable `filename`.
- The current RAG service embeds the question via Gemini, queries up to **5** chunks from Milvus `document_chunks` filtered by user ID and supplied document IDs, then streams Groq chat output.
- If answer mode is document-only and no evidence exists, the service returns a fixed explanation token rather than calling Groq.
- `mode` is currently included in `done` but does **not** change model, inference settings, or retrieval pipeline.
- `quick` and `general` are the Zod defaults when omitted. They do not change the generation model.
- Supplied document IDs must belong to the caller and be in `READY` state without soft deletion; otherwise a 404 is returned.

## 2. Get Chat Details

**GET /chat/:id/details**

Returns session metadata, attached PDFs, and the conversation along the currently active message branch. This replaces `GET /chat-sessions/:id`; the original route is no longer available.

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `id` | Path | UUID | Yes | Existing active chat session belonging to caller |

```http
GET /chat/6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6/details
Authorization: Bearer <access-jwt>
```

### Success response — 200 OK

```json
{
  "message": "📦 Chat session retrieved successfully! Smooth sailing! 😎",
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "title": "Financial Analysis",
    "answerMode": "document_only",
    "createdAt": "2026-10-30T11:00:00.000Z",
    "updatedAt": "2026-10-30T11:05:00.000Z",
    "documents": [
      {
        "id": "c14161ef-8ea9-475f-902d-d7127d6c34cc",
        "fileName": "Annual Report.pdf",
        "pageCount": 120,
        "status": "READY",
        "deletedAt": null
      }
    ],
    "messages": [
      {
        "id": "234726de-85ef-4d6f-95a1-eb420ac0cc01",
        "role": "user",
        "content": "Summarize the financial report.",
        "status": "COMPLETED",
        "createdAt": "2026-10-30T11:00:00.000Z",
        "parentMessageId": null,
        "versionGroupId": "bf5f4398-14f2-4cbf-bb81-a3b0c76f73a5",
        "versionCount": 1,
        "versions": [{ "id": "234726de-85ef-4d6f-95a1-eb420ac0cc01", "status": "COMPLETED", "createdAt": "2026-10-30T11:00:00.000Z", "active": true }],
        "sources": [],
        "feedback": null
      },
      {
        "id": "5132f3ab-b51d-4356-b091-9e70515bc351",
        "role": "assistant",
        "content": "Revenue increased [1].",
        "status": "COMPLETED",
        "createdAt": "2026-10-30T11:00:10.000Z",
        "parentMessageId": "234726de-85ef-4d6f-95a1-eb420ac0cc01",
        "versionGroupId": "6e67f4b9-0ddd-4be0-bcd3-f9938d74758f",
        "versionCount": 1,
        "versions": [{ "id": "5132f3ab-b51d-4356-b091-9e70515bc351", "status": "COMPLETED", "createdAt": "2026-10-30T11:00:10.000Z", "active": true }],
        "sources": [
          {
            "documentId": "c14161ef-8ea9-475f-902d-d7127d6c34cc",
            "pageNumber": 12
          }
        ],
        "feedback": "LIKE"
      }
    ]
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Malformed session UUID |
| 401 | Invalid or missing access JWT |
| 404 | Session absent, deleted, or owned by another user |

**Notes:**

- `id` identifies a **ChatSession**, not a message.
- `documents` comes from `SessionDocument → Document`, ordered by attachment time, then document ID. `deletedAt` lets the frontend disable previews of deleted files. Request a fresh signed download URL through `GET /documents/:id` when opening a PDF.
- `messages` contains only the active lineage from the root message through `ChatSession.activeLeafMessageId`, in conversation order. Inactive branches and soft-deleted messages are excluded. All messages in that lineage are returned; there is no pagination yet.
- `activeLeafMessageId` is returned at session level. Each visible message includes `parentMessageId`, `versionGroupId`, `versionCount`, and `versions[]` (id, status, createdAt, active). `versions` also includes inactive alternatives in the same version group.
- `feedback` comes from `ChatFeedback.type` and is `LIKE`, `DISLIKE`, or `null`, matching Prisma's enum. For user messages, it is always `null`.
- `sources` is reduced to `documentId` and `pageNumber` for PDF citations. Other internal chat-history fields are omitted.

## 3. Fork Conversation

**POST /chat/:id/fork** — 201 Created

`id` is the original **session UUID**. The JSON body selects the last message of the copied path:

```http
POST /chat/6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6/fork
Authorization: Bearer <access-jwt>
Content-Type: application/json
```

```json
{ "messageId": "5132f3ab-b51d-4356-b091-9e70515bc351" }
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `messageId` | UUID | Yes | Completed message in the caller-owned, non-deleted session |

```json
{
  "message": "🎉 Chat session fork created successfully! Welcome aboard! 🚀",
  "data": {
    "id": "a609217f-01e1-4854-89ec-a310af0af812",
    "title": "Fork → Financial Analysis"
  }
}
```

Only the root-to-`messageId` path is copied. New message UUIDs, re-linked `parentMessageId` and remapped `versionGroupId` are used; the active leaf points to the last copied message. `SessionDocument` relations are copied, not the PDF/files/vector data. Feedback and completion records are not copied. All database writes are one Prisma transaction; failure rolls back the fork.

**Errors:** 400 malformed UUID/body; 401 no auth; 404 foreign/missing/deleted session or missing message; 409 selected message not completed, corrupt path, or inaccessible linked document.

## 4. Toggle Answer Feedback

**POST /chat/:messageId/feedback** — **204 No Content**

```http
POST /chat/5132f3ab-b51d-4356-b091-9e70515bc351/feedback
Authorization: Bearer <access-jwt>
Content-Type: application/json
```

```json
{ "type": "LIKE" }
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `type` | Prisma FeedbackType | Yes | Exactly `LIKE` or `DISLIKE` |

Toggle rules: missing feedback → create; same type → delete; different type → update. A row lock serializes concurrent toggles per message. Only completed assistant messages in active (not deleted) sessions owned by the caller are accepted.

Implementation: `ChatController` and `ChatService` inside `ChatModule`; no separate feedback module.

**Errors:** 400 invalid UUID/body; 401 unauthenticated; 404 message not found/not owned/session deleted; 409 wrong role or status.

## 5. Regenerate Answer

**POST /chat/:messageId/regenerate** — 200 OK (SSE)

```http
POST /chat/5132f3ab-b51d-4356-b091-9e70515bc351/regenerate
Authorization: Bearer <access-jwt>
Content-Type: application/json
Accept: text/event-stream
```

```json
{ "mode": "quick" }
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `mode` | enum | Yes | `quick`, `pro`, `ultra` |

Any completed assistant answer in a caller-owned active session can be regenerated, including the first/middle answer or a version on an inactive branch. The original user question is reused; **no new user message is created**. The new assistant is a sibling of the selected answer, sharing its `parentMessageId` and `versionGroupId`, with a new message ID and completion record. Only ancestors **preceding** that user question become RAG history; later messages and other branches remain stored and unchanged. The active leaf moves to the new answer. Document IDs come from the session's currently attached, owned, READY documents (per-message selections were not persisted previously). The generation `mode` comes from the request, as it is not stored on the message.

SSE format is identical to `/chat/send`: `started`, `sources`, repeated `token`, then `done` or `error`. On failure/cancellation the active leaf is restored to whichever message was active **before** regeneration, even when the regenerated target was inactive. Clients should re-fetch chat details to obtain the active branch and version navigation metadata.

**Errors before SSE:** 400 invalid mode or no ready PDF for document-only; 401 no auth; 404 foreign/deleted session or message; 409 wrong role/status, missing parent user question, or generation already running.

## 6. Edit User Message

**POST /chat/:messageId/edit** — 200 OK (SSE)

Uses the **same request body as `/chat/send`**, but `sessionId` is required and must identify the message's session:

```json
{
  "question": "Edited question",
  "sessionId": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
  "documentIds": ["c55ec1cb-452a-4383-8d6b-ad18a13f1a11"],
  "answerMode": "document_only",
  "mode": "quick"
}
```

Only completed **user** messages can be edited, including older messages. The replacement user message shares the original user's `versionGroupId` and `parentMessageId`. A new assistant message, completion, and branch are created. Conversation context is collected from *before* the original user message. Original history remains available. The active leaf temporarily moves to the new streaming answer and is restored if generation fails.

The response is the same SSE event stream as `/chat/send`. **Errors before SSE:** 400 invalid or missing body fields; 401 no auth; 404 session/message/documents absent or foreign; 409 wrong role/status or another stream running.

## 7. Select an Existing Version

**PATCH /chat/:messageId/activate** — 200 OK

No request body. The message must be a completed version in a caller-owned, non-deleted session. The backend finds the deepest completed descendant of the chosen message and sets it as `activeLeafMessageId`, so FE can revisit the earlier branch. Selecting a version is blocked while another generation is streaming.

```json
{
  "message": "🔄 Active chat version updated successfully! Looking fresh! ✨",
  "data": { "activeLeafMessageId": "5132f3ab-b51d-4356-b091-9e70515bc351" }
}
```

**Errors:** 400 invalid UUID; 401 no auth; 404 foreign/deleted session or missing message; 409 non-completed target or concurrent generation.

## Known issues / missing capabilities

- Existing sessions may have linked documents that were later deleted; regenerate searches only currently attached, READY, owned documents.
- Resume-after-disconnect for an interrupted SSE stream is not implemented.
