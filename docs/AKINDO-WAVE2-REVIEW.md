# AKINDO Midnight Buildathon — Wave 2 requirements review

Reviewed 9 October 2026 against the live AKINDO event page, its public event
API, and the rules/rubric links exposed by that page. This is a project
readiness review, not an organizer ruling.

## Active wave and submission package

The event is **Build Privacy-First Apps on Midnight**. AKINDO's current event
API reports Wave 2 as active, with submissions closing **19 October 2026 at
15:00:34 UTC** and judging ending **26 October 2026 at 15:00:34 UTC**. Use the
submission form's displayed countdown as the final operational deadline; the
linked rules PDF contains an older schedule.

The event page asks each submission to include a public GitHub repository,
a clear README covering setup, architecture, Midnight integration and
testing, a slide deck, a demo/video pitch, and a description of work completed
during the current wave. The public repo must include the `midnightntwrk`
topic. For a project continued from a prior wave, the event description asks
the entrant to explain what changed. Newly written or materially extended
Midnight-related code is expected to use Apache-2.0. The repository already
has that license and the public topic.

## Current judging weights

| Criterion | Weight | What judges look for | AegisBid evidence / remaining work |
| --- | ---: | --- | --- |
| Engineering & Implementation | 40% | Compact compiles, private state, dual-ledger understanding, organized repo and README. Midnight tags/ecosystem attribution encouraged. | V2 Compact source, generated package, live Preprod contract, setup docs, `compact:v2:check`. Obtain a fresh reproducible full compile in CI or provide trusted build logs. |
| QA & Reliability | 15% | Tests/simulations, passing checks, stability under basic use. | Vitest, static contract gates, transaction/provider tests. Record a fresh end-to-end demo and note external 1AM proving dependency. |
| Product & Vision | 15% | Problem, fit for Midnight, realistic scope and roadmap. | README and Wave 2 deck; keep production and identity claims bounded. |
| UX & Design | 15% | Clear frontend, expected behavior, end-to-end contract connection. | Live V2 deploy, bid, settlement/results flow. Demonstrate only with a synced 1AM Preprod wallet and successful current deployment. |
| Communication | 10% | Clear, structured video and slide deck. | Wave 2 PPTX and matching demo script are prepared; still record and attach a current video. |
| Business Development & Viability | 5% | Target user, market and adoption path. | Deck identifies a pilot path; strengthen with a real issuer/user interview only if one actually occurs. |

## Material Wave 2 work to call out

The repository's current history contains substantial October 2026 V2
engineering, including the Preprod integration, 1AM-only wallet flow,
transaction/proof diagnostics, live settlement, encrypted witness-file
support, and winner-facing outcome feedback. The working tree also includes
an uncommitted 1AM proof-timeout change. Before submission, review `git log`
and the final diff to state precisely which changes belong to this Wave and
which remain uncommitted; do not imply that local changes are in the public
repo until they are pushed.

## Important source conflicts: eligibility and dates

There is a material conflict in the organizer-published sources:

- The live event description allows entrants to continue an existing
  project when they make meaningful new Midnight work in the active wave and
  explain the progress.
- The linked Official Rules PDF also says projects must be “net-new” and
  says pre-existing code/projects are ineligible, while elsewhere allowing
  pre-existing independently developed code alongside newly developed or
  materially extended Midnight code. The same PDF's Wave dates are older than
  the live page/API schedule.
- The separate linked Google Docs judging-rubric document has different
  category names and weights (including Product Leadership 20% and Business
  Development 15%). The live event API/page and linked Official Rules PDF
  show the current 40/15/15/15/10/5 weighting used in the table above.

Treat eligibility as **unconfirmed** until AKINDO organizers answer in
writing whether this pre-existing AegisBid project qualifies based on its
Wave 2 Midnight work. Ask which rubric version and deadline govern. Do not
submit a claim that the project is eligible based only on the event summary.

## Submission readiness

Already present: public repo, Apache-2.0 license, `midnightntwrk` topic,
README, Wave 2 slide deck source, a PPTX draft, a demo script, deployed V2
contract metadata, automated tests, and Compact static gates.

Still needed from the project owner: organizer clarification on eligibility;
fresh full Compact compile evidence; a current end-to-end recording; final
team/contact/demo links; Wave 2 progress text checked against pushed commits;
individual team registration and entry through AKINDO's normal submission
form. This agent has not submitted the entry.

## Sources

- [AKINDO event page](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG)
- [AKINDO public event API](https://api.akindo.io/public/wave-hacks/jaMZjqPOBsLXvjdG)
- [Official Rules PDF linked from the event](https://drive.google.com/file/d/1YKXtsw5nghcEBEW0BFrLn-U34AfH_MF4/view?usp=sharing)
- [Judging rubric document linked from the event](https://docs.google.com/document/d/1-dDTqWa2CcfnSEvgXq83La2M8zAxi4jtVtKpMJRm3Oo/edit?usp=sharing)
