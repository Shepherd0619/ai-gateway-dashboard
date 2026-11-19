import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCredentialApi,
  createCredentialManager,
  formatGatewayKeyError,
  getGatewayKeyStatus,
  normalizeBackendCredentialsResponse,
  normalizeGatewayKeysResponse,
} from '../credential-management.js';

test('credential API uses the Admin endpoints and sends only new provider keys', async () => {
  const calls = [];
  const api = createCredentialApi(async (...args) => { calls.push(args); return { ok: true }; });

  await api.getBackendCredentials();
  await api.setBackendCredential('openrouter', 'new-provider-key');
  await api.resetBackendCredential('openrouter');
  await api.listGatewayKeys(50, 100);
  await api.issueGatewayKey('desktop-dev', null);
  await api.revokeGatewayKey('key-id');

  assert.deepEqual(calls, [
    ['GET', '/admin/backend-credentials'],
    ['PUT', '/admin/backend-credentials/openrouter', { body: { apiKey: 'new-provider-key' } }],
    ['DELETE', '/admin/backend-credentials/openrouter'],
    ['GET', '/admin/gateway-keys?limit=50&offset=100'],
    ['POST', '/admin/gateway-keys', { body: { name: 'desktop-dev', expiresAt: null } }],
    ['POST', '/admin/gateway-keys/key-id/revoke'],
  ]);
});

test('credential API safely addresses backend names containing route characters', async () => {
  const calls = [];
  const api = createCredentialApi(async (...args) => { calls.push(args); return {}; });

  await api.setBackendCredential('custom/name', 'new-key');
  await api.resetBackendCredential('custom%name');

  assert.deepEqual(calls, [
    ['PUT', '/admin/backend-credentials?name=custom%2Fname', { body: { apiKey: 'new-key' } }],
    ['DELETE', '/admin/backend-credentials?name=custom%25name'],
  ]);
});

test('normalizes provider status without retaining unexpected secret fields', () => {
  const result = normalizeBackendCredentialsResponse({ backends: [
    { name: 'openrouter', configured: true, source: 'configuration', apiKey: 'must-not-escape' },
    { name: 'openai', configured: true, source: 'runtime', secret: 'must-not-escape' },
  ] });

  assert.deepEqual(result, { backends: [
    { name: 'openrouter', configured: true, source: 'configuration' },
    { name: 'openai', configured: true, source: 'runtime' },
  ] });
});

test('normalizes gateway key metadata without retaining an unexpected apiKey', () => {
  const result = normalizeGatewayKeysResponse({
    limit: 50,
    offset: 0,
    keys: [{
      id: 'key-id', name: 'desktop-dev', createdAt: '2026-11-19T01:00:00Z',
      expiresAt: null, revokedAt: null, lastUsedAt: null, lastUsedIp: null,
      apiKey: 'one-time-secret-must-not-be-listed',
    }],
  });

  assert.deepEqual(result, {
    limit: 50,
    offset: 0,
    keys: [{
      id: 'key-id', name: 'desktop-dev', createdAt: '2026-11-19T01:00:00Z',
      expiresAt: null, revokedAt: null, lastUsedAt: null, lastUsedIp: null,
    }],
  });
  assert.equal(JSON.stringify(result).includes('one-time-secret'), false);
});

test('rejects malformed credential and gateway key responses', () => {
  assert.throws(() => normalizeBackendCredentialsResponse({ backends: [{ name: 'x', configured: 'yes', source: 'runtime' }] }), /backend credential/i);
  assert.throws(() => normalizeGatewayKeysResponse({ keys: [], limit: 0, offset: -1 }), /gateway key/i);
  assert.throws(() => normalizeGatewayKeysResponse({ keys: [{ id: 'missing-fields' }], limit: 50, offset: 0 }), /gateway key/i);
});

test('key status marks exact expiry as expired and gives revocation precedence', () => {
  const now = Date.parse('2026-11-19T01:00:00Z');

  assert.equal(getGatewayKeyStatus({ expiresAt: null, revokedAt: null }, now), 'active');
  assert.equal(getGatewayKeyStatus({ expiresAt: '2026-11-19T01:00:00Z', revokedAt: null }, now), 'expired');
  assert.equal(getGatewayKeyStatus({ expiresAt: '2026-11-20T01:00:00Z', revokedAt: '2026-11-18T01:00:00Z' }, now), 'revoked');
});

