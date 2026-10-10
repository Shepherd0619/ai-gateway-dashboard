# Model Discovery Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selected-gateway admin dialog for reading, editing, enabling, and restoring the gateway's shared model-discovery catalog.

**Architecture:** Add a small pure `model-discovery.js` module for normalization, validation, local date/time formatting, and PUT payload construction; test it with Node's built-in test runner. Add a dedicated modal in `index.html`, matching styles in `styles.css`, and wire GET/PUT/DELETE through the existing authenticated API wrapper in `app.js`. Keep model catalog state separate from routing mappings and backend reachability.

**Tech Stack:** Static HTML, CSS, zero-dependency vanilla JavaScript ES modules, Node.js built-in `node:test`.

## Global Constraints

- Keep the dashboard zero-dependency and follow existing vanilla-JS patterns.
- Render gateway/API values safely with DOM APIs and `textContent`, not interpolated `innerHTML`.
- Use the existing selected-gateway API wrapper and `x-admin-key` behavior.
- Model discovery is a shared catalog and must not create or alter routing mappings.
- `createdAt` is entered as local date/time and sent as ISO-8601; if blank, use current time at save.
- Runtime entries override base entries by case-insensitive ID; unshadowed base entries remain. DELETE restores base configuration.

---

## File map

- Create `model-discovery.js`: pure catalog response normalization, draft validation, datetime-local conversion, and PUT body construction.
- Create `tests/model-discovery.test.js`: deterministic tests for helper behavior using `node:test`.
- Modify `index.html`: a vertically stacked, full-width model-discovery summary panel after the classifier panel and a separate model discovery modal with enabled state, entry list, error/status areas, add/remove, save, and restore actions.
- Modify `styles.css`: responsive layout for model rows, metadata fields, and explanatory catalog/restore notes using current theme tokens.
- Modify `app.js`: add model-discovery API methods and modal lifecycle/rendering/event handlers; reuse `api`, `friendlyError`, `confirmModal`, `openModal`, and `toast`.
- Modify `README.md`: document model discovery dialog, fields, date/time fallback, merge semantics, and backend routes.

## Task 1: Implement and test model catalog helpers

**Files:**
- Create: `model-discovery.js`
- Create: `tests/model-discovery.test.js`

**Interfaces:**
- `normalizeModelDiscovery(value)` returns `{ enabled: boolean, models: Array<{ id: string, displayName?: string, ownedBy?: string, createdAt?: string }> }`; invalid/missing models normalize to an empty array, optional null values are omitted, and string identifiers are trimmed.
- `validateModelDiscoveryDraft(models)` returns `null` for valid input or a human-readable validation message for the first invalid row (blank ID, duplicate ID ignoring case, or invalid non-empty local datetime).
- `toLocalDateTimeInput(isoValue)` returns a `YYYY-MM-DDTHH:mm` value suitable for `input[type=datetime-local]`, or an empty string for absent/invalid values.
- `buildModelDiscoveryPut({ enabled, models }, now = () => new Date())` returns `{ enabled: Boolean, models: [...] }`; trims IDs and optional text; omits blank `displayName`/`ownedBy`; converts populated local datetimes to ISO-8601; substitutes `now().toISOString()` when `createdAt` is blank.

- [ ] **Step 1: Write failing helper tests**

Add tests covering normalizing the backend `{enabled, models}` shape, trimming IDs and omitting null optional properties, empty/invalid catalog normalization, blank IDs, case-insensitive duplicate IDs, invalid local datetime, valid local date conversion to ISO, blank date using an injected clock, and omission of blank optional text fields.

Use a stable injected clock in the blank-date test:

```js
const now = () => new Date('2026-10-10T12:34:56.000Z');
const payload = buildModelDiscoveryPut({ enabled: true, models: [{ id: 'model-a', createdAt: '' }] }, now);
assert.equal(payload.models[0].createdAt, '2026-10-10T12:34:56.000Z');
```

- [ ] **Step 2: Run the focused tests and confirm the missing-module failure**

Run: `node --test tests/model-discovery.test.js`
Expected: FAIL because `model-discovery.js` exports do not exist yet.

- [ ] **Step 3: Implement the pure helper exports**

Implement the four exports above without DOM or API dependencies. For datetime-local parsing, parse its local wall-clock value rather than treating it as UTC: match `YYYY-MM-DDTHH:mm`, construct a local `Date(year, month - 1, day, hour, minute)`, then compare the resulting components to the input to reject impossible dates/times. Convert the valid date to ISO via `toISOString()`.

