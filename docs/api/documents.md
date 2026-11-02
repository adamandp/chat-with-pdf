# Documents API Reference

Five protected NestJS endpoints cover PDF upload reservation, list/detail, background processing, and progress streaming. A direct MinIO signed `PUT` is described separately below; it is **not** a NestJS endpoint.

## Endpoint index

| Method | Endpoint | Authentication | Description |
| --- | --- | --- | --- |
| POST | `/documents/presigned-url` | Bearer | Reserve PDF upload |
| GET | `/documents` | Bearer | List active documents |
| GET | `/documents/:id` | Bearer | Detail + download URL |
| POST | `/documents/:id/process` | Bearer | Enqueue PDF processing |
| GET | `/documents/:id/progress` | Bearer | Stream processing progress |

## 1. Create Presigned Upload URL

**POST /documents/presigned-url**

Creates a `PENDING_UPLOAD` document database record and a temporary signed MinIO PUT URL.

### Request

**Headers:**

```http
Authorization: Bearer <access-jwt>
Content-Type: application/json
```

**Cookies:** none required.

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `fileName` | string or null | Yes | If string, 1–255 characters; current schema permits `null` |

```json
{
  "fileName": "annual-report.pdf"
}
```

### Success response — 201 Created

```json
{
  "data": {
    "document_id": "c55ec1cb-452a-4383-8d6b-ad18a13f1a11",
    "upload_url": "https://minio.example/bucket/<signed-put-url>",
    "expires_in": 900
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid request body |
| 401 | Missing/invalid access token |
| 500 | Database or URL-signing failure (concrete error depends on storage exception) |

**Notes:** URL expires in 900 seconds; object key is the generated document UUID. If URL signing fails, the newly created DB record is deleted. **Currently the DTO does not accept `fileSize`, `mimeType`, `sha256Hash` or `pageCount`**, even though the Document table has those columns.

## 2. List Documents

**GET /documents**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| `page` | Query | integer | No | 1–100, default 1 |
| `limit` | Query | integer | No | 1–100, default 10 |

```http
GET /documents?page=1&limit=10
Authorization: Bearer <access-jwt>
```

### Success response — 200 OK

```json
{
  "data": [
    {
      "id": "c55ec1cb-452a-4383-8d6b-ad18a13f1a11",
      "userId": "<user-uuid>",
      "fileName": "annual-report.pdf",
      "fileSize": null,
      "mimeType": null,
      "sha256Hash": null,
      "pageCount": 24,
      "chunkCount": 120,
      "status": "READY",
      "errorMessage": null,
      "createdAt": "2026-10-30T11:00:00.000Z",
      "updatedAt": "2026-10-30T12:00:00.000Z",
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
| 401 | Unauthorized |

**Notes:** scoped by `userId` and `deletedAt: null`, sorted by `updatedAt DESC` then ID. Non-null `fileSize` is serialized as a decimal **string** in this list. No search/filter/sort parameters other than pagination.

## 3. Get Document Detail

**GET /documents/:id**

Returns one owned, active document, plus a signed download URL.

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required |
| --- | --- | --- | --- |
| `id` | Path | UUID | Yes |

### Success response — 200 OK

```json
{
  "data": {
    "id": "c55ec1cb-452a-4383-8d6b-ad18a13f1a11",
    "userId": "<user-uuid>",
    "fileName": "annual-report.pdf",
    "fileSize": null,
    "mimeType": null,
    "sha256Hash": null,
    "pageCount": 24,
    "chunkCount": 120,
    "status": "READY",
    "errorMessage": null,
    "createdAt": "2026-10-30T11:00:00.000Z",
    "updatedAt": "2026-10-30T12:00:00.000Z",
    "deletedAt": null,
    "download_url": "https://minio.example/bucket/<signed-get-url>"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Malformed UUID |
| 401 | Unauthorized |
| 404 | Document not found, deleted, or not owned by caller |
| 500 | Possible serialization failure if `fileSize` is non-null BigInt |

**Known issue:** unlike the list endpoint, `findOne` returns Prisma `BigInt` as-is. JSON serialization can fail for a non-null `fileSize`. Download URL expires in 900 seconds. Current service does not require `READY` status to generate a URL.

## 4. Queue Document Processing

**POST /documents/:id/process**

Marks a document `QUEUED` and submits a BullMQ job using document ID as `jobId`.

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required |
| --- | --- | --- | --- |
| `id` | Path | UUID | Yes |

### Success response — 201 Created

```json
{
  "message": "Document queued for processing",
  "data": {
    "id": "c55ec1cb-452a-4383-8d6b-ad18a13f1a11",
    "status": "QUEUED"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Malformed UUID |
| 401 | Unauthorized |
| 503 | Failure during queue insertion / initial update |
| 404 / 500 | Final database lookup fails after an unsuccessful update or missing document, depending on Prisma exception mapping |

**Known issues:**

- Current service does **not** check affected row count from `updateMany`, enforce that the doc is `PENDING_UPLOAD`, validate that the uploaded MinIO object exists with a HEAD request, or verify MIME/hash/file size before queueing.
- Repeated calls and calling process on `READY` or `FAILED` documents have no explicit idempotency / status-transition contract.
- Failure during enqueue updates the DB to `FAILED`; a retry needs a clear policy.

## 5. Stream Document Progress

**GET /documents/:id/progress**

SSE stream for an active owned document. Sends an initial snapshot and future queue events.

### Request

**Headers:**

```http
Authorization: Bearer <access-jwt>
Accept: text/event-stream
```

**Cookies:** none. **Body:** none.

| Parameter | Location | Type | Required |
| --- | --- | --- | --- |
| `id` | Path | UUID | Yes |

### Success response — 200 OK (SSE)

**Response header:** `Content-Type: text/event-stream`.

```text
event: message
data: {"document_id":"c55ec1cb-452a-4383-8d6b-ad18a13f1a11","status":"PROCESSING","progress":40}

event: heartbeat
data: {}

event: message
data: {"document_id":"c55ec1cb-452a-4383-8d6b-ad18a13f1a11","status":"READY","progress":100}
```

On failure, the message payload can be:

```json
{
  "document_id": "c55ec1cb-452a-4383-8d6b-ad18a13f1a11",
  "status": "FAILED",
  "progress": 0,
  "error": "PDF processing failed"
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Malformed UUID |
| 401 | Unauthorized |
| 404 | Active owned document not found |

**Notes:** event type `message` carries snapshot / status / percentage; `heartbeat` contains `{}` every 15 seconds. Stream ends when status becomes `READY` or `FAILED`. Event delivery is in-memory through RxJS + queue listener; clients should not assume durable replay or cross-instance pub/sub.

---

## Direct MinIO Upload (not a NestJS endpoint)

Immediately after presign, upload PDF bytes to the returned signed URL:

```http
PUT <upload_url>
Content-Type: application/pdf

<binary PDF bytes>
```

- **Authentication:** the signed URL, **not** the backend Bearer token or refresh cookie.
- **Response:** successful storage-dependent 2xx (often 200), normally no JSON body. Exact code depends on MinIO/S3 server.
- **Next step:** `POST /documents/:id/process` with the original `document_id`.
- No NestJS `POST /documents/upload` route exists in the current controller.

## Processing lifecycle

```text
POST /documents/presigned-url       -> PENDING_UPLOAD
PUT <upload_url> directly to MinIO -> PDF object uploaded
POST /documents/:id/process        -> QUEUED (BullMQ)
Worker: PDF.js extraction          -> PROCESSING
Worker: chunk (1000, overlap 200), Gemini embedding, Milvus insert
                                     -> READY
Worker/queue failure               -> FAILED
GET /documents/:id/progress        -> SSE status/progress/heartbeat
```

The worker extracts page text, splits and embeds chunks in batches of 50, writes to Milvus `document_chunks`, and saves `pageCount` / `chunkCount`. The worker implementation does not currently calculate or persist uploaded `fileSize` or SHA-256 hash.

## Document response field reference

| Field | Type in JSON | Notes |
| --- | --- | --- |
| `id`, `userId` | UUID | Document and owner |
| `fileName` | string / null | Filename; may currently be null |
| `fileSize` | string / null in list | BigInt in Prisma; detail endpoint bug |
| `mimeType`, `sha256Hash` | string / null | Not populated by current presign service |
| `pageCount`, `chunkCount` | number / null | May be set during processing |
| `status` | enum | `PENDING_UPLOAD`, `QUEUED`, `PROCESSING`, `READY`, `FAILED`, `DELETING`, `DELETED` |
| `errorMessage` | string / null | Failure details |
| `createdAt`, `updatedAt`, `deletedAt` | ISO timestamps / null | Timestamps |

## Missing API surface and legacy documentation

Current controller does **not** implement document soft-delete, permanent deletion, restore, list deleted documents, explicit retry, or file metadata update, although the Prisma schema includes lifecycle fields/statuses.

Legacy `docs/document-api.yaml` and `docs/documents.openapi.json` describe older upload routes/fields. Do not treat those as a current contract without reconciliation.
