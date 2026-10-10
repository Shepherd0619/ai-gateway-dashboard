---
name: playwright-api-mocking
description: Use when testing a browser-based application with Playwright and its API is unavailable, unsafe to mutate, or needs deterministic success and failure responses; applies to route interception, API fixtures, UI exports, and browser-level integration checks.
---

# Testing Browser UIs with Playwright API Mocks

Use Playwright to exercise the real page and user-visible controls while replacing only the API boundary needed for a deterministic scenario. A mocked browser test proves frontend behavior against the supplied fixture; it does not prove that a live service has the same contract.

## Workflow

1. Start the application using its documented development or static-server command. Keep it on loopback unless the user explicitly authorizes a different exposure and the environment permits it.
2. Inspect the page and source/API contract to identify the exact origin, method, path, request shape, response shape, and user-visible trigger. Treat unknowns as assumptions to verify, not facts to invent.
3. Register Playwright routes **before navigation or before the action that triggers the request**. Match the narrowest practical origin, method, and path. Use deterministic fixtures with representative optional fields and ordering.
4. Prevent accidental live mutations. Abort unexpected API requests and non-read methods, or explicitly assert that the test generated none. Do not route unrelated traffic to a success fixture.
5. Use accessible role/name locators for the actual UI flow. Assert visible output and behavior (including format switching, copy/download when relevant), not just that controls exist. Capture a screenshot when visual state matters.
6. Exercise relevant error states: failed status/network, malformed payload, empty data, and delayed response where loading or cancellation matters. Verify the UI reports failure and does not silently render an incomplete success state.
7. Check browser console errors and network requests. Report which requests were mocked and whether any live backend was available. Keep mock-based frontend evidence separate from live integration claims.

## Playwright route pattern

Adapt the fixture, origin, method, and path to the contract under test. Install this before `page.goto`:

```js
const apiOrigin = 'http://127.0.0.1:4000';
const catalog = {
  enabled: true,
  models: [
    { id: 'model-a', displayName: 'Model A', ownedBy: 'provider' },
    { id: 'model-b' },
  ],
};

const intercepted = [];
await page.route(`${apiOrigin}/**`, async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  intercepted.push({ method: request.method(), pathname: url.pathname });
  if (url.origin === apiOrigin && url.pathname === '/admin/model-discovery' && request.method() === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalog),
    });
  }
  return route.abort();
});

await page.goto(appUrl); // Register interception before eager page-load requests.
await page.getByRole('button', { name: /manage catalog/i }).click();
await expect(page.getByRole('dialog')).toBeVisible();
await expect.poll(() => intercepted.filter((r) => r.pathname === '/admin/model-discovery').length).toBeGreaterThan(0);
expect(intercepted.filter((r) => !['GET', 'HEAD'].includes(r.method))).toEqual([]);
```

If overlapping route handlers are used, verify handler precedence in the installed Playwright version. Prefer one origin-level handler that explicitly branches on origin, method, and pathname when precedence could be ambiguous. Record intercepted requests, assert the expected mock was hit, and verify no unexpected or mutating API request escaped it.

## Export assertions

For JSON/YAML/Compose or other generated output, parse structured output when possible; otherwise assert stable semantic fields rather than fragile whitespace. Check enabled state, item order, optional metadata, and empty-catalog behavior. For downloads, wait for and inspect the downloaded artifact instead of treating the click as proof of its contents.

## Common mistakes

| Mistake | Better practice |
|---|---|
| Installing a route after the initial request | Register routes before navigation/action and verify the request was intercepted. |
| Using `**/*` and returning success for everything | Match exact API origin/path/method; abort unexpected API traffic. |
| Claiming a mock proves backend compatibility | Label it frontend behavior against a fixture; run a separately authorized live integration test for compatibility. |
| Treating connection failure as permission to expose a service | Respect the denial. Do not switch to `0.0.0.0`, a tunnel, forwarding, another tool, or another process to achieve the same exposure. Ask for authorization or stop with the limitation. |
| Reporting a screenshot as a functional assertion | Assert the visible data and state transitions; use screenshots as supplemental evidence. |
| Hiding failed requests or console errors | Inspect and report them; distinguish expected failures from regressions. |
