# AegisBid

AegisBid is a zero-knowledge shielded tender and sealed-bid protocol designed for Midnight Network. It lets an issuer receive binding bids, prove the correct winner, and publish an auditable settlement without exposing losing bids or bidder secrets.

> The browser application in this repository is a deterministic protocol workbench. It demonstrates the intended contract states, privacy boundary, proof lifecycle, settlement outputs, and QA cases locally. It does not claim that the included simulation is a live Midnight deployment.

## Judge quickstart (Midnight Buildathon, Wave 1)

```bash
bun install        # or: npm install
bun run test       # 13 protocol invariants (Vitest) — must be green
bun run compact:check  # 19 contract structural gates — must pass
bun run dev        # open the printed local URL
```

- Contract: [`contracts/aegis_bid.compact`](contracts/aegis_bid.compact), Compact language 0.16 baseline — see [`contracts/COMPACT_TOOLCHAIN.md`](contracts/COMPACT_TOOLCHAIN.md) for the pinned references and full-compile instructions.
- Executable spec of the circuits: [`src/features/aegis/tenderEngine.ts`](src/features/aegis/tenderEngine.ts), asserted by [`tenderEngine.test.ts`](src/features/aegis/tenderEngine.test.ts), [`hash.test.ts`](src/features/aegis/hash.test.ts), [`storedBids.test.ts`](src/features/aegis/storedBids.test.ts).
- Bid commitments in the UI are SHA-256 bindings (`amount:salt:key`) from the same engine — see `BidPage` in [`src/features/aegis/AegisUserApp.tsx`](src/features/aegis/AegisUserApp.tsx).
- Submission pack: [`docs/pitch-deck.md`](docs/pitch-deck.md), [`docs/demo-script.md`](docs/demo-script.md), [`docs/submission-checklist.md`](docs/submission-checklist.md).
- License: Apache-2.0 (`LICENSE`). Repo topic `midnightntwrk` is set.

## Why shielded tenders

Conventional on-chain auctions expose economically sensitive values. Off-chain tenders preserve secrecy but require trust in the evaluator. AegisBid separates public verification from private data:

- bidders keep the amount, random salt, and identity witness locally;
- the public ledger receives a binding commitment, nullifier, timestamp, and proof receipt;
- settlement circuits prove that the winning committed value is optimal and policy-compliant;
- losing amounts, salts, and identities are not written to public state;
- the winning value is disclosed only as an explicit settlement output.

## Architecture

```text
Bidder device                     Midnight public state
------------------------------    --------------------------------
bid amount                        tender configuration
random salt          ZK proof     commitment hash
identity witness  --------------> identity nullifier
local witness store               commitment count
                                  phase and deadline
                                  settlement receipt
```

The interface calls this the dual-ledger model: private local state plus replicated public ledger state. This is a conceptual model of Midnight's public transcript and private computation; it is not a claim that Midnight runs two blockchains.

### Commitment phase

For each bidder public key `pk`, AegisBid derives:

```text
commitment = H(amount, salt, pk)
nullifier  = H(identitySecret, issuer)
```

The submission circuit proves the tender is open, the deadline has not elapsed, the identity nullifier is unused, and the commitment is new. Only the commitment and nullifier become public.

### Settlement phase

After the deadline, an authorized evaluator supplies committed bid witnesses to the settlement circuit. The circuit checks membership for every candidate and applies bounded pairwise comparisons:

- `winningAmount >= candidateAmount` for highest-bid auctions;
- `winningAmount <= candidateAmount` for lowest-compliant procurement;
- reserve or ceiling and specification constraints must also hold.

The public receipt contains the winner commitment, explicitly disclosed clearing value, comparison root, and settlement time. It does not contain losing values.

## Compact contract

The production-shaped reference contract is [`contracts/aegis_bid.compact`](contracts/aegis_bid.compact).

| Section | Purpose | Visibility |
| --- | --- | --- |
| `TenderConfig` | Deadline, mode, reserve and specification root | Public |
| `commitments` | Binding hashes of private bids | Public |
| `nullifiers` | One-submission identity protection | Public |
| `localBidAmount`, `localBidSalt` | Bid witnesses resolved by the DApp | Private |
| `submitBid` | Deadline, uniqueness and commitment circuit | ZK proof |
| `settle` | Membership, comparison and policy circuit | ZK proof |
| `SettlementReceipt` | Winner commitment and explicit public outputs | Public |

Compact is evolving. Pin a compiler release and reconcile syntax with that release before deployment. The contract is intentionally presented as production-shaped reference code rather than a claim of audited, mainnet-ready bytecode.

## Privacy guarantees and limits

### Guaranteed by the protocol design

