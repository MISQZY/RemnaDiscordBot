// API load test: k6 run scripts/load/api.k6.js
// API_URL — the API (default http://localhost:3000); SID — optional `sid` cookie of a signed-in session
// for the authenticated scenario (copy it from the browser after /v1/auth/login).
// Start the API with API_RATE_LIMIT_PER_MINUTE=0: otherwise the per-IP limit turns the load into 429s.
import { check } from 'k6';
import http from 'k6/http';

const API_URL = __ENV.API_URL || 'http://localhost:3000';
const SID = __ENV.SID;

export const options = {
  scenarios: {
    public: {
      executor: 'ramping-vus',
      exec: 'publicRoutes',
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '15s', target: 0 },
      ],
    },
    ...(SID
      ? {
          authenticated: {
            executor: 'constant-vus',
            exec: 'authenticatedRoutes',
            vus: 10,
            duration: '1m45s',
          },
        }
      : {}),
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:public}': ['p(95)<100'],
    'http_req_duration{scenario:authenticated}': ['p(95)<300'],
  },
};

export function publicRoutes() {
  check(http.get(`${API_URL}/health`), { 'health 200': (r) => r.status === 200 });
  check(http.get(`${API_URL}/ready`), { 'ready 200': (r) => r.status === 200 });
  check(http.get(`${API_URL}/v1/status`), { 'status 200': (r) => r.status === 200 });
}

export function authenticatedRoutes() {
  const params = { cookies: { sid: SID } };
  check(http.get(`${API_URL}/v1/me`, params), { 'me 200': (r) => r.status === 200 });
  check(http.get(`${API_URL}/v1/me/guilds`, params), { 'guilds 200': (r) => r.status === 200 });
}
