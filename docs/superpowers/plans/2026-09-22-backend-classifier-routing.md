# Backend and Classifier Routing Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the static admin console so model mappings and the independent classifier route can select named backends and proxy servers without submitting or displaying `TargetModel`.

**Architecture:** Keep the zero-dependency vanilla JavaScript architecture and existing gateway/admin-key request wrapper. Add a small route-normalization layer in `app.js` that accepts the backend's camelCase responses, derives backend choices from loaded mapping/classifier data plus the `openrouter` default, and uses the same choices in mapping and classifier forms. Preserve first-match ordering and full-list PUT behavior, while extending all mapping/classifier payloads and harden exports with `backend`/`proxyServer` fields.

**Tech Stack:** Static HTML, vanilla JavaScript, CSS, Node's built-in test runner, browser-based verification.

## Global Constraints

- Keep existing gateway selection, `x-admin-key` authentication, API paths, and zero-dependency deployment.
- Mapping rules are first-match-wins from top to bottom; more specific prefixes must precede broader prefixes.
- A missing mapping `Backend` displays as `openrouter` but is never copied into `Target`.
- Classifier uses independent `Target`, `Backend`, and `ProxyServer`; clearing `Target` disables it.
- Never submit or export `Classifier.TargetModel`; page requests must contain no `TargetModel` text.
- Preserve backend error text, including 400 responses for unknown backend/proxy values; never silently fall back after a failed save.
- Backend and ProxyServer controls may be empty; the UI must make the effective default behavior clear.
- Include Backend and ProxyServer in mapping exports and Target/Backend/ProxyServer in classifier exports.
- Do not add a frontend framework or dependency.

---

### Task 1: Add focused API and route-model tests

**Files:**
- Create: `tests/routing.test.js`
- Modify: `app.js` only as needed to expose a test-safe API factory through `window.__aiGatewayTest` without changing production behavior
- Modify: `package.json` if no test script exists, adding only a built-in Node test command

**Interfaces:**
- Tests consume `window.__aiGatewayTest` functions `normalizeRule`, `normalizeClassifier`, `buildMappingPatch`, `buildClassifierPut`, and `buildHardenConfig`.
- Production code produces deterministic payload builders with no network access, so tests can assert exact request bodies and exports.

- [ ] **Step 1: Inspect package metadata and test availability**

Run:

```powershell
Get-ChildItem -Force
if (Test-Path package.json) { Get-Content package.json }
```

Expected: confirm whether a package manifest/test runner exists; do not install dependencies.

- [ ] **Step 2: Write failing tests for the new contracts**

Create `tests/routing.test.js` using Node's built-in `node:test` and `node:assert/strict`. Load the browser script in a minimal VM/document stub or test exported pure helpers. Cover these exact cases:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

const api = await loadRoutingHelpers();

test('normalizes a mapping with an omitted backend to openrouter', () => {
  assert.deepEqual(api.normalizeRule({ prefix: 'claude', target: '', proxyServer: null }), {
    prefix: 'claude', target: '', backend: 'openrouter', proxyServer: null,
  });
});

test('builds a mapping PATCH without putting backend in target', () => {
  assert.deepEqual(api.buildMappingPatch({ target: 'local-model', backend: 'lmstudio', proxyServer: null }), {
    target: 'local-model', backend: 'lmstudio', proxyServer: null,
  });
});

test('builds an independent classifier PUT with Target, not TargetModel', () => {
  const body = api.buildClassifierPut({ target: 'local-classifier', backend: 'lmstudio', proxyServer: null });
  assert.deepEqual(body, { target: 'local-classifier', backend: 'lmstudio', proxyServer: null });
  assert.equal(JSON.stringify(body).includes('TargetModel'), false);
});

test('exports backend and independent classifier route', () => {
  const output = api.buildHardenConfig([
    { prefix: 'claude-local', target: 'local-model', backend: 'lmstudio', proxyServer: null },
  ], { target: 'local-classifier', backend: 'lmstudio', proxyServer: 'corp' });
  assert.deepEqual(output, {
    ModelMapping: { Rules: [{ Prefix: 'claude-local', Target: 'local-model', Backend: 'lmstudio', ProxyServer: null }] },
    Classifier: { Target: 'local-classifier', Backend: 'lmstudio', ProxyServer: 'corp' },
  });
  assert.equal(JSON.stringify(output).includes('TargetModel'), false);
});
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```powershell
node --test tests/routing.test.js
```

Expected: FAIL because the new helper contract does not exist yet.

- [ ] **Step 4: Add minimal test hooks and pure helpers**

