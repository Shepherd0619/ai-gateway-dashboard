import test from 'node:test';
import assert from 'node:assert/strict';
import * as routing from '../routing.js';

test('moves a proxy up one priority while preserving the other entries', () => {
  assert.deepEqual(routing.moveProxyServer(['us-exit', 'eu-exit', 'ap-exit'], 1, -1), [
    'eu-exit', 'us-exit', 'ap-exit',
  ]);
});

test('moves a proxy down one priority while preserving the other entries', () => {
  assert.deepEqual(routing.moveProxyServer(['us-exit', 'eu-exit', 'ap-exit'], 1, 1), [
    'us-exit', 'ap-exit', 'eu-exit',
  ]);
});

test('does not move a proxy beyond the ends of the priority list', () => {
  assert.deepEqual(routing.moveProxyServer(['us-exit', 'eu-exit'], 0, -1), ['us-exit', 'eu-exit']);
  assert.deepEqual(routing.moveProxyServer(['us-exit', 'eu-exit'], 1, 1), ['us-exit', 'eu-exit']);
});

test('removes a proxy without changing the order of the remaining entries', () => {
  assert.deepEqual(routing.removeProxyServerAt(['us-exit', 'eu-exit', 'ap-exit'], 1), [
    'us-exit', 'ap-exit',
  ]);
});

test('normalizes a mapping with an omitted backend to openrouter', () => {
  assert.deepEqual(routing.normalizeRule({ prefix: 'claude', target: '', proxyServers: null }), {
    prefix: 'claude', target: '', backend: 'openrouter', proxyServers: null,
  });
});

test('builds a mapping PATCH without putting backend in target', () => {
  assert.deepEqual(routing.buildMappingPatch({ target: 'local-model', backend: 'lmstudio', proxyServers: null }), {
    target: 'local-model', backend: 'lmstudio', proxyServers: null,
  });
});

test('builds an independent classifier PUT with Target, not TargetModel', () => {
  const body = routing.buildClassifierPut({ target: 'local-classifier', backend: 'lmstudio', proxyServers: ['us-exit', 'eu-exit'] });
  assert.deepEqual(body, { target: 'local-classifier', backend: 'lmstudio', proxyServers: ['us-exit', 'eu-exit'] });
  assert.equal(JSON.stringify(body).includes('TargetModel'), false);
});

test('normalizes ordered camelCase and PascalCase proxy arrays', () => {
  assert.deepEqual(routing.normalizeRule({ proxyServers: ['us-exit', 'eu-exit'] }).proxyServers, ['us-exit', 'eu-exit']);
  assert.deepEqual(routing.normalizeRule({ ProxyServers: ['eu-exit', 'us-exit'] }).proxyServers, ['eu-exit', 'us-exit']);
  assert.deepEqual(routing.normalizeClassifier({ proxyServers: ['us-exit', 'eu-exit'] }).proxyServers, ['us-exit', 'eu-exit']);
  assert.deepEqual(routing.normalizeClassifier({ ProxyServers: ['eu-exit', 'us-exit'] }).proxyServers, ['eu-exit', 'us-exit']);
});

test('reads legacy scalar proxy values as zero or one proxy', () => {
  assert.deepEqual(routing.normalizeRule({ proxyServer: 'corp' }).proxyServers, ['corp']);
  assert.deepEqual(routing.normalizeClassifier({ proxyServer: 'corp' }).proxyServers, ['corp']);
  assert.deepEqual(routing.normalizeRule({ proxyServer: '' }).proxyServers, []);
  assert.deepEqual(routing.normalizeClassifier({ proxyServer: '' }).proxyServers, []);
});

test('keeps mapping null distinct from an explicit empty proxy array', () => {
  assert.equal(routing.normalizeRule({}).proxyServers, null);
  assert.equal(routing.normalizeRule({ proxyServers: null }).proxyServers, null);
  assert.deepEqual(routing.normalizeRule({ proxyServers: [] }).proxyServers, []);
  assert.deepEqual(routing.buildMappingPatch({ target: 'model', backend: 'lmstudio', proxyServers: [] }), {
    target: 'model', backend: 'lmstudio', proxyServers: [],
  });
});

test('writes only ordered proxyServers arrays in new route requests', () => {
  assert.deepEqual(routing.buildMappingPatch({ target: 'model', backend: 'lmstudio', proxyServers: ['us-exit', 'eu-exit'] }), {
    target: 'model', backend: 'lmstudio', proxyServers: ['us-exit', 'eu-exit'],
  });
  assert.deepEqual(routing.buildClassifierPut({ target: 'classifier', backend: 'lmstudio', proxyServers: [] }), {
    target: 'classifier', backend: 'lmstudio', proxyServers: [],
  });
});

