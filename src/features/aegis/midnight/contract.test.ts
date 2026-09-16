import { describe, expect, it } from "vitest";
import {
  buildSettlementWitnesses,
  buildSubmitBidWitnesses,
  getDeploymentStatus,
  loadContractModule,
  stringToBytes32Hex,
  toLedgerDeadlineSeconds,
  toLedgerTenderConfig,
} from "./contract";

describe("midnight contract wiring", () => {
  it("reports NOT DEPLOYED until an address is configured", () => {
    const status = getDeploymentStatus();
    expect(status.deployed).toBe(false);
    if (!status.deployed) {
      expect(status.reason).toContain("VITE_AEGISBID_CONTRACT");
      expect(status.nextSteps.length).toBeGreaterThan(0);
    }
  });

  it("derives deterministic Bytes<32> hex", () => {
    const a = stringToBytes32Hex("North Sea Energy Authority");
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).toBe(stringToBytes32Hex("North Sea Energy Authority"));
    expect(a).not.toBe(stringToBytes32Hex("Someone else"));
  });

  it("converts deadlines to ledger seconds", () => {
    expect(toLedgerDeadlineSeconds(1_789_200_000)).toBe(1_789_200);
  });

  it("maps engine configs to the Compact constructor shape", () => {
    const highest = toLedgerTenderConfig({
      issuer: "issuer-1",
      deadline: 1_789_200_000,
      reserve: 1_000n,
      mode: "highest",
      specificationRoot: "0xspec",
    });
    expect(highest.mode).toBe("HighestBid");
    expect(highest.deadline).toBe(1_789_200);
    expect(highest.issuer).toMatch(/^0x[0-9a-f]{64}$/);

    const lowest = toLedgerTenderConfig({
      issuer: "issuer-1",
      deadline: 1_789_200_000,
      reserve: 5_000n,
      mode: "lowest",
      specificationRoot: "0xspec",
    });
    expect(lowest.mode).toBe("LowestCompliant");
  });

  it("builds submitBid witnesses from private state", () => {
    const witnesses = buildSubmitBidWitnesses({
      amount: 2_450n,
      salt: "salt-b",
      identitySecret: "id-b",
    });
    expect(witnesses.localBidAmount({ privateState: null })).toEqual([null, 2_450n]);
    expect(witnesses.localBidSalt({ privateState: null })).toEqual([null, "salt-b"]);
    expect(witnesses.localIdentitySecret({ privateState: null })).toEqual([null, "id-b"]);
  });

  it("builds indexed settlement witnesses", () => {
    const witnesses = buildSettlementWitnesses([
      { amount: 1_200n, salt: "sa", bidderKey: "pk-a" },
      { amount: 2_450n, salt: "sb", bidderKey: "pk-b" },
    ]);
    expect(witnesses.settlementBid({ privateState: null }, 1)).toEqual([null, 2_450n]);
    expect(witnesses.settlementSalt({ privateState: null }, 0)).toEqual([null, "sa"]);
    expect(witnesses.settlementKey({ privateState: null }, 1)).toEqual([null, "pk-b"]);
    expect(() => witnesses.settlementBid({ privateState: null }, 7)).toThrow();
  });

  it("fails bindings load with next steps while uncompiled", async () => {
    await expect(loadContractModule()).rejects.toThrow(/managed\/aegis-bid/);
  });
});
