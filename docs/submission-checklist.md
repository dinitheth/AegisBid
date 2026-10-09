# AegisBid — AKINDO Wave 2 submission checklist

Use this checklist with [the detailed event-source review](AKINDO-WAVE2-REVIEW.md).
The organizer sources conflict on existing-project eligibility and on rubric
versions; resolve those points before submitting.

## Platform materials

- [x] Public repository: https://github.com/dinitheth/AegisBid
- [x] Apache-2.0 license is present.
- [x] GitHub repository topic `midnightntwrk` is present (checked 9 Oct 2026).
- [x] README covers setup, architecture, Midnight integration, tests and
      limitations.
- [x] Wave 2 PPTX is prepared at `submission/AegisBid-Wave2-v2.pptx`.
- [ ] Add verified team names/contact and current live demo URL to the deck.
- [ ] Record and upload a current end-to-end demo (script in `demo-script.md`).
- [ ] Add final public video URL and any team/contact details to the submission.
- [ ] Each team member registers individually on AKINDO.
- [ ] Enter through the normal AKINDO form. This repository change does not
      submit an entry.

## Eligibility and evidence gates

- [ ] Ask AKINDO in writing whether this existing project qualifies based on
      its new/material Wave 2 Midnight work; the published page and rules PDF
      conflict.
- [ ] Confirm with AKINDO which rubric weights and closing time govern; the
      linked rubric document and current event page disagree.
- [ ] Run a fresh full Compact 0.31.1 compile on a compatible builder and
      preserve compiler version/logs. The local static check is not a compile.
- [ ] Verify the currently deployed V2 contract and proving-asset links before
      recording or submitting.
- [ ] Make sure the progress description only claims changes present in the
      submitted Git revision. Commit/push any intended Wave 2 work first.
- [ ] Disclose constraints: 8-bid maximum, supplied-key (not real-world)
      duplicate prevention, evaluator witness handoff, 1AM proving dependency,
      no audit, and award/payment outside AegisBid.

## Current event weights and evidence

| Criterion | Weight | Evidence to point judges to |
| --- | ---: | --- |
| Engineering & Implementation | 40% | `contracts/aegis_bid_v2.compact`, generated bindings, README architecture, deployment notes, compile evidence |
| QA & Reliability | 15% | `npm test`, `npm run compact:v2:check`, production build, honest Preprod demo |
| Product & Vision | 15% | README problem/fit/limits and slides 2, 7 |
| UX & Design | 15% | Live issuer, bidder, settlement and bidder-results flow in demo |
| Communication | 10% | Wave 2 deck and short, captioned demo video |
| Business Development & Viability | 5% | Target users and pilot path on slide 7; add interviews only if actually completed |

For discrepancies, use the live event API/page as the operational source for
current-wave timing and listed weights, but seek organizer clarification on
the inconsistent rules and rubric links. See the source URLs in
`AKINDO-WAVE2-REVIEW.md`.
