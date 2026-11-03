# Authentication Sessions API

**Base path:** `/session`

Authentication sessions and chat sessions are different resources.

## 01 — Refresh Access Token

`POST /session/refresh` · Refresh cookie · **200 OK**

**Request:** `Cookie: refreshToken=<jwt>`; no JSON body. No bearer JWT is required for this public route.

**Success response**
```json
{
  "message": "🔄 Access token updated successfully! Looking fresh! ✨",
  "data": {
    "accessToken": "<new-access-jwt>"
  }
}
```

**Errors:** 401 missing, invalid, expired or revoked refresh cookie.

**Notes:** The refresh cookie is not rotated. The new access token preserves the existing session ID (`sid`) and original refresh expiration. Access token lifetime: 15 minutes. Untrusted `Origin` headers return 403.
