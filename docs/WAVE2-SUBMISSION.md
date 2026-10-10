# AegisBid — Wave 2 submission notes

Submission preparation for **Build Privacy-First Apps on Midnight**, Wave 2.
See `AKINDO-WAVE2-REVIEW.md` before entry: the event page and linked official
rules disagree on existing-project eligibility and use different schedules.

## Draft progress description

> During Wave 2, AegisBid moved from an earlier prototype to a V2 Compact
> contract deployed on Midnight Preprod, with generated Ledger 8 bindings and
> browser proving assets. The V2 flow connects through 1AM and checks tender
> deadlines using ledger time, binds a tender-scoped nullifier to the
> transaction context and supplied bidder key, and requires an evaluator
> capability. Settlement checks the supplied witnesses against commitments,
> compares their amounts, and enforces the reserve or ceiling. The current V2
> circuit does not require distinct witnesses, so it does not prove that the
> complete committed set was evaluated or that the selected offer is truly
> optimal.
>
> Wave 2 work also added cross-device tender discovery, encrypted witness-file
> handoff for evaluation, clearer bidder progress/results, and fixes for
> wallet-session, stale V1 link, proof-asset, and transaction-diagnostic
> failures. The source includes automated protocol, provider, wallet, and UI
> model tests plus V2 structural contract checks.
>
> Limits: this prototype supports at most eight bids per tender. Its supplied
> bidder key does not prove real-world identity. Evaluators need bid witnesses
> after closing, with the current file handoff relying on a separate trusted
> channel. Proof preparation depends on the 1AM service. AegisBid publishes a
> settlement receipt but does not transfer a real award or payment. V2 does
> not prove complete-set optimality. No security audit has been completed.

This file is a preparation note, not the submitted progress statement. Verify
the selected commit and the AKINDO entry before describing Wave 2 changes.
Never describe local-only changes as part of the public submission.

## Files to attach

- Slide deck: `../submission/AegisBid-Wave2-v2.pptx`
- Recording script: `demo-script.md`
- README: repository root
- Evidence/source discrepancies and current judging weights:
  `AKINDO-WAVE2-REVIEW.md`

Add the recorded video URL, live app URL, team details, and submission commit
after those values are verified. Do not submit an entry until organizers
clarify the existing-project eligibility conflict.
