# AegisBid test suite

This directory is the repository's single test entry point. It contains the
Vitest suites for the browser protocol model, wallet integration, Midnight
provider construction, V2 contract bindings, and failure diagnostics.

Run the complete suite from the repository root:

```bash
npm test
npm run compact:v2:check
```

The test files deliberately import the production code from `src/`; they do
not duplicate the implementation. `compact:v2:check` complements Vitest with
static security gates for the deployable Compact V2 source.
