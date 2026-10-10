# AegisBid — Private tendering on Midnight

**Private, verifiable tendering on Midnight.**

AegisBid is a privacy-preserving tender prototype for Midnight. Issuers publish the tender policy publicly, bidders submit sealed offers, and an authorized evaluator records a settlement result without publishing losing amounts or bid salts.

It is built for the **Midnight Wave 2** hackathon track and runs against **Midnight Preprod** through the 1AM wallet.

> Hackathon software, not an audited procurement system. Do not use it for real funds, regulated tenders, or production procurement.

## What V2 demonstrates

- **Sealed offers:** an offer amount and salt are private witness inputs; the public ledger receives a binding commitment rather than the amount.
- **On-chain tender timing:** bid acceptance and the transition to evaluation use Midnight ledger block time, not a timestamp supplied by the browser.
- **Policy checks over supplied witnesses:** highest-bid tenders require the selected amount to meet the reserve; lowest-compliant tenders require it to meet the ceiling. The completeness limitation below means V2 does not yet prove that the selected bid is optimal across every committed offer.
- **Evaluator authorization:** deployment commits to a private evaluator capability. Only the holder can begin evaluation or settle.
- **Duplicate supplied-identity prevention:** a tender-scoped nullifier prevents reuse of the same supplied bidder key for that tender.
- **Inspectable results:** the public record exposes the winning commitment and settlement outcome while keeping losing offers sealed.

The evaluator must obtain private witnesses for every bid after closing. The
current UI supports encrypted witness-file handoff through a separate trusted
channel. This is not automatic recovery, and AegisBid does not transfer the
real-world award or payment.

### V2 settlement limitation

The current V2 circuit checks that the declared winner and each supplied
candidate witness match a committed offer, compares the supplied amounts, and
enforces the reserve or ceiling. It checks the supplied witness count against
the public commitment count, but it does **not** require the supplied
commitments to be distinct. An evaluator could therefore repeat a committed
bid and omit another one. V2 does not prove that the selected offer is truly
optimal across the complete committed set. Treat settlement as a prototype
result, not a trustworthy proof of optimal selection. This is a Wave 3 fix.

## Live V2 deployment

The current V2 tender contract is deployed on Midnight Preprod:

```text
21b2efc6d75311c13c42f131ea48406539a5a461ecb32f7fb7e0e460e9bdc957
```

Use the app’s **Copy share link** action for the complete tender URL. The address alone identifies the contract, while the share link also carries display metadata that lets another browser discover the tender.

The app uses the following pinned base URL for V2 proving assets:
`https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@8c335f5f3edca4a431053bfd8ed137afbb2430b5/managed/aegis-bid-v2`.
This is a URL prefix, not a browsable folder page. Opening the prefix by itself
returns a 404; the individual files are available, for example:
[`submitBid.prover`](https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@8c335f5f3edca4a431053bfd8ed137afbb2430b5/managed/aegis-bid-v2/keys/submitBid.prover),
[`submitBid.verifier`](https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@8c335f5f3edca4a431053bfd8ed137afbb2430b5/managed/aegis-bid-v2/keys/submitBid.verifier),
and [`submitBid.bzkir`](https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@8c335f5f3edca4a431053bfd8ed137afbb2430b5/managed/aegis-bid-v2/zkir/submitBid.bzkir).

Do not configure the legacy `VITE_ZK_CONFIG_BASE` for a V2 deployment. To host V2 assets elsewhere, set `VITE_AEGISBID_V2_ZK_CONFIG_BASE` to a directory containing the V2 `keys/` and `zkir/` folders.

### Runtime integration

- The browser connects to the 1AM wallet for account access, transaction approval, and proof generation. Midnight's public GraphQL indexer supplies contract state, transaction activity, and the latest network block time.
- Browser reads to the official Midnight Preview, Preprod, and Mainnet indexers use the same-origin `POST /api/midnight/indexer?network=<network>` route. This avoids browser CORS failures; the server route only forwards bounded read-only GraphQL requests to the selected official indexer and does not proxy arbitrary URLs.
- V2 proof configuration is pinned by `aegis-v2-8c335f5f3edca4a431053bfd8ed137afbb2430b5`. A tender share link carries its public policy and this proof-configuration ID, while live commitment counts and settlement status are read from the indexer. Links for incompatible or retired V1 deployments are not treated as active V2 tenders.
- The flagship tender is the verified V2 Preprod deployment listed above. Issuer-created tender records are stored locally; use **Copy share link** to share the tender policy and address with another browser. Optional shared discovery can be configured with the server-side registry variables below.

