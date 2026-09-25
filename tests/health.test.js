import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse, getBackendHealthRows, getHealthSummary } from '../health.js';

const partialHealth = {
  status: 'unhealthy',
  backends: {
    openrouter: {
      status: 'healthy',
      upstream: 'https://openrouter.ai/api',
      latency_ms: 42,
      error: null,
    },
    local: {
      status: 'unhealthy',
      upstream: 'http://localhost:1234',
      latency_ms: null,
      error: 'Connection refused',
    },
  },
};

test('preserves a non-2xx JSON body when health errors are allowed', async () => {
  const response = new Response(JSON.stringify(partialHealth), { status: 503 });

  assert.deepEqual(await readApiResponse(response, 503), {
    status: 503,
    data: partialHealth,
    ok: true,
  });
});

test('keeps non-2xx responses unsuccessful outside health 503 handling', async () => {
  const response = new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 });
  const otherError = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  assert.deepEqual(await readApiResponse(response), {
    status: 503,
    data: { error: 'Unavailable' },
    ok: false,
  });
  assert.deepEqual(await readApiResponse(otherError, 503), {
    status: 404,
    data: { error: 'Not found' },
    ok: false,
  });
});

test('maps every backend connectivity result for display', () => {
  assert.deepEqual(getBackendHealthRows(partialHealth), [
    {
      name: 'openrouter',
      upstream: 'https://openrouter.ai/api',
      status: 'healthy',
      latency_ms: 42,
      error: null,
    },
    {
      name: 'local',
      upstream: 'http://localhost:1234',
      status: 'unhealthy',
      latency_ms: null,
      error: 'Connection refused',
    },
  ]);
});

test('summarizes fully reachable, partially reachable, and unreachable backends', () => {
  assert.deepEqual(getHealthSummary({ status: 'healthy', backends: { openrouter: { status: 'healthy' } } }), {
    state: 'ok', text: 'ALL REACHABLE · 1/1',
  });
  assert.deepEqual(getHealthSummary(partialHealth), {
    state: 'bad', text: 'PARTIAL · 1/2 REACHABLE',
  });
  assert.deepEqual(getHealthSummary({ status: 'unhealthy', backends: { local: { status: 'unhealthy' } } }), {
    state: 'bad', text: 'UNREACHABLE · 0/1 REACHABLE',
  });
  assert.deepEqual(getHealthSummary({ status: 'unhealthy', backends: {} }), {
    state: 'idle', text: 'NO BACKENDS',
  });
});
