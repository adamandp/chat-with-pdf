// Collection > Scripts > Pre-request
// Environment: base_url. Collection Authorization: Bearer Token {{accessToken}}.
// Postman sends the refreshToken from its cookie jar automatically.
const baseUrl = String(pm.variables.get('base_url') || '').replace(/\/+$/, '');
const requestUrl = pm.variables.replaceIn(pm.request.url.toString()).split(/[?#]/)[0].replace(/\/+$/, '');
const publicPaths = ['/auth/login', '/auth/register', '/auth/logout', '/session/refresh'];

if (baseUrl && requestUrl.startsWith(`${baseUrl}/`) &&
    !publicPaths.some(path => requestUrl === `${baseUrl}${path}`)) {
  try {
    let token = pm.environment.get('accessToken');
    let expiresAt = 0;
    try {
      const { Buffer } = require('buffer');
      const payload = JSON.parse(Buffer.from(token.split('.')[1]
        .replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      expiresAt = Number(payload.exp) * 1000;
    } catch {
      // Missing or malformed token: try the existing refresh cookie once.
    }

    // Refresh slightly early so the token won't expire while the request travels.
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30000) {
      const response = await pm.sendRequest({
        url: `${baseUrl}/session/refresh`,
        method: 'POST',
        header: { Accept: 'application/json' },
      });
      if (response.code < 200 || response.code >= 300) {
        throw new Error(`Refresh failed (HTTP ${response.code}). Login again if the session expired or was revoked.`);
      }
      token = response.json()?.data?.accessToken;
      if (typeof token !== 'string' || !token) {
        throw new Error('Refresh response does not contain data.accessToken.');
      }
      pm.environment.set('accessToken', token);
    }
    // Local scope wins over an old collection/global variable of the same name.
    pm.variables.set('accessToken', token);
  } catch (error) {
    pm.environment.unset('accessToken');
    pm.variables.set('accessToken', '');
    pm.execution.skipRequest();
    throw error;
  }
}
