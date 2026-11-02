# Chat Sessions API Reference

Eight endpoints for managing conversation sessions. Every endpoint requires `Authorization: Bearer <access-jwt>`; no refresh cookie is required.

## Endpoint index

| Method | Path | Description |
| --- | --- | --- |
| GET | `/chat-sessions` | List active sessions |
| GET | `/chat-sessions/deleted` | List soft-deleted sessions |
| GET | `/chat-sessions/:id` | Get session details, attached documents, active messages, and feedback |
| GET | `/chat-sessions/:id/chats` | Legacy: get all stored messages, including inactive branches |
| PATCH | `/chat-sessions/:id` | Rename a session |
| DELETE | `/chat-sessions/:id` | Soft-delete a session |
| DELETE | `/chat-sessions/:id/permanent` | Delete a previously deleted session permanently |
| POST | `/chat-sessions/:id/restore` | Restore a soft-deleted session |

## 1. List Active Chat Sessions

**GET /chat-sessions**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `page` | Query | integer | No | 1–100; default 1 |
| `limit` | Query | integer | No | 1–100; default 10 |

```http
GET /chat-sessions?page=1&limit=10
Authorization: Bearer <access-jwt>
```

### Success response — 200 OK

```json
{
  "message": "📦 Chat sessions retrieved successfully! Smooth sailing! 😎",
  "data": [
    {
      "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
      "title": "Financial Analysis",
      "updatedAt": "2026-10-30T11:00:00.000Z"
    }
  ],
  "paging": {
    "currentPage": 1,
    "pageSize": 10,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid pagination |
| 401 | Invalid or missing access JWT |

**Notes:** only `deletedAt: null` rows owned by the caller are included. The query sorts by `updatedAt DESC` and `id DESC`, not by `lastMessageAt`.

## 2. List Deleted Chat Sessions

**GET /chat-sessions/deleted**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `page` | Query | integer | No | 1–100; default 1 |
| `limit` | Query | integer | No | 1–100; default 10 |

```http
GET /chat-sessions/deleted?page=1&limit=10
Authorization: Bearer <access-jwt>
```

### Success response — 200 OK

```json
{
  "message": "📦 Deleted chat sessions retrieved successfully! Smooth sailing! 😎",
  "data": [
    {
      "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
      "title": "Financial Analysis",
      "updatedAt": "2026-10-30T11:00:00.000Z"
    }
  ],
  "paging": {
    "currentPage": 1,
    "pageSize": 10,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid pagination |
| 401 | Unauthorized |

**Note:** only owned sessions where `deletedAt` is not null appear.

## 3. Get Chat Session Detail

**GET /chat-sessions/:id**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `id` | Path | UUID | Yes | Existing active chat session belonging to caller |

```http
GET /chat-sessions/6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6
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

- `documents` comes from `SessionDocument → Document`, ordered by attachment time, then document ID. `deletedAt` lets the frontend disable previews of deleted files. Request a fresh signed download URL through `GET /documents/:id` when opening a PDF.
- `messages` contains only the active lineage from the root message through `ChatSession.activeLeafMessageId`, in conversation order. Inactive branches and soft-deleted messages are excluded. All messages in that lineage are returned; there is no pagination yet.
- `feedback` comes from `ChatFeedback.type` and is `LIKE`, `DISLIKE`, or `null`, matching Prisma's enum. For user messages, it is always `null`.
- `sources` is reduced to `documentId` and `pageNumber` for PDF citations. Other internal chat-history fields are omitted.

## 4. List Chat Messages (Legacy)

**GET /chat-sessions/:id/chats**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `id` | Path | UUID | Yes | Existing active chat session belonging to caller |

```http
GET /chat-sessions/6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6/chats
Authorization: Bearer <access-jwt>
```

### Success response — 200 OK

```json
{
  "message": "📦 Chat session messages retrieved successfully! Smooth sailing! 😎",
  "data": [
    {
      "id": "234726de-85ef-4d6f-95a1-eb420ac0cc01",
      "sessionId": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
      "parentMessageId": null,
      "versionGroupId": "811532e8-89bc-4cbe-8f64-f13e6231df0e",
      "role": "user",
      "content": "Summarize the financial report.",
      "sources": [],
      "answerMode": "document_only",
      "status": "COMPLETED",
      "createdAt": "2026-10-30T11:00:00.000Z",
      "updatedAt": "2026-10-30T11:00:00.000Z",
      "deletedAt": null
    }
  ]
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Malformed session UUID |
| 401 | Unauthorized |
| 404 | Session absent, deleted, or owned by another user |

**Notes:** retained for existing clients during migration to `GET /chat-sessions/:id`. Messages are sorted by creation time ascending and ID ascending. This endpoint returns the **entire stored message collection**, not the active branch selected by `activeLeafMessageId`. There is no pagination. `sources` is JSON; `status` enum values are `PENDING`, `STREAMING`, `COMPLETED`, `FAILED`, `CANCELLED`.

## 5. Rename Chat Session

**PATCH /chat-sessions/:id**

### Request

**Headers:**

```http
Authorization: Bearer <access-jwt>
Content-Type: application/json
```

**Cookies:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `id` | Path | UUID | Yes | Active owned session |
| `title` | JSON body | string | Yes | Trimmed, 1–255 chars |

```json
{
  "title": "Updated Chat Title"
}
```

### Success response — 200 OK

```json
{
  "message": "🔄 Chat session updated successfully! Looking fresh! ✨",
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "title": "Updated Chat Title",
    "updatedAt": "2026-10-30T11:00:00.000Z"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid UUID or title |
| 401 | Unauthorized |
| 404 | Active owned session not found |

## 6. Soft Delete Chat Session

**DELETE /chat-sessions/:id**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required |
| --- | --- | --- | --- |
| `id` | Path | UUID | Yes |

### Success response — 200 OK

```json
{
  "message": "🗑️ Chat session deleted successfully! Sayonara! 👋",
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "title": "Updated Chat Title",
    "updatedAt": "2026-10-30T11:00:00.000Z"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid UUID |
| 401 | Unauthorized |
| 404 | Active owned session not found |

**Note:** soft delete leaves messages and related documents intact.

## 7. Permanently Delete Chat Session

**DELETE /chat-sessions/:id/permanent**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `id` | Path | UUID | Yes | Session must already be soft-deleted |

### Success response — 200 OK

```json
{
  "message": "🗑️ Chat session permanently deleted successfully! Sayonara! 👋",
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "title": "Updated Chat Title",
    "updatedAt": "2026-10-30T11:00:00.000Z"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid UUID |
| 401 | Unauthorized |
| 404 | Deleted session not found / not owned by user |

**Notes:** the service deletes feedback, completion records, chat history, session-document join records and the session in a transaction. It does not delete the PDF documents themselves.

## 8. Restore Chat Session

**POST /chat-sessions/:id/restore**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `id` | Path | UUID | Yes | Soft-deleted owned session |

### Success response — 200 OK

```json
{
  "message": "♻️ Chat session restored successfully! Back in action! ✨",
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "title": "Updated Chat Title",
    "updatedAt": "2026-10-30T11:00:00.000Z"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid UUID |
| 401 | Unauthorized |
| 404 | Soft-deleted owned session not found |

## ChatSession response fields

List, update, soft delete, permanent delete and restore return **only** the following summary fields in `data`:

| Field | JSON type | Meaning |
| --- | --- | --- |
| `id` | UUID | Chat session identifier |
| `title` | string / null | Session title |
| `updatedAt` | ISO timestamp / null | Last modification timestamp |

`GET /chat-sessions/:id/chats` returns full chat-history records including `content`, `role`, `parentMessageId`, `sources`, and status.
`GET /chat-sessions/:id` instead returns a compact combined detail for the chat screen.

## Known issues and missing endpoints

- Session list sorts by `updatedAt`, but new chat messages update `lastMessageAt` without explicitly updating `updatedAt`.
- Message listing fetches all branch histories rather than the active branch and does not paginate.
- Current controllers do not offer search, pin/unpin, session-document list/attach/detach, fork, or regenerate.
