# Chat AI API Reference

Two authenticated endpoints: one JSON chat detail endpoint and one **POST Server-Sent Events** (SSE) generation endpoint.

## Endpoint index

| Method | Endpoint | Authentication | Description |
| --- | --- | --- | --- |
| GET | `/chat/:id/details` | Bearer access token | Get session details, attached documents, active messages, and feedback |
| POST | `/chat/send` | Bearer access token | Generate RAG answer as SSE |

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

**Validation note:** `answerMode: document_only` requires at least one document ID. Input Zod object is strict: unexpected fields are rejected.

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
| 400 | Invalid DTO, or document-only without document IDs |
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
- The DTO uses `.default('quick').optional()` and `.default('general').optional()`; because outer optional can bypass the inner default, omitted values should not be assumed to be filled. In particular `done.mode` can be omitted by JSON serialization.

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
        "sources": [],
        "feedback": null
      },
      {
        "id": "5132f3ab-b51d-4356-b091-9e70515bc351",
        "role": "assistant",
        "content": "Revenue increased [1].",
        "status": "COMPLETED",
        "createdAt": "2026-10-30T11:00:10.000Z",
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
- `feedback` comes from `ChatFeedback.type` and is `LIKE`, `DISLIKE`, or `null`, matching Prisma's enum. For user messages, it is always `null`.
- `sources` is reduced to `documentId` and `pageNumber` for PDF citations. Other internal chat-history fields are omitted.

## Known issues / missing capabilities

- Ownership and `READY` state of supplied `documentIds` are **not explicitly checked** in `ChatService.prepare` before linking them to `SessionDocument`.
- Existing `docs/chat.md` and `docs/chat.openapi.json` describe a superseded `POST /chat` endpoint with snake_case inputs. They do not match this controller.
- No separate endpoints for regenerate, edit message, fork conversation, feedback or resuming an interrupted stream exist.
