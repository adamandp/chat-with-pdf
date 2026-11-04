# Chat With PDF — API Reference

Frontend-facing HTTP/SSE contracts. These are the maintained NestJS route and DTO references. Historical implementation notes elsewhere in `docs/` are not an API specification; obsolete standalone OpenAPI/Markdown contracts have been removed.

Backend schema and DTO conventions: [Validation & DTO Rules](../rules/validation.md).

## Modules

- [Authentication](authentication.md) — lazy guest creation, guest upgrade, registration, login, profile, logout, logout-all
- [Sessions](sessions.md) — refresh access token
- [Chat Sessions](chat-sessions.md) — active/deleted lists, legacy messages, rename, delete, permanent delete, restore
- [Document Upload](document-upload.md) — presigned upload, background processing, progress SSE, retry TODO
- [Documents](documents.md) — ready/deleted lists, details, soft delete, restore, permanent delete
- [Chat](chat.md) — chat details, send SSE, fork, feedback toggle, edit/regenerate SSE, and version activation
- [Health](health.md) — dependency checks

## Common Rules

- Base URL (local): `http://localhost:3000`.
- Protected routes: `Authorization: Bearer <accessToken>`.
- Login, guest creation and refresh use the `refreshToken` HTTP-only cookie; frontend requests must include credentials for those routes.
- Ordinary success responses use `message` and, when applicable, `data` and `paging`.
- `paging` contains `currentPage`, `pageSize`, `totalItems`, `totalPages`; request query keys are `page` and `limit` (defaults 1/10, accepted 1–100).
- Chat session lists support `q` (case-insensitive title search) and `order=asc|desc`; active sessions keep pinned chats first.
- Document and Trash lists support `q` (case-insensitive filename search), `order=asc|desc`, and `sort=modified|name|pages` (default `modified`). All filters apply before pagination.
- `POST /chat/send`, `POST /chat/:messageId/edit`, `POST /chat/:messageId/regenerate`, and `GET /document-upload/:id/progress` return **text/event-stream**, not a `message`/`data` JSON envelope.
- JSON errors are emitted through Nest's exceptions and can differ from success envelopes; do not assume an identical schema for all errors.
- Standard POST statuses: register 201, guest/login/logout/logout-all/refresh/restore 200, presigned-url/process 201. Retry is a TODO stub.

**Example common success envelope**
```json
{
  "message": "📦 Chat sessions retrieved successfully! Smooth sailing! 😎",
  "data": [],
  "paging": {
    "currentPage": 1,
    "pageSize": 10,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

**Example standard validation/auth error (structure can vary by exception)**
```json
{
  "message": "Unauthorized",
  "error": "Unauthorized",
  "statusCode": 401
}
```

**Implementation note:** message strings are defined centrally and selected explicitly by the corresponding service; no global response interceptor is used.
