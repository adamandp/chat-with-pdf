export interface HealthResponse {
  status: 'ok' | 'error';
  connection: 'up' | 'down';
}
