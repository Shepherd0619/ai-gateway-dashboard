# Tool setup documentation

Open [Tool Setup](../../tool-setup.html), or select **Tool Setup** in the dashboard navigation. The English guide covers Claude Code, OpenAI Codex, Anthropic and OpenAI Python SDKs, and live model routing.

## Production data sources

- Reuses the dashboard gateway list and selection stored in `aiGatewayAdmin.v1`. The fallback entry uses the placeholder `https://gateway.example.com`; configure your actual gateway in the console.
- With an admin key, reads `GET /admin/model-discovery`, `GET /admin/mappings`, and optionally `GET /admin/backend-translations`. The admin key is sent only in request headers and never included in documentation or examples. A failed or malformed translation response leaves that status unknown and does not discard a valid catalog or mapping response.
- Without saved admin configuration, reads only public `GET /v1/models`; mappings and backend translation settings are unavailable. The page does not infer translation status from a model or backend name.
- When local model discovery is disabled, reads the upstream catalog through `/v1/models`. If upstream authentication is required, the page reports failure rather than forwarding the admin key as an inference credential.
- Reloads on gateway changes, manual refresh, gateway storage changes in another tab, and when the page becomes visible. Refreshes every 60 seconds while visible. URL or model changes regenerate the examples. Failures and timeouts clear stale examples.

## Generated configuration

Claude uses the gateway root URL and the native Anthropic Messages path `/v1/messages`. OpenAI SDK and Codex base URLs append `/v1` to the root. Examples do not depend on Vertex projects, fixed third-party model catalogs, external pricing, or another platform's token system.

Both SDKs can select shared catalog aliases. Names do not establish the actual model vendor or protocol support. OpenAI options prioritize catalog IDs beginning with `openai/` or `gpt-`, followed by current OpenAI routing targets that can be used unchanged, then other shared aliases. Route resolution follows the backend ModelMapper: case-insensitive prefix matching, chained rewrites, the first explicit backend, and cycle detection. Missing routing data is labeled **Unverified**.

On Claude Code and API Clients, protocol guidance uses the selected Claude model's resolved route and exact backend name. Only `POST /v1/messages` follows that backend's translation switch. When enabled, Anthropic Messages are translated to the configured Chat Completions or Responses upstream; when disabled, Anthropic Messages are forwarded with model rewriting. Other paths are not transformed by this switch, and `/v1/messages/*` subroutes are unsupported when translation is enabled. If admin translation settings are unavailable or malformed, the status is unknown; the page does not infer it from model or backend names.

Gateway protocol translation and upstream model capability are separate. Translation settings describe the gateway's protocol behavior; model names, catalog entries, and health checks do not prove that a model supports the resulting protocol or client features. Verify inference, tool calls, and multi-turn behavior with the upstream provider.

Credential commands prompt for the reader's own upstream API key. The page does not collect, store, or copy real inference keys. PowerShell 7.1+, Bash, and Zsh are supported. Codex uses `env_key = "AI_GATEWAY_API_KEY"` and the Responses API.

Claude Desktop deployment settings and other vendors are outside the current scope. The webpage replaces the earlier reference-site Markdown and its dedicated scripts.

## Implementation and validation

- `tool-setup.html` and `tool-setup.css`: documentation layout using the shared dashboard theme, with no third-party dependencies.
- `tool-setup.js`: navigation, gateway and model selection, read-only synchronization, copying, and status messages.
- `tool-docs.js`: configuration loading, route resolution, backend translation status and guidance, and example generation.
- `tests/tool-docs.test.js`: optional translation-setting reads, malformed and failed translation responses, no-admin-key behavior, exact selected-route backend resolution through chained mappings, protocol guidance, credential boundaries, and generated examples.

Serve `tool-setup.html` with a static HTTP server. Deploy it under the same origin as the dashboard to share saved gateway configuration. Gateway CORS must allow that origin.

Production configuration was inspected read-only in local Chrome on 2026-10-30. No production keys were saved, mappings or catalogs changed, or paid inference requests made.

Current automated validation: `node --test tests/tool-docs.test.js` passes all 14 focused Tool Setup tests, and `npm test` passes all 76 project tests. Earlier browser fixture checks covered gateway and shell changes, model selection, copying, HTTP 503, malformed JSON, empty catalogs, missing admin configuration, and rapid switching. The layout had no page-level horizontal overflow at a 375px content viewport. Direct production `/v1/models` access returned five aliases matching the console catalog. Cross-origin production reads from the local preview failed; deployed integration remains to be verified.

English translation checks covered all four documentation sections and an HTTP 503 error using mocked read-only API responses. Production-provided gateway names and model display names remain unchanged.

Codex configuration fields follow the [OpenAI gateway connection guide](https://learn.chatgpt.com/docs/enterprise/connect-to-a-gateway).
