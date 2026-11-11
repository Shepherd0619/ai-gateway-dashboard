function valueOf(object, camel, pascal, fallback) {
  if (object && object[camel] !== undefined) return object[camel];
  if (object && object[pascal] !== undefined) return object[pascal];
  return fallback;
}

function normalizeRule(rule) {
  return {
    prefix: valueOf(rule, 'prefix', 'Prefix', ''),
    target: valueOf(rule, 'target', 'Target', ''),
    backend: valueOf(rule, 'backend', 'Backend', 'openrouter') || 'openrouter',
    proxyServer: valueOf(rule, 'proxyServer', 'ProxyServer', null),
  };
}

function normalizeClassifier(config) {
  if (!config) return null;
  return {
    target: valueOf(config, 'target', 'Target', null),
    backend: valueOf(config, 'backend', 'Backend', null),
    proxyServer: valueOf(config, 'proxyServer', 'ProxyServer', null),
    source: valueOf(config, 'source', 'Source', 'base'),
  };
}

function buildMappingPatch(route) {
  return {
    target: route.target || '',
    backend: route.backend || null,
    proxyServer: route.proxyServer == null ? null : route.proxyServer,
  };
}

function buildClassifierPut(route) {
  var target = route.target || null;
  return {
    target: target,
    backend: target ? (route.backend || null) : null,
    proxyServer: target ? (route.proxyServer == null ? null : route.proxyServer) : null,
  };
}

function normalizeModelDiscoveryForExport(modelDiscovery) {
  var source = modelDiscovery && Array.isArray(modelDiscovery.models) ? modelDiscovery.models : [];
  return {
    enabled: !!(modelDiscovery && modelDiscovery.enabled === true),
    models: source.filter(function (model) {
      return model && typeof model.id === 'string' && model.id.trim();
    }).map(function (model) {
      var normalized = { id: model.id.trim() };
      ['displayName', 'ownedBy', 'createdAt'].forEach(function (field) {
        if (typeof model[field] === 'string' && model[field].trim()) normalized[field] = model[field].trim();
      });
      return normalized;
    }),
  };
}

function normalizeBackendTranslation(backend, index, fallbackName) {
  if (!backend || typeof backend !== 'object' || Array.isArray(backend)) {
    throw new Error('Backend translation at index ' + index + ' must be an object.');
  }

  var name = valueOf(backend, 'name', 'Name', fallbackName);
  if (typeof name !== 'string') {
    throw new Error('Backend translation at index ' + index + ' must have a valid backend name.');
  }
  if (name.trim().length === 0) {
    throw new Error('Backend translation at index ' + index + ' must have a non-empty backend name.');
  }

  var translateAnthropicToOpenAI = valueOf(backend, 'translateAnthropicToOpenAI', 'TranslateAnthropicToOpenAI', undefined);
  if (typeof translateAnthropicToOpenAI !== 'boolean') {
    throw new Error('Backend translation for ' + name + ' must set translateAnthropicToOpenAI to a boolean.');
  }

  var openAIProtocol = valueOf(backend, 'openAIProtocol', 'OpenAIProtocol', undefined);
  if (openAIProtocol !== 'ChatCompletions' && openAIProtocol !== 'Responses') {
    throw new Error('Backend translation for ' + name + ' has invalid openAIProtocol; expected ChatCompletions or Responses.');
  }

  var reasoningFormat = valueOf(backend, 'reasoningFormat', 'ReasoningFormat', undefined);
  if (reasoningFormat !== 'OpenAI' && reasoningFormat !== 'OpenRouter') {
    throw new Error('Backend translation for ' + name + ' has invalid reasoningFormat; expected OpenAI or OpenRouter.');
  }

  var source = valueOf(backend, 'source', 'Source', undefined);
  if (source !== 'base' && source !== 'runtime') {
    throw new Error('Backend translation for ' + name + ' has invalid source; expected base or runtime.');
  }

  return {
    name: name,
    translateAnthropicToOpenAI: translateAnthropicToOpenAI,
    openAIProtocol: openAIProtocol,
    reasoningFormat: reasoningFormat,
    source: source,
  };
}

function normalizeBackendTranslationResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Backend translation response must contain a backends array.');
  }
  var backends = valueOf(response, 'backends', 'Backends', undefined);
  if (!Array.isArray(backends)) {
    throw new Error('Backend translation response must contain a backends array.');
  }

  var normalized = {};
  var normalizedNames = new Set();
  backends.forEach(function (backend, index) {
    var settings = normalizeBackendTranslation(backend, index, undefined);
    var nameKey = settings.name.toLowerCase();
    if (normalizedNames.has(nameKey)) {
      throw new Error('Duplicate backend translation name at index ' + index + ' (case-insensitive match).');
    }
    normalizedNames.add(nameKey);
    Object.defineProperty(normalized, settings.name, {
      value: settings,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  });
  return normalized;
}

function normalizeBackendTranslationsForExport(backendTranslations) {
  if (backendTranslations == null) return [];
  if (typeof backendTranslations !== 'object' || Array.isArray(backendTranslations)) {
    throw new Error('Backend translations for export must be an object keyed by backend name.');
  }
  return Object.keys(backendTranslations).map(function (name, index) {
    return normalizeBackendTranslation(backendTranslations[name], index, name);
  });
}

function validateComposeBackendName(name) {
  var envKeyPrefix = 'Backends__' + name + '__';
  var envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (name.indexOf('__') !== -1 || !envKeyPattern.test(envKeyPrefix + 'TranslateAnthropicToOpenAI') ||
      !envKeyPattern.test(envKeyPrefix + 'OpenAIProtocol') || !envKeyPattern.test(envKeyPrefix + 'ReasoningFormat')) {
    throw new Error('Backend name cannot safely map to a Compose environment key (Backends__{name}__...).');
  }
}

function buildHardenConfig(rules, classifier, modelDiscovery, backendTranslations) {
  var catalog = normalizeModelDiscoveryForExport(modelDiscovery);
  var config = {
    ModelMapping: {
      Rules: (rules || []).map(function (rule) {
        var normalized = normalizeRule(rule);
        return {
          Prefix: normalized.prefix,
          Target: normalized.target,
          Backend: normalized.backend,
          ProxyServer: normalized.proxyServer,
        };
      }),
    },
    Classifier: classifier ? {
      Target: classifier.target || null,
      Backend: classifier.backend || null,
      ProxyServer: classifier.proxyServer == null ? null : classifier.proxyServer,
    } : {
      Target: null,
      Backend: null,
      ProxyServer: null,
    },
  };
  if (modelDiscovery !== undefined) {
    config.ModelDiscovery = {
      Enabled: catalog.enabled,
      Models: catalog.models.map(function (model) {
        var exported = { Id: model.id };
        if (model.displayName) exported.DisplayName = model.displayName;
        if (model.ownedBy) exported.OwnedBy = model.ownedBy;
        if (model.createdAt) exported.CreatedAt = model.createdAt;
        return exported;
      }),
    };
  }
  if (backendTranslations !== undefined) {
    config.Backends = {};
    normalizeBackendTranslationsForExport(backendTranslations).forEach(function (backend) {
      Object.defineProperty(config.Backends, backend.name, {
        value: {
          TranslateAnthropicToOpenAI: backend.translateAnthropicToOpenAI,
          OpenAIProtocol: backend.openAIProtocol,
          ReasoningFormat: backend.reasoningFormat,
        },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    });
  }
  return config;
}

function normalizeBackendNames(response) {
  var names = response;
  if (response && !Array.isArray(response)) {
    if (Array.isArray(response.backends)) names = response.backends;
    else if (Array.isArray(response.Backends)) names = response.Backends;
    else if (response.Backends && typeof response.Backends === 'object') names = Object.keys(response.Backends);
    else names = [];
  }
  return Array.isArray(names) ? names.filter(function (name) { return typeof name === 'string' && name; }) : [];
}

function collectBackendNames(rules, classifier, liveBackends) {
  var names = ['openrouter'];
  (liveBackends || []).forEach(function (backend) {
    if (backend && names.indexOf(backend) === -1) names.push(backend);
  });
  (rules || []).forEach(function (rule) {
    var backend = normalizeRule(rule).backend;
    if (backend && names.indexOf(backend) === -1) names.push(backend);
  });
  var normalizedClassifier = normalizeClassifier(classifier);
  if (normalizedClassifier && normalizedClassifier.backend && names.indexOf(normalizedClassifier.backend) === -1) {
    names.push(normalizedClassifier.backend);
  }
  return names;
}

function collectProxyNames(rules, classifier, configuredNames) {
  var names = [];
  function addName(name) {
    if (name && names.indexOf(name) === -1) names.push(name);
  }
  (rules || []).forEach(function (rule) {
    addName(normalizeRule(rule).proxyServer);
  });
  var normalizedClassifier = normalizeClassifier(classifier);
  if (normalizedClassifier) addName(normalizedClassifier.proxyServer);
  (configuredNames || []).forEach(addName);
  return names;
}

function buildHardenEnvLines(rules, classifier, modelDiscovery, backendTranslations) {
  var catalog = normalizeModelDiscoveryForExport(modelDiscovery);
  var lines = [];
  (rules || []).forEach(function (rule, index) {
    var normalized = normalizeRule(rule);
    lines.push('      - ModelMapping__Rules__' + index + '__Prefix=' + normalized.prefix);
    lines.push('      - ModelMapping__Rules__' + index + '__Target=' + normalized.target);
    lines.push('      - ModelMapping__Rules__' + index + '__Backend=' + normalized.backend);
    if (normalized.proxyServer !== null && normalized.proxyServer !== undefined) {
      lines.push('      - ModelMapping__Rules__' + index + '__ProxyServer=' + normalized.proxyServer);
    }
  });
  var normalizedClassifier = normalizeClassifier(classifier) || {};
  lines.push('      - Classifier__Target=' + (normalizedClassifier.target || ''));
  lines.push('      - Classifier__Backend=' + (normalizedClassifier.backend || ''));
  if (normalizedClassifier.proxyServer !== null && normalizedClassifier.proxyServer !== undefined) {
    lines.push('      - Classifier__ProxyServer=' + normalizedClassifier.proxyServer);
  }
  if (modelDiscovery !== undefined) {
    lines.push('      - ModelDiscovery__Enabled=' + catalog.enabled);
    catalog.models.forEach(function (model, index) {
      var prefix = '      - ModelDiscovery__Models__' + index + '__';
      lines.push(prefix + 'Id=' + model.id);
      if (model.displayName) lines.push(prefix + 'DisplayName=' + model.displayName);
      if (model.ownedBy) lines.push(prefix + 'OwnedBy=' + model.ownedBy);
      if (model.createdAt) lines.push(prefix + 'CreatedAt=' + model.createdAt);
    });
  }
  if (backendTranslations !== undefined) {
    normalizeBackendTranslationsForExport(backendTranslations).forEach(function (backend) {
      validateComposeBackendName(backend.name);
      var prefix = '      - Backends__' + backend.name + '__';
      lines.push(prefix + 'TranslateAnthropicToOpenAI=' + backend.translateAnthropicToOpenAI);
      lines.push(prefix + 'OpenAIProtocol=' + backend.openAIProtocol);
      lines.push(prefix + 'ReasoningFormat=' + backend.reasoningFormat);
    });
  }
  return lines;
}

export {
  normalizeRule,
  normalizeClassifier,
  buildMappingPatch,
  buildClassifierPut,
  buildHardenConfig,
  normalizeBackendTranslationResponse,
  normalizeBackendNames,
  collectBackendNames,
  collectProxyNames,
  buildHardenEnvLines,
};
