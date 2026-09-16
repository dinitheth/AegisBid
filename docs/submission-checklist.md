# AegisBid — AKINDO Wave 1 Submission Checklist

Buildathon: **Build Privacy-First Apps on Midnight**
(`https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG`)

## Per-Wave submission (all required by the deadline)

- [ ] Public GitHub repo contains the submitted code (this repo).
- [ ] Repo carries the **`midnightntwrk` topic**: GitHub → repo page →
      ⚙️ About → Topics → add `midnightntwrk` (+ suggested: `midnight`,
      `privacy`, `zero-knowledge`, `compact`, `sealed-bid`). ⚠️ Cannot be
      set via `git push`; must be clicked in the web UI. `gh` CLI was not
      available on the build machine, so this step is still manual.
- [ ] README explains project, setup, architecture, Midnight integration,
      and how judges test it (see README Quickstart).
- [ ] Slide deck attached (export `docs/pitch-deck.md` to PDF/Slides).
- [ ] Demo / video pitch attached (record per `docs/demo-script.md`).
- [ ] Progress description for this Wave written on the AKINDO page.
- [ ] Apache-2.0 licensing in place (`LICENSE` + `package.json`).
- [ ] Every team member registered individually on AKINDO.

## Technical gate (auto-disqualify if missing)

- [x] ≥1 Compact contract: `contracts/aegis_bid.compact` (language 0.16).
- [x] Compiles: `npm run compact:check` passes; full compile documented in
      `contracts/COMPACT_TOOLCHAIN.md` (needs Midnight toolchain on judge side).
- [x] Meaningful new Midnight functionality (not a fork/copy).
- [ ] `midnightntwrk` topic set (manual step above).
- [x] Public repo + deck + demo video links on the AKINDO submission.

## Judging rubric coverage

> Weights below are the team's working map from the program materials.
> Confirm against the official "Midnight Buildathon Judging Rubric" link in
> the AKINDO Rules section before submitting — the hard gates are: contract
> compiles, private-state management, dual-ledger understanding, organized
> repo + clear README.

| Criterion (working weight) | Evidence |
|---|---|
| Engineering | Contract + `tenderEngine.ts` spec + `evaluator.ts` adapter, dual-ledger boundary, both modes, `persistentCommit`/`disclose` correctly applied |
| QA | `bun run test` — 18 invariants green; `bun run compact:check` — 24 gates green; Settlement page enforces the same rejections live |
| Product & Vision | README + deck slides 2–3, 7 |
| UX | Guided bidder flow, explorer, settlement views |
| Communication | Deck + 90-second demo video |
| BD & Viability | Deck slide 7, README adoption path |

## Wave 2 / 3 follow-ups

- [ ] Generate TypeScript bindings from the pinned compiler and connect the
      UI proof flow to `midnight-local-dev` (replace deterministic adapter).
- [ ] Evaluator settlement flow against a local node with proof-server logs.
- [ ] Pilot tender with a real issuer; audit prep.
