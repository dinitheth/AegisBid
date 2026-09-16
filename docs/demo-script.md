# AegisBid — Demo Video Script (90 seconds)

Record a screen capture with voiceover, export ≤ 3 min, upload unlisted to
YouTube, link it in the AKINDO submission. Checklist at the bottom.

## Script

**0:00–0:10 — Hook.**
"On-chain auctions leak every bid. Off-chain tenders ask you to trust the
evaluator. AegisBid gives you both privacy and proof — on Midnight."

**0:10–0:30 — Explore.**
Show the tender explorer. "Issuers publish tenders with a public policy:
mode, threshold, deadline. No bid values anywhere."

**0:30–0:55 — Bid.**
Open a tender, enter an amount, submit. "The amount never leaves the
device. The ledger receives only a binding commitment and a nullifier."
Point at the sealed reference + proof receipt. Show the privacy inspector:
private local state vs public transcript.

**0:55–1:15 — Settle.**
Switch to settlement. "After the deadline, the circuit proves the winner
is optimal and policy-compliant." Point at winner commitment, clearing
value, comparison root. "Losing values stay redacted."

**1:15–1:30 — Prove it.**
Run `npm test` in a terminal (13 green) and/or the in-app QA runner.
"Every invariant — sealed winner, reserve rejection, deadline rejection —
is asserted by automated tests." Close with repo + contact.

## Recording checklist

- [ ] 1080p, browser at 100% zoom, hide bookmarks bar.
- [ ] Use fresh example data; no real secrets on screen.
- [ ] Voiceover, no background music over speech.
- [ ] Captions or subtitles added on YouTube.
- [ ] Video set to Unlisted; link pasted in AKINDO submission + README.
- [ ] Under 3 minutes; file backup kept locally.
