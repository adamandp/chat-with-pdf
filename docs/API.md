# Chat With PDF — API Reference

> **Implementation snapshot:** this PR branch based on the latest `master`, reviewed 2026-11-02. These contracts describe existing NestJS code rather than future requirements. UUIDs, JWTs and URLs in examples are illustrative.

## Modules and endpoints

| Module | Count | Documentation |
| --- | ---: | --- |
| Authentication & token sessions | 6 | [authentication.md](api/authentication.md) |
| Chat sessions | 7 | [chat-sessions.md](api/chat-sessions.md) |
| AI chat | 2 | [chat.md](api/chat.md) |
| Document Upload | 4 | [document-upload.md](api/document-upload.md) |
| Documents | 6 | [documents.md](api/documents.md) |
| Health | 5 | [health.md](api/health.md) |
| **Total NestJS routes** | **30** | |

The direct MinIO signed `PUT` described in the documents guide is **not** a NestJS endpoint.

## Base URL and authentication

- Default local URL: `http://localhost:3000`; the application can use a different `PORT`.
- There is **no global `/api` or `/v1` prefix** in `src/main.ts`.
- Protected endpoints require `Authorization: Bearer <access-jwt>`.
- Access JWT lifetime: **15 minutes**. Refresh JWT lifetime: **7 days**.
- Login sets `refreshToken` in an HttpOnly, `SameSite=Lax` cookie (`Secure` when `NODE_ENV=production`), and returns access token in JSON.
- `POST /session/refresh` and `POST /auth/logout` use the refresh cookie. `POST /auth/logout-all` uses the Bearer token.
- Cross-origin browser clients should send credentials for cookie-bearing requests. CORS allows configured `FRONTEND_ORIGINS` with credentials enabled; cross-site cookie deployments require review of SameSite and Secure behavior.

## Common JSON response format

```ts
interface WebResponse<T = unknown> {
  message?: string;
  errors?: string;
  data?: T;
  paging?: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
```

Fields are optional. For instance register returns only `message`, while refresh returns `message` and `data`. SSE endpoints use event frames, **not** this JSON body.

## HTTP semantics and error handling

| Operation | Typical actual response |
| --- | --- |
| GET, PATCH, DELETE success | 200 OK |
| POST success without explicit `@HttpCode` | 201 Created (e.g. register, presigned-url, document processing) |
| POST success with `@HttpCode(200)` | 200 OK (login, refresh, logout, logout-all, restore) |
| `@Sse` endpoint | 200 OK, `text/event-stream` |
| Invalid DTO or UUID | 400 Bad Request |
| Authentication failed | 401 Unauthorized |
| Owned resource not found | 404 Not Found |
| Generation already running | 409 Conflict |
| Dependency check / queue unavailable | 503 Service Unavailable |

**Important:** NestJS exceptions and Zod validation errors do not share a guaranteed `WebResponse` error envelope. The status descriptions in each guide describe thrown conditions; exact Nest exception payloads can differ.

## Pagination

List endpoints accept `?page=1&limit=10`. Both are integers from 1 through 100; defaults are `page=1` and `limit=10`. Response paging fields: `currentPage`, `pageSize`, `totalItems`, `totalPages`. An empty collection can return `totalPages: 0`.

## Integration guides

**Authentication:** register (optional) → login (JSON access token + refresh cookie) → protected requests → refresh as needed → logout or logout-all.

**PDF upload:** `POST /document-upload/presigned-url` → direct MinIO `PUT` → `POST /document-upload/:id/process` → `GET /document-upload/:id/progress` → `POST /chat/send`.

**Chat details:** `GET /chat/:id/details` returns session metadata, documents, and active-branch messages with sources/feedback (moved from `GET /chat-sessions/:id`).

**SSE:** `POST /chat/send` emits `started`, `sources`, `token`, `done`, `error`; use fetch streaming because native `EventSource` cannot POST. Document upload progress uses `GET` SSE events `message` and `heartbeat`.

## Versioning and legacy documents

These newly authored module pages describe current controllers / Zod DTOs / services / Prisma, including known defects. Legacy `docs/chat.md`, `docs/chat.openapi.json`, `docs/document-api.yaml`, and `docs/documents.openapi.json` still describe **older contracts** (e.g. `POST /chat`, snake_case request fields, `/presigned-url`). They are preserved here and should not be treated as current API truth until reconciled.

Retry is explicitly a TODO stub. Notable remaining gaps include multi-session auth correctness, document upload status validation, and message regenerate/fork/feedback. See each module page for details.

## Source paths audited

- `src/model/auth/*` and `src/model/session/*`
- `src/model/chat-session/*`
- `src/model/chat/*`
- `src/model/document-upload/*` including BullMQ processor/listener
- `src/model/documents/*` for document management
- `src/model/health/*`
- `src/common/common.dto.ts`, `src/common/common.interface.ts`, `src/main.ts`, `prisma/schema.prisma`
