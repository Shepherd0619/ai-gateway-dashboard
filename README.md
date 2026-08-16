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

- **appsettings.json:** generates a `ModelMapping:Rules` snippet that can be copied or downloaded as `.json` and pasted into the `ModelMapping` section of `appsettings.json`.
- **docker-compose env:** generates an `environment:` variable snippet (`ModelMapping__Rules__{i}__Prefix/Target/ProxyServer`) for the service’s `environment:` section. Environment variables override `ModelMapping:Rules` by index.

Restart the gateway or container after hardening. Then use **Reset All Overrides** in the panel to clear runtime state so the base configuration becomes the only source.

## Behavior and known limitations

- **`target` may be empty:** an empty `target` means “match this prefix but keep the original model name unchanged (do not rewrite).” `PATCH` and `PUT` behave consistently; the field is optional.
- **Prefixes containing `/`:** the request path uses `encodeURIComponent`, so no manual escaping is required.
- **Empty prefix (catch-all):** because `PATCH` cannot address it, the frontend uses a complete `PUT`; the page always places the catch-all rule at the end (the backend uses first-match-wins).
- **Base vs. runtime:** `GET /admin/mappings` returns a merged view without identifying the source. If a rule remains after deletion, it came from the `appsettings.json` default and has been restored; the page displays a notice.
- **Reordering / entering an index uses a complete `PUT`:** this writes the current complete list, including base rules, as runtime overrides. Later changes to a same-named base rule in `appsettings.json` will be hidden by the runtime override; use **Harden Configuration + Reset All Overrides** to reconcile them.
- **`PUT` replaces rather than merges:** it is used for reordering, **Reset All Overrides**, and empty-prefix operations. A normal single-rule edit still uses `PATCH`.

## Backend contract

- `GET/PUT /admin/mappings`, `GET/PATCH/DELETE /admin/mappings/{prefix}` (requires `x-admin-key`)
- `GET /health` (no authentication required)
- camelCase fields: `prefix` / `target` / `proxyServer`
