import { normalizeGatewayUrl, getDocModels, resolveDocRoute, resolveDocBackendTranslation, buildProtocolTranslationGuidance, buildSnippets, readProductionDocs } from './tool-docs.js';

const $ = id => document.getElementById(id);
const storageKey = 'aiGatewayAdmin.v1';
const defaultGateway = {id:'example',name:'Example gateway',baseUrl:'https://gateway.example.com'};
let gateways=[], gateway=null, snapshot=null, controller=null, revision=0, loading=false;
let claudeModel='', openaiModel='';

function node(tag, text, className) {
  const element=document.createElement(tag);
  if (text != null) element.textContent=text;
  if (className) element.className=className;
  return element;
}
function readGateways() {
  let saved={};
  try { saved=JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { /* use example entry */ }
  gateways=(Array.isArray(saved.gateways) ? saved.gateways : []).filter(item=>{
    try { return item && typeof item.id==='string' && normalizeGatewayUrl(item.baseUrl); } catch { return false; }
  });
  if (!gateways.some(item=>normalizeGatewayUrl(item.baseUrl)===defaultGateway.baseUrl)) gateways.push(defaultGateway);
  gateway=gateways.find(item=>item.id===saved.activeGatewayId) || gateways[0];
  $('docs-gateway').replaceChildren(...gateways.map(item=>{
    const option=node('option',item.name || item.baseUrl); option.value=item.id; return option;
  }));
  $('docs-gateway').value=gateway.id;
}
function updateModels(id, models, selected) {
  const select=$(id);
  select.replaceChildren(...models.map(model=>{
    const option=node('option',model.displayName ? `${model.displayName} · ${model.id}` : model.id);
    option.value=model.id; return option;
  }));
  if (!models.length) { const option=node('option','No verified models available'); option.value=''; select.append(option); }
  select.disabled=!models.length;
  if (models.some(model=>model.id===selected)) select.value=selected;
  return select.value;
}
function section(title, parent) {
  const part=node('section'); part.append(node('h2',title)); parent.append(part); return part;
}
function paragraph(parent,text,className) { parent.append(node('p',text,className)); }
function code(parent,label,text) {
  const wrapper=node('div',null,'code-block');
  const head=node('div',null,'code-head');
  const button=node('button','Copy','btn btn-ghost'); button.type='button'; button.setAttribute('aria-label',`Copy ${label}`);
  button.addEventListener('click',async()=>{
    try { await navigator.clipboard.writeText(text); $('copy-status').textContent='Copied'; }
    catch { $('copy-status').textContent='Clipboard access is unavailable. Select the code and copy it manually.'; }
    setTimeout(()=>{ $('copy-status').textContent=''; },2500);
  });
  head.append(node('span',label),button);
  const pre=node('pre'); pre.append(node('code',text)); wrapper.append(head,pre); parent.append(wrapper);
}
function routeNote(parent,model) {
  if (!model) return;
  const route=resolveDocRoute(model,snapshot.mappings);
  paragraph(parent,route ? `Current route: ${model} → ${route.target} (${route.backend}). The Claude name is a client alias; the route target identifies the actual model.` : 'Routing information is unavailable for this model. The upstream target cannot be verified.','route-note');
  const translation=resolveDocBackendTranslation(model,snapshot.mappings,snapshot.backendTranslations);
  paragraph(parent,buildProtocolTranslationGuidance(translation),'notice');
}
function heading(parent,title,intro) { parent.append(node('h1',title),node('p',intro,'intro')); }
function link(parent,label,url) { const anchor=node('a',label); anchor.href=url; parent.append(anchor); }
function missingModel(parent,family) { paragraph(parent,`No verified ${family} model is available in the current configuration. Check the model catalog and routing rules in the console, then refresh.`,'empty-note'); }

function render() {
  const content=$('doc-content'); content.replaceChildren();
  const page=['claude-code','codex','api','models'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'claude-code';
  document.querySelectorAll('#doc-nav a').forEach(anchor=>{
    if (anchor.hash===`#${page}`) anchor.setAttribute('aria-current','page'); else anchor.removeAttribute('aria-current');
  });
  content.setAttribute('aria-busy',String(loading));
  if (!snapshot) {
    heading(content,'Tool Setup', 'Connect Claude and OpenAI clients using the current gateway configuration.');
    paragraph(content,loading ? 'Loading the model catalog and routes…' : 'Configuration has not loaded. Check the gateway connection, then select Refresh configuration.','empty-note');
    return;
  }
  const snippets=buildSnippets({baseUrl:gateway.baseUrl,claudeModel,openaiModel,shell:$('docs-shell').value});
  if (page==='claude-code') {
    heading(content,'Claude Code','Use the current gateway through the Anthropic Messages API in your terminal or IDE.');
    routeNote(content,claudeModel);
    const install=section('1. Install Claude Code',content);
    code(install,'npm','npm install -g @anthropic-ai/claude-code');
    link(install,'Claude Code installation guide','https://code.claude.com/docs/en/setup');
    const configure=section('2. Configure and launch',content);
    paragraph(configure,'Use an API key from your upstream account. The key is forwarded to the matched upstream. The console x-admin-key and Claude subscription login tokens cannot be used here.');
    if (claudeModel) code(configure,$('docs-shell').selectedOptions[0].textContent,snippets.claudeShell); else missingModel(configure,'Claude');
    paragraph(configure,'These environment variables apply to the current terminal session. Check existing provider settings, such as Vertex or Bedrock, and remove conflicting values first.');
    const settings=section('3. Save non-sensitive settings (optional)',content);
    paragraph(settings,'Merge the env fields below into ~/.claude/settings.json (Windows: %USERPROFILE%\\.claude\\settings.json). Preserve existing settings. Credentials are still supplied by the terminal that launches the client.');
    code(settings,'settings.json',snippets.claudeSettings);
    const ide=section('4. IDE and desktop apps',content);
    paragraph(ide,'Claude Code integrations in VS Code and JetBrains can use the same gateway settings. Restart the integration after configuration and ensure its environment can access the credentials. Claude Desktop uses separate third-party deployment settings; this guide does not generate those settings.');
    link(ide,'Claude Code IDE integration','https://code.claude.com/docs/en/vs-code');
  } else if (page==='codex') {
    heading(content,'OpenAI Codex','Use a custom provider to send Codex model requests through the current gateway.');
    paragraph(content,'Codex uses the Responses API. Before connecting, verify that the selected upstream model supports Responses, streaming, and tool calls. The gateway does not convert Chat Completions into Responses.','notice');
    const install=section('1. Install Codex',content); code(install,'npm','npm install -g @openai/codex');
    const config=section('2. Configure the provider',content);
    paragraph(config,'Merge this into ~/.codex/config.toml (Windows: %USERPROFILE%\\.codex\\config.toml). Place the top-level model and model_provider fields before the first TOML table, and avoid duplicate fields.');
    if (openaiModel) code(config,'config.toml',snippets.codexConfig); else missingModel(config,'OpenAI');
    paragraph(config,'Authentication uses an upstream API key from an environment variable. ChatGPT account credentials do not apply. Verify the basic connection with WebSocket and built-in search disabled. If the client does not recognize the model ID, ask your administrator for matching Codex model metadata.');
    const start=section('3. Set credentials and launch',content); code(start,$('docs-shell').selectedOptions[0].textContent,snippets.codexShell);
    paragraph(start,'Set AI_GATEWAY_API_KEY to your upstream key. Do not use the admin key. After launch, use /status to check the provider and model. For desktop apps, ensure the process can read the environment variable and restart after changing configuration.');
    link(start,'OpenAI gateway connection guide','https://learn.chatgpt.com/docs/enterprise/connect-to-a-gateway');
  } else if (page==='api') {
    heading(content,'API Clients','Choose the Anthropic or OpenAI SDK for your client protocol. Anthropic Messages behavior follows the selected route’s backend translation setting.');
    routeNote(content,claudeModel);
    const auth=section('1. Set upstream credentials',content);
    paragraph(auth,'Use an upstream API key accepted by the matched backend. Both x-api-key and Authorization: Bearer are supported. Admin endpoints use a separate x-admin-key.');
    code(auth,$('docs-shell').selectedOptions[0].textContent,snippets.codexShell.replace(/\ncodex$/, ''));
    const anthropic=section('2. Anthropic Messages',content);
    code(anthropic,'Install the Python SDK','pip install anthropic');
    if (claudeModel) code(anthropic,'Python · /v1/messages',snippets.claudePython); else missingModel(anthropic,'Claude');
    const openai=section('3. OpenAI Chat Completions',content);
    code(openai,'Install the Python SDK','pip install openai');
    if (openaiModel) code(openai,'Python · /v1/chat/completions',snippets.openaiPython); else missingModel(openai,'OpenAI');
    paragraph(openai,'The OpenAI SDK base_url includes /v1. The Anthropic SDK uses the gateway root URL. Catalog aliases do not guarantee compatibility with either protocol; verify the upstream API before use.','notice');
  } else {
    heading(content,'Models & Routing','The model catalog controls what clients discover. Mapping rules determine where requests are sent.');
    paragraph(content,`${snapshot.source}; ${snapshot.models.length} catalog entries. Pricing, context limits, and capability labels from other platforms are not included.`);
    const table=node('table');
    const head=node('thead'); const header=node('tr');
    ['Client model ID','Display name','Resolved target','Backend'].forEach(text=>header.append(node('th',text))); head.append(header); table.append(head);
    const body=node('tbody');
    for (const model of snapshot.models) {
      const route=resolveDocRoute(model.id,snapshot.mappings); const row=node('tr');
      [model.id,model.displayName || '—',route?.target || 'Unverified',route?.backend || 'Unverified'].forEach(text=>row.append(node('td',text))); body.append(row);
    }
    table.append(body); const scroll=node('div',null,'table-scroll'); scroll.append(table); content.append(scroll);
    if (!snapshot.models.length) paragraph(content,'The model catalog is empty. Ask your administrator to publish available models.','empty-note');
    paragraph(content,'Each pass matches prefixes in order, ignoring case, and applies the first match. Rewritten targets are matched again until an empty target, no match, or a cycle ends the chain. The first explicit backend in the chain is used, defaulting to openrouter. Catalog entries do not create mappings. Claude aliases may resolve to OpenAI or local models.');
    if (openaiModel) paragraph(content,`OpenAI examples use ${openaiModel}. This option may come from current mapping targets and may not appear in the public model catalog.`);
    const discovery=section('Read the public catalog',content); code(discovery,$('docs-shell').selectedOptions[0].textContent,snippets.modelList);
    paragraph(discovery,'When local model discovery is enabled, the catalog can be read directly. When disabled, the request is forwarded upstream and may require an upstream API key. This catalog does not use the Codex model metadata format.');
  }
}

async function refresh() {
  const request=++revision;
  controller?.abort(); controller=new AbortController();
  const signal=controller.signal;
  const timeout=setTimeout(()=>controller?.signal===signal && controller.abort(),15000);
  snapshot=null; loading=true;
  $('docs-refresh').disabled=true; $('docs-warning').hidden=true;
  $('gateway-url').textContent=gateway.baseUrl;
  $('docs-status').textContent='Loading the latest configuration…'; $('sync-time').textContent='Syncing';
  updateModels('claude-model',[],''); updateModels('openai-model',[],''); render();
  try {
    const result=await readProductionDocs(gateway,{signal});
    if (request!==revision) return;
    snapshot=result;
    const choices=getDocModels(result.models,result.mappings);
    claudeModel=updateModels('claude-model',choices.claude,claudeModel);
    openaiModel=updateModels('openai-model',choices.openai,openaiModel);
    $('docs-status').textContent=`${result.source} · ${result.models.length} models${result.mappings ? ` · ${result.mappings.length} routes` : ''}`;
    $('sync-time').textContent=`Updated at ${new Date().toLocaleTimeString('en-GB',{hour12:false})}`;
    $('docs-warning').textContent=result.warnings.join(' '); $('docs-warning').hidden=!result.warnings.length;
  } catch (error) {
    if (request!==revision) return;
    $('docs-status').textContent=signal.aborted ? 'The request timed out. Check your connection and try again.' : (error.message.startsWith('Failed to load configuration') || error.message.startsWith('Invalid model catalog') ? error.message : 'Unable to load configuration. Check the gateway URL, CORS settings, and admin key. You can update the gateway in the console.');
    $('sync-time').textContent='Not synced';
  } finally {
    clearTimeout(timeout);
    if (request===revision) { loading=false; $('docs-refresh').disabled=false; render(); }
  }
}
$('docs-gateway').addEventListener('change',()=>{
  gateway=gateways.find(item=>item.id===$('docs-gateway').value);
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.gateways) && saved.gateways.some(item=>item.id===gateway.id)) {
      saved.activeGatewayId=gateway.id;
      localStorage.setItem(storageKey,JSON.stringify(saved));
    }
  } catch { /* selection still works when storage is unavailable */ }
  refresh();
});
$('claude-model').addEventListener('change',()=>{ claudeModel=$('claude-model').value; render(); });
$('openai-model').addEventListener('change',()=>{ openaiModel=$('openai-model').value; render(); });
$('docs-shell').addEventListener('change',render);
$('docs-refresh').addEventListener('click',refresh);
window.addEventListener('hashchange',render);
window.addEventListener('storage',event=>{ if (event.key===storageKey || event.key===null) { readGateways(); refresh(); } });
document.addEventListener('visibilitychange',()=>{ if (!document.hidden) { readGateways(); refresh(); } });
setInterval(()=>{ if (!document.hidden && !loading) refresh(); },60000);
readGateways(); refresh();
