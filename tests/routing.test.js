import test from 'node:test';
import assert from 'node:assert/strict';
import * as routing from '../routing.js';

test('normalizes a mapping with an omitted backend to openrouter', () => {
  assert.deepEqual(routing.normalizeRule({ prefix: 'claude', target: '', proxyServer: null }), {
    prefix: 'claude', target: '', backend: 'openrouter', proxyServer: null,
  });
});

test('builds a mapping PATCH without putting backend in target', () => {
  assert.deepEqual(routing.buildMappingPatch({ target: 'local-model', backend: 'lmstudio', proxyServer: null }), {
    target: 'local-model', backend: 'lmstudio', proxyServer: null,
  });
});

test('builds an independent classifier PUT with Target, not TargetModel', () => {
  const body = routing.buildClassifierPut({ target: 'local-classifier', backend: 'lmstudio', proxyServer: null });
  assert.deepEqual(body, { target: 'local-classifier', backend: 'lmstudio', proxyServer: null });
  assert.equal(JSON.stringify(body).includes('TargetModel'), false);
});

test('clearing classifier target produces a fully disabled route', () => {
  assert.deepEqual(routing.buildClassifierPut({ target: '', backend: 'lmstudio', proxyServer: 'corp' }), {
    target: null, backend: null, proxyServer: null,
  });
});

test('exports backend and independent classifier route', () => {
  const output = routing.buildHardenConfig([
    { prefix: 'claude-local', target: 'local-model', backend: 'lmstudio', proxyServer: null },
  ], { target: 'local-classifier', backend: 'lmstudio', proxyServer: 'corp' });
  assert.deepEqual(output, {
    ModelMapping: { Rules: [{ Prefix: 'claude-local', Target: 'local-model', Backend: 'lmstudio', ProxyServer: null }] },
    Classifier: { Target: 'local-classifier', Backend: 'lmstudio', ProxyServer: 'corp' },
  });
  assert.equal(JSON.stringify(output).includes('TargetModel'), false);
});

test('reads backend names from supported discovery response shapes', () => {
  assert.deepEqual(routing.normalizeBackendNames(['openrouter', 'lmstudio']), ['openrouter', 'lmstudio']);
  assert.deepEqual(routing.normalizeBackendNames({ backends: ['lmstudio'] }), ['lmstudio']);
  assert.deepEqual(routing.normalizeBackendNames({ Backends: { openrouter: {}, lmstudio: {} } }), ['openrouter', 'lmstudio']);
});

test('merges live backend names with route names and openrouter', () => {
  assert.deepEqual(routing.collectBackendNames([{ backend: 'lmstudio' }], { backend: 'ollama' }, ['azure']), [
    'openrouter', 'azure', 'lmstudio', 'ollama',
  ]);
});

test('collects backend and proxy choices dynamically', () => {
  assert.deepEqual(routing.collectBackendNames([{ backend: 'lmstudio' }], { backend: 'ollama' }), [
    'openrouter', 'lmstudio', 'ollama',
  ]);
  assert.deepEqual(routing.collectProxyNames([{ proxyServer: 'corp' }], { proxyServer: 'edge' }), [
    '', 'corp', 'edge',
  ]);
});
