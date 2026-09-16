# AegisBid Midnight integration — real-chain path

> Status: **DEPLOYED on local `undeployed` network (2026-09-16).** Contract
> `75e339942b5d9f07bd9713b13b12cdf9f10ebf68e487fd894fc8e7a21bdbe390`,
> exercised end-to-end with real proofs — bid tx `0048722c…` (block 825),
> evaluate tx `002687c0…`, settle tx `009e088c…`, receipt `winningValue=1200`,
> phase `Settled`. Reachable via the VPS + SSH tunnels (see
> `docs/VPS-DEPLOY.md`). Not on preprod / mainnet. This repo contains no
> generated bindings (`managed/` is local build output).

## What exists today

- `contracts/aegis_bid.compact` — 0.16 baseline, 24 structural gates green
  (`bun run compact:check`). Full compile still needs the real toolchain.
- `src/features/aegis/midnight/networks.ts` — pinned endpoints for
  `undeployed` / `preview` / `preprod` / `mainnet` (indexer v4, local proof
  server), zero-dependency, 3 tests.
- `src/features/aegis/midnight/contract.ts` — deployment-status helper,
  ledger-shape mapping (`toLedgerTenderConfig`), witness builders for
  `submitBid` / `settle`, dynamic bindings loader. 7 tests.
- `scripts/midnight-deploy.mjs` — compile + wallet + providers + `deployContract`
  + on-chain verification, with `--e2e` exercising all three circuits
  (reconciled against generated `index.d.ts`, toolchain 0.31.1).
- Deploy host notes: run under `node --import tsx/esm` (tsx loader for the
  local-dev TS helpers); keep ONE `@midnight-ntwrk` tree — symlink the scope
  to `midnight-local-dev/node_modules` (two copies cause
  `expected instance of …` WASM failures); pin `compact-runtime@0.16.0` to
  match the bindings; give the proof server swap (it OOMs proving `settle`
  on small boxes — exit 137).
- Browser wallet (`wallet.ts`, Lace connector) and read-only indexer view
  (`chain.ts`) are wired but untested against a live chain.

Pinned versions (docs support matrix, Sep 2026): Midnight.js `4.1.1`,
compact toolchain `0.31.1`, proof server `8.1.0`, indexer v4.

## Path to first deployment (local, nothing at risk)

```bash
# 1. Toolchain + local network (separate checkout, needs Docker)
git clone https://github.com/midnightntwrk/midnight-local-dev.git ../midnight-local-dev
npm --prefix ../midnight-local-dev install
npm --prefix ../midnight-local-dev start   # node :9944, indexer :8088, proof server :6300

# 2. Compile this contract with the real compiler
MIDNIGHT_COMPACT_BIN=<path/to/compact> bun run compact:check
# expect: managed/aegis-bid/{contract,zkir,keys}

# 3. Reconcile src/features/aegis/midnight/contract.ts mapping helpers
#    against managed/aegis-bid/contract/index.d.ts, then finish the
#    deployContract call marked in scripts/midnight-deploy.mjs

# 4. Deploy
node scripts/midnight-deploy.mjs --network undeployed
# prints the contract address → set VITE_AEGISBID_CONTRACT → rebuild

# 5. Verify
node scripts/midnight-status.mjs
# check the address on the indexer: { block { height } } at :8088
```

## Promoting to preprod

1. Fund a wallet: faucet tNIGHT, register for tDUST in Lace
   (`docs.midnight.network/guides/acquire-tokens`).
2. `export MIDNIGHT_SEED=<64-hex>` (never commit it).
3. `node scripts/midnight-deploy.mjs --network preprod`.
4. Confirm the address on a preprod explorer, then record it in
   `managed/DEPLOYMENTS.md`.

## Why the SDK is not in package.json yet

The full `@midnight-ntwrk/*` tree is heavy and timed out resolving on this
machine. The browser layer therefore uses dynamic imports with helpful
errors, and the deploy script installs/validates its own requirements at
run time. Once a deploy machine with Docker + toolchain is available, pin
the matrix versions into `package.json` (see the install list in
`guides/deploy-and-operate`).
