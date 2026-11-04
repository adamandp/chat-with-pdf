# Chat With PDF — API Reference

> **Current implementation reference:** the endpoint tables and module pages below describe the NestJS controllers and DTOs, including the search/sort API. UUIDs, JWTs and URLs in examples are illustrative.

## Modules and endpoints

| Module | Count | Documentation |
| --- | ---: | --- |
| Authentication & token sessions | 7 | [authentication.md](api/authentication.md) |
| Chat sessions | 7 | [chat-sessions.md](api/chat-sessions.md) |
| AI chat | 7 | [chat.md](api/chat.md) |
| Document Upload | 4 | [document-upload.md](api/document-upload.md) |
| Documents | 6 | [documents.md](api/documents.md) |
| Health | 5 | [health.md](api/health.md) |
| **Total NestJS routes** | **36** | |

The direct MinIO signed `PUT` described in the documents guide is **not** a NestJS endpoint.

## Base URL and authentication

- Default local URL: `http://localhost:3000`; the application can use a different `PORT`.
- There is **no global `/api` or `/v1` prefix** in `src/main.ts`.
- Protected endpoints require `Authorization: Bearer <access-jwt>`.
- Access JWT lifetime: **15 minutes**. Refresh JWT lifetime: **7 days**.
- Login and guest creation set `refreshToken` in an HttpOnly, `SameSite=Lax` cookie by default (`Secure` when `NODE_ENV=production`), and return access token in JSON. `AUTH_COOKIE_SAME_SITE=none` supports HTTPS cross-site cookies.
- `POST /session/refresh` and `POST /auth/logout` use the refresh cookie. `POST /auth/logout-all` uses the Bearer token.
- Cross-origin browser clients should send credentials for cookie-bearing requests. CORS allows configured `FRONTEND_ORIGINS` with credentials enabled; refresh/logout check `Origin` when present.
- JWTs identify user (`sub`) and database session (`sid`). Refresh preserves the same cookie/session, logout revokes only that session. Login is limited to 30 requests/IP and 10 requests/username per 15 minutes (429 with `Retry-After`).

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

List endpoints accept `?page=1&limit=10`. Both are integers from 1 through 100; defaults are `page=1` and `limit=10`. Chat Session and Document lists also accept `q` (trimmed, max 255 characters; case-insensitive title/filename substring search) and `order=asc|desc` (default `desc`). Document lists additionally accept `sort=modified|name|pages` (default `modified`). Chat Session lists retain pinned-first ordering for active chats; the order controls time/tie-breaker direction. Filtering and sorting happen before pagination, and `totalItems` counts matching rows. Response paging fields: `currentPage`, `pageSize`, `totalItems`, `totalPages`. An empty collection can return `totalPages: 0`.

## Integration guides

**Authentication:** visitors can browse without credentials. On first send/upload, try refresh, then `POST /auth/guest` only if no valid session exists. A guest has a regular UUID, JWT and owned data. `POST /auth/register` upgrades a valid guest in place (same `User.id` and documents/chats), revokes guest sessions, then the client logs in normally. Existing registered users retain the register → login flow.

**PDF upload:** `POST /document-upload/presigned-url` → direct MinIO `PUT` → `POST /document-upload/:id/process` → `GET /document-upload/:id/progress` → `POST /chat/send`.

**Chat details:** `GET /chat/:id/details` returns session metadata, documents, active-branch messages, feedback, and version navigation metadata (moved from `GET /chat-sessions/:id`).

**Chat branching and feedback:** `POST /chat/:id/fork`, `POST /chat/:messageId/feedback` (204), `POST /chat/:messageId/regenerate` (SSE, including older/inactive answers), `POST /chat/:messageId/edit` (SSE), and `PATCH /chat/:messageId/activate`. See [Chat API](api/chat.md).

**Session pinning:** `PATCH /chat-sessions/:id` accepts `title` and/or `isPinned`. `GET /chat-sessions` lists pinned sessions first before pagination; Trash includes the pin flag without pinned-first sorting.

**Permanent PDF deletion:** `DELETE /documents/:id/permanent` removes MinIO/Milvus data but preserves `Document` and chat associations. Cleanup progresses `READY` → `DELETING` → `DELETED`, with failed cleanup retryable. Permanently deleted documents disappear from Trash and cannot be downloaded or restored; chat details keep their metadata with `status: DELETED`.

**SSE:** `POST /chat/send`, `POST /chat/:messageId/regenerate`, and `POST /chat/:messageId/edit` emit `started`, `sources`, `token`, `done`, `error`; use fetch streaming because native `EventSource` cannot POST. Document upload progress uses `GET` SSE events `message` and `heartbeat`.

## Documentation policy

`docs/API.md` and `docs/api/*.md` are the maintained frontend-facing API reference. The obsolete standalone chat/document Markdown and OpenAPI contracts have been removed because they advertised retired endpoints and snake_case request fields. This repository does not currently publish a maintained OpenAPI JSON/YAML specification; generate a new one from the live controllers/DTOs before relying on automated client generation.

Historical implementation/design notes elsewhere under `docs/` are retained for context, **not** as an API contract. For current upload internals see [document processing](document-processing.md), and for HTTP requests use the module guides above.

Known limitations intentionally left unchanged: `POST /document-upload/:id/retry` remains a TODO stub, upload validation/status transitions are not fully enforced, and interrupted chat SSE generation cannot yet resume after disconnect. See the module pages for details.

## Source paths audited

- `src/model/auth/*` and `src/model/session/*`
- `src/model/chat-session/*`
- `src/model/chat/*`
- `src/model/document-upload/*` including BullMQ processor/listener
- `src/model/documents/*` for document management
- `src/model/health/*`
- `src/common/common.dto.ts`, `src/common/common.interface.ts`, `src/main.ts`, `prisma/schema.prisma`