- Raw bid values and salts do not enter public contract state during bidding.
- Commitments bind a bidder to one value without revealing it.
- Nullifiers prevent repeat use of the same private identity witness per issuer.
- Comparison proofs reveal the ordering result without publishing losing values.
- Public verification does not require trusting the browser simulation.

### Operational assumptions

- The bidder device and witness storage must remain uncompromised.
- Metadata such as submission timing and transaction origin can still be observable.
- Issuer authorization and compliant specification proofs must be integrated with the deployment's identity policy.
- Circuit parameters, cryptographic primitives, and generated bindings require independent review and audit.
- The local workbench models proof behavior but does not benchmark a production proof server.

## Run the interface

Requirements: Node.js 22+ and Bun.

```bash
bun install
bun run dev
```

Open `http://localhost:8080`.

The interface includes:

1. a filterable tender explorer and tender creation dialog;
2. a shielded bid terminal with deterministic local commitment generation;
3. a private/public scope inspector;
4. a staged local proof visualizer;
5. confidential winner verification and comparison receipts;
6. a line-numbered Compact source explorer;
7. deterministic QA simulations with assertions and logs.

## Midnight local development

Use the official [`midnight-local-dev`](https://github.com/midnightntwrk/midnight-local-dev) environment and the current [Midnight installation guide](https://docs.midnight.network/getting-started/installation). Exact commands and compiler syntax can change between releases; use the README and release notes of the version you pin.

A typical integration workflow is:

```bash
# 1. Start the pinned Midnight local network and proof server
# Follow the docker-compose command in the selected midnight-local-dev release.

# 2. Confirm the Compact compiler version
compact --version

# 3. Compile the contract with the pinned toolchain
compact build contracts/aegis_bid.compact

# 4. Generate or refresh TypeScript bindings using that release's CLI
# 5. Connect the generated API and witness provider to the UI
# 6. Run contract integration tests against the local node
```

The repository does not invent a fixed Docker command because `midnight-local-dev` topology and CLI flags are release-specific. Pin the toolchain in CI before replacing the deterministic browser adapter with generated bindings.

## QA scenarios

The QA runner is deterministic and repeatable:

| Scenario | Expected invariant |
| --- | --- |
| Three-party sealed bid | Correct committed winner; losing values absent from receipt |
| Under-reserve rejection | Settlement constraint fails; state remains unsettled |
| Post-deadline submission | Submission fails; commitment count is unchanged |

For network-level tests, repeat these cases through generated bindings against `midnight-local-dev`, assert both returned values and ledger state, and retain proof-server logs as artifacts.

## Hackathon judging alignment

### Engineering — 40%

- Explicit public/private state boundary.
- Commitment and nullifier model with deterministic state transitions.
- Support for highest-bid and lowest-compliant evaluation.
- Bounded winner-comparison circuit and explicit disclosure point.
- Production-shaped Compact source with a clear path to generated bindings.
- Failure states for duplicate identity, late submission, incomplete bid set, and unmet reserve.

### QA — 15%

Automated suite — `bun run test` (Vitest, 13 tests, all passing):

| Test file | What it proves |
| --- | --- |
| `src/features/aegis/hash.test.ts` | SHA-256 matches FIPS 180-4 vectors, deterministic |
| `src/features/aegis/tenderEngine.test.ts` | Three-party sealed bid (winner disclosed, losers redacted); under-reserve, post-deadline, duplicate-identity, non-optimal-winner, and incomplete-bid-set rejections; lowest-compliant ceiling mode |
| `src/features/aegis/storedBids.test.ts` | Legacy stored-bid migration; UI commitments match the protocol engine |

- Negative tests verify that rejected operations do not mutate ledger state.
- Test cases map directly to contract invariants (`tenderEngine.ts` mirrors `contracts/aegis_bid.compact`) and can be repeated against a local Midnight node.
- Three core simulations also execute directly in the application, each emitting ordered execution logs, assertions, timing, and pass status.

## Security status

AegisBid is a hackathon reference implementation and has not been audited. Do not use it to control real procurement, treasury, or regulated tender activity without a complete Compact compatibility pass, circuit review, key-management design, authorization policy, adversarial testing, and independent security audit.

## References

- [Compact reference](https://docs.midnight.network/compact/reference/compact-reference)
- [Privacy-first Compact concepts](https://docs.midnight.network/concepts/how-midnight-works/compact-privacy-first-language)
- [Writing a Compact contract](https://docs.midnight.network/compact/reference/writing)
- [Explicit disclosure](https://docs.midnight.network/compact/reference/explicit-disclosure)
- [Midnight local network](https://docs.midnight.network/guides/midnight-local-network)
