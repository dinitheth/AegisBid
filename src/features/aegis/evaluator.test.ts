import { describe, expect, it } from "vitest";
import {
  buildTenderStateForSettlement,
  friendlySettlementError,
  parseReserveToBigInt,
  storedBidToWitness,
  uiTenderToConfig,
} from "./evaluator";
import type { StoredBid, Tender } from "./protocol";
import { TenderError, beginEvaluation, settle } from "./tenderEngine";

const tender: Tender = {
  id: "AGB-TEST-001",
  title: "Test tender",
  issuer: "Test Issuer",
  deadline: "2026-09-14T18:00:00Z",
  threshold: "Reserve 4.20M tDUST",
  commitments: 2,
  status: "Active",
  mode: "Highest bid",
  specification: "Test spec",
};

describe("evaluator adapter", () => {
  it("parses reserve / ceiling strings to base units", () => {
    expect(parseReserveToBigInt("Reserve 4.20M tDUST")).toBe(4_200_000n);
    expect(parseReserveToBigInt("Ceiling 8.75M tDUST")).toBe(8_750_000n);
    expect(parseReserveToBigInt("Reserve 880K tDUST")).toBe(880_000n);
    expect(parseReserveToBigInt("4200000")).toBe(4_200_000n);
    expect(parseReserveToBigInt("no number here")).toBeNull();
  });

  it("maps UI tenders to engine configs", () => {
    const config = uiTenderToConfig(tender);
    expect(config.issuer).toBe("Test Issuer");
    expect(config.mode).toBe("highest");
    expect(config.reserve).toBe(4_200_000n);
    expect(config.deadline).toBe(Date.parse(tender.deadline));
    expect(config.specificationRoot).toMatch(/^0x[0-9a-f]{64}$/);

    const lowest = uiTenderToConfig({ ...tender, mode: "Lowest compliant" });
    expect(lowest.mode).toBe("lowest");
  });

  it("converts stored bids to witnesses and rejects legacy rows", () => {
    const ok: StoredBid = {
      tenderId: "AGB-TEST-001",
      tenderTitle: "Test tender",
      tenderStatus: "Active",
      amount: "1500",
      receipt: "0xabc",
      commitment: "0xabc",
      salt: "salt-1",
      bidderKey: "pk-1",
      submittedAt: 1,
      accepted: true,
      note: "",
      onChain: false,
    };
    expect(storedBidToWitness(ok)).toEqual({ amount: 1500n, salt: "salt-1", bidderKey: "pk-1" });
    expect(storedBidToWitness({ ...ok, salt: "" })).toBeNull();
    expect(storedBidToWitness({ ...ok, amount: "not-a-number" })).toBeNull();
  });

  it("runs beginEvaluation + settle through the adapter state", () => {
    const config = uiTenderToConfig({ ...tender, threshold: "Reserve 1,000" });
    const witnesses = [
      { amount: 1200n, salt: "sa", bidderKey: "pk-a" },
      { amount: 2450n, salt: "sb", bidderKey: "pk-b" },
    ];
    const state = buildTenderStateForSettlement(config, witnesses);
    expect(state.phase).toBe("Open");
    expect(state.commitments).toHaveLength(2);

    beginEvaluation(state, config.deadline);
    const receipt = settle(state, { winningIndex: 1, bids: witnesses, now: config.deadline + 1 });
    expect(receipt.winningValue).toBe(2450n);
    expect(state.phase).toBe("Settled");
  });

  it("surfaces engine rejections for non-optimal and under-reserve winners", () => {
    const config = uiTenderToConfig({ ...tender, threshold: "Reserve 5,000" });
    const witnesses = [
      { amount: 4200n, salt: "s1", bidderKey: "pk-a" },
      { amount: 4920n, salt: "s2", bidderKey: "pk-b" },
    ];
    const state = buildTenderStateForSettlement(config, witnesses);
    beginEvaluation(state, config.deadline);
    try {
      settle(state, { winningIndex: 0, bids: witnesses, now: config.deadline + 1 });
      throw new Error("expected NOT_MAXIMUM");
    } catch (error) {
      expect(error).toBeInstanceOf(TenderError);
      expect((error as TenderError).code).toBe("NOT_MAXIMUM");
    }
    expect(friendlySettlementError("NOT_MAXIMUM")).toContain("highest");
    expect(friendlySettlementError("RESERVE_NOT_MET")).toContain("reserve");
    expect(friendlySettlementError("DEADLINE_NOT_REACHED")).toContain("deadline");
  });
});
