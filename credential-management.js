const BACKEND_CREDENTIAL_SOURCES = new Set(['configuration', 'runtime', 'none']);
const GATEWAY_KEY_FIELDS = [
  'id', 'name', 'createdAt', 'expiresAt', 'revokedAt', 'lastUsedAt', 'lastUsedIp',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function isOptionalIsoDate(value) {
  return value === null || isIsoDate(value);
}

function endpointForBackend(name) {
  const encoded = encodeURIComponent(name);
  return /[/%]/.test(name) || name === '.' || name === '..'
    ? '/admin/backend-credentials?name=' + encoded
    : '/admin/backend-credentials/' + encoded;
}

export function createCredentialApi(request) {
  return {
    getBackendCredentials: () => request('GET', '/admin/backend-credentials'),
    setBackendCredential: (name, apiKey) => request('PUT', endpointForBackend(name), { body: { apiKey } }),
    resetBackendCredential: (name) => request('DELETE', endpointForBackend(name)),
    listGatewayKeys: (limit = 50, offset = 0) =>
      request('GET', '/admin/gateway-keys?limit=' + encodeURIComponent(limit) + '&offset=' + encodeURIComponent(offset)),
    issueGatewayKey: (name, expiresAt = null) =>
      request('POST', '/admin/gateway-keys', { body: { name, expiresAt } }),
    revokeGatewayKey: (id) =>
      request('POST', '/admin/gateway-keys/' + encodeURIComponent(id) + '/revoke'),
  };
}

export function normalizeBackendCredentialsResponse(data) {
  if (!isRecord(data) || !Array.isArray(data.backends)) {
    throw new Error('The gateway returned an invalid backend credential response.');
  }
  const names = new Set();
  const backends = data.backends.map((backend) => {
    if (!isRecord(backend) || typeof backend.name !== 'string' || !backend.name.trim() ||
        typeof backend.configured !== 'boolean' || !BACKEND_CREDENTIAL_SOURCES.has(backend.source) ||
        names.has(backend.name.toLowerCase())) {
      throw new Error('The gateway returned an invalid backend credential entry.');
    }
    names.add(backend.name.toLowerCase());
    return { name: backend.name, configured: backend.configured, source: backend.source };
  });
  return { backends };
}

function normalizeGatewayKey(key) {
  if (!isRecord(key) || typeof key.id !== 'string' || !key.id ||
      typeof key.name !== 'string' || !key.name || !isIsoDate(key.createdAt) ||
      !isOptionalIsoDate(key.expiresAt) || !isOptionalIsoDate(key.revokedAt) ||
      !isOptionalIsoDate(key.lastUsedAt) ||
      !(key.lastUsedIp === null || typeof key.lastUsedIp === 'string')) {
    throw new Error('The gateway returned an invalid gateway key entry.');
  }
  return Object.fromEntries(GATEWAY_KEY_FIELDS.map((field) => [field, key[field]]));
}

export function normalizeGatewayKeysResponse(data) {
  if (!isRecord(data) || !Array.isArray(data.keys) ||
      !Number.isInteger(data.limit) || data.limit < 1 || data.limit > 100 ||
      !Number.isInteger(data.offset) || data.offset < 0) {
    throw new Error('The gateway returned an invalid gateway key response.');
  }
  return { keys: data.keys.map(normalizeGatewayKey), limit: data.limit, offset: data.offset };
}

export function getGatewayKeyStatus(key, now = Date.now()) {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && Date.parse(key.expiresAt) <= Number(now)) return 'expired';
  return 'active';
}

export function formatGatewayKeyError(error) {
  if (error && error.status === 404) {
    return 'Gateway Key management is disabled or unavailable on this gateway. Check GatewayKeys:Enabled.';
  }
  if (error && error.status === 503) {
    return 'Gateway Key storage is unavailable. Check the gateway database configuration and retry.';
  }
  return (error && error.message) || 'Gateway Key request failed.';
}