- [ ] **Step 4: Run the focused tests and verify pass**

Run: `node --test tests/model-discovery.test.js`
Expected: all model-discovery helper tests pass.

- [ ] **Step 5: Run the existing suite**

Run: `npm test`
Expected: existing routing tests and new helper tests pass.

## Task 2: Add the model discovery dialog markup and styles

**Files:**
- Modify: `index.html:24-43` for the toolbar action; add a model-discovery modal adjacent to existing modal markup.
- Modify: `styles.css` modal/form sections.

**Interfaces:**
- DOM IDs consumed by Task 3: `model-discovery-btn`, `model-discovery-panel`, `model-discovery-summary-status`, `model-discovery-summary-count`, `model-discovery-summary-source`, `model-discovery-modal`, `model-discovery-enabled`, `model-discovery-list`, `model-discovery-add`, `model-discovery-error`, `model-discovery-status`, `model-discovery-save`, and `model-discovery-restore`.
- Each rendered model card uses `data-model-index` on its wrapper and controls named `id`, `displayName`, `ownedBy`, and `createdAt`; remove buttons use `data-model-remove`.

- [ ] **Step 1: Add the toolbar action and modal skeleton**

Add a `Model Discovery` toolbar button. Add a separate accessible `role="dialog"` modal with `aria-modal="true"`, an `aria-labelledby` title, enabled checkbox, model list container, Add model button, explanatory note, inline `role="alert"` error container, `role="status"` loading/saving region, Restore base configuration button, Cancel close buttons, and Save catalog submit button.

- [ ] **Step 2: Add each model field and help text through the renderer contract**

Keep the list container empty in HTML; Task 3 renders cards with `input[type=text]` for `id`, `displayName`, and `ownedBy`, plus `input[type=datetime-local]` for `createdAt`. Include helper text that the displayed value uses local date/time, that manual input follows the browser-local `YYYY-MM-DDTHH:mm` format, and that an empty value is set to the current time when saved.

- [ ] **Step 3: Style the modal for desktop and narrow viewports**

Use the existing `modal-card`, `modal-wide`, form input, button, border, background, and text color tokens. Lay out model fields in two columns on wide screens and one column at narrow widths. Keep entry actions visible, make the model list scroll within the modal, and distinguish the note about runtime/base merge semantics without suggesting individual removal hides baseline models.

- [ ] **Step 4: Inspect the resulting page structure and run the existing suite**

Run: `npm test`
Expected: all tests pass; markup IDs are unique and date-time help communicates blank-value fallback.

## Task 3: Wire authenticated GET, editable rows, validation, and PUT save

**Files:**
- Modify: `app.js:1-3` imports, `Api` object, modal functions/rendering, and `init()` event wiring.
- Test: `tests/model-discovery.test.js` for any helper additions from this task.

**Interfaces:**
- API methods: `Api.getModelDiscovery()` calls `GET /admin/model-discovery`; `Api.setModelDiscovery(settings)` calls `PUT /admin/model-discovery` with the settings body; `Api.resetModelDiscovery()` calls `DELETE /admin/model-discovery`.
- Dialog state is a private draft `{ enabled, models }`; it is loaded fresh whenever opened and does not share or mutate mapping/classifier state.

- [ ] **Step 1: Add API methods using the existing wrapper**

Implement the three methods in `Api`. `api()` already adds `x-admin-key`, serializes JSON bodies, parses non-success errors, and returns the shared response wrapper. Verify DELETE `204` response handling uses `readApiResponse` and does not require a JSON response body.

- [ ] **Step 2: Add failing UI-independent API/payload checks where practical**

Keep request-shape and model payload assertions in helper tests; do not introduce a mock DOM framework. Assert PUT payload keys exactly match `enabled` and `models`, including `displayName`, `ownedBy`, and ISO `createdAt` only where populated.

- [ ] **Step 3: Implement modal loading and safe row rendering**

On toolbar click, open the modal, show loading status, and request GET. Normalize its result with `normalizeModelDiscovery`, clone model entries into local draft state, and render using `document.createElement`, `.value`, `.textContent`, and `replaceChildren()`. Each field input updates the draft; Add model appends a blank-ID entry, Remove removes only that draft entry, and enabled checkbox updates draft state. Show a visible error instead of presenting a failed GET as an empty catalog.

- [ ] **Step 4: Implement client validation and save behavior**

