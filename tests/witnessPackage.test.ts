import { describe, expect, it } from "vitest";
import {
  decryptSettlementWitness,
  encryptSettlementWitness,
} from "../src/features/aegis/witnessPackage";

const bid = {
  tenderId: "a".repeat(64),
  tenderTitle: "Test tender",
  tenderStatus: "Active" as const,
  amount: "8500",
  receipt: "tx",
  commitment: "0xcommitment",
  salt: "salt-value",
  bidderKey: "bidder-key",
  identitySecret: "",
  submittedAt: 1,
  accepted: true,
  note: "accepted",
  onChain: true,
};

describe("encrypted settlement witness package", () => {
  it("round-trips the private witness and binds it to the tender", async () => {
    const encrypted = await encryptSettlementWitness(bid, "a sufficiently long passphrase");
    const decrypted = await decryptSettlementWitness(encrypted, "a sufficiently long passphrase");

    expect(decrypted).toEqual({
      version: 1,
      tenderId: bid.tenderId,
      amount: bid.amount,
      salt: bid.salt,
      bidderKey: bid.bidderKey,
    });
  });

  it("rejects an incorrect passphrase", async () => {
    const encrypted = await encryptSettlementWitness(bid, "a sufficiently long passphrase");
    await expect(decryptSettlementWitness(encrypted, "a different passphrase")).rejects.toThrow(
      "passphrase is incorrect",
    );
  });

  it("rejects incomplete or non-live bids", async () => {
    await expect(
      encryptSettlementWitness({ ...bid, accepted: false }, "a sufficiently long passphrase"),
    ).rejects.toThrow("Only accepted live bids");
  });
});
