export interface HealthResponse {
  status: 'ok' | 'error';
  database: 'up' | 'down';
}
