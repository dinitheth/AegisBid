import { describe, expect, it } from "vitest";
import {
  generateNonce,
  matchesSavedBidToWinner,
  normalizeStoredBids,
  type StoredBid,
  type Tender,
} from "../src/features/aegis/protocol";
import { makeCommitment } from "../src/features/aegis/tenderEngine";

describe("stored bids", () => {
  it("migrates legacy entries missing salt/bidderKey", () => {
    const bids = normalizeStoredBids([
      {
        tenderId: "AGB-1",
        tenderTitle: "Legacy tender",
        amount: "1000",
        commitment: "0xabc",
        submittedAt: 42,
      },
    ]);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({
      salt: "",
      bidderKey: "",
      identitySecret: "",
      receipt: "0xabc",
      accepted: false,
    });
  });

  it("drops malformed entries and non-arrays", () => {
    expect(normalizeStoredBids(null)).toEqual([]);
    expect(normalizeStoredBids([{ nope: true }, 42, "x"])).toEqual([]);
  });

  it("UI commitment derivation matches the protocol engine", () => {
    const salt = generateNonce();
    expect(salt).toHaveLength(32);
    const a = makeCommitment(3_850_000n, salt, "pk-device");
    const b = makeCommitment(3_850_000n, salt, "pk-device");
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("only recognizes this device's exact accepted on-chain winning commitment", () => {
    const tender: Tender = {
      id: "short-id",
      contractAddress: "0xAbCd",
      title: "Tender",
      issuer: "Issuer",
      deadline: "2026-10-09T00:00:00.000Z",
      threshold: "100",
      commitments: 1,
      status: "Settled",
      mode: "Highest bid",
      specification: "Work",
      settlement: { winnerCommitment: "0xAABB", winningValue: "200" },
    };
    const bid: StoredBid = {
      tenderId: "short-id",
      tenderTitle: "Tender",
      tenderStatus: "Settled",
      amount: "200",
      receipt: "tx",
      commitment: "local-model-hash",
      chainCommitment: "0xaabb",
      salt: "",
      bidderKey: "",
      identitySecret: "",
      submittedAt: 1,
      accepted: true,
      note: "",
      onChain: true,
    };
    expect(matchesSavedBidToWinner(tender, [bid])).toBe(true);
    expect(matchesSavedBidToWinner(tender, [{ ...bid, chainCommitment: undefined }])).toBe(false);
    expect(matchesSavedBidToWinner(tender, [{ ...bid, accepted: false }])).toBe(false);
    expect(matchesSavedBidToWinner(tender, [{ ...bid, tenderId: "different-tender" }])).toBe(false);
  });
});
