# Gateway key management implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Console UI for provider credential overrides and SQLite-backed Gateway Key lifecycle operations against the backend `develop` Admin API.

**Architecture:** Keep the current vanilla JavaScript app and selected-gateway `api()` helper. Put endpoint construction, safe response/status helpers, and gateway-scoped async state in a small module, then render the two credential workflows in an accessible dialog in `index.html` and `app.js`.

**Tech Stack:** Static HTML, CSS, native ES modules, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-19-gateway-key-management-design.md`

## Global Constraints

- Keep the dashboard dependency-free and preserve the existing local working-tree files.
- Never return or store provider credential plaintext; provider changes are runtime overrides.
- Show a Gateway Key plaintext only from its successful issue response, and never persist it or expect it from list responses.
- SQLite remains backend configuration; explain Gateway Key API `404` and storage `503` states in the UI.
- Do not push changes.
- Bump one shared `?v=20261119.1` token in both HTML entrypoints and every local ES-module import, including transitive imports.

## Review Focus

- Backend names containing `/` or `%` use the query-string endpoint form; cover in API adapter tests.
- Gateway Key list responses never surface an unexpected `apiKey` property; cover in response normalization tests.
- Expired and revoked keys have distinct display states; cover boundary and precedence in status helper tests.
- Gateway Key `404` and `503` explain disabled feature and unavailable storage separately; cover in error helper tests.
- Responses from an old selected gateway do not replace the currently selected gateway's credential data; cover with a deferred-response manager test.

---

### Task 1: Credential API and view helpers

**Files:**
- Create: `credential-management.js`
- Create: `tests/credential-management.test.js`

**Interfaces:**
- `createCredentialApi(request)` exposes `getBackendCredentials()`, `setBackendCredential(name, apiKey)`, `resetBackendCredential(name)`, `listGatewayKeys(limit, offset)`, `issueGatewayKey(name, expiresAt)`, and `revokeGatewayKey(id)`.
- `normalizeBackendCredentialsResponse(data)` validates and returns `{ backends }` with only `name`, `configured`, and `source`.
- `normalizeGatewayKeysResponse(data)` validates and returns `{ keys, limit, offset }` with only key metadata fields, excluding unexpected secret fields.
- `getGatewayKeyStatus(key, now)` returns `active`, `expired`, or `revoked`; revocation takes precedence.
- `formatGatewayKeyError(error)` distinguishes feature-disabled `404` from storage `503` and preserves other API messages.

- [x] **Step 1: Write failing tests** for all API method paths/bodies, encoded and query-string backend names, malformed response rejection, list-secret filtering, key status boundaries, and 404/503 guidance.
- [x] **Step 2: Run `node --test tests/credential-management.test.js`** and confirm the expected exports or behaviors are missing.
- [x] **Step 3: Implement the API adapter and helpers** with no dependencies and no credential persistence.
- [x] **Step 4: Run `node --test tests/credential-management.test.js`** and confirm all focused tests pass.

### Task 2: Credential state manager

**Files:**
- Modify: `credential-management.js`
- Modify: `tests/credential-management.test.js`

**Interfaces:**
- `createCredentialManager({ api, getGatewayId, onChange })` exposes `getState()`, `loadProviders()`, `loadKeys(offset)`, `saveProviderCredential(name, apiKey)`, `resetProviderCredential(name)`, `issueGatewayKey(name, expiresAt)`, `revokeGatewayKey(id)`, `clearIssuedKey()`, and `gatewayChanged()`.
- State includes the current `gatewayId`, backend credential metadata, key metadata and paging state, loading/error state, and a transient `issuedApiKey` cleared by `clearIssuedKey()` or `gatewayChanged()`.
- Every async result applies only when its captured gateway id and request generation still match the manager's current state.

- [x] **Step 1: Write failing manager tests** for stale provider/key results after a gateway change, one-time key issue/clear, and current-gateway save/reset/list mutations.
- [x] **Step 2: Run the focused tests** and confirm manager behavior is missing.
- [x] **Step 3: Implement the manager** with current-gateway guards, transient issue state, and explicit error/loading state.
- [x] **Step 4: Run `node --test tests/credential-management.test.js`** and confirm API and manager tests pass.

### Task 3: Credentials dialog and gateway lifecycle

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `tests/asset-cache.test.js`
- Test: `tests/credential-ui.test.js`
- Test: `tests/credential-management.test.js`

**Interfaces:**
- `app.js` creates the credential API from the existing `api()` helper, so all calls use the selected gateway and existing `x-admin-key` header.
- The Credentials dialog has `Gateway keys` and `Provider credentials` tabs, explicit loading/empty/error states, and a selected-gateway request guard.
- Gateway keys are paged with `limit=50`; issue accepts a name and optional local expiry converted to ISO-8601, and revoke uses the existing confirmation dialog.
- Provider credential rows show only source/configured state, use empty password inputs for new values, and offer reset only for runtime overrides.
- The one-time issue result stays in the manager's transient state and is cleared when the dialog closes or gateway selection changes.

- [x] **Step 1: Write and run failing DOM contract tests** for the Credentials entry, accessible tabs, issue form, and one-time result area; confirm the expected markup is missing.
- [x] **Step 2: Extend the asset-cache test** to walk local ES-module imports recursively and assert both entrypoints, stylesheets, and every module share one token.
- [x] **Step 3: Run the cache test** and confirm it passes against the current module graph.
- [x] **Step 4: Implement the dialog and interactions** using existing Console styles and modal helpers; the dialog calls the credential manager and renders API failures without exposing response secrets.
- [x] **Step 5: Bump the shared asset token** to `20261119.1` across both entrypoints, stylesheets, and all module imports.
- [x] **Step 6: Run `npm test`** and confirm the full local suite passes, including the recursive asset-cache check.
- [x] **Step 7: Inspect the local Console with Playwright API mocks** for both tabs, one-time issuance, disabled Gateway Keys, and storage failure; register narrow route handlers before navigation and abort unexpected API calls. This validates frontend behavior against fixtures only. No live backend connection or push.
