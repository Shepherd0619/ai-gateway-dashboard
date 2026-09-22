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
    proxyServer: valueOf(rule, 'proxyServer', 'ProxyServer', null) || null,
  };
}

function normalizeClassifier(config) {
  if (!config) return null;
  return {
    target: valueOf(config, 'target', 'Target', null),
    backend: valueOf(config, 'backend', 'Backend', null),
    proxyServer: valueOf(config, 'proxyServer', 'ProxyServer', null) || null,
    source: valueOf(config, 'source', 'Source', 'base'),
  };
}

function buildMappingPatch(route) {
  return {
    target: route.target || '',
    backend: route.backend || null,
    proxyServer: route.proxyServer || null,
  };
}

function buildClassifierPut(route) {
  var target = route.target || null;
  return {
    target: target,
    backend: target ? (route.backend || null) : null,
    proxyServer: target ? (route.proxyServer || null) : null,
  };
}

function buildHardenConfig(rules, classifier) {
  return {
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
      ProxyServer: classifier.proxyServer || null,
    } : {
      Target: null,
      Backend: null,
      ProxyServer: null,
    },
  };
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
  var names = [''];
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

export {
  normalizeRule,
  normalizeClassifier,
  buildMappingPatch,
  buildClassifierPut,
  buildHardenConfig,
  normalizeBackendNames,
  collectBackendNames,
  collectProxyNames,
};
