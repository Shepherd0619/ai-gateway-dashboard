# Repository guidance

## Static frontend cache busting

This dashboard is deployed as a dependency-free static site with native ES modules. When a release changes browser JavaScript or CSS:

- Bump one shared `?v=<release-id>` token in both HTML entrypoints and every local ES-module import, including transitive imports. Versioning only the top-level script is insufficient because cached modules can still be mixed across releases.
- Deploy the updated HTML and assets together. Where hosting headers are configurable, make HTML entrypoints revalidate rather than retaining old asset URLs for a long `max-age`.
- Run `npm test`; `tests/asset-cache.test.js` verifies that entrypoints, stylesheets, and local module imports use the same version token. Extend that test if adding another HTML entrypoint or local module graph.
