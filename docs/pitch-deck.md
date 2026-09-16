# AegisBid — Pitch Deck (Wave 1)

Convert to slides (Google Slides / PowerPoint / PDF) before submitting to
AKINDO. Each section below is one slide. Target: 8 slides, 5-minute read.

---

## 1. Title

**AegisBid — Private bidding, made simple.**
Zero-knowledge shielded tenders on Midnight Network.
Team, date, contact. Link to live demo + GitHub repo.

## 2. Problem

Conventional on-chain auctions expose economically sensitive bid values.
Off-chain tenders preserve secrecy but require trust in the evaluator.
Result: bidders shade bids, issuers can't prove fairness, losing prices leak.

## 3. Solution

AegisBid separates public verification from private data:

- Bidder device keeps amount, salt, identity witness locally.
- Public ledger receives only commitment, nullifier, proof receipt.
- Settlement circuits prove the winner is optimal and policy-compliant.
- Losing amounts, salts, identities never enter public state.
- The winning value is disclosed only as an explicit settlement output.

## 4. How it works on Midnight

Dual-ledger diagram (see README):

1. **Commit phase** — `submitBid` circuit proves tender open, deadline
   unelapsed, nullifier unused, commitment fresh.
2. **Evaluate** — `beginEvaluation` locks the tender after the deadline.
3. **Settle** — `settle` circuit checks membership of every candidate,
   pairwise ordering (`>=` highest-bid / `<=` lowest-compliant), reserve /
   ceiling policy, then publishes `SettlementReceipt`.

Private state: `localBidAmount`, `localBidSalt`, `localIdentitySecret`.
Public state: `tender`, `phase`, `commitmentCount`, `commitments`,
`nullifiers`, `settlement`.

## 5. Demo (screenshots / GIFs)

- Tender explorer + creation dialog.
- Shielded bid terminal: amount → sealed commitment, proof receipt.
- Settlement view: winner commitment, clearing value, comparison root,
  losing values redacted.
- QA runner: three scenarios green (see `npm test`).

## 6. Technical depth

- `contracts/aegis_bid.compact` — Compact language 0.16 baseline,
  `npm run compact:check` structural gate (24 checks: pragma, ledger,
  witnesses, circuits, `persistentCommit` hiding, disclosed nullifier,
  single-tuple `persistentHash`, constant-bounded settle loop,
  `Counter.read()`, guards).
- `src/features/aegis/tenderEngine.ts` — deterministic executable spec of
  the circuits (SHA-256 models `persistentCommit`); `npm test` asserts 18
  invariants (sealed-bid, reserve rejection, deadline rejection,
  double-identity prevention, ceiling procurement,
  non-optimal/incomplete rejection, plus 5 evaluator-adapter cases).
- Supports highest-bid AND lowest-compliant procurement modes.

## 7. Market & adoption path

Procurement, spectrum/energy auctions, DAO treasury spends, carbon markets —
any sealed process that needs public verifiability without leaking losing
prices. Path: Wave 2 — local-devnet integration with generated bindings +
evaluator flow; Wave 3 — pilot tender with a real issuer, audit prep.

## 8. Ask

Wave 1 development grant + feedback. Then: Midnight Build Club → refine
with a pilot issuer → Midnight Accelerator.
