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
Switch to settlement. "After the deadline, the evaluator supplies bid
witnesses. The circuit checks that each supplied offer matches a commitment,
compares those offers, and enforces the tender's price limit. The winning
value appears in the receipt, while losing values stay out of it."
"There is an important V2 limitation: the circuit does not require distinct
witnesses, so it cannot prove that every committed bid was included or that
the selected offer is globally optimal. Fixing and testing that is planned
for Wave 3."

**1:15–1:30 — Prove it.**
Show only verification commands that have just completed successfully. Explain
that the protocol-model tests and static V2 checks help catch regressions, but
do not replace a fresh Compact compile or verify the missing complete-set
uniqueness property. Close with the repository and contact.

## Recording checklist

- [ ] 1080p, browser at 100% zoom, hide bookmarks bar.
- [ ] Use fresh example data; no real secrets on screen.
- [ ] Voiceover, no background music over speech.
- [ ] Captions or subtitles added on YouTube.
- [ ] Video set to Unlisted; link pasted in AKINDO submission + README.
- [ ] Under 3 minutes; file backup kept locally.
