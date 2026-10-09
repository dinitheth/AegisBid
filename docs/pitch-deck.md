# AegisBid — Midnight Buildathon, Wave 2

Seven-slide source outline for `submission/AegisBid-Wave2.pptx`. Update team,
contact, demo URL, and any live evidence before submission. Do not present the
prototype as a production procurement system or claim an award/payment flow.

## 1. AegisBid

**Private bids. Publicly verifiable outcomes.**

Sealed tender evaluation on Midnight. Wave 2 · October 2026 ·
`github.com/dinitheth/AegisBid`

Add team names, contact, and the live demo URL before submitting.

## 2. The problem

Public-chain auctions can expose economically sensitive offers. Traditional
off-chain evaluation asks participants to trust the issuer's process.

AegisBid applies zero-knowledge proofs to the offer and winner checks, while
keeping the product flow familiar: publish policy, submit sealed offers,
evaluate after closing, inspect a public receipt.

## 3. Tender lifecycle

1. Issuer deploys a tender with a public deadline, selection rule, reserve or
   ceiling, and evaluator capability.
2. Bidder proves a sealed offer against the tender. The chain records a
   commitment and tender-scoped nullifier, not the offer amount.
3. After ledger time reaches the deadline, the evaluator opens the committed
   set and submits the candidate witnesses.
4. The Compact circuit checks membership, complete set, winner ordering, and
   reserve/ceiling. It publishes a receipt with the winning value.

## 4. What the ledger sees

**Public:** tender policy, deadline, commitment and nullifier membership,
phase, evaluator commitment, winning commitment, winning value, comparison
root.

**Private witnesses:** offer amount and salt during bidding; bidder key;
amount, salt, and bidder key for each candidate during evaluation.

The winning value is disclosed at settlement. Losing amounts and salts are
not written into the receipt. The evaluator must obtain the bid witnesses;
the current app supports encrypted witness-file handoff, not automatic
cross-device recovery.

## 5. Midnight implementation

`contracts/aegis_bid_v2.compact` targets Compact 0.23 / Ledger 8 and the
committed generated bindings and proof assets were built with Compact 0.31.1.
The V2 contract is deployed on Midnight Preprod and the app connects through
the 1AM wallet. The circuits use ledger block time, commitments, a tender-
scoped nullifier, an evaluator capability, and a bounded eight-bid settlement
comparison.

Engineering evidence: source contract, generated V2 package, deployed
Preprod address in `README.md`, static V2 invariant checks, and reproducible
tests. A local static check is not a substitute for a fresh full Compact
compile.

## 6. Verification and known limits

The project tests policy ordering, reserve and ceiling checks, deadline
gates, duplicate supplied bidder-key handling, provider wiring, and transaction
failure paths. A timeout is not reported as a sent transaction; the app avoids
automatically launching overlapping proof jobs.

Current limits: at most eight bids per tender; supplied bidder keys are not
real-world identity or Sybil resistance; proof preparation depends on 1AM;
cross-device witness handoff needs a separate trusted channel; the issuer
handles any real-world award or payment outside AegisBid. This prototype has
not had a security audit.

## 7. Product path

Initial users: public agencies and organizations running procurements where
losing price confidentiality matters. Pilot path: one low-risk, non-binding
tender with a willing issuer; test bidder onboarding, witness handoff, close,
and settlement before any production claim.

Next: make evaluator witness handoff recoverable across devices, validate
larger bid sets with an aggregation design, audit the contract and client,
and document the issuer's award/payment process. AegisBid proves a tender
outcome; it does not transfer an award or payment.

### Before publishing the deck

- Replace team/contact/demo placeholders with verified details.
- Record a fresh demo against the currently deployed V2 contract.
- Confirm whether AKINDO considers the existing project eligible under its
  conflicting Wave 2 eligibility wording; see `AKINDO-WAVE2-REVIEW.md`.
- Do not claim that the presenter is eligible or that a transaction succeeded
  unless the linked evidence supports it.
