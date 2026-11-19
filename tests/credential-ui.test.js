import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Console exposes an accessible Credentials dialog with two labeled tabs', async () => {
  const html = await read('index.html');

  assert.match(html, /id="credentials-btn"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /id="credentials-modal"[^>]*hidden/);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="credentials-title"/);
  assert.match(html, /id="credentials-tabs"[^>]*role="tablist"/);
  assert.match(html, /id="credentials-tab-keys"[^>]*role="tab"[^>]*aria-controls="gateway-keys-pane"/);
  assert.match(html, /id="credentials-tab-providers"[^>]*role="tab"[^>]*aria-controls="provider-credentials-pane"/);
});

test('Credentials dialog has issue, transient-result, and provider-status regions', async () => {
  const html = await read('index.html');

  assert.match(html, /id="gateway-key-form"/);
  assert.match(html, /id="gateway-key-name"[^>]*required/);
  assert.match(html, /id="gateway-key-expires-at"[^>]*type="datetime-local"/);
  assert.match(html, /id="gateway-key-issue"/);
  assert.match(html, /id="issued-key-result"[^>]*hidden/);
  assert.match(html, /id="gateway-key-status"[^>]*role="status"/);
  assert.match(html, /id="provider-credentials-status"[^>]*role="status"/);
  assert.match(html, /id="provider-credentials-body"/);
});
