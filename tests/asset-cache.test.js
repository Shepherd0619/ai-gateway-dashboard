import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), 'utf8');
}

function localAssetReferences(source, pattern) {
  return [...source.matchAll(pattern)].map(match => match[1]);
}

test('static entrypoints, stylesheets, and transitive modules share a cache version', async () => {
  const index = await read('index.html');
  const setup = await read('tool-setup.html');
  const indexAssets = localAssetReferences(index, /(?:src|href)="([^\"]+\.(?:js|css)(?:\?[^\"]*)?)"/g);
  const appEntry = indexAssets.find(asset => asset.startsWith('app.js'));
  const version = appEntry && new URL(appEntry, 'http://localhost/').searchParams.get('v');

  assert.ok(version, 'index.html must version its app entrypoint');

  for (const [file, source] of [['index.html', index], ['tool-setup.html', setup]]) {
    for (const asset of localAssetReferences(source, /(?:src|href)="([^\"]+\.(?:js|css)(?:\?[^\"]*)?)"/g)) {
      assert.equal(new URL(asset, 'http://localhost/').searchParams.get('v'), version, `${file}: ${asset}`);
    }
  }

  const visited = new Set();
  async function visitModule(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await read(file);
    const imports = localAssetReferences(source, /\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g);
    for (const asset of imports) {
      assert.equal(new URL(asset, 'http://localhost/').searchParams.get('v'), version, `${file}: ${asset}`);
      const resolved = new URL(asset, 'http://localhost/' + file);
      if (resolved.origin === 'http://localhost' && /\.js$/i.test(resolved.pathname)) {
        await visitModule(decodeURIComponent(resolved.pathname.replace(/^\//, '')));
      }
    }
  }

  for (const file of ['app.js', 'tool-docs.js', 'tool-setup.js']) await visitModule(file);
});