export function createCredentialManager(options) {
  const api = options.api;
  const getGatewayId = options.getGatewayId;
  const onChange = options.onChange || (() => {});
  let providerGeneration = 0;
  let keyGeneration = 0;
  let state = createState(getGatewayId());

  function createState(gatewayId) {
    return {
      gatewayId: gatewayId || null,
      backends: [],
      keys: [],
      limit: 50,
      offset: 0,
      providersLoading: false,
      keysLoading: false,
      providerBusy: null,
      keyBusy: null,
      providersError: null,
      keysError: null,
      issuedApiKey: null,
    };
  }

  function snapshot() {
    return {
      ...state,
      backends: state.backends.map((backend) => ({ ...backend })),
      keys: state.keys.map((key) => ({ ...key })),
    };
  }

  function publish(reason) {
    onChange(snapshot(), reason);
  }

  function syncGateway() {
    const selected = getGatewayId() || null;
    if (selected !== state.gatewayId) gatewayChanged();
    return selected;
  }

  function isCurrent(gatewayId, generation, kind) {
    return gatewayId === state.gatewayId && gatewayId === (getGatewayId() || null) &&
      generation === (kind === 'provider' ? providerGeneration : keyGeneration);
  }

  function getState() {
    return snapshot();
  }

  function gatewayChanged() {
    providerGeneration += 1;
    keyGeneration += 1;
    state = createState(getGatewayId());
    publish('gateway');
  }

  async function loadProviders() {
    const gatewayId = syncGateway();
    if (!gatewayId) return false;
    const generation = ++providerGeneration;
    state.providersLoading = true;
    state.providersError = null;
    publish('providers-loading');
    try {
      const response = await api.getBackendCredentials();
      if (!isCurrent(gatewayId, generation, 'provider')) return false;
      state.backends = normalizeBackendCredentialsResponse(response && response.data).backends;
      state.providersLoading = false;
      state.providersError = null;
      publish('providers-loaded');
      return true;
    } catch (error) {
      if (!isCurrent(gatewayId, generation, 'provider')) return false;
      state.providersLoading = false;
      state.providersError = (error && error.message) || 'Unable to load provider credentials.';
      publish('providers-error');
      return false;
    }
  }

  async function loadKeys(offset = state.offset) {
    const gatewayId = syncGateway();
    if (!gatewayId) return false;
    if (!Number.isInteger(offset) || offset < 0) {
      state.keysError = 'Invalid Gateway Key page.';
      publish('keys-error');
      return false;
    }
    const generation = ++keyGeneration;
    state.keysLoading = true;
    state.keysError = null;
    state.offset = offset;
    publish('keys-loading');
    try {
      const response = await api.listGatewayKeys(state.limit, offset);
      if (!isCurrent(gatewayId, generation, 'key')) return false;
      const page = normalizeGatewayKeysResponse(response && response.data);
      state.keys = page.keys;
      state.limit = page.limit;
      state.offset = page.offset;
      state.keysLoading = false;
      state.keysError = null;
      publish('keys-loaded');
      return true;
    } catch (error) {
      if (!isCurrent(gatewayId, generation, 'key')) return false;
      state.keysLoading = false;
      state.keysError = formatGatewayKeyError(error);
      publish('keys-error');
      return false;
    }
  }

  async function updateProvider(name, operation) {
    const gatewayId = syncGateway();
    if (!gatewayId) return false;
    const generation = ++providerGeneration;
    state.providerBusy = name;
    state.providersError = null;
    publish('provider-saving');
    try {
      await operation();
      if (!isCurrent(gatewayId, generation, 'provider')) return false;
      state.providerBusy = null;
      publish('provider-saved');
      await loadProviders();
      return true;
    } catch (error) {
      if (!isCurrent(gatewayId, generation, 'provider')) return false;
      state.providerBusy = null;
      state.providersError = (error && error.message) || 'Unable to update provider credentials.';
      publish('provider-error');
      return false;
    }
  }

  function saveProviderCredential(name, apiKey) {
    return updateProvider(name, () => api.setBackendCredential(name, apiKey));
  }

  function resetProviderCredential(name) {
    return updateProvider(name, () => api.resetBackendCredential(name));
  }

  async function issueGatewayKey(name, expiresAt = null) {
    const gatewayId = syncGateway();
    if (!gatewayId) return false;
    const generation = ++keyGeneration;
    state.keyBusy = 'issue';
    state.keysError = null;
    publish('key-issuing');
    try {
      const response = await api.issueGatewayKey(name, expiresAt);
      if (!isCurrent(gatewayId, generation, 'key')) return false;
      const apiKey = response && response.data && response.data.apiKey;
      if (typeof apiKey !== 'string' || !apiKey) throw new Error('The gateway did not return the newly issued key.');
      state.issuedApiKey = apiKey;
      state.keyBusy = null;
      publish('key-issued');
      await loadKeys(state.offset);
      return true;
    } catch (error) {
      if (!isCurrent(gatewayId, generation, 'key')) return false;
      state.keyBusy = null;
      state.keysError = formatGatewayKeyError(error);
      publish('key-issue-error');
      return false;
    }
  }

  async function revokeGatewayKey(id) {
    const gatewayId = syncGateway();
    if (!gatewayId) return false;
    const generation = ++keyGeneration;
    state.keyBusy = id;
    state.keysError = null;
    publish('key-revoking');
    try {
      await api.revokeGatewayKey(id);
      if (!isCurrent(gatewayId, generation, 'key')) return false;
      state.keyBusy = null;
      publish('key-revoked');
      await loadKeys(state.offset);
      return true;
    } catch (error) {
      if (!isCurrent(gatewayId, generation, 'key')) return false;
      state.keyBusy = null;
      state.keysError = formatGatewayKeyError(error);
      publish('key-revoke-error');
      return false;
    }
  }

  function clearIssuedKey() {
    if (!state.issuedApiKey) return;
    state.issuedApiKey = null;
    publish('issued-key-cleared');
  }

  return {
    getState,
    loadProviders,
    loadKeys,
    saveProviderCredential,
    resetProviderCredential,
    issueGatewayKey,
    revokeGatewayKey,
    clearIssuedKey,
    gatewayChanged,
  };
}