test('explains disabled Gateway Keys and unavailable key storage', () => {
  assert.match(formatGatewayKeyError(Object.assign(new Error('HTTP 404'), { status: 404 })), /disabled/i);
  assert.match(formatGatewayKeyError(Object.assign(new Error('HTTP 503'), { status: 503 })), /storage|database/i);
  assert.equal(formatGatewayKeyError(Object.assign(new Error('No admin key'), { status: 401 })), 'No admin key');
});

test('ignores provider and key results that arrive after the selected gateway changes', async () => {
  let gatewayId = 'gateway-a';
  let finishProviders;
  let finishKeys;
  const manager = createCredentialManager({
    getGatewayId: () => gatewayId,
    api: {
      getBackendCredentials: () => new Promise((resolve) => { finishProviders = resolve; }),
      listGatewayKeys: () => new Promise((resolve) => { finishKeys = resolve; }),
    },
  });
  const providers = manager.loadProviders();
  const keys = manager.loadKeys(0);

  gatewayId = 'gateway-b';
  manager.gatewayChanged();
  finishProviders({ data: { backends: [{ name: 'old', configured: true, source: 'runtime' }] } });
  finishKeys({ data: { keys: [], limit: 50, offset: 0 } });
  await Promise.all([providers, keys]);

  assert.equal(manager.getState().gatewayId, 'gateway-b');
  assert.deepEqual(manager.getState().backends, []);
  assert.deepEqual(manager.getState().keys, []);
  assert.equal(manager.getState().issuedApiKey, null);
});

test('keeps an issued key transiently and clears it when the user dismisses the result', async () => {
  let listed = [];
  const manager = createCredentialManager({
    getGatewayId: () => 'gateway-a',
    api: {
      issueGatewayKey: async () => ({ data: { apiKey: 'sk-aigw-once.secret' } }),
      listGatewayKeys: async (limit, offset) => ({ data: { keys: listed, limit, offset } }),
    },
  });

  assert.equal(await manager.issueGatewayKey('desktop-dev', null), true);
  assert.equal(manager.getState().issuedApiKey, 'sk-aigw-once.secret');
  assert.equal(await manager.loadKeys(0), true);
  assert.equal(manager.getState().keys.some((key) => key.apiKey), false);

  manager.clearIssuedKey();
  assert.equal(manager.getState().issuedApiKey, null);
});

test('saves and restores provider overrides and revokes a gateway key through the manager', async () => {
  let backend = { name: 'openrouter', configured: true, source: 'configuration' };
  let key = {
    id: 'key-id', name: 'desktop-dev', createdAt: '2026-11-19T01:00:00Z',
    expiresAt: null, revokedAt: null, lastUsedAt: null, lastUsedIp: null,
  };
  const calls = [];
  const manager = createCredentialManager({
    getGatewayId: () => 'gateway-a',
    api: {
      getBackendCredentials: async () => ({ data: { backends: [backend] } }),
      setBackendCredential: async (name, apiKey) => {
        calls.push(['save', name, apiKey]);
        backend = { name, configured: true, source: 'runtime' };
      },
      resetBackendCredential: async (name) => {
        calls.push(['reset', name]);
        backend = { name, configured: true, source: 'configuration' };
      },
      listGatewayKeys: async (limit, offset) => ({ data: { keys: [key], limit, offset } }),
      revokeGatewayKey: async (id) => {
        calls.push(['revoke', id]);
        key = { ...key, revokedAt: '2026-11-19T02:00:00Z' };
      },
    },
  });

  assert.equal(await manager.loadProviders(), true);
  assert.equal(await manager.saveProviderCredential('openrouter', 'new-provider-key'), true);
  assert.equal(manager.getState().backends[0].source, 'runtime');
  assert.equal(await manager.resetProviderCredential('openrouter'), true);
  assert.equal(manager.getState().backends[0].source, 'configuration');
  assert.equal(await manager.loadKeys(0), true);
  assert.equal(await manager.revokeGatewayKey('key-id'), true);
  assert.equal(manager.getState().keys[0].revokedAt, '2026-11-19T02:00:00Z');
  assert.deepEqual(calls, [
    ['save', 'openrouter', 'new-provider-key'],
    ['reset', 'openrouter'],
    ['revoke', 'key-id'],
  ]);
  assert.equal(JSON.stringify(manager.getState().backends).includes('new-provider-key'), false);
});
