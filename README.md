# AI Gateway · Runtime Mapping Console

A pure static admin page for viewing, adding, editing, and deleting AI Gateway model-mapping rules at runtime. It has zero dependencies and no build step; place it directly in Apache HTTPD.

## Files

| File | Description |
|---|---|
| `index.html` | Page structure |
| `styles.css` | “Dark industrial control panel” theme |
| `app.js` | Logic (multi-gateway management, API wrapper, CRUD) |

Place the three files in the same directory and open `index.html` in a browser, or serve it through Apache.

## Deployment

### 1. Backend: enable the Admin API and configure CORS

The page connects directly to the gateway backend by default (`http://localhost:4000`). Because this is a cross-origin request, the backend must do two things:

- **Set `Admin__ApiKey`** as an environment variable; otherwise the entire Admin API returns 404:

  ```bash
  # Example (Linux/macOS)
  Admin__ApiKey=sk-admin-xxx dotnet run
  # Windows PowerShell
  # $env:Admin__ApiKey = "sk-admin-xxx"; dotnet run
  ```

- **Add the page origin to the CORS allowlist.** Add the origin where Apache serves the page (`appsettings.json` → `Cors:AllowedOrigins`):

  ```json
  {
    "Cors": {
      "AllowedOrigins": [
        "https://pivot.claude.ai",
        "http://localhost:8080"
      ]
    }
  }
  ```

Restart the gateway after making these changes. If you open the page directly from `file://`, its origin is `null` and most browsers will block it through CORS. Serve it through Apache or any local HTTP server instead.

### 2. Apache: serve the static files

Copy the three files to Apache’s `DocumentRoot` (such as `htdocs/`). No additional modules or `.htaccess` configuration are required.

### 3. Usage

1. Open the page and select **Manage** in the top-right corner, then add a gateway (name / Base URL / API Key).
2. Select the active gateway; the page automatically fetches `/health` and `/admin/mappings`.
3. Add, edit, or delete rules. Changes take effect immediately and persist to `mappings-runtime.json` on the backend.

## Multiple gateways

- The gateway list (name / Base URL / API Key) is stored in the browser’s `localStorage` (`aiGatewayAdmin.v1`) and is never uploaded.
- Each gateway stores its own `x-admin-key`; switching gateways switches the backend target.

## Reordering rules

Rules are matched from top to bottom using first-match-wins, so order determines priority. The page provides two ways to reorder them:

- **Move up / Move down buttons:** the `↑` / `↓` controls in each row’s action column immediately move the rule one position and submit the complete list.
- **The `Position INDEX` field in the edit modal:** enter a 1-based position corresponding to the `#` column and save to move the rule there. Leave it blank to keep the current position or append a new rule to the end.

Reordering submits the **complete effective list** through `PUT /admin/mappings`, so every current rule, including base defaults, becomes a runtime override. An empty prefix (catch-all) is always pinned to the end.

## Hardening configuration

Use the harden dialog to turn the current effective rules into base defaults. The dialog provides two export formats:

- **appsettings.json:** generates a `ModelMapping:Rules` snippet containing each rule’s `Prefix`, `Target`, `Backend`, and `ProxyServer`, plus the independent classifier `Target`, `Backend`, and `ProxyServer` route.
- **docker-compose env:** generates an `environment:` variable snippet (`ModelMapping__Rules__{i}__Prefix/Target/Backend/ProxyServer` and `Classifier__Target/Backend/ProxyServer`) for the service’s `environment:` section. Environment variables override `ModelMapping:Rules` by index.

Restart the gateway or container after hardening. Then use **Reset All Overrides** in the panel to clear runtime state so the base configuration becomes the only source.

## Behavior and known limitations

- **`target` may be empty:** an empty `target` means “match this prefix but keep the original model name unchanged (do not rewrite).” `PATCH` and `PUT` behave consistently; the field is optional.
- **Named backends:** each mapping and classifier route has an independent `backend` field. The UI loads the current backend names from `GET /admin/backends`, merges any names already present in loaded routes, and always offers `openrouter` as the default when a mapping omits `Backend`.
- **Classifier route:** `/admin/classifier` uses `target`, `backend`, and `proxyServer` independently; an empty `target` disables the classifier route and does not consult mapping rules.
- **Prefixes containing `/`:** the request path uses `encodeURIComponent`, so no manual escaping is required.
- **Empty prefix (catch-all):** because `PATCH` cannot address it, the frontend uses a complete `PUT`; the page always places the catch-all rule at the end (the backend uses first-match-wins).
- **Base vs. runtime:** `GET /admin/mappings` returns a merged view without identifying the source. If a rule remains after deletion, it came from the `appsettings.json` default and has been restored; the page displays a notice.
- **Reordering / entering an index uses a complete `PUT`:** this writes the current complete list, including base rules, as runtime overrides. Later changes to a same-named base rule in `appsettings.json` will be hidden by the runtime override; use **Harden Configuration + Reset All Overrides** to reconcile them.
- **`PUT` replaces rather than merges:** it is used for reordering, **Reset All Overrides**, and empty-prefix operations. A normal single-rule edit still uses `PATCH`.

## Model discovery catalog

Use the **Model Discovery** panel to see the selected gateway's discovery status and effective model count, and **Manage Catalog** to edit its shared administrator-maintained catalog returned by `/v1/models`. The catalog has an enabled flag and model entries with a required `id` plus optional `displayName`, `ownedBy`, and `createdAt`. The dialog accepts `createdAt` in local `YYYY-MM-DDTHH:mm` date/time format using the browser picker or manual entry; leaving it blank sets it to the current time when saving. A successful save closes the dialog; errors keep it open. Catalog entries do not create routing mappings.

Saving the list stores each displayed model as a runtime entry. The backend merges runtime entries before configured base entries by case-insensitive model ID. A runtime entry replaces a matching base entry; unshadowed base entries remain in the effective catalog. Removing a row in the dialog therefore does not hide a matching base model, and later base-config changes to a listed ID remain masked by its runtime copy. **Restore Base Configuration** sends DELETE to discard all runtime discovery overrides and return to the configured baseline; it does not delete that baseline.

## Backend contract

- `GET/PUT /admin/mappings`, `GET/PATCH/DELETE /admin/mappings/{prefix}` (requires `x-admin-key`)
- `GET /admin/backends` (requires `x-admin-key`; returns backend names for selectors)
- `GET/PUT/DELETE /admin/model-discovery` (requires `x-admin-key`; GET returns `{ enabled, models }`; PUT replaces runtime discovery settings and returns the effective merged view; DELETE removes the runtime override and restores the configured baseline)
- Each model entry uses `id` (required), with optional `displayName`, `ownedBy`, and ISO-8601 `createdAt`.
- `GET /health` (no authentication required)
- camelCase fields: `prefix` / `target` / `backend` / `proxyServer` for mappings and `target` / `backend` / `proxyServer` for classifier responses; all admin requests require `x-admin-key`
