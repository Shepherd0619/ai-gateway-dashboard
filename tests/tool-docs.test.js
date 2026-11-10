import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGatewayUrl, getDocModels, resolveDocRoute, buildSnippets, readProductionDocs } from '../tool-docs.js';
import * as ToolDocs from '../tool-docs.js';

test('gateway URL rejects unsafe values and normalizes trailing slash', () => {
  assert.equal(normalizeGatewayUrl('https://example.test/gateway/'), 'https://example.test/gateway');
  for (const value of ['javascript:alert(1)', 'https://user:secret@example.test', 'https://example.test/?key=secret']) {
    assert.throws(() => normalizeGatewayUrl(value));
  }
});

test('models and route explanations follow live first-match rules, including no rewrite', () => {
  const mappings = [
    {prefix:'claude-sonnet',target:'openai/new-model',backend:'openrouter'},
    {prefix:'openai/',target:'',backend:'openrouter'},
    {prefix:'claude',target:'openai/other-model',backend:'openrouter'},
  ];
  const choices = getDocModels([{id:'claude-sonnet',displayName:'Sonnet alias'}], mappings);
  assert.deepEqual(choices.claude.map(m=>m.id), ['claude-sonnet']);
  assert.deepEqual(choices.openai.map(m=>m.id), ['openai/new-model','openai/other-model','claude-sonnet']);
  assert.equal(resolveDocRoute('claude-sonnet', mappings).target, 'openai/new-model');
  assert.equal(resolveDocRoute('openai/new-model', mappings).target, 'openai/new-model');
  assert.deepEqual(resolveDocRoute('unknown', mappings), {target:'unknown',backend:'openrouter'});
  assert.equal(resolveDocRoute('CLAUDE-sonnet', mappings).target, 'openai/new-model');
});

test('public shared aliases remain usable by either SDK without inventing a provider', () => {
  const choices=getDocModels([{id:'team-fast',displayName:'Fast alias'},{id:'claude-sonnet'}],null);
  assert.deepEqual(choices.claude.map(model=>model.id),['team-fast','claude-sonnet']);
  assert.deepEqual(choices.openai.map(model=>model.id),['team-fast','claude-sonnet']);
  assert.equal(resolveDocRoute('team-fast',null),null);
});

test('route resolution follows chained aliases and retains first explicit backend', () => {
  const rules=[{prefix:'claude',target:'alias',backend:'first'},{prefix:'alias',target:'openai/final',backend:'second'},{prefix:'openai/',target:'',backend:'third'}];
  assert.deepEqual(resolveDocRoute('claude-sonnet',rules),{target:'openai/final',backend:'first'});
  assert.deepEqual(resolveDocRoute('loop-a',[{prefix:'loop-a',target:'loop-b'},{prefix:'loop-b',target:'loop-a'}]),{target:'loop-a',backend:'openrouter'});
});

test('generated configs use the chosen URL and model without any admin credential', () => {
  const snippets = buildSnippets({baseUrl:'https://example.test/gateway/',claudeModel:'claude-sonnet',openaiModel:'openai/new-model',shell:'powershell'});
  const settings = JSON.parse(snippets.claudeSettings);
  assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://example.test/gateway');
  assert.equal(settings.env.ANTHROPIC_MODEL, 'claude-sonnet');
  assert.match(snippets.codexConfig, /base_url = "https:\/\/example.test\/gateway\/v1"/);
  assert.match(snippets.codexConfig, /wire_api = "responses"/);
  assert.match(snippets.codexConfig, /env_key = "AI_GATEWAY_API_KEY"/);
  assert.match(snippets.openaiPython, /openai\/new-model/);
  assert.doesNotMatch(Object.values(snippets).join('\n'), /rightcapital|vertex|x-admin-key/i);
});

test('live loader only reads admin endpoints and keeps admin key in request headers', async () => {
  const calls=[];
  const fetcher=async (url, options) => {
    calls.push({url,options});
    const body=url.endsWith('/mappings') ? [{prefix:'claude',target:'openai/live'}]
      : url.endsWith('/backend-translations') ? {backends:[]}
      : {enabled:true,models:[{id:'claude-live'}]};
    return {ok:true,json:async()=>body};
  };
  const result=await readProductionDocs({baseUrl:'https://example.test',apiKey:'admin-test'}, {fetcher});
  assert.equal(result.models[0].id,'claude-live');
  assert.deepEqual(result.backendTranslations,{});
  assert.equal(calls.length,3);
  assert.ok(calls.every(c=>c.options.method==='GET' && c.options.headers['x-admin-key']==='admin-test'));
  assert.doesNotMatch(JSON.stringify(result), /admin-test/);
});

