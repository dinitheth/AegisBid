# AegisBid — private procurement for Midnight Wave 2

AegisBid is a privacy-preserving tender prototype for Midnight. Issuers publish the tender policy publicly, bidders submit sealed offers, and an authorized evaluator settles the result without publishing losing amounts or bid salts.

It is built for the **Midnight Wave 2** hackathon track and runs against **Midnight Preprod** through the 1AM wallet.

> Hackathon software, not an audited procurement system. Do not use it for real funds, regulated tenders, or production procurement.

## What V2 demonstrates

- **Sealed offers:** an offer amount and salt are private witness inputs; the public ledger receives a binding commitment rather than the amount.
- **On-chain tender timing:** bid acceptance and the transition to evaluation use Midnight ledger block time, not a timestamp supplied by the browser.
- **Correct policy enforcement:** highest-bid tenders require a winning amount at or above the reserve; lowest-compliant tenders require it at or below the ceiling.
- **Evaluator authorization:** deployment commits to a private evaluator capability. Only the holder can begin evaluation or settle.
- **Duplicate supplied-identity prevention:** a tender-scoped nullifier prevents reuse of the same supplied bidder key for that tender.
- **Inspectable results:** the public record exposes the winning commitment and settlement outcome while keeping losing offers sealed.

The evaluator must obtain private witnesses for every bid after closing. The
current UI supports encrypted witness-file handoff through a separate trusted
channel. This is not automatic recovery, and AegisBid does not transfer the
real-world award or payment.

## Live V2 deployment

The current V2 tender contract is deployed on Midnight Preprod:

```text
21b2efc6d75311c13c42f131ea48406539a5a461ecb32f7fb7e0e460e9bdc957
```

Use the app’s **Copy share link** action for the complete tender URL. The address alone identifies the contract, while the share link also carries display metadata that lets another browser discover the tender.

The app loads V2 proving assets by default from:

```text
https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@8c335f5f3edca4a431053bfd8ed137afbb2430b5/managed/aegis-bid-v2
```

Do not configure the legacy `VITE_ZK_CONFIG_BASE` for a V2 deployment. To host V2 assets elsewhere, set `VITE_AEGISBID_V2_ZK_CONFIG_BASE` to a directory containing the V2 `keys/` and `zkir/` folders.

## End-to-end demo

1. Open the deployed AegisBid app and connect a **synced 1AM Preprod** wallet.
2. As issuer, create a tender with a future deadline, policy, and reserve or ceiling. Save the generated contract address and share link.
3. In a second wallet/browser profile, open the share link and submit a bid. The first use downloads circuit assets and prepares a local ZK proof; 1AM asks for approval only after that preparation succeeds.
4. Once ledger time passes the deadline, return to the issuer browser to begin evaluation and settle.
5. Verify the result in the app and Midnight/1AM Explorer.

### Operational notes

- A 1AM `Request timed out` error occurs before a wallet approval is shown; **no bid was sent**. Confirm the wallet shows **Preprod · Synced**, then retry once. Do not keep clicking Submit.
- The evaluator capability is held in browser-local storage under `aegisbid-v2-evaluator-secret:<contract-address>`. Keep the deploying browser profile and back up the secret before clearing site data. Never share a wallet recovery phrase or this secret.
- The initial proving-key download and first proof can take minutes on Preprod. Keep the page and wallet open until the wallet approval appears.

## V2 contract and artifacts

| Item | Location | Purpose |
| --- | --- | --- |
| Deployable Compact contract | [`contracts/aegis_bid_v2.compact`](contracts/aegis_bid_v2.compact) | V2 tender rules and ZK circuits |
| Generated V2 bindings | [`managed/aegis-bid-v2/contract`](managed/aegis-bid-v2/contract) | Browser contract integration |
| V2 prover/verifier assets | [`managed/aegis-bid-v2`](managed/aegis-bid-v2) | `submitBid`, `beginEvaluation`, and `settle` proofs |
| Browser integration | [`src/features/aegis/midnight`](src/features/aegis/midnight) | 1AM connector, provider stack, deployment UI |
| Security-shape gate | [`scripts/compact-v2-check.mjs`](scripts/compact-v2-check.mjs) | Guards V2 invariants before release |

V2 uses Compact **0.31.1** / Ledger 8-compatible generated artifacts. The full V2 compile was verified on the Azure builder VM because the Compact ZK backend requires a compatible AVX-capable CPU.

### Practical proving bound

V2 settles at most **8 bids per tender**. This is an explicit hackathon trade-off: the former 64-bid settlement circuit generated a ~153 MB prover, whereas V2’s settlement prover is about 19.6 MB. For larger procurements, split work into lots until a batched or recursive proof design is available.

## Important limitations

- Preprod’s current Compact/Ledger toolchain does not provide a circuit-level `kernel.caller()` binding. V2 prevents duplicate **supplied** bidder keys, but cannot yet prove that the key belongs to the wallet that submitted the transaction. It is not Sybil resistance or verified real-world identity.
- Bid timing, transaction origin, and other network metadata may be visible.
- The evaluator must retain the private capability and bid witnesses needed for settlement.
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
                                     public settlement outcome
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

`npm run compact:v2:check` asserts the V2 security properties that matter for Wave 2: ledger-time gating, evaluator capability, bidder nullifier usage, highest-floor/lowest-ceiling behavior, and the eight-bid proving bound.

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
