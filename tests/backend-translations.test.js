import assert from 'node:assert/strict';
import test from 'node:test';
import * as BackendTranslations from '../backend-translations.js';
import * as Routing from '../routing.js';

test('backend translation API keeps simple names in the named Admin endpoints', () => {
  const calls = [];
  const api = BackendTranslations.createBackendTranslationApi((method, path, options) => {
    calls.push({ method, path, options });
    return { method, path, options };
  });
  const settings = {
    translateAnthropicToOpenAI: true,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  };
  const name = 'openrouter';

  api.getBackendTranslations();
  api.setBackendTranslation(name, settings);
  api.resetBackendTranslation(name);

  assert.deepEqual(calls, [
    { method: 'GET', path: '/admin/backend-translations', options: undefined },
    {
      method: 'PUT',
      path: '/admin/backend-translations/openrouter',
      options: { body: settings },
    },
    {
      method: 'DELETE',
      path: '/admin/backend-translations/openrouter',
      options: undefined,
    },
  ]);
});

test('backend translation API uses the query fallback for slash, percent, and dot-segment names', () => {
  const calls = [];
  const api = BackendTranslations.createBackendTranslationApi((method, path, options) => {
    calls.push({ method, path, options });
  });
  const settings = {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  };

  api.setBackendTranslation('custom backend/blue', settings);
  api.resetBackendTranslation('custom backend/blue');
  api.setBackendTranslation('literal%backend', settings);
  api.resetBackendTranslation('literal%backend');
  api.setBackendTranslation('.', settings);
  api.resetBackendTranslation('.');
  api.setBackendTranslation('..', settings);
  api.resetBackendTranslation('..');

  assert.deepEqual(calls, [
    { method: 'PUT', path: '/admin/backend-translations?name=custom%20backend%2Fblue', options: { body: settings } },
    { method: 'DELETE', path: '/admin/backend-translations?name=custom%20backend%2Fblue', options: undefined },
    { method: 'PUT', path: '/admin/backend-translations?name=literal%25backend', options: { body: settings } },
    { method: 'DELETE', path: '/admin/backend-translations?name=literal%25backend', options: undefined },
    { method: 'PUT', path: '/admin/backend-translations?name=.', options: { body: settings } },
    { method: 'DELETE', path: '/admin/backend-translations?name=.', options: undefined },
    { method: 'PUT', path: '/admin/backend-translations?name=..', options: { body: settings } },
    { method: 'DELETE', path: '/admin/backend-translations?name=..', options: undefined },
  ]);
});

test('turns a Compose builder error into an empty export and visible error text', () => {
  const result = BackendTranslations.renderHardenOutput(
    'env',
    () => '{"Backends":{}}',
    () => { throw new Error('Backend name cannot safely map to a Compose environment key.'); },
  );

  assert.deepEqual(result, {
    value: '',
    error: 'Backend name cannot safely map to a Compose environment key.',
  });
});

function makeSettings(name, source, patch) {
  return {
    name,
    translateAnthropicToOpenAI: true,
    openAIProtocol: 'ChatCompletions',
    reasoningFormat: 'OpenRouter',
    source,
    ...patch,
  };
}

function createManagerHarness(initialGateway = 'gateway-a') {
  let gatewayId = initialGateway;
  const changes = [];
  const calls = [];
  const responses = {
    get: async () => ({ data: { backends: [] } }),
    set: async (_name, settings) => ({ data: makeSettings(_name, 'runtime', settings) }),
    reset: async () => ({}),
  };
  const api = {
    getBackendTranslations: (...args) => { calls.push(['get', ...args]); return responses.get(...args); },
    setBackendTranslation: (...args) => { calls.push(['set', ...args]); return responses.set(...args); },
    resetBackendTranslation: (...args) => { calls.push(['reset', ...args]); return responses.reset(...args); },
  };
  const manager = BackendTranslations.createBackendTranslationManager({
    api,
    getGatewayId: () => gatewayId,
    normalize: Routing.normalizeBackendTranslationResponse,
    formatError: (error) => error.message,
    onChange: (state, reason) => changes.push({ state, reason }),
  });
  return {
    manager,
    calls,
    changes,
    responses,
    setGatewayId: (value) => { gatewayId = value; },
  };
}

