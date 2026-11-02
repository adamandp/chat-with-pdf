# Health API Reference

Five dependency-specific health checks. **All are protected** by the global JWT guard; none is decorated `@Public()`. Refresh cookies are unnecessary.

## Endpoint index

| Method | Path | Dependency |
| --- | --- | --- |
| GET | `/health/minio` | MinIO bucket |
| GET | `/health/postgres` | PostgreSQL |
| GET | `/health/milvus` | Milvus |
| GET | `/health/gemini` | Gemini chat model |
| GET | `/health/groq` | Groq chat model |

## 1. Check MinIO

**GET /health/minio**

Tests whether the configured storage bucket exists/access is available.

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

### Success response — 200 OK

```json
{
  "message": "📦 MinIO connection retrieved successfully! Smooth sailing! 😎",
  "data": {
    "status": "ok",
    "connection": "up"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing / invalid Bearer token |
| 503 | Bucket missing, denied, or storage connectivity failure |

## 2. Check PostgreSQL

**GET /health/postgres**

Runs `SELECT 1` against the configured PostgreSQL connection.

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

### Success response — 200 OK

```json
{
  "message": "📦 Postgres connection retrieved successfully! Smooth sailing! 😎",
  "data": {
    "status": "ok",
    "connection": "up"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing / invalid Bearer token |
| 503 | PostgreSQL connection/query error |

## 3. Check Milvus

**GET /health/milvus**

Calls Milvus health check.

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

### Success response — 200 OK

```json
{
  "message": "📦 Milvus connection retrieved successfully! Smooth sailing! 😎",
  "data": {
    "status": "ok",
    "connection": "up"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing / invalid Bearer token |
| 503 | Milvus unhealthy, connection or RPC failure |

**Known inconsistency:** the Milvus **failure** response uses `database: "down"` instead of `connection: "down"`.

## 4. Check Gemini

**GET /health/gemini**

Sends an actual short prompt (`Reply with only OK.`) to the configured Gemini chat model with a one-second call timeout.

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

### Success response — 200 OK

```json
{
  "message": "📦 AI connection retrieved successfully! Smooth sailing! 😎",
  "data": {
    "status": "ok",
    "connection": "up"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing / invalid Bearer token |
| 503 | Provider request failed or timed out |

**Note:** invokes a real provider call and may consume quota.

## 5. Check Groq

**GET /health/groq**

Sends an actual short prompt (`Reply with only OK.`) to the configured Groq chat model with a one-second call timeout.

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookies:** none. **Body:** none.

### Success response — 200 OK

```json
{
  "message": "📦 AI connection retrieved successfully! Smooth sailing! 😎",
  "data": {
    "status": "ok",
    "connection": "up"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing / invalid Bearer token |
| 503 | Provider request failed or timed out |

**Note:** invokes a real provider call and may consume quota.

## Error response examples

Each service throws a NestJS `ServiceUnavailableException` when the check fails, with an explicit payload similar to:

```json
{
  "errors": "🚨 Whoops! Couldn't retrieve Postgres connection. Maybe it's playing hide and seek? 🤔",
  "data": {
    "status": "error",
    "connection": "down"
  }
}
```

Milvus failure currently includes `"database": "down"`, unlike the `connection` field used by the other health checks. NestJS may add exception response information; no universal app-level error envelope is guaranteed.

## Operational considerations

- There is no public `GET /health/live` or aggregate `GET /health/ready` route in the current controller.
- Provider checks make real LLM calls, which makes them less suitable as low-cost, high-frequency container liveness probes.
- Use dedicated liveness/readiness routes for orchestrator health checks if needed; these are recommendations, **not implemented endpoints**.