## End-to-end demo

1. Open the deployed AegisBid app and connect a **synced 1AM Preprod** wallet.
2. As issuer, create a tender with a future deadline, policy, and reserve or ceiling. Save the generated contract address and share link.
3. In a second wallet/browser profile, open the share link and submit a bid. The first use downloads circuit assets and prepares a local ZK proof; 1AM asks for approval only after that preparation succeeds.
4. Once ledger time passes the deadline, return to the issuer browser to begin evaluation and settle.
5. Verify the result in the app and Midnight/1AM Explorer.

### Operational notes

- A 1AM timeout before the wallet approval is shown means the request did not reach transaction approval; no transaction was sent. Confirm the wallet shows **Preprod · Synced**, reload/reconnect 1AM if needed, and retry once. Do not repeatedly click Submit: proof generation may still be running, and the app does not automatically retry it.
- The evaluator capability is held in browser-local storage under `aegisbid-v2-evaluator-secret:<contract-address>`. Keep the deploying browser profile and back up the secret before clearing site data. Never share a wallet recovery phrase or this secret.
- The initial proving-key download and first proof can take several minutes on Preprod. The app allows up to ten minutes for proof generation and shows progress before the wallet approval step. Keep the page and wallet open until approval appears; a timeout is not proof that a transaction was submitted.

## V2 contract and artifacts

| Item | Location | Purpose |
| --- | --- | --- |
| Deployable Compact contract | [`contracts/aegis_bid_v2.compact`](contracts/aegis_bid_v2.compact) | V2 tender rules and ZK circuits |
| Generated V2 bindings | [`managed/aegis-bid-v2/contract`](managed/aegis-bid-v2/contract) | Browser contract integration |
| V2 prover/verifier assets | [`managed/aegis-bid-v2`](managed/aegis-bid-v2) | `submitBid`, `beginEvaluation`, and `settle` proofs |
| Browser integration | [`src/features/aegis/midnight`](src/features/aegis/midnight) | 1AM connector, provider stack, deployment UI |
| Same-origin indexer endpoint | [`src/routes/api.midnight.indexer.ts`](src/routes/api.midnight.indexer.ts) | Bounded read-only proxy to the official Midnight GraphQL indexers |
| Security-shape gate | [`scripts/compact-v2-check.mjs`](scripts/compact-v2-check.mjs) | Guards V2 invariants before release |

V2 uses Compact **0.31.1** / Ledger 8-compatible generated artifacts. Project notes report that the V2 package was compiled on an Azure builder VM because the Compact ZK backend requires a compatible AVX-capable CPU. This repository does not include a reproducible compiler log for that run, and a fresh compile has not been verified as part of this README review. A successful full Compact compile is required by the event's technical gate; the static check below is not a compile.

### Practical proving bound

V2 settles at most **8 bids per tender**. This is an explicit hackathon trade-off: the former 64-bid settlement circuit generated a ~153 MB prover, whereas V2’s settlement prover is about 19.6 MB. For larger procurements, split work into lots until a batched or recursive proof design is available.

## Important limitations

- Preprod’s current Compact/Ledger toolchain does not provide a circuit-level `kernel.caller()` binding. V2 prevents duplicate **supplied** bidder keys, but cannot yet prove that the key belongs to the wallet that submitted the transaction. It is not Sybil resistance or verified real-world identity.
- Bid timing, transaction origin, and other network metadata may be visible.
- The evaluator must retain the private capability and bid witnesses needed for settlement.
- Settlement witnesses are not required to be distinct, so a repeated committed bid can mask an omitted bid. V2 therefore does not guarantee complete-set optimality; do not rely on the selected result as a proven global winner until this is fixed and verified.
- This repository includes legacy V1 material for history and comparison. New work must use `aegis_bid_v2.compact` and V2 assets.
- No security audit, production key-management design, or compliance review has been performed.

## Architecture