test('loads effective settings and source for every backend returned by the backend list', async () => {
  const harness = createManagerHarness();
  harness.responses.get = async () => ({ data: { backends: [
    makeSettings('openrouter', 'base'),
    makeSettings('lmstudio', 'runtime', { openAIProtocol: 'Responses' }),
  ] } });

  await harness.manager.load(['openrouter', 'lmstudio']);

  const rendered = harness.manager.getState();
  assert.deepEqual(rendered.names, ['openrouter', 'lmstudio']);
  assert.equal(rendered.effective.openrouter.source, 'base');
  assert.equal(rendered.effective.lmstudio.source, 'runtime');
  assert.equal(rendered.effective.lmstudio.openAIProtocol, 'Responses');
  assert.equal(rendered.loading, false);
  assert.equal(rendered.error, null);
});

test('keeps effective settings unchanged until a successful PUT response arrives', async () => {
  const harness = createManagerHarness();
  const initial = makeSettings('openrouter', 'base');
  let finishSave;
  harness.responses.get = async () => ({ data: { backends: [initial] } });
  harness.responses.set = () => new Promise((resolve) => { finishSave = resolve; });
  await harness.manager.load(['openrouter']);

  const updated = {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  };
  const saving = harness.manager.save('openrouter', updated);
  assert.deepEqual(harness.manager.getState().effective.openrouter, initial);
  assert.deepEqual(harness.calls.at(-1), ['set', 'openrouter', updated]);

  finishSave({ data: makeSettings('openrouter', 'runtime', updated) });
  assert.equal(await saving, true);
  assert.deepEqual(harness.manager.getState().effective.openrouter, makeSettings('openrouter', 'runtime', updated));
});

test('preserves effective settings when a backend translation save fails', async () => {
  const harness = createManagerHarness();
  const initial = makeSettings('openrouter', 'base');
  harness.responses.get = async () => ({ data: { backends: [initial] } });
  harness.responses.set = async () => { throw new Error('PUT rejected'); };
  await harness.manager.load(['openrouter']);

  const result = await harness.manager.save('openrouter', {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  });

  assert.equal(result, false);
  assert.deepEqual(harness.manager.getState().effective.openrouter, initial);
  assert.match(harness.manager.getState().error, /PUT rejected/);
});

test('applies a successful PUT that overlaps another backend reset refresh', async () => {
  const harness = createManagerHarness();
  const initial = {
    openrouter: makeSettings('openrouter', 'runtime'),
    lmstudio: makeSettings('lmstudio', 'base'),
  };
  const current = { ...initial };
  let getCount = 0;
  let finishRefresh;
  let finishPut;
  harness.responses.get = () => {
    getCount += 1;
    if (getCount === 1) return Promise.resolve({ data: { backends: Object.values(initial) } });
    const staleSnapshot = [makeSettings('openrouter', 'base'), initial.lmstudio];
    return new Promise((resolve) => { finishRefresh = () => resolve({ data: { backends: staleSnapshot } }); });
  };
  harness.responses.set = (name, settings) => new Promise((resolve) => {
    finishPut = () => {
      current[name] = makeSettings(name, 'runtime', settings);
      resolve({ data: current[name] });
    };
  });
  harness.responses.reset = async (name) => { current[name] = makeSettings(name, 'base'); };
  await harness.manager.load(['openrouter', 'lmstudio']);

  const saving = harness.manager.save('lmstudio', {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  });
  const resetting = harness.manager.reset('openrouter');
  for (let attempt = 0; attempt < 100 && !finishRefresh; attempt += 1) await Promise.resolve();
  assert.equal(typeof finishRefresh, 'function');
  finishPut();
  assert.equal(await saving, true);
  finishRefresh();

  assert.equal(await resetting, true);
  assert.equal(harness.manager.getState().effective.openrouter.source, 'base');
  assert.deepEqual(harness.manager.getState().effective.lmstudio, makeSettings('lmstudio', 'runtime', {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  }));
});

test('applies a successful PUT that overlaps an ordinary effective-settings load', async () => {
  const harness = createManagerHarness();
  let current = makeSettings('openrouter', 'base');
  let getCount = 0;
  let finishRefresh;
  let finishPut;
  harness.responses.get = () => {
    getCount += 1;
    if (getCount === 1) return Promise.resolve({ data: { backends: [current] } });
    const staleSnapshot = current;
    return new Promise((resolve) => { finishRefresh = () => resolve({ data: { backends: [staleSnapshot] } }); });
  };
  harness.responses.set = (name, settings) => new Promise((resolve) => {
    finishPut = () => {
      current = makeSettings(name, 'runtime', settings);
      resolve({ data: current });
    };
  });
  await harness.manager.load(['openrouter']);

  const saving = harness.manager.save('openrouter', {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  });
  const refreshing = harness.manager.load(['openrouter']);
  for (let attempt = 0; attempt < 100 && !finishRefresh; attempt += 1) await Promise.resolve();
  assert.equal(typeof finishRefresh, 'function');
  assert.deepEqual(Array.from(harness.manager.getState().saving), ['openrouter']);
  finishPut();

  assert.equal(await saving, true);
  finishRefresh();
  assert.equal(await refreshing, true);
  assert.deepEqual(harness.manager.getState().effective.openrouter, makeSettings('openrouter', 'runtime', {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  }));
});