test('exports an explicit direct proxy override as an empty array', () => {
  assert.deepEqual(routing.buildHardenConfig([
    { prefix: 'claude', target: 'model', backend: 'lmstudio', proxyServers: [] },
  ], { target: 'classifier', backend: 'lmstudio', proxyServers: [] }), {
    ModelMapping: { Rules: [{ Prefix: 'claude', Target: 'model', Backend: 'lmstudio', ProxyServers: null, ProxyServer: '' }] },
    Classifier: { Target: 'classifier', Backend: 'lmstudio', ProxyServers: [] },
  });
});


test('disabling classifier preserves its saved proxy list', () => {
  assert.deepEqual(routing.buildClassifierPut({ target: '', backend: 'lmstudio', proxyServers: ['us-exit', 'eu-exit'] }), {
    target: null, backend: null, proxyServers: ['us-exit', 'eu-exit'],
  });
});

test('exports backend and independent classifier route', () => {
  const output = routing.buildHardenConfig([
    { prefix: 'claude-local', target: 'local-model', backend: 'lmstudio', proxyServers: null },
  ], { target: 'local-classifier', backend: 'lmstudio', proxyServers: ['corp', 'edge'] });
  assert.deepEqual(output, {
    ModelMapping: { Rules: [{ Prefix: 'claude-local', Target: 'local-model', Backend: 'lmstudio', ProxyServers: null }] },
    Classifier: { Target: 'local-classifier', Backend: 'lmstudio', ProxyServers: ['corp', 'edge'] },
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
  assert.deepEqual(routing.collectProxyNames([{ proxyServers: ['corp', 'west'] }], { proxyServers: ['edge', 'west'] }), [
    'corp', 'west', 'edge',
  ]);
});

test('collects proxy choices when some mapping rules inherit the proxy list', () => {
  assert.deepEqual(routing.collectProxyNames([
    { proxyServers: null },
    { proxyServers: ['us-exit', 'eu-exit'] },
  ]), ['us-exit', 'eu-exit']);
});

test('includes configured proxies that are not referenced by a route', () => {
  assert.deepEqual(routing.collectProxyNames(
    [{ proxyServers: ['us-exit'] }],
    null,
    ['us-exit', 'us-exit-aliyun'],
  ), ['us-exit', 'us-exit-aliyun']);
});

test('exports ordered Compose proxy variables without conflating inherited and direct states', () => {
  assert.deepEqual(routing.buildHardenEnvLines([
    { prefix: 'inherit', target: 'model-a', backend: 'openrouter', proxyServers: null },
    { prefix: 'direct', target: 'model-b', backend: 'openrouter', proxyServers: [] },
    { prefix: 'named', target: 'model-c', backend: 'openrouter', proxyServers: ['us-exit', 'eu-exit'] },
  ], { target: 'classifier', backend: 'openrouter', proxyServers: ['classifier-exit', 'backup-exit'] }), [
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
    '      - ModelMapping__Rules__2__ProxyServers__0=us-exit',
    '      - ModelMapping__Rules__2__ProxyServers__1=eu-exit',
    '      - Classifier__Target=classifier',
    '      - Classifier__Backend=openrouter',
    '      - Classifier__ProxyServers__0=classifier-exit',
    '      - Classifier__ProxyServers__1=backup-exit',
  ]);
});

test('exports an empty classifier proxy list as a bare environment key', () => {
  assert.deepEqual(routing.buildHardenEnvLines([], { target: 'classifier', backend: 'openrouter', proxyServers: [] }), [
    '      - Classifier__Target=classifier',
    '      - Classifier__Backend=openrouter',
    '      - Classifier__ProxyServers=',
  ]);
});

test('preserves disabled classifier target and backend in Compose env', () => {
  assert.deepEqual(routing.buildHardenEnvLines([], { target: null, backend: null, proxyServers: [] }), [
    '      - Classifier__Target=',
    '      - Classifier__Backend=',
    '      - Classifier__ProxyServers=',
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
    Classifier: { Target: null, Backend: null, ProxyServers: [] },
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
    '      - Classifier__ProxyServers=',
    '      - ModelDiscovery__Enabled=false',
    '      - ModelDiscovery__Models__0__Id=model-a',
    '      - ModelDiscovery__Models__0__DisplayName=Model A',
    '      - ModelDiscovery__Models__0__OwnedBy=provider',
    '      - ModelDiscovery__Models__0__CreatedAt=2026-10-10T12:00:00Z',
    '      - ModelDiscovery__Models__1__Id=model-b',
  ]);
});

test('normalizes multiple backend translation settings and preserves their sources', () => {
  assert.deepEqual(routing.normalizeBackendTranslationResponse({ backends: [
    {
      name: 'openrouter',
      translateAnthropicToOpenAI: true,
      openAIProtocol: 'ChatCompletions',
      reasoningFormat: 'OpenRouter',
      source: 'base',
    },
    {
      Name: 'lmstudio',
      TranslateAnthropicToOpenAI: false,
      OpenAIProtocol: 'Responses',
      ReasoningFormat: 'OpenAI',
      Source: 'runtime',
    },
  ] }), {
    openrouter: {
      name: 'openrouter',
      translateAnthropicToOpenAI: true,
      openAIProtocol: 'ChatCompletions',
      reasoningFormat: 'OpenRouter',
      source: 'base',
    },
    lmstudio: {
      name: 'lmstudio',
      translateAnthropicToOpenAI: false,
      openAIProtocol: 'Responses',
      reasoningFormat: 'OpenAI',
      source: 'runtime',
    },
  });
});

test('normalizes an empty backend translation response to an empty map', () => {
  assert.deepEqual(routing.normalizeBackendTranslationResponse({ backends: [] }), {});
});

test('preserves arbitrary configured backend names through normalization and JSON export', () => {
  const name = ' Vendor / East: Production ';
  const translations = routing.normalizeBackendTranslationResponse({ backends: [{
    name,
    translateAnthropicToOpenAI: true,
    openAIProtocol: 'ChatCompletions',
    reasoningFormat: 'OpenRouter',
    source: 'base',
  }] });
  assert.equal(translations[name].name, name);
  const backends = routing.buildHardenConfig([], null, undefined, translations).Backends;
  assert.equal(Object.hasOwn(backends, name), true);
  assert.deepEqual(backends[name], {
    TranslateAnthropicToOpenAI: true,
    OpenAIProtocol: 'ChatCompletions',
    ReasoningFormat: 'OpenRouter',
  });
});

test('preserves special object-property backend names in normalization and JSON export', () => {
  const translations = routing.normalizeBackendTranslationResponse({ backends: [{
    name: '__proto__',
    translateAnthropicToOpenAI: true,
    openAIProtocol: 'ChatCompletions',
    reasoningFormat: 'OpenRouter',
    source: 'base',
  }] });
  assert.equal(Object.hasOwn(translations, '__proto__'), true);
  const backends = routing.buildHardenConfig([], null, undefined, translations).Backends;
  assert.equal(Object.hasOwn(backends, '__proto__'), true);
  assert.deepEqual(backends.__proto__, {
    TranslateAnthropicToOpenAI: true,
    OpenAIProtocol: 'ChatCompletions',
    ReasoningFormat: 'OpenRouter',
  });
});

test('rejects duplicate backend translation names case-insensitively', () => {
  const settings = {
    translateAnthropicToOpenAI: true,
    openAIProtocol: 'ChatCompletions',
    reasoningFormat: 'OpenRouter',
    source: 'base',
  };
  assert.throws(() => routing.normalizeBackendTranslationResponse({ backends: [
    { ...settings, name: 'OpenRouter' },
    { ...settings, name: 'openrouter' },
  ] }), /duplicate.*backend.*name/i);
});

test('rejects unsafe backend names only when building Compose environment keys', () => {
  for (const name of ['backend__nested', 'backend\nother', 'backend.name', 'backend-name']) {
    const translations = routing.normalizeBackendTranslationResponse({ backends: [{
      name,
      translateAnthropicToOpenAI: true,
      openAIProtocol: 'ChatCompletions',
      reasoningFormat: 'OpenRouter',
      source: 'base',
    }] });
    assert.throws(
      () => routing.buildHardenEnvLines([], null, undefined, translations),
      /Compose.*environment.*key/i,
    );
  }
});

test('rejects invalid backend translation response shapes with a useful error', () => {
  for (const response of [null, [], {}, { backends: {} }]) {
    assert.throws(
      () => routing.normalizeBackendTranslationResponse(response),
      /backends.*array/i,
    );
  }
});

test('rejects missing or invalid backend translation names', () => {
  for (const backend of [
    { translateAnthropicToOpenAI: true, openAIProtocol: 'ChatCompletions', reasoningFormat: 'OpenRouter', source: 'base' },
    { name: '', translateAnthropicToOpenAI: true, openAIProtocol: 'ChatCompletions', reasoningFormat: 'OpenRouter', source: 'base' },
    { name: '  ', translateAnthropicToOpenAI: true, openAIProtocol: 'ChatCompletions', reasoningFormat: 'OpenRouter', source: 'base' },
    { name: null, translateAnthropicToOpenAI: true, openAIProtocol: 'ChatCompletions', reasoningFormat: 'OpenRouter', source: 'base' },
    { name: 7, translateAnthropicToOpenAI: true, openAIProtocol: 'ChatCompletions', reasoningFormat: 'OpenRouter', source: 'base' },
  ]) {
    assert.throws(() => routing.normalizeBackendTranslationResponse({ backends: [backend] }), /backend.*name/i);
  }
});

test('rejects non-boolean backend translation enabled values', () => {
  assert.throws(() => routing.normalizeBackendTranslationResponse({ backends: [{
    name: 'openrouter', translateAnthropicToOpenAI: 'true', openAIProtocol: 'ChatCompletions',
    reasoningFormat: 'OpenRouter', source: 'base',
  }] }), /translateAnthropicToOpenAI.*boolean/i);
});

test('rejects unsupported backend translation protocol and reasoning formats', () => {
  const backend = {
    name: 'openrouter', translateAnthropicToOpenAI: true, openAIProtocol: 'ChatCompletions',
    reasoningFormat: 'OpenRouter', source: 'base',
  };
  assert.throws(() => routing.normalizeBackendTranslationResponse({ backends: [{
    ...backend, openAIProtocol: 'LegacyCompletions',
  }] }), /openAIProtocol.*ChatCompletions.*Responses/i);
  assert.throws(() => routing.normalizeBackendTranslationResponse({ backends: [{
    ...backend, reasoningFormat: 'Unknown',
  }] }), /reasoningFormat.*OpenAI.*OpenRouter/i);
});

test('rejects unsupported backend translation sources', () => {
  assert.throws(() => routing.normalizeBackendTranslationResponse({ backends: [{
    name: 'openrouter', translateAnthropicToOpenAI: true, openAIProtocol: 'ChatCompletions',
    reasoningFormat: 'OpenRouter', source: 'other',
  }] }), /source.*base.*runtime/i);
});

test('exports only approved backend translation fields in Harden JSON', () => {
  const backendTranslations = {
    openrouter: {
      name: 'openrouter',
      translateAnthropicToOpenAI: true,
      openAIProtocol: 'ChatCompletions',
      reasoningFormat: 'OpenRouter',
      source: 'base',
      baseUrl: 'https://private.example/v1',
      apiKey: 'never-export-this',
    },
  };
  const output = routing.buildHardenConfig([], null, undefined, backendTranslations);
  assert.deepEqual(output, {
    ModelMapping: { Rules: [] },
    Classifier: { Target: null, Backend: null, ProxyServers: [] },
    Backends: {
      openrouter: {
        TranslateAnthropicToOpenAI: true,
        OpenAIProtocol: 'ChatCompletions',
        ReasoningFormat: 'OpenRouter',
      },
    },
  });
  assert.equal(JSON.stringify(output).includes('BaseUrl'), false);
  assert.equal(JSON.stringify(output).includes('https://private.example/v1'), false);
  assert.equal(JSON.stringify(output).includes('never-export-this'), false);
});

test('exports only approved backend translation fields in Compose env', () => {
  const backendTranslations = {
    openrouter: {
      name: 'openrouter',
      translateAnthropicToOpenAI: true,
      openAIProtocol: 'ChatCompletions',
      reasoningFormat: 'OpenRouter',
      source: 'base',
      baseUrl: 'https://private.example/v1',
      apiKey: 'never-export-this',
    },
  };
  const output = routing.buildHardenEnvLines([], null, undefined, backendTranslations);
  assert.deepEqual(output, [
    '      - Classifier__Target=',
    '      - Classifier__Backend=',
    '      - Classifier__ProxyServers=',
    '      - Backends__openrouter__TranslateAnthropicToOpenAI=true',
    '      - Backends__openrouter__OpenAIProtocol=ChatCompletions',
    '      - Backends__openrouter__ReasoningFormat=OpenRouter',
  ]);
  assert.equal(output.join('\n').includes('BaseUrl'), false);
  assert.equal(output.join('\n').includes('https://private.example/v1'), false);
  assert.equal(output.join('\n').includes('never-export-this'), false);
});

test('omitting backend translations keeps previous Harden export shapes unchanged', () => {
  assert.deepEqual(routing.buildHardenConfig([], null), {
    ModelMapping: { Rules: [] },
    Classifier: { Target: null, Backend: null, ProxyServers: [] },
  });
  assert.deepEqual(routing.buildHardenEnvLines([], null), [
    '      - Classifier__Target=',
    '      - Classifier__Backend=',
    '      - Classifier__ProxyServers=',
  ]);
});