At the end of the existing IIFE, expose only the pure helper object when a test harness requests it, or extract pure functions into a small browser-compatible module loaded by both `app.js` and the test. Keep the production page behavior unchanged and do not expose admin keys or mutable state.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```powershell
node --test tests/routing.test.js
```

Expected: PASS for normalization, mapping payload, classifier payload, and export structure.

- [ ] **Step 6: Add the test script if needed and rerun all tests**

If no `package.json` exists, create the smallest package manifest with:

```json
{
  "private": true,
  "scripts": { "test": "node --test tests/*.test.js" }
}
```

If one exists, add only the missing `test` script. Run `npm test` and expect PASS.

---

### Task 2: Extend HTML controls and user-facing ordering/default guidance

**Files:**
- Modify: `index.html:51-70` mapping table headers
- Modify: `index.html:108-125` classifier form
- Modify: `index.html:137-168` mapping rule form
- Modify: `index.html:232-237` harden export hints
- Modify: `styles.css` only for backend select/table sizing if existing rules do not cover them

**Interfaces:**
- Produces element IDs `f-classifier-target`, `f-classifier-backend`, `f-classifier-proxy`, `f-backend`, and `f-proxy` consumed by `app.js`.
- Keeps existing modal IDs and button event wiring intact.

- [ ] **Step 1: Add the Backend column and explicit order guidance**

Add a `BACKEND` column between TARGET and PROXY. Change the mapping panel hint to state first-match-wins and that a more specific prefix must be above a broader prefix. Add the same warning to the rule modal's position hint.

- [ ] **Step 2: Replace classifier TargetModel markup**

Rename the classifier input label/ID to `TARGET` / `f-classifier-target`. Add select controls for Backend and ProxyServer, with an explicit empty proxy option. Update the hint to say that empty Target disables the independent classifier route. Do not leave the string `TargetModel` in HTML, hints, IDs, or export instructions.

- [ ] **Step 3: Add mapping Backend and ProxyServer selectors**

Replace the free-text proxy input with a select containing an empty/direct option; add a Backend select. The controls must allow an empty backend option if no known backend is available, while displaying a note that omitted backend uses openrouter. Do not hardcode only openrouter as the set of choices.

- [ ] **Step 4: Update harden hints**

Describe exported mapping fields as Prefix/Target/Backend/ProxyServer and classifier fields as Target/Backend/ProxyServer. Remove all `Classifier__TargetModel` wording.

- [ ] **Step 5: Verify the markup statically**

Run:

```powershell
Select-String -Path index.html -Pattern 'TargetModel|f-classifier-model|Classifier__TargetModel'
```

Expected: no matches. Confirm all new IDs occur exactly once.

---

### Task 3: Implement backend-aware mapping and independent classifier behavior

**Files:**
- Modify: `app.js:112-125` API methods
- Modify: `app.js:173-248` mapping rendering/normalization
- Modify: `app.js:282-369` classifier rendering/form handling
- Modify: `app.js:549-670` mapping form/save paths
- Modify: `app.js:789-821` harden/export builders

**Interfaces:**
- `Api.upsert(prefix, target, backend, proxyServer)` sends `{ target, backend, proxyServer }` to PATCH.
- `Api.replaceAll(rules)` sends full rules including backend and proxyServer.
- `Api.setClassifier(target, backend, proxyServer)` sends `{ target, backend, proxyServer }` to PUT.
- `collectBackendNames(rules, classifier)` returns unique names with `openrouter` first, followed by names observed in API data.
- `collectProxyNames(rules, classifier)` returns unique non-empty proxy names plus the empty option.
- `normalizeClassifier(response)` reads `target`, `backend`, `proxyServer`, and `source`, preserving nulls.

- [ ] **Step 1: Update API payload builders and methods**

Change API methods to use the new fields:

```js
upsert: (prefix, target, backend, proxyServer) =>
  api('PATCH', '/admin/mappings/' + encodeURIComponent(prefix), {
    body: { target: target || '', backend: backend || null, proxyServer: proxyServer || null },
  }),
setClassifier: (target, backend, proxyServer) =>
  api('PUT', '/admin/classifier', {
    body: { target: target || null, backend: backend || null, proxyServer: proxyServer || null },
  }),
```

Keep `replaceAll` on `/admin/mappings` and pass normalized rules containing backend.

- [ ] **Step 2: Normalize mapping and classifier responses**

Extend `normalizeRule` to map both lower camel-case and any existing PascalCase response fields, with `backend` defaulting only for display/requests where the field is absent:

```js
function normalizeRule(r) {
  return {
    prefix: r.prefix ?? r.Prefix ?? '',
    target: r.target ?? r.Target ?? '',
    backend: r.backend ?? r.Backend ?? 'openrouter',
    proxyServer: r.proxyServer ?? r.ProxyServer ?? null,
  };
}
```

