# AegisBid Compact toolchain pin

Authoring baseline for `contracts/aegis_bid.compact`.

## Pinned baseline

- **Compact language:** `0.16` — contract declares `pragma language_version >= 0.16;`
  so any compiler accepting the 0.16 language (including newer 0.x compilers
  per the pragma-constraint rules) can compile it.
- **Standard library:** `import CompactStandardLibrary;`
- **Reference docs (accessed September 2026):**
  - Writing a contract — `https://docs.midnight.network/compact/reference/writing`
    (example contract uses `pragma language_version 0.16;`)
  - Compact reference, pragma form —
    `https://docs.midnight.network/compact/reference/compact-reference`
  - Compiler usage (`compact compile <file> <outdir>`, `--language-version`) —
    `https://docs.midnight.network/compact/compilation-and-tooling/compiler-usage`
  - Midnight local network —
    `https://docs.midnight.network/guides/midnight-local-network`

## How judges / CI verify

```bash
npm run compact:check
```

`scripts/compact-check.mjs` asserts the structural contract requirements
(pragma, stdlib import, public ledger fields, witness declarations,
`submitBid` / `beginEvaluation` / `settle` circuits, `disclose()` on the
only public value output) and — when a real Midnight compiler is available —
runs a full compile.

A full compile needs the Midnight toolchain, **not** the Windows NTFS
`compact.exe` that happens to share the name:

```bash
# 1. Follow the pinned midnight-local-dev release for your platform.
# 2. Point the check at the real compiler binary:
MIDNIGHT_COMPACT_BIN=/path/to/midnight-compact npm run compact:check
# which then runs:
#   compact compile contracts/aegis_bid.compact managed/aegis-bid
```

## Before a mainnet deployment

Pin an exact compiler release in CI, record `compact --version` output in
the release notes, reconcile any `0.16` → newer-language migration notes,
and re-run `npm test` (the TypeScript engine in
`src/features/aegis/tenderEngine.ts` is the executable spec of these
circuits) plus integration tests against `midnight-local-dev`.
