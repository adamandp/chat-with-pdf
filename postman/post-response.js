// Collection > Scripts > Post-response
const baseUrl = String(pm.variables.get('base_url') || '').replace(/\/+$/, '');
const requestUrl = pm.variables.replaceIn(pm.request.url.toString()).split(/[?#]/)[0].replace(/\/+$/, '');
const successful = pm.response.code >= 200 && pm.response.code < 300;

if (baseUrl && successful) {
  if (['/auth/login', '/session/refresh'].some(path => requestUrl === `${baseUrl}${path}`)) {
    const token = pm.response.json()?.data?.accessToken;
    if (typeof token !== 'string' || !token) {
      throw new Error('Response does not contain data.accessToken.');
    }
    pm.environment.set('accessToken', token);
    pm.variables.set('accessToken', token);
  }
  if (['/auth/logout', '/auth/logout-all'].some(path => requestUrl === `${baseUrl}${path}`)) {
    pm.environment.unset('accessToken');
    pm.variables.set('accessToken', '');
  }
}
