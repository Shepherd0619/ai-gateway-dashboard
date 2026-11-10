export function createBackendTranslationApi(request) {
  const endpointForName = (name) => /[/%]/.test(name) || name === '.' || name === '..'
    ? '/admin/backend-translations?name=' + encodeURIComponent(name)
    : '/admin/backend-translations/' + encodeURIComponent(name);
  return {
    getBackendTranslations: () => request('GET', '/admin/backend-translations'),
    setBackendTranslation: (name, settings) => request(
      'PUT',
      endpointForName(name),
      { body: settings },
    ),
    resetBackendTranslation: (name) => request(
      'DELETE',
      endpointForName(name),
    ),
  };
}

export function renderHardenOutput(format, buildJson, buildEnv) {
  try {
    const value = format === 'json' ? buildJson() : buildEnv();
    return { value, error: null };
  } catch (error) {
    return {
      value: '',
      error: (error && error.message) || 'Unable to build the selected configuration format.',
    };
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function copyOwnProperties(value) {
  const copy = {};
  Object.keys(value || {}).forEach((key) => {
    Object.defineProperty(copy, key, {
      value: value[key],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  });
  return copy;
}

function copySettings(settings) {
  return {
    translateAnthropicToOpenAI: settings.translateAnthropicToOpenAI,
    openAIProtocol: settings.openAIProtocol,
    reasoningFormat: settings.reasoningFormat,
  };
}

function validateBackendTranslationMap(names, translations) {
  if (!Array.isArray(names)) throw new Error('Configured backend names must be an array.');
  const uniqueNames = new Set();
  names.forEach((name) => {
    if (typeof name !== 'string' || !name) throw new Error('Configured backend names must be non-empty strings.');
    if (uniqueNames.has(name)) throw new Error('Configured backend names contain a duplicate entry.');
    uniqueNames.add(name);
    if (!hasOwn(translations, name)) {
      throw new Error('Backend translation settings are missing configured backend "' + name + '".');
    }
  });
  if (Object.keys(translations).length !== names.length) {
    throw new Error('Backend translation settings do not match the configured backend list.');
  }
  return translations;
}

export function validateBackendTranslationNames(names, translations) {
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
    throw new Error('Normalized backend translation settings must be an object.');
  }
  return validateBackendTranslationMap(names, translations);
}

export function createBackendTranslationManager(options) {
  const api = options.api;
  const getGatewayId = options.getGatewayId;
  const normalize = options.normalize;
  const formatError = options.formatError || ((error) => error.message || 'Request failed.');
  const onChange = options.onChange || (() => {});
  let requestVersion = 0;
  let gatewayGeneration = 0;
  const resetQueues = new Map();
  const resetOperations = new Set();
  const saveOperations = new Set();
  const backendVersions = new Map();
  let state = {
    gatewayId: null,
    names: [],
    effective: {},
    drafts: new Map(),
    saving: new Set(),
    loading: false,
    error: null,
  };

  function snapshot() {
    const saving = new Set(state.saving);
    [resetOperations, saveOperations].forEach((operations) => {
      operations.forEach((operation) => {
        if (operation.gatewayId === state.gatewayId && operation.generation === gatewayGeneration) saving.add(operation.name);
      });
    });
    return {
      gatewayId: state.gatewayId,
      names: state.names.slice(),
      effective: copyOwnProperties(state.effective),
      drafts: new Map(state.drafts),
      saving,
      loading: state.loading,
      error: state.error,
    };
  }

  function publish(reason) {
    onChange(snapshot(), reason);
  }

  function currentRequest(gatewayId, version) {
    return gatewayId === getGatewayId() && gatewayId === state.gatewayId && version === requestVersion;
  }

  function currentGateway(gatewayId, generation) {
    return gatewayId === getGatewayId() && gatewayId === state.gatewayId && generation === gatewayGeneration;
  }

  function hasResetInFlight(name, gatewayId) {
    return Array.from(resetOperations).some((operation) =>
      operation.gatewayId === gatewayId && operation.generation === gatewayGeneration && operation.name === name
    );
  }

  function hasSaveInFlight(name, gatewayId) {
    return Array.from(saveOperations).some((operation) =>
      operation.gatewayId === gatewayId && operation.generation === gatewayGeneration && operation.name === name
    );
  }

  function backendVersion(generation, name) {
    const versions = backendVersions.get(generation);
    return versions ? (versions.get(name) || 0) : 0;
  }

  function bumpBackendVersion(generation, name) {
    let versions = backendVersions.get(generation);
    if (!versions) {
      versions = new Map();
      backendVersions.set(generation, versions);
    }
    versions.set(name, backendVersion(generation, name) + 1);
  }

  function setOwnProperty(target, name, value) {
    Object.defineProperty(target, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  function updateEffectiveBackend(name, settings) {
    const effective = copyOwnProperties(state.effective);
    setOwnProperty(effective, name, settings);
    state.effective = effective;
    state.drafts.set(name, copySettings(settings));
  }

  function mergeMutationsSinceLoad(names, normalized, versionsAtStart, generation) {
    const effective = copyOwnProperties(normalized);
    names.forEach((name) => {
      if (backendVersion(generation, name) !== versionsAtStart.get(name) && hasOwn(state.effective, name)) {
        setOwnProperty(effective, name, state.effective[name]);
      }
    });
    return effective;
  }

  function advanceGatewayGeneration() {
    gatewayGeneration += 1;
    backendVersions.clear();
  }

  function ordinaryErrorMessage(error) {
    if (error && error.name === 'ApiError') return formatError(error);
    return (error && error.message) || formatError(error);
  }

  function errorMessage(error) {
    if (error && error.status === 404) {
      return 'This gateway does not support backend protocol translation settings. Upgrade to a newer gateway version with GET /admin/backend-translations.';
    }
    return ordinaryErrorMessage(error);
  }

  function beginGateway(gatewayId) {
    const selectedGatewayId = gatewayId || null;
    const sameGateway = selectedGatewayId === state.gatewayId;
    requestVersion += 1;
    if (!sameGateway) advanceGatewayGeneration();
    state = {
      gatewayId: selectedGatewayId,
      names: sameGateway ? state.names.slice() : [],
      effective: sameGateway ? copyOwnProperties(state.effective) : {},
      drafts: sameGateway ? new Map(state.drafts) : new Map(),
      saving: new Set(),
      loading: !!gatewayId,
      error: null,
    };
    publish('gateway');
  }

  async function load(names, gatewayId) {
    const selectedGatewayId = gatewayId === undefined ? getGatewayId() : gatewayId;
    if ((selectedGatewayId || null) !== state.gatewayId) advanceGatewayGeneration();
    const generation = gatewayGeneration;
    const version = ++requestVersion;
    const requestedNames = Array.isArray(names) ? names.slice() : [];
    const versionsAtStart = new Map(requestedNames.map((name) => [name, backendVersion(generation, name)]));
    state = {
      gatewayId: selectedGatewayId || null,
      names: requestedNames,
      effective: {},
      drafts: new Map(),
      saving: new Set(),
      loading: !!selectedGatewayId,
      error: null,
    };
    publish('load-start');
    if (!selectedGatewayId) {
      state.loading = false;
      publish('load-empty');
      return false;
    }

    try {
      const response = await api.getBackendTranslations();
      if (!currentRequest(selectedGatewayId, version)) return false;
      const normalized = normalize(response && response.data);
      validateBackendTranslationNames(state.names, normalized);
      state.effective = mergeMutationsSinceLoad(state.names, normalized, versionsAtStart, generation);
      state.names.forEach((name) => state.drafts.set(name, copySettings(state.effective[name])));
      state.loading = false;
      state.error = null;
      publish('loaded');
      return true;
    } catch (error) {
      if (!currentRequest(selectedGatewayId, version)) return false;
      const preserved = {};
      state.names.forEach((name) => {
        if (backendVersion(generation, name) !== versionsAtStart.get(name) && hasOwn(state.effective, name)) {
          setOwnProperty(preserved, name, state.effective[name]);
        }
      });
      state.effective = preserved;
      state.drafts = new Map();
      state.names.forEach((name) => {
        if (hasOwn(preserved, name)) state.drafts.set(name, copySettings(preserved[name]));
      });
      state.loading = false;
      state.error = errorMessage(error);
      publish('load-error');
      return false;
    }
  }

  function setUnavailable(error, names, gatewayId) {
    const selectedGatewayId = gatewayId === undefined ? getGatewayId() : gatewayId;
    requestVersion += 1;
    if ((selectedGatewayId || null) !== state.gatewayId) advanceGatewayGeneration();
    state = {
      gatewayId: selectedGatewayId || null,
      names: Array.isArray(names) ? names.slice() : [],
      effective: {},
      drafts: new Map(),
      saving: new Set(),
      loading: false,
      error: selectedGatewayId ? ordinaryErrorMessage(error) : null,
    };
    publish('load-error');
  }

  function updateDraft(name, settings) {
    if (!hasOwn(state.effective, name) || !settings || typeof settings !== 'object') return false;
    state.drafts.set(name, copySettings(settings));
    return true;
  }

  async function save(name, settings) {
    const gatewayId = state.gatewayId;
    const generation = gatewayGeneration;
    if (!gatewayId || gatewayId !== getGatewayId() || !hasOwn(state.effective, name) || state.saving.has(name) || hasSaveInFlight(name, gatewayId) || hasResetInFlight(name, gatewayId)) return false;
    const operation = { name, gatewayId, generation };
    const payload = copySettings(settings || state.drafts.get(name));
    saveOperations.add(operation);
    state.drafts.set(name, payload);
    state.error = null;
    publish('save-start');

    try {
      const response = await api.setBackendTranslation(name, payload);
      if (!currentGateway(gatewayId, generation)) return false;
      const normalized = normalize({ backends: [response && response.data] });
      if (!hasOwn(normalized, name) || normalized[name].name !== name) {
        throw new Error('The gateway returned settings for a different backend.');
      }
      updateEffectiveBackend(name, normalized[name]);
      bumpBackendVersion(generation, name);
      state.error = null;
      publish('save-success');
      return true;
    } catch (error) {
      if (!currentGateway(gatewayId, generation)) return false;
      state.error = errorMessage(error);
      publish('save-error');
      return false;
    } finally {
      saveOperations.delete(operation);
      if (currentGateway(gatewayId, generation)) publish('save-finished');
    }
  }

  function reset(name) {
    const gatewayId = state.gatewayId;
    if (!gatewayId || gatewayId !== getGatewayId() || !hasOwn(state.effective, name) || state.saving.has(name) || hasSaveInFlight(name, gatewayId) || hasResetInFlight(name, gatewayId)) return Promise.resolve(false);
    const generation = gatewayGeneration;
    const operation = { name, gatewayId, generation, names: state.names.slice() };
    resetOperations.add(operation);
    state.error = null;
    publish('reset-start');

    const execute = async () => {
      if (!currentGateway(gatewayId, generation)) return false;
      try {
        await api.resetBackendTranslation(name);
        if (!currentGateway(gatewayId, generation)) return false;
        bumpBackendVersion(generation, name);
        return await load(operation.names, gatewayId);
      } catch (error) {
        if (!currentGateway(gatewayId, generation)) return false;
        state.error = errorMessage(error);
        publish('reset-error');
        return false;
      }
    };

    const previous = resetQueues.get(generation) || Promise.resolve();
    const task = previous.then(execute, execute);
    const queueTail = task.then(() => undefined, () => undefined);
    resetQueues.set(generation, queueTail);
    queueTail.then(() => {
      if (resetQueues.get(generation) === queueTail) resetQueues.delete(generation);
    });

    return task.finally(() => {
      resetOperations.delete(operation);
      if (currentGateway(gatewayId, generation)) publish('reset-finished');
    });
  }

  return {
    beginGateway,
    load,
    setUnavailable,
    updateDraft,
    save,
    reset,
    getState: snapshot,
  };
}