test('resets a backend override with DELETE and refreshes the effective base source', async () => {
  const harness = createManagerHarness();
  let current = makeSettings('openrouter', 'runtime', { openAIProtocol: 'Responses' });
  harness.responses.get = async () => ({ data: { backends: [current] } });
  await harness.manager.load(['openrouter']);
  current = makeSettings('openrouter', 'base');

  assert.equal(await harness.manager.reset('openrouter'), true);
  assert.deepEqual(harness.calls.map(([kind]) => kind), ['get', 'reset', 'get']);
  assert.equal(harness.manager.getState().effective.openrouter.source, 'base');
  assert.equal(harness.manager.getState().effective.openrouter.openAIProtocol, 'ChatCompletions');
});

test('completes and refreshes two concurrent resets on separate backend rows', async () => {
  const harness = createManagerHarness();
  const current = {
    openrouter: makeSettings('openrouter', 'runtime', { openAIProtocol: 'Responses' }),
    lmstudio: makeSettings('lmstudio', 'runtime', { reasoningFormat: 'OpenAI' }),
  };
  const pendingDeletes = new Map();
  harness.responses.get = async () => ({ data: { backends: Object.values(current) } });
  harness.responses.reset = (name) => new Promise((resolve) => {
    pendingDeletes.set(name, () => {
      current[name] = makeSettings(name, 'base');
      resolve();
    });
  });
  await harness.manager.load(['openrouter', 'lmstudio']);

  const firstReset = harness.manager.reset('openrouter');
  const secondReset = harness.manager.reset('lmstudio');
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (condition()) return;
      await Promise.resolve();
    }
    assert.fail('Timed out waiting for the expected reset request.');
  };

  await waitFor(() => pendingDeletes.has('openrouter'));
  pendingDeletes.get('openrouter')();
  const firstResult = await firstReset;
  assert.equal(harness.manager.getState().effective.openrouter.source, 'base');
  assert.equal(harness.manager.getState().effective.lmstudio.source, 'runtime');
  assert.deepEqual(Array.from(harness.manager.getState().saving), ['lmstudio']);
  await waitFor(() => pendingDeletes.has('lmstudio'));
  pendingDeletes.get('lmstudio')();
  const secondResult = await secondReset;

  assert.equal(firstResult, true);
  assert.equal(secondResult, true);
  assert.deepEqual(harness.calls.map(([kind, name]) => [kind, name]), [
    ['get', undefined],
    ['reset', 'openrouter'],
    ['get', undefined],
    ['reset', 'lmstudio'],
    ['get', undefined],
  ]);
  assert.equal(harness.manager.getState().effective.openrouter.source, 'base');
  assert.equal(harness.manager.getState().effective.lmstudio.source, 'base');
});

test('explains that a 404 means the gateway predates backend translation support', async () => {
  const harness = createManagerHarness();
  harness.responses.get = async () => {
    const error = new Error('HTTP 404');
    error.status = 404;
    throw error;
  };

  await harness.manager.load(['openrouter']);

  assert.match(harness.manager.getState().error, /older gateway|older backend|upgrade/i);
  assert.equal(Object.keys(harness.manager.getState().effective).length, 0);
});

test('does not label a backend-list 404 as a translation compatibility failure', () => {
  const harness = createManagerHarness();
  const error = Object.assign(new Error('HTTP 404'), { name: 'ApiError', status: 404 });

  harness.manager.setUnavailable(error, [], 'gateway-a');

  assert.equal(harness.manager.getState().error, 'HTTP 404');
  assert.doesNotMatch(harness.manager.getState().error, /upgrade|translation support/i);
});

