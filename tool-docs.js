// Shared generation and read-only production configuration loading.
export function normalizeGatewayUrl(value) {
  const url = new URL(String(value).trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('The gateway URL must use HTTP(S) without credentials, query parameters, or a fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

export function resolveDocRoute(model, mappings) {
  if (!Array.isArray(mappings)) return null;
  let target=model, backend='openrouter', backendSelected=false;
  const visited=new Set();
  while (!visited.has(target.toLowerCase())) {
    visited.add(target.toLowerCase());
    const rule=mappings.find(rule=>target.toLowerCase().startsWith(rule.prefix.toLowerCase()));
    if (!rule) break;
    if (!backendSelected && rule.backend) { backend=rule.backend; backendSelected=true; }
    if (!rule.target) break;
    target=rule.target;
  }
  return {target,backend};
}

export function getDocModels(models, mappings) {
  const claude = [...models];
  const openai = models.filter(model => /^(openai\/|gpt-)/i.test(model.id));
  for (const rule of mappings || []) {
    if (!/^openai\//.test(rule.target || '')) continue;
    // A target is usable as an input only if a current rule accepts it unchanged.
    const route = resolveDocRoute(rule.target, mappings);
    if (route?.target !== rule.target) continue;
    if (!openai.some(model => model.id === rule.target)) openai.push({id: rule.target});
  }
  // Catalog IDs are shared aliases, not a guarantee of the underlying vendor.
  // Keep them available for both protocols; prefer explicit OpenAI IDs for Codex.
  for (const model of models) if (!openai.some(item=>item.id===model.id)) openai.push(model);
  return {claude, openai};
}

const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
export function buildSnippets({baseUrl, claudeModel, openaiModel, shell = 'powershell'}) {
  const root = normalizeGatewayUrl(baseUrl);
  const api = `${root}/v1`;
  const env = {ANTHROPIC_BASE_URL: root, ...(claudeModel ? {ANTHROPIC_MODEL: claudeModel} : {})};
  const powershell = shell === 'powershell';
  function credentials(key) {
    if (powershell) return `$env:${key} = Read-Host 'Upstream API Key' -MaskInput`;
    if (shell === 'zsh') return `read -rs '${key}?Upstream API Key: '\nexport ${key}`;
    return `read -rs -p 'Upstream API Key: ' ${key}\nexport ${key}`;
  }
  const claudeEnv = Object.entries(env).map(([key,value]) => powershell ? `$env:${key} = ${psQuote(value)}` : `export ${key}=${quote(value)}`);
  return {
    claudeSettings: JSON.stringify({env}, null, 2),
    claudeShell: [...claudeEnv, credentials('ANTHROPIC_AUTH_TOKEN'), 'claude'].join('\n'),
    codexConfig: openaiModel ? `model = ${JSON.stringify(openaiModel)}\nmodel_provider = "ai-gateway"\nweb_search = "disabled"\n\n[model_providers.ai-gateway]\nname = "AI Gateway"\nbase_url = ${JSON.stringify(api)}\nwire_api = "responses"\nenv_key = "AI_GATEWAY_API_KEY"\nrequires_openai_auth = false\nsupports_websockets = false` : '',
    codexShell: `${credentials('AI_GATEWAY_API_KEY')}\ncodex`,
    claudePython: claudeModel ? `import os\nfrom anthropic import Anthropic\n\nclient = Anthropic(\n    api_key=os.environ["AI_GATEWAY_API_KEY"],\n    base_url=${JSON.stringify(root)},\n)\nmessage = client.messages.create(\n    model=${JSON.stringify(claudeModel)},\n    max_tokens=256,\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(message.content[0].text)` : '',
    openaiPython: openaiModel ? `import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    api_key=os.environ["AI_GATEWAY_API_KEY"],\n    base_url=${JSON.stringify(api)},\n)\nresponse = client.chat.completions.create(\n    model=${JSON.stringify(openaiModel)},\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(response.choices[0].message.content)` : '',
    modelList: powershell ? `Invoke-RestMethod -Uri ${psQuote(`${api}/models`)}` : `curl ${quote(`${api}/models`)}`,
  };
}

function validateModels(models) {
  if (!Array.isArray(models) || models.some(model => !model || typeof model.id !== 'string' || !model.id.trim())) {
    throw new Error('Invalid model catalog response.');
  }
  return models.map(model => ({id:model.id, ...(typeof model.displayName === 'string' ? {displayName:model.displayName} : {})}));
}

export async function readProductionDocs(gateway, {fetcher = fetch, signal} = {}) {
  const root = normalizeGatewayUrl(gateway.baseUrl);
  async function get(path, admin = false) {
    const response = await fetcher(root + path, {
      method:'GET', headers: admin ? {'x-admin-key':gateway.apiKey} : {}, signal,
      credentials:'omit', cache:'no-store',
    });
    if (!response.ok) throw new Error(`Failed to load configuration (HTTP ${response.status}).`);
    return response.json();
  }
  if (!gateway.apiKey) {
    const response = await get('/v1/models');
    return {models:validateModels(response.data), mappings:null, source:'Public model catalog', warnings:['No admin configuration is saved for this gateway in this browser. Live routes are unavailable; model options come from /v1/models.']};
  }
  const [catalog, routes] = await Promise.allSettled([get('/admin/model-discovery',true), get('/admin/mappings',true)]);
  // Never silently turn a failed catalog request into an empty successful document.
  if (catalog.status === 'rejected') throw catalog.reason;
  if (typeof catalog.value.enabled !== 'boolean') throw new Error('Invalid model catalog response.');
  const warnings=[];
  let mappings=null;
  if (routes.status === 'fulfilled' && Array.isArray(routes.value) && routes.value.every(rule => rule && typeof rule.prefix === 'string' && (rule.target == null || typeof rule.target === 'string'))) {
    mappings=routes.value.map(rule=>({prefix:rule.prefix,target:rule.target || '',backend:typeof rule.backend==='string' ? rule.backend : ''}));
  } else warnings.push('The model catalog loaded, but routing rules could not be read. Resolved targets cannot be verified. Refresh to try again.');
  if (!catalog.value.enabled) warnings.push('Local model discovery is disabled. The catalog shown is returned by the upstream /v1/models endpoint.');
  const models = catalog.value.enabled ? validateModels(catalog.value.models) : validateModels((await get('/v1/models')).data);
  return {models,mappings,source:catalog.value.enabled ? 'Live admin configuration' : 'Upstream model catalog',warnings};
}
