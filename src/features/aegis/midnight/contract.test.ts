import { describe, expect, it } from "vitest";
import {
  buildSettlementWitnesses,
  buildSubmitBidWitnesses,
  getDeploymentStatus,
  hexToBytes,
  loadContractModule,
  stringToBytes32,
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

  it("converts hex to bytes and rejects bad input", () => {
    expect(hexToBytes("0x00ff")).toEqual(new Uint8Array([0, 255]));
    expect(hexToBytes("00ff")).toEqual(new Uint8Array([0, 255]));
    expect(() => hexToBytes("0x0")).toThrow();
    expect(() => hexToBytes("0xzz")).toThrow();
    expect(() => hexToBytes("")).toThrow();
  });

  it("maps strings to 32 live bytes", () => {
    const hashed = stringToBytes32("North Sea Energy Authority");
    expect(hashed).toHaveLength(32);
    expect(stringToBytes32("North Sea Energy Authority")).toEqual(hashed);
    const direct = stringToBytes32(`0x${"ab".repeat(32)}`);
    expect(direct).toEqual(new Uint8Array(32).fill(0xab));
  });

  it("loads bindings when compiled, else explains how to compile", async () => {
    try {
      const mod = (await loadContractModule()) as { Contract?: unknown };
      expect(mod.Contract).toBeDefined();
    } catch (error) {
      expect((error as Error).message).toContain("managed/aegis-bid");
    }
  });
});