```text
Bidder browser + 1AM                 Midnight Preprod
--------------------                 -------------------------------
private amount + salt  -- ZK proof -> commitment and nullifier
private bidder key                  tender policy and phase
                                     commitment count
Issuer evaluator capability  ------> authorized evaluation/settlement
                                     public winning receipt

Browser reads to the official public indexer are routed through the app's
same-origin server endpoint, avoiding direct browser CORS requests. Transaction
proofs and approvals still go through the connected 1AM wallet.
```

The UI also contains a deterministic local protocol model used for fast, repeatable tests. It is a test harness; live contract behavior is supplied by the V2 Compact contract and generated artifacts.

## Local setup

Requirements:

- Node.js 22+
- npm or Bun
- Docker only when running the optional Midnight local network/proof service
- 1AM wallet for the live Preprod flow

```bash
npm install
npm run dev
```

Open the URL printed by Vite. For a production build:

```bash
npm run build
```

Useful environment variables are documented in [`.env.example`](.env.example):

- `VITE_MIDNIGHT_NETWORK_ID`
- `VITE_AEGISBID_CONTRACT` for the legacy/default contract path
- `VITE_AEGISBID_V2_ZK_CONFIG_BASE` for an intentional V2 asset mirror
- `TENDER_REGISTRY_URL` and `TENDER_REGISTRY_TOKEN` for optional shared tender discovery (server-side only)

## Tests and verification

All executable tests are in the root-level [`tests/`](tests) folder. They import production modules from `src/` rather than copying implementation code.

```bash
npm test                 # Vitest protocol, wallet, provider, and UI-model checks
npm run compact:v2:check # V2 static contract security gates
npm run build            # production browser/server build
```

| Test suite | Coverage |
| --- | --- |
| `tests/tenderEngine.test.ts` | Highest/lowest winner selection, reserve/ceiling, deadlines, duplicates, state safety |
| `tests/evaluator.test.ts` | UI-to-protocol mapping and settlement adapter behavior |
| `tests/hash.test.ts`, `tests/storedBids.test.ts` | Commitment model and local bid persistence/migration |
| `tests/chain.test.ts` | Tender discovery, shared links, live-count overlays, registry validation |
| `tests/wallet.test.ts` | Wallet balance display handling |
| `tests/midnight.contract.test.ts` | Generated contract mapping and witness construction |
| `tests/midnight.providers.test.ts` | V2 asset path, 1AM-only connector detection, provider assembly, private-state scope |
| `tests/midnight.oneAmWallet.test.ts` | Connector discovery, timeouts, and wallet error messages |
| `tests/midnight.networks.test.ts` | Pinned network configuration |
| `tests/midnight.forensics.test.ts` | Transaction-assembly diagnostic retention |

`npm run compact:v2:check` performs structural checks for ledger-time gating, evaluator capability, bidder nullifier usage, highest-floor/lowest-ceiling conditions, and the eight-bid proving bound. It does not invoke the Compact compiler and does not establish that the settlement witness set is complete or unique. The Vitest protocol/model tests also do not substitute for checking the compiled contract's behavior.

## Midnight local development and recompilation

Use the official [Midnight local network guide](https://docs.midnight.network/guides/midnight-local-network) and pin the toolchain version before regenerating artifacts. A typical flow is:

```bash
# Start the version-pinned Midnight local network and proof service.
compact --version
# Compile V2 with Compact 0.31.1 on a compatible Linux/AVX builder.
compactc contracts/aegis_bid_v2.compact managed/aegis-bid-v2
npm run compact:v2:check
```

The Azure Ubuntu builder VM was used to compile the current V2 package; it is a build environment, not a public proof server. Keep it stopped when unused to avoid charges.

## Project resources

- [Wave 1 submission archive](docs/WAVE1-SUBMISSION.md)
- [Wave 2 submission notes](docs/WAVE2-SUBMISSION.md)
- [Event criteria, rules conflicts, and readiness review](docs/AKINDO-WAVE2-REVIEW.md)
- [Wave 2 pitch deck source](docs/pitch-deck.md)
- [Prepared Wave 2 slide deck](submission/AegisBid-Wave2-v2.pptx)
- [Demo script](docs/demo-script.md)
- [Midnight integration notes](docs/MIDNIGHT_INTEGRATION.md)
- [Compact documentation](https://docs.midnight.network/compact/reference/compact-reference)
- [Midnight installation guide](https://docs.midnight.network/getting-started/installation)

## License

[Apache-2.0](LICENSE)