test('public reader uses discovery, and malformed or failed catalog cannot look like success', async () => {
  const result=await readProductionDocs({baseUrl:'https://example.test'}, {fetcher:async(url,options)=>{
    assert.equal(url,'https://example.test/v1/models');
    assert.equal(options.headers['x-admin-key'],undefined);
    return {ok:true,json:async()=>({data:[{id:'claude-public'}]})};
  }});
  assert.equal(result.models[0].id,'claude-public');
  assert.equal(result.mappings,null);
  assert.equal(result.backendTranslations,null);
  await assert.rejects(()=>readProductionDocs({baseUrl:'https://example.test'}, {fetcher:async()=>({ok:true,json:async()=>({})})}), /Invalid model catalog/);
  await assert.rejects(()=>readProductionDocs({baseUrl:'https://example.test'}, {fetcher:async()=>({ok:false,status:401})}), /401/);
});

test('partial route failure is explicit and cannot fabricate a target', async () => {
  const result=await readProductionDocs({baseUrl:'https://example.test',apiKey:'admin-test'}, {fetcher:async url=>{
    if(url.endsWith('/mappings')) return {ok:false,status:503};
    if(url.endsWith('/backend-translations')) return {ok:true,json:async()=>({backends:[]})};
    return {ok:true,json:async()=>({enabled:true,models:[{id:'claude-live'}]})};
  }});
  assert.equal(result.mappings,null);
  assert.equal(result.warnings.length,1);
  assert.equal(resolveDocRoute('claude-live',result.mappings),null);
});

test('disabled discovery reads upstream catalog without forwarding the admin key', async () => {
  const result=await readProductionDocs({baseUrl:'https://example.test',apiKey:'admin-test'}, {fetcher:async(url,options)=>{
    if(url.endsWith('/v1/models')) {
      assert.deepEqual(options.headers,{});
      return {ok:true,json:async()=>({data:[{id:'upstream-live'}]})};
    }
    if(url.endsWith('/mappings')) return {ok:true,json:async()=>[]};
    if(url.endsWith('/backend-translations')) return {ok:true,json:async()=>({backends:[]})};
    return {ok:true,json:async()=>({enabled:false,models:[{id:'inactive-local'}]})};
  }});
  assert.equal(result.source,'Upstream model catalog');
  assert.deepEqual(result.models,[{id:'upstream-live'}]);
  assert.ok(result.warnings.length);
});

const translationSettings=(name,patch={})=>({
  name,translateAnthropicToOpenAI:true,openAIProtocol:'ChatCompletions',reasoningFormat:'OpenRouter',source:'base',...patch,
});

test('live admin reader fetches and normalizes backend translation settings', async () => {
  const requests=[];
  const result=await readProductionDocs({baseUrl:'https://example.test',apiKey:'admin-test'}, {fetcher:async(url,options)=>{
    requests.push({url,options});
    const body=url.endsWith('/model-discovery') ? {enabled:true,models:[{id:'claude-live'}]}
      : url.endsWith('/mappings') ? [{prefix:'claude',target:'openai/live',backend:'openrouter'}]
      : {backends:[translationSettings('openrouter',{openAIProtocol:'Responses',reasoningFormat:'OpenAI'})]};
    return {ok:true,json:async()=>body};
  }});
  assert.equal(requests.length,3);
  const translationRequest=requests.find(request=>request.url.endsWith('/admin/backend-translations'));
  assert.ok(translationRequest);
  assert.equal(translationRequest.options.method,'GET');
  assert.equal(translationRequest.options.headers['x-admin-key'],'admin-test');
  assert.deepEqual(result.backendTranslations.openrouter,translationSettings('openrouter',{openAIProtocol:'Responses',reasoningFormat:'OpenAI'}));
  assert.equal(result.warnings.length,0);
});

test('translation request failure leaves catalog and routes usable but reports unknown state', async () => {
  const result=await readProductionDocs({baseUrl:'https://example.test',apiKey:'admin-test'}, {fetcher:async url=>{
    if(url.endsWith('/model-discovery')) return {ok:true,json:async()=>({enabled:true,models:[{id:'claude-live'}]})};
    if(url.endsWith('/mappings')) return {ok:true,json:async()=>[{prefix:'claude',target:'openai/live',backend:'openrouter'}]};
    return {ok:false,status:503};
  }});
  assert.deepEqual(result.models,[{id:'claude-live'}]);
  assert.deepEqual(result.mappings,[{prefix:'claude',target:'openai/live',backend:'openrouter'}]);
  assert.equal(result.backendTranslations,null);
  assert.equal(result.warnings.length,1);
  assert.match(result.warnings[0],/translation/i);
  assert.match(result.warnings[0],/unknown/i);
});

