# AegisBid — Wave 1 AKINDO Submission Pack

Buildathon: **Build Privacy-First Apps on Midnight**
(`https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG`)
Deadline: end of Wave 1 build period (Sep 16, 2026).

## 1. Links (fill before submitting)

- Public repo: `https://github.com/dinitheth/AegisBid` (branch `main`, this Wave's commit)
- Live demo URL: _(fill — deployed preview or `bun run dev` local)_
- Slide deck (PDF/Slides): _(export `docs/pitch-deck.md`, attach link)_
- Demo video (unlisted, ≤3 min): _(record per `docs/demo-script.md`, attach link)_

## 2. Wave 1 progress text (paste into AKINDO)

> AegisBid is a shielded tender / sealed-bid protocol on Midnight. Bidders
> keep amount, salt, and identity witness locally; the ledger receives only
> a `persistentCommit` binding, a disclosed `persistentHash` nullifier, and
> a settlement receipt. Settlement circuits prove the winner is optimal and
> policy-compliant (highest-bid reserve / lowest-compliant ceiling) while
> losing values stay redacted; only the clearing value is disclosed.
>
> Wave 1 delivered: `contracts/aegis_bid.compact` (0.16 baseline, 24
> structural gates green), a deterministic `tenderEngine.ts` executable spec
> (18 Vitest invariants green), an evaluator adapter (`evaluator.ts`) with
> friendly circuit errors, and a bidder + settlement UI (explorer, shielded
> bid terminal, history, comparison, settlement with receipts, wallet
> balance, results). Verified with `bun run test`, `bun run
> compact:check`, `bun run build`.
>
> Honest boundary: the browser is a deterministic workbench (SHA-256 models
> `persistentCommit`); full `compact compile` needs the pinned Midnight
> toolchain (`contracts/COMPACT_TOOLCHAIN.md`), and generated bindings +
> local-devnet integration with proof-server logs is Wave 2.

## 3. Judge verification (2 minutes)

```bash
bun install
bun run test          # 18 invariants green
bun run compact:check # 24 gates green (full compile via MIDNIGHT_COMPACT_BIN; see contracts/COMPACT_TOOLCHAIN.md)
bun run dev           # Settlement → Load 3 demo offers → Start evaluation → Settle
```

## 4. Manual steps (cannot be done via git push)

- [ ] GitHub → repo → About → Topics: add `midnightntwrk` (+ `midnight`, `privacy`, `zero-knowledge`, `compact`, `sealed-bid`).
- [ ] Export `docs/pitch-deck.md` to PDF/Slides; attach link.
- [ ] Record demo per `docs/demo-script.md`; upload unlisted; attach link.
- [ ] Every team member registered individually on AKINDO.
- [ ] Paste section 2 as the Wave progress description.
- [ ] Confirm the official rubric weights in AKINDO Rules (this repo's checklist weights are a working map).

## 5. Wave 2 plan

TypeScript bindings are generated (toolchain 0.31.1) and the contract is
**deployed on Midnight preprod**
(`daf54fc9…d0fc4`, deploy tx `a7d15020…`, block #2,634,493 — see
`docs/MIDNIGHT_INTEGRATION.md`), plus proven end-to-end on a local devnet
(settle receipt `winningValue=1200`). Next: live bid/settle calls against
the preprod deployment from the app, then pilot with a real issuer.