test('ignores a stale translation response after the active gateway changes', async () => {
  const harness = createManagerHarness('gateway-a');
  let finishLoad;
  harness.responses.get = () => new Promise((resolve) => { finishLoad = resolve; });
  const oldGatewayLoad = harness.manager.load(['openrouter'], 'gateway-a');
  harness.setGatewayId('gateway-b');
  harness.manager.beginGateway('gateway-b');

  finishLoad({ data: { backends: [makeSettings('openrouter', 'runtime')] } });
  await oldGatewayLoad;

  assert.equal(harness.manager.getState().gatewayId, 'gateway-b');
  assert.deepEqual(harness.manager.getState().names, []);
  assert.deepEqual(Object.keys(harness.manager.getState().effective), []);
});

test('cancels a reset refresh after switching gateways without applying stale settings', async () => {
  const harness = createManagerHarness('gateway-a');
  let finishDelete;
  harness.responses.get = async () => ({ data: { backends: [makeSettings('openrouter', 'runtime')] } });
  harness.responses.reset = () => new Promise((resolve) => { finishDelete = resolve; });
  await harness.manager.load(['openrouter'], 'gateway-a');

  const resetting = harness.manager.reset('openrouter');
  for (let attempt = 0; attempt < 100 && !finishDelete; attempt += 1) await Promise.resolve();
  assert.equal(typeof finishDelete, 'function');
  harness.setGatewayId('gateway-b');
  harness.manager.beginGateway('gateway-b');
  finishDelete();

  assert.equal(await resetting, false);
  assert.equal(harness.manager.getState().gatewayId, 'gateway-b');
  assert.deepEqual(Object.keys(harness.manager.getState().effective), []);
  assert.deepEqual(harness.calls.map(([kind]) => kind), ['get', 'reset']);
});

test('does not let a canceled reset block a new selection of its previous gateway', async () => {
  const harness = createManagerHarness('gateway-a');
  let current = makeSettings('openrouter', 'runtime');
  const finishDeletes = [];
  harness.responses.get = async () => ({ data: { backends: [current] } });
  harness.responses.reset = () => new Promise((resolve) => finishDeletes.push(() => {
    current = makeSettings('openrouter', 'base');
    resolve();
  }));
  await harness.manager.load(['openrouter'], 'gateway-a');

  const canceledReset = harness.manager.reset('openrouter');
  for (let attempt = 0; attempt < 100 && finishDeletes.length < 1; attempt += 1) await Promise.resolve();
  harness.setGatewayId('gateway-b');
  harness.manager.beginGateway('gateway-b');
  harness.setGatewayId('gateway-a');
  harness.manager.beginGateway('gateway-a');
  await harness.manager.load(['openrouter'], 'gateway-a');

  const activeReset = harness.manager.reset('openrouter');
  for (let attempt = 0; attempt < 100 && finishDeletes.length < 2; attempt += 1) await Promise.resolve();
  assert.equal(finishDeletes.length, 2);
  finishDeletes[1]();
  assert.equal(await activeReset, true);
  finishDeletes[0]();

  assert.equal(await canceledReset, false);
  assert.equal(harness.manager.getState().gatewayId, 'gateway-a');
  assert.equal(harness.manager.getState().effective.openrouter.source, 'base');
});

test('refuses an incomplete effective settings response instead of inventing a backend row', async () => {
  const harness = createManagerHarness();
  harness.responses.get = async () => ({ data: { backends: [makeSettings('openrouter', 'base')] } });

  assert.equal(await harness.manager.load(['openrouter', 'lmstudio']), false);
  assert.match(harness.manager.getState().error, /missing configured backend "lmstudio"/i);
  assert.deepEqual(Object.keys(harness.manager.getState().effective), []);
});

test('ignores a save response that arrives after switching gateways', async () => {
  const harness = createManagerHarness('gateway-a');
  let finishSave;
  harness.responses.get = async () => ({ data: { backends: [makeSettings('openrouter', 'base')] } });
  harness.responses.set = () => new Promise((resolve) => { finishSave = resolve; });
  await harness.manager.load(['openrouter'], 'gateway-a');

  const saving = harness.manager.save('openrouter', {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  });
  harness.setGatewayId('gateway-b');
  harness.manager.beginGateway('gateway-b');
  finishSave({ data: makeSettings('openrouter', 'runtime', {
    translateAnthropicToOpenAI: false,
    openAIProtocol: 'Responses',
    reasoningFormat: 'OpenAI',
  }) });

  assert.equal(await saving, false);
  assert.equal(harness.manager.getState().gatewayId, 'gateway-b');
  assert.deepEqual(Object.keys(harness.manager.getState().effective), []);
});
