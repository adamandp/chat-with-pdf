# Authentication API Reference

Lazy guest sessions, account creation/upgrades, login, profile, token refresh and session termination. Status codes and messages reflect the current controllers and the service-level response templates.

## Endpoint index

| Method | Endpoint | Authentication | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Create account |
| POST | `/auth/guest` | Public | Create a guest only when no valid session exists |
| POST | `/auth/login` | Public | Login; receive access JWT and refresh cookie |
| GET | `/auth/profile` | Bearer | Current user profile |
| POST | `/session/refresh` | Refresh cookie | Renew access JWT |
| POST | `/auth/logout` | Refresh cookie | Revoke only the current device session |
| POST | `/auth/logout-all` | Bearer | Revoke all device sessions |

## 1. Register

**POST /auth/register**

Creates an account **without** automatically logging in. When a valid guest refresh cookie is sent, this upgrades that same `User.id` instead of creating a new user. Its chat sessions and documents retain ownership. Guest sessions are revoked; the client then logs in through the normal endpoint.

### Request

**Headers:** `Content-Type: application/json`. **Cookie:** optional (a valid guest cookie permits upgrade; a registered user's valid cookie causes 400). **Body:**

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `username` | string | Yes | Trimmed, 3–50 chars, letters/digits/`_`/`.`/`-` |
| `password` | string | Yes | 8–100 chars |
| `name` | string | No | Max 255 chars |

```json
{
  "username": "adamandp",
  "password": "Password123!",
  "name": "Adam Ananda Putra"
}
```

### Success response — 201 Created

No new session cookie. A guest upgrade clears its old refresh cookie.

```json
{
  "message": "🎉 Account created successfully! Welcome aboard! 🚀"
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid request, username already registered, or already authenticated as a registered account |

## 2. Create Guest Session

**POST /auth/guest**

Call lazily before the first chat send or PDF upload, never merely to render `/`. No request body is required. If a valid refresh cookie already exists, the endpoint returns an access token for that session without creating a new user.

### Success response — 200 OK

For a new guest, the response sets the same HttpOnly `refreshToken` cookie as login:

```json
{
  "message": "🎉 Guest session created successfully! Welcome aboard! 🚀",
  "data": { "accessToken": "<jwt>" }
}
```

The new user has a standard UUID, nullable credentials, and `accountType: "GUEST"`. It receives the same 15-minute access/7-day refresh tokens and `AuthSession` checks as registered accounts. A repeated call with a valid cookie does not rotate that cookie. The endpoint checks trusted cookie origins and limits new guests to 10 creations per IP per 15 minutes (429 with `Retry-After`).

### Errors

| Status | Condition |
| --- | --- |
| 403 | Untrusted browser Origin |
| 429 | Guest creation rate limit reached |

## 3. Login

**POST /auth/login**

Validates credentials and creates a database-backed authentication session.

### Request

**Headers:** `Content-Type: application/json`. **Cookie:** optional. A guest may log into an existing account; its old guest session is revoked, but guest data is not silently imported into that separate account.

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `username` | string | Yes | 3–50 chars; alphanumeric, underscores, dots, hyphens |
| `password` | string | Yes | 8–100 chars |

```json
{
  "username": "adamandp",
  "password": "Password123!"
}
```

### Success response — 200 OK

**Response headers:**

```http
Set-Cookie: refreshToken=<refresh-jwt>; HttpOnly; SameSite=Lax; Path=/; Expires=<7-days-later>
```

```json
{
  "message": "🎉 Login session created successfully! Welcome aboard! 🚀",
  "data": {
    "accessToken": "<jwt>"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid body or already logged in with a registered account refresh cookie |
| 401 | Invalid username/password, inactive account, or soft-deleted account |
| 429 | More than 30 login requests per IP or 10 per username within 15 minutes (`Retry-After` header) |

### Notes

- Access token: 15 minutes, response JSON only.
- Refresh token: 7 days, HttpOnly cookie. `Secure` is enabled when `NODE_ENV=production` or `AUTH_COOKIE_SAME_SITE=none`.
- The service stores a SHA-256 hash of the refresh JWT in `auth_sessions`. Maximum: five concurrently active device sessions.
- Login limits use atomic PostgreSQL counters for both IP and normalized username. All attempts count, whether credentials are valid or not.
- Deploy migration `20261103000000_restore_auth_login_rate_limit` first (`npx prisma migrate deploy`); the login rate limiter requires this table.

## 4. Get Profile

**GET /auth/profile**

### Request

**Headers:** `Authorization: Bearer <access-jwt>`. **Cookie:** not required. **Body:** none.

### Success response — 200 OK

```json
{
  "message": "📦 User profile retrieved successfully! Smooth sailing! 😎",
  "data": {
    "id": "6b79dddc-4fbe-438b-b3dc-f51a0e4a68f6",
    "username": "adamandp",
    "name": "Adam Ananda Putra",
    "accountType": "REGISTERED"
  }
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing, expired, invalid, or rejected access token |

**Note:** `name` and `username` can be null for guests; the profile includes `accountType: "GUEST" | "REGISTERED"`.

## 5. Refresh Access Token

**POST /session/refresh**

### Request

**Headers:**

```http
Cookie: refreshToken=<refresh-jwt>
```

**Authentication:** valid refresh cookie. **Bearer:** not required. **Body:** none.

### Success response — 200 OK

```json
{
  "message": "🔄 Access token updated successfully! Looking fresh! ✨",
  "data": {
    "accessToken": "<new-access-jwt>"
  }
}
```

**Response cookies:** none; the existing refresh cookie is deliberately not rotated. The new access JWT preserves the same `sid`.

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing, expired, invalid, or revoked refresh token |

**Security:** the refresh token must match the stored hash for its active session.

## 6. Logout

**POST /auth/logout**

Intended to end the session associated with the supplied refresh cookie.

### Request

**Headers:**

```http
Cookie: refreshToken=<refresh-jwt>
```

**Bearer:** not required. **Body:** none.

### Success response — 200 OK

**Response headers:**

```http
Set-Cookie: refreshToken=; Expires=<past-date>; Path=/
```

```json
{
  "message": "🗑️ Login session deleted successfully! Sayonara! 👋"
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing, expired, invalid, or revoked refresh cookie |

Only the session matching the refresh token's `sid` is revoked. The browser cookie is also cleared if the token is missing, expired, or already revoked (the HTTP response remains 401).

## 7. Logout All Devices

**POST /auth/logout-all**

Revokes all active authentication sessions belonging to the authenticated user.

### Request

**Headers:**

```http
Authorization: Bearer <access-jwt>
```

**Refresh cookie:** not required. **Body:** none.

### Success response — 200 OK

**Response headers:**

```http
Set-Cookie: refreshToken=; Expires=<past-date>; Path=/
```

```json
{
  "message": "🗑️ All login sessions deleted successfully! Sayonara! 👋"
}
```

### Error responses

| Status | Condition |
| --- | --- |
| 401 | Missing, invalid, expired, or rejected access token |

**Note:** all active DB authentication sessions are revoked; the HTTP response clears only the requesting browser's refresh cookie. Other browsers' cookies remain physically present but their sessions should be rejected.

## Cookies and browser integration

- A browser sends a matching HttpOnly cookie automatically; client JavaScript cannot read its value.
- For cross-origin browser requests, use credentials (e.g. Axios `withCredentials: true`); backend must permit the exact frontend origin and credentials.
- `AUTH_COOKIE_SAME_SITE=lax` is the default. Cross-site FE/BE hostnames require `AUTH_COOKIE_SAME_SITE=none` and HTTPS (`Secure` enabled automatically).
- Refresh and logout reject requests with an `Origin` header outside `FRONTEND_ORIGINS` (403).
- Refresh rotation is intentionally outside the API contract. Revoking a session invalidates its access and refresh tokens.

## Session isolation guarantees

| Operation | Session identity | Expected result |
| --- | --- | --- |
| Access / refresh validation | `sub` and `sid` | A device's token only works while its own session remains active |
| Refresh token validation | `sub`, `sid`, and refresh hash | A revoked or mismatched session fails |
| Logout | `sub` and `sid` | Only the current device is logged out |
| Logout all | `sub` | All sessions belonging to the user are revoked |

Responses and endpoint paths are unchanged; server-side checks match the documented per-device behavior.
