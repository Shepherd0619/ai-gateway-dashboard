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

function buildHardenConfig(rules, classifier, modelDiscovery) {
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

function collectProxyNames(rules, classifier) {
  var names = [];
  (rules || []).forEach(function (rule) {
    var proxy = normalizeRule(rule).proxyServer;
    if (proxy && names.indexOf(proxy) === -1) names.push(proxy);
  });
  var normalizedClassifier = normalizeClassifier(classifier);
  if (normalizedClassifier && normalizedClassifier.proxyServer && names.indexOf(normalizedClassifier.proxyServer) === -1) {
    names.push(normalizedClassifier.proxyServer);
  }
  return names;
}

function buildHardenEnvLines(rules, classifier, modelDiscovery) {
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
  return lines;
}

export {
  normalizeRule,
  normalizeClassifier,
  buildMappingPatch,
  buildClassifierPut,
  buildHardenConfig,
  normalizeBackendNames,
  collectBackendNames,
  collectProxyNames,
  buildHardenEnvLines,
};
