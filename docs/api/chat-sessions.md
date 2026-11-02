# Chat Sessions API Reference

Seven endpoints for managing conversation sessions. Every endpoint requires `Authorization: Bearer <access-jwt>`; no refresh cookie is required.

## Endpoint index

| Method | Path | Description |
| --- | --- | --- |
| GET | `/chat-sessions` | List active sessions |
| GET | `/chat-sessions/deleted` | List soft-deleted sessions |
| GET | `/chat-sessions/:id/chats` | Get stored messages in a session |
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
  "data": [
    {
      "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
      "userId": "<user-uuid>",
      "title": "Financial Analysis",
      "answerMode": "document_only",
      "activeLeafMessageId": "<message-uuid>",
      "lastMessageAt": "2026-10-30T12:00:00.000Z",
      "createdAt": "2026-10-30T11:00:00.000Z",
      "updatedAt": "2026-10-30T11:00:00.000Z",
      "deletedAt": null
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
  "data": [
    {
      "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
      "userId": "<user-uuid>",
      "title": "Old chat",
      "answerMode": "general",
      "activeLeafMessageId": null,
      "lastMessageAt": null,
      "createdAt": "2026-10-30T11:00:00.000Z",
      "updatedAt": "2026-10-30T13:00:00.000Z",
      "deletedAt": "2026-10-30T13:00:00.000Z"
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

## 3. List Chat Messages

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
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "sessionId": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
      "parentMessageId": null,
      "versionGroupId": "550e8400-e29b-41d4-a716-446655440000",
      "role": "user",
      "content": "Summarize the PDF",
      "sources": [],
      "answerMode": "document_only",
      "status": "COMPLETED",
      "createdAt": "2026-10-30T12:00:00.000Z",
      "updatedAt": "2026-10-30T12:00:00.000Z",
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

**Notes:** messages are sorted by creation time ascending and ID ascending. This endpoint returns the **entire stored message collection**, not the active branch selected by `activeLeafMessageId`. There is no pagination. `sources` is JSON; `status` enum values are `PENDING`, `STREAMING`, `COMPLETED`, `FAILED`, `CANCELLED`.

## 4. Rename Chat Session

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
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "userId": "<user-uuid>",
    "title": "Updated Chat Title",
    "answerMode": "document_only",
    "activeLeafMessageId": "<message-uuid>",
    "lastMessageAt": "2026-10-30T12:00:00.000Z",
    "createdAt": "2026-10-30T11:00:00.000Z",
    "updatedAt": "2026-10-30T13:00:00.000Z",
    "deletedAt": null
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid UUID or title |
| 401 | Unauthorized |
| 404 | Active owned session not found |

## 5. Soft Delete Chat Session

**DELETE /chat-sessions/:id**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required |
| --- | --- | --- | --- |
| `id` | Path | UUID | Yes |

### Success response — 200 OK

```json
{
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "userId": "<user-uuid>",
    "title": "Financial Analysis",
    "answerMode": "document_only",
    "activeLeafMessageId": "<message-uuid>",
    "lastMessageAt": "2026-10-30T12:00:00.000Z",
    "createdAt": "2026-10-30T11:00:00.000Z",
    "updatedAt": "2026-10-30T13:00:00.000Z",
    "deletedAt": "2026-10-30T13:00:00.000Z"
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

## 6. Permanently Delete Chat Session

**DELETE /chat-sessions/:id/permanent**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `id` | Path | UUID | Yes | Session must already be soft-deleted |

### Success response — 200 OK

```json
{
  "message": "Session permanently deleted"
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid UUID |
| 401 | Unauthorized |
| 404 | Deleted session not found / not owned by user |

**Notes:** the service deletes feedback, completion records, chat history, session-document join records and the session in a transaction. It does not delete the PDF documents themselves.

## 7. Restore Chat Session

**POST /chat-sessions/:id/restore**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `id` | Path | UUID | Yes | Soft-deleted owned session |

### Success response — 201 Created

```json
{
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "userId": "<user-uuid>",
    "title": "Financial Analysis",
    "answerMode": "document_only",
    "activeLeafMessageId": "<message-uuid>",
    "lastMessageAt": "2026-10-30T12:00:00.000Z",
    "createdAt": "2026-10-30T11:00:00.000Z",
    "updatedAt": "2026-10-30T14:00:00.000Z",
    "deletedAt": null
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

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `userId` | UUID | Conversation and owner |
| `title` | string / null | Name of chat |
| `answerMode` | string / null | Last session answer mode |
| `activeLeafMessageId` | UUID / null | Active branch leaf |
| `lastMessageAt` | ISO timestamp / null | Latest message time |
| `createdAt`, `updatedAt`, `deletedAt` | ISO timestamp / null | Lifecycle timestamps |

## Known issues and missing endpoints

- Session list sorts by `updatedAt`, but new chat messages update `lastMessageAt` without explicitly updating `updatedAt`.
- Message listing fetches all branch histories rather than the active branch and does not paginate.
- Current controllers do not offer `GET /chat-sessions/:id`, search, pin/unpin, session-document list/attach/detach, fork, or regenerate.
