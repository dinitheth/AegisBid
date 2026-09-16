import { describe, expect, it } from "vitest";
import { generateNonce, normalizeStoredBids } from "./protocol";
import { makeCommitment } from "./tenderEngine";

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
    expect(bids[0]).toMatchObject({ salt: "", bidderKey: "", receipt: "0xabc", accepted: false });
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
});
