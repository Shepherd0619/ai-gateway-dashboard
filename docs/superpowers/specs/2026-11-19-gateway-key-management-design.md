# Gateway key and credential management design

## Intent

Add the dashboard controls needed to exercise the backend `develop` branch's
provider credentials and SQLite-backed Gateway Key API during local integration.
Keep the existing static, dependency-free Console and its current visual language.

## Goals

- Show configured backend credential state without ever reading or displaying a
  stored provider key; allow an administrator to set an in-memory override or
  restore the configured value.
- Issue, list, paginate, and revoke downstream Gateway Keys through the Admin
  API. Show the newly issued `apiKey` once, with a clear copy-and-save warning.
- Explain disabled Gateway Key support (`404`) and SQLite/storage failures
  (`503`) in the Gateway Key workspace.
- Use the selected gateway's existing base URL and `x-admin-key` client.

## Non-goals and constraints

- Do not add SQLite connection-string or database controls to the browser. SQLite
  is configured and operated by the backend; the UI only reports relevant API
  failures.
- Do not persist provider-key form values or issued Gateway Key plaintext in
  browser storage. Backend credential reads expose only `configured` and
  `source`.
- Do not change gateway selection, existing mapping flows, or introduce a
  dependency/build step.
- Preserve all existing local changes and do not push this work.
- When browser assets change, use one shared cache token in both HTML entrypoints
  and every local module import, including transitive imports.

## Approaches

1. Add a Credentials workspace to the existing Console, with separate tabs for
   Provider credentials and Gateway Keys. This reuses the selected gateway and
   Admin API key while keeping independent operations distinct. **Recommended.**
2. Add a separate HTML page. This isolates the screens but duplicates the
   gateway-selection and authentication experience and adds another entrypoint.
3. Place key lifecycle controls inside Manage Gateways. This mixes a browser's
   saved connection details with server-side credentials and risks implying that
   the one-time Gateway Key is a connection Admin key.

## Interaction and visual direction

Add a `Credentials` action to the existing Console header. It opens one wide,
scrollable dialog with two tabs. Keep all content left-aligned and reuse the
existing compact table, form, button, and status styles.

```text
Credentials
┌ Provider credentials ── Gateway keys ──────────────────────────────┐
│ Provider credentials: backend | status/source | set key | restore    │
│ Gateway keys: name | expiry | created | last used | status | revoke  │
│ Issue key: name, optional expiry                                     │
└─────────────────────────────────────────────────────────────────────┘
```

- Palette: reuse Console background `#0a0b0e`, panel `#12141b`, text `#d8dce2`,
  muted text `#6b727e`, and amber action `#ffb454`; use existing green/red
  status colors for active and failure states.
- Type: retain the existing monospace stack and its current compact scale.
- Keep responsive horizontal table scrolling, visible focus, and keyboard
  operation. Use direct, sentence-case labels and action names.
- Newly issued key: show its plaintext in a dedicated one-time result area. State
  that closing the result loses the key and that the backend cannot reveal it
  again. Never insert it into a table or persistent state.

## API contract

- `GET /admin/backend-credentials` returns `{ backends: [{ name, configured,
  source }] }`; `PUT /admin/backend-credentials/{name}` accepts `{ apiKey }`;
  `DELETE /admin/backend-credentials/{name}` clears the runtime override and
  returns the effective status. Encode backend names as URL path segments.
- `POST /admin/gateway-keys` accepts `{ name, expiresAt }` and returns `201` with
  key metadata plus the one-time `apiKey`.
- `GET /admin/gateway-keys?limit=50&offset=0` returns `{ keys, limit, offset }`;
  metadata includes `id`, `name`, `createdAt`, `expiresAt`, `revokedAt`,
  `lastUsedAt`, and `lastUsedIp`. Never expect plaintext from list responses.
- `POST /admin/gateway-keys/{id}/revoke` returns `204` or `404`.
- All requests use the existing `api()` helper and selected gateway's admin key.
  Render `400`, `401`, `404`, and `503` errors as actionable status text; a `404`
  on Gateway Key endpoints means the backend feature is disabled or unavailable.

## Verification

Add focused Node tests for credential response normalization, request paths and
bodies, pagination, one-time issue handling, and error/disabled states. Run the
full `npm test` suite locally. No push or deployment is part of this change.