On Save, read current field values into draft, call `validateModelDiscoveryDraft`, and display validation errors in the dialog. If valid, disable duplicate save actions, display saving status, build the request with `buildModelDiscoveryPut`, and send PUT. On success normalize and re-render the returned effective `{ enabled, models }` so any merged base entries are shown; display a success toast/status. On failure display `friendlyError(error)` inline and re-enable actions. Do not close the modal on a failed request.

- [ ] **Step 5: Verify event wiring and tests**

Run: `npm test`
Expected: all tests pass; opening the dialog triggers authenticated GET and submit triggers PUT with only the specified fields.

## Task 4: Implement confirmed restore-to-base workflow and gateway safety

**Files:**
- Modify: `app.js` model discovery dialog handlers and existing `confirmModal` integration.
- Modify: `index.html` restore confirmation/help copy if needed.

**Interfaces:**
- `Api.resetModelDiscovery()` returns the standard API result for `204`; the UI follows it with `Api.getModelDiscovery()` to refresh the effective catalog.

- [ ] **Step 1: Add explicit restore confirmation**

Clicking Restore opens the existing confirmation modal with text explaining that the runtime override will be discarded and the gateway will use its configured baseline; restoring does not delete baseline entries. Only its Confirm callback makes the DELETE request.

- [ ] **Step 2: Perform DELETE, then reload the effective catalog**

While restoring, disable restore/save controls and show status. After DELETE succeeds, GET the effective catalog and render it. On DELETE or reload failure, retain the dialog and show the concrete API/network error; do not claim restoration succeeded unless DELETE and follow-up GET both succeed.

- [ ] **Step 3: Guard against stale gateway selection**

Capture the selected gateway ID when opening the modal. Before PUT or DELETE, verify it is still the active gateway; if it changed, abort the mutation, explain that the dialog must be reopened for the newly selected gateway, and do not send a write using a stale draft. Reopening always performs a fresh GET.

- [ ] **Step 4: Verify reset/error paths**

Run: `npm test`
Expected: all tests pass. Manually verify Cancel does not call DELETE, Confirm calls DELETE once, success reloads GET, and API errors stay visible.

## Task 5: Document the catalog feature and verify full behavior

**Files:**
- Modify: `README.md` behavior and backend contract sections.

- [ ] **Step 1: Document UI behavior and merge caveat**

Add a concise section documenting that Model Discovery manages the shared administrator-maintained `/v1/models` catalog, how optional fields work, that `createdAt` uses local picker/manual `YYYY-MM-DDTHH:mm` entry and defaults to save-time current time, and that model entries do not create mappings. Explicitly explain runtime/base ID merge semantics and the Restore base configuration action.

- [ ] **Step 2: Document backend endpoints**

List `GET/PUT/DELETE /admin/model-discovery` as requiring `x-admin-key`; describe GET/PUT `{ enabled, models }`, optional model fields, PUT replacement/runtime merge behavior, and DELETE baseline restoration without implying it deletes base configuration.

- [ ] **Step 3: Run the complete automated suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Manually verify in the dashboard**

Use a development gateway exposing the backend feature and check: initial GET loading/error; empty catalog; enabling/disabling discovery; add/edit/remove model rows; blank `createdAt` submits the current time in ISO-8601; valid selected/manual times round-trip through GET; blank and duplicate IDs and invalid date are rejected client-side; PUT errors are visible; successful PUT shows returned effective catalog; restore cancellation is non-mutating; confirmed DELETE followed by GET restores base state; changing gateways cannot apply a stale edit to another gateway. Confirm mapping rules remain unchanged throughout.

- [ ] **Step 5: Check final diff and working tree**

Run: `git diff --check` and `git status --short --branch`.
Expected: no whitespace errors; changes remain on `feat/model-discovery-admin-ui`; do not commit unless requested.

## Self-review

- **Spec coverage:** API contract and selected gateway are covered in Tasks 3–4; fields/date-time fallback/validation in Tasks 1–3; runtime merge and restore semantics in Tasks 2, 4, and 5; safety and no-mapping behavior in Tasks 3 and 5; tests and README in Tasks 1 and 5.
- **Placeholder scan:** No TODO/TBD steps; each task names exact files, expected behavior, and test command. No commands use shell-specific line-continuation conventions.
- **Type consistency:** Helper exports and return shapes are defined in Task 1; `Api` method names and dialog draft shape are fixed in Task 3 and referenced consistently in Task 4.
