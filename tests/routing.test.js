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

test('preserves null, empty, and named proxy states when normalizing', () => {
  for (const proxyServer of [null, '', 'corp']) {
    assert.equal(routing.normalizeRule({ proxyServer }).proxyServer, proxyServer);
    assert.equal(routing.normalizeClassifier({ proxyServer }).proxyServer, proxyServer);
  }
});

test('builds mapping PATCH bodies for all proxy states', () => {
  for (const proxyServer of [null, '', 'corp']) {
    assert.deepEqual(routing.buildMappingPatch({ target: 'model', backend: 'lmstudio', proxyServer }), {
      target: 'model', backend: 'lmstudio', proxyServer,
    });
  }
});

test('builds classifier PUT bodies for all enabled proxy states', () => {
  for (const proxyServer of [null, '', 'corp']) {
    assert.deepEqual(routing.buildClassifierPut({ target: 'classifier', backend: 'lmstudio', proxyServer }), {
      target: 'classifier', backend: 'lmstudio', proxyServer,
    });
  }
});

test('exports an explicit direct proxy override as an empty string', () => {
  assert.deepEqual(routing.buildHardenConfig([
    { prefix: 'claude', target: 'model', backend: 'lmstudio', proxyServer: '' },
  ], { target: 'classifier', backend: 'lmstudio', proxyServer: '' }), {
    ModelMapping: { Rules: [{ Prefix: 'claude', Target: 'model', Backend: 'lmstudio', ProxyServer: '' }] },
    Classifier: { Target: 'classifier', Backend: 'lmstudio', ProxyServer: '' },
  });
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
    'corp', 'edge',
  ]);
});

test('exports Compose env without conflating inherited and direct proxy states', () => {
  assert.deepEqual(routing.buildHardenEnvLines([
    { prefix: 'inherit', target: 'model-a', backend: 'openrouter', proxyServer: null },
    { prefix: 'direct', target: 'model-b', backend: 'openrouter', proxyServer: '' },
    { prefix: 'named', target: 'model-c', backend: 'openrouter', proxyServer: 'corp' },
  ], { target: 'classifier', backend: 'openrouter', proxyServer: null }), [
    '      - ModelMapping__Rules__0__Prefix=inherit',
    '      - ModelMapping__Rules__0__Target=model-a',
    '      - ModelMapping__Rules__0__Backend=openrouter',
    '      - ModelMapping__Rules__1__Prefix=direct',
    '      - ModelMapping__Rules__1__Target=model-b',
    '      - ModelMapping__Rules__1__Backend=openrouter',
    '      - ModelMapping__Rules__1__ProxyServer=',
    '      - ModelMapping__Rules__2__Prefix=named',
    '      - ModelMapping__Rules__2__Target=model-c',
    '      - ModelMapping__Rules__2__Backend=openrouter',
    '      - ModelMapping__Rules__2__ProxyServer=corp',
    '      - Classifier__Target=classifier',
    '      - Classifier__Backend=openrouter',
  ]);
});

test('exports an empty classifier proxy override in Compose env', () => {
  assert.equal(routing.buildHardenEnvLines([], { target: 'classifier', backend: 'openrouter', proxyServer: '' }).at(-1),
    '      - Classifier__ProxyServer=');
});

test('preserves disabled classifier target and backend in Compose env', () => {
  assert.deepEqual(routing.buildHardenEnvLines([], { target: null, backend: null, proxyServer: null }), [
    '      - Classifier__Target=',
    '      - Classifier__Backend=',
  ]);
});

test('exports the complete model discovery catalog in appsettings shape', () => {
  assert.deepEqual(routing.buildHardenConfig([], null, {
    enabled: true,
    models: [
      { id: 'model-a', displayName: 'Model A', ownedBy: 'provider', createdAt: '2026-10-10T12:00:00Z' },
      { id: 'model-b' },
    ],
  }), {
    ModelMapping: { Rules: [] },
    Classifier: { Target: null, Backend: null, ProxyServer: null },
    ModelDiscovery: {
      Enabled: true,
      Models: [
        { Id: 'model-a', DisplayName: 'Model A', OwnedBy: 'provider', CreatedAt: '2026-10-10T12:00:00Z' },
        { Id: 'model-b' },
      ],
    },
  });
});

test('exports model discovery as indexed Compose environment variables', () => {
  assert.deepEqual(routing.buildHardenEnvLines([], null, {
    enabled: false,
    models: [
      { id: 'model-a', displayName: 'Model A', ownedBy: 'provider', createdAt: '2026-10-10T12:00:00Z' },
      { id: 'model-b' },
    ],
  }), [
    '      - Classifier__Target=',
    '      - Classifier__Backend=',
    '      - ModelDiscovery__Enabled=false',
    '      - ModelDiscovery__Models__0__Id=model-a',
    '      - ModelDiscovery__Models__0__DisplayName=Model A',
    '      - ModelDiscovery__Models__0__OwnedBy=provider',
    '      - ModelDiscovery__Models__0__CreatedAt=2026-10-10T12:00:00Z',
    '      - ModelDiscovery__Models__1__Id=model-b',
  ]);
});
