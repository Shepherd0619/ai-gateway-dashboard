import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGatewayUrl, getDocModels, resolveDocRoute, buildSnippets, readProductionDocs } from '../tool-docs.js';

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
    return {ok:true,json:async()=>url.endsWith('/mappings') ? [{prefix:'claude',target:'openai/live'}] : {enabled:true,models:[{id:'claude-live'}]}};
  };
  const result=await readProductionDocs({baseUrl:'https://example.test',apiKey:'admin-test'}, {fetcher});
  assert.equal(result.models[0].id,'claude-live');
  assert.equal(calls.length,2);
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
  await assert.rejects(()=>readProductionDocs({baseUrl:'https://example.test'}, {fetcher:async()=>({ok:true,json:async()=>({})})}), /Invalid model catalog/);
  await assert.rejects(()=>readProductionDocs({baseUrl:'https://example.test'}, {fetcher:async()=>({ok:false,status:401})}), /401/);
});

test('partial route failure is explicit and cannot fabricate a target', async () => {
  const result=await readProductionDocs({baseUrl:'https://example.test',apiKey:'admin-test'}, {fetcher:async url=>{
    if(url.endsWith('/mappings')) return {ok:false,status:503};
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
    return {ok:true,json:async()=>url.endsWith('/mappings') ? [] : {enabled:false,models:[{id:'inactive-local'}]}};
  }});
  assert.equal(result.source,'Upstream model catalog');
  assert.deepEqual(result.models,[{id:'upstream-live'}]);
  assert.ok(result.warnings.length);
});