test('malformed translation response is unknown without discarding valid catalog and routes', async () => {
  const result=await readProductionDocs({baseUrl:'https://example.test',apiKey:'admin-test'}, {fetcher:async url=>{
    if(url.endsWith('/model-discovery')) return {ok:true,json:async()=>({enabled:true,models:[{id:'claude-live'}]})};
    if(url.endsWith('/mappings')) return {ok:true,json:async()=>[{prefix:'claude',target:'openai/live',backend:'openrouter'}]};
    return {ok:true,json:async()=>({backends:[{name:'openrouter',translateAnthropicToOpenAI:'true'}]})};
  }});
  assert.equal(result.models[0].id,'claude-live');
  assert.equal(result.mappings[0].backend,'openrouter');
  assert.equal(result.backendTranslations,null);
  assert.match(result.warnings.join(' '),/translation.*unknown/i);
});

test('backend translation status follows the selected route and its exact backend name', () => {
  const translations={
    openrouter:translationSettings('openrouter'),
    lmstudio:translationSettings('lmstudio',{translateAnthropicToOpenAI:false,openAIProtocol:'Responses',reasoningFormat:'OpenAI'}),
  };
  const resolve=ToolDocs.resolveDocBackendTranslation;
  assert.deepEqual(resolve?.('claude-default',[],translations),{
    enabled:true,openAIProtocol:'ChatCompletions',reasoningFormat:'OpenRouter',
  });
  const chained=[
    {prefix:'claude',target:'alias',backend:'lmstudio'},
    {prefix:'alias',target:'openai/final',backend:'openrouter'},
    {prefix:'openai/',target:'',backend:'openrouter'},
  ];
  assert.deepEqual(resolve?.('claude-sonnet',chained,translations),{
    enabled:false,openAIProtocol:'Responses',reasoningFormat:'OpenAI',
  });
  assert.equal(resolve?.('claude-sonnet',[{prefix:'claude',target:'openrouter/model',backend:'openrouter'}],{
    openrouter:translations.openrouter,
  }).enabled,true);
  assert.equal(resolve?.('openrouter/model',[{prefix:'openrouter/',target:'',backend:'lmstudio'}],{
    openrouter:translations.openrouter,
  }),null);
  assert.equal(resolve?.('claude-sonnet',chained,null),null);
});

test('backend translation lookup matches route backend names case-insensitively', () => {
  const settings=translationSettings('openrouter');
  const result=ToolDocs.resolveDocBackendTranslation(
    'claude-model',
    [{prefix:'claude',target:'',backend:'OPENROUTER'}],
    {openrouter:settings},
  );

  assert.deepEqual(result,{
    enabled:true,
    openAIProtocol:'ChatCompletions',
    reasoningFormat:'OpenRouter',
  });
});

test('protocol guidance distinguishes unknown status from model capability and documents path limits', () => {
  const guidance=ToolDocs.buildProtocolTranslationGuidance;
  const unknown=guidance?.(null) || '';
  assert.match(unknown,/status is unknown; settings are unavailable for the selected backend/i);
  assert.match(unknown,/do not infer enabled or disabled/i);
  assert.doesNotMatch(unknown,/could not be read/i);
  assert.match(unknown,/Only POST \/v1\/messages/i);
  assert.match(unknown,/other paths are not transformed/i);
  assert.match(unknown,/model names.*(do not|cannot).*prove/i);
  assert.match(unknown,/When translation is enabled, \/v1\/messages\/\* subroutes are unsupported/i);
  const enabled=guidance?.({enabled:true,openAIProtocol:'ChatCompletions',reasoningFormat:'OpenRouter'}) || '';
  assert.match(enabled,/translates Anthropic Messages to the configured Chat Completions upstream/i);
  const disabled=guidance?.({enabled:false,openAIProtocol:'Responses',reasoningFormat:'OpenAI'}) || '';
  assert.match(disabled,/forwards Anthropic Messages with model rewriting/i);
  assert.match(disabled,/other paths are not transformed/i);
  assert.doesNotMatch(`${unknown} ${enabled} ${disabled}`,/\/openai\/v1\//i);
});