Use a separate classifier normalizer that preserves `null` backend/proxyServer when disabled and never reads a mapping rule to calculate its route.

- [ ] **Step 3: Add dynamic selector population**

Build choices from current mappings and classifier response. Always include `openrouter`; append newly observed backend names; append observed proxy names and an empty/direct option. Re-render options without losing the current selected value when editing. The backend selector must not silently change an unknown loaded value; retain it as a selected option so the save response/error can make the issue visible.

- [ ] **Step 4: Render backend in mapping rows**

Render normalized backend in a new table cell. Render empty proxy as `—` and empty target as `(no rewrite)`. Do not place backend text in the target cell.

- [ ] **Step 5: Update classifier display and form**

Enable classifier only when `target` is non-empty. Show Target, Backend, ProxyServer, and Source. For disabled/null responses show `(disabled)` and `—`/`DIRECT` as appropriate. `openClassifierForm` populates the three new controls. Submit calls `Api.setClassifier(target || null, backend || null, proxyServer || null)` and closes only after success. On failure, render `friendlyError(err)` into the form, preserving the API's `error` text.

- [ ] **Step 6: Update mapping form and all save paths**

Read backend and proxy from the form. Include backend in `entry`, `normalizeRule`, PATCH, full-list PUT, reorder, prefix rename, and reload paths. Do not use any fallback after a rejected save; leave the modal open and display the exact backend error.

- [ ] **Step 7: Update harden JSON and env exports**

Generate:

```json
{
  "ModelMapping": { "Rules": [{ "Prefix": "...", "Target": "...", "Backend": "...", "ProxyServer": null }] },
  "Classifier": { "Target": "...", "Backend": "...", "ProxyServer": null }
}
```

For env output, emit `ModelMapping__Rules__{i}__Prefix`, `Target`, `Backend`, and `ProxyServer`, plus `Classifier__Target`, `Classifier__Backend`, and `Classifier__ProxyServer`. Never emit `TargetModel`.

- [ ] **Step 8: Run focused tests and static checks**

Run:

```powershell
npm test
Select-String -Path app.js,index.html -Pattern 'TargetModel|targetModel|evaluatedTargetModel|evaluatedProxyServer'
```

Expected: tests PASS and no obsolete classifier-field matches.

---

### Task 4: Browser verification and regression checks

**Files:**
- Modify: `app.js`, `index.html`, or `styles.css` only if verification exposes a defect
- Test: `tests/routing.test.js`

**Interfaces:**
- Verifies the actual page and network requests against a local mock backend; no production backend changes.

- [ ] **Step 1: Start a local static server and mock API**

Use a local server suitable for the environment, serving the repository root and a mock API that requires `x-admin-key`. The mock must return named backends (`openrouter`, `lmstudio`) in mapping/classifier data, accept new payloads, and return 400 `{ "error": "Unknown backend: invalid" }` for invalid backend/proxy values.

- [ ] **Step 2: Verify mapping create/edit/reload**

In the browser, create a `claude-local` rule with `Backend=lmstudio`, `Target=local-model`, and empty ProxyServer. Confirm the request body contains `backend: "lmstudio"`, save succeeds, and refresh preserves backend/proxy. Edit the rule to `Backend=openrouter`, save, refresh, and confirm the change.

- [ ] **Step 3: Verify classifier independence and disable state**

Set classifier Target/backend to `local-classifier`/`lmstudio` while mapping rules use another backend. Confirm classifier PUT is independent and its rendered route stays lmstudio. Clear Target, save, and confirm GET/render shows disabled with null route fields.

- [ ] **Step 4: Verify errors and obsolete-field absence**

Attempt an invalid backend and invalid proxy; confirm the visible form error contains the exact API error text and the UI does not replace the selection with openrouter. Inspect all requests and assert no request body or URL contains `TargetModel`.

- [ ] **Step 5: Verify exports and ordering guidance**

Open Harden Configuration and confirm JSON/env outputs contain Backend and ProxyServer for mappings and Target/Backend/ProxyServer for classifier, with no TargetModel. Confirm the first-match-wins and specific-before-broad guidance remains visible in the panel and form.

- [ ] **Step 6: Run final verification commands**

Run:

```powershell
npm test
Select-String -Path app.js,index.html,README.md -Pattern 'TargetModel|targetModel|Classifier__TargetModel'
git diff --check
git status --short
```

Expected: tests pass, obsolete classifier identifiers have no matches, diff has no whitespace errors, and only intended files are modified.
