import { describe, expect, it } from "vitest";
import {
  TenderError,
  beginEvaluation,
  createTender,
  makeCommitment,
  settle,
  submitBid,
  type TenderConfig,
} from "./tenderEngine";

const SPEC = "0xspecification-root";

function highestConfig(overrides: Partial<TenderConfig> = {}): TenderConfig {
  return {
    issuer: "midnight:issuer:test",
    deadline: 1_789_200,
    reserve: 1_000n,
    mode: "highest",
    specificationRoot: SPEC,
    ...overrides,
  };
}

function lowestConfig(overrides: Partial<TenderConfig> = {}): TenderConfig {
  return {
    issuer: "midnight:issuer:procurement",
    deadline: 1_789_200,
    reserve: 5_000n,
    mode: "lowest",
    specificationRoot: SPEC,
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TenderError);
    expect((error as TenderError).code).toBe(code);
    return;
  }
  throw new Error(`expected TenderError(${code}) but nothing was thrown`);
}

describe("AegisBid tender engine (mirrors aegis_bid.compact)", () => {
  it("runs a three-party sealed bid and discloses only the winner", () => {
    const state = createTender(highestConfig());
    const bids = [
      { bidderKey: "pk-alice", amount: 1_200n, salt: "salt-a", identitySecret: "id-a", now: 1_789_100 },
      { bidderKey: "pk-bob", amount: 2_450n, salt: "salt-b", identitySecret: "id-b", now: 1_789_101 },
      { bidderKey: "pk-cara", amount: 1_900n, salt: "salt-c", identitySecret: "id-c", now: 1_789_102 },
    ];
    const commitments = bids.map((bid) => submitBid(state, bid));
    expect(new Set(commitments).size).toBe(3);
    expect(state.commitments).toHaveLength(3);

    // Commitments bind without revealing amounts.
    for (const c of commitments) expect(c).toMatch(/^0x[0-9a-f]{64}$/);
    expect(commitments.join("")).not.toContain("2450");

    beginEvaluation(state, 1_789_200);
    const receipt = settle(state, {
      winningIndex: 1,
      bids: bids.map(({ amount, salt, bidderKey }) => ({ amount, salt, bidderKey })),
      now: 1_789_210,
    });

    expect(receipt.winnerCommitment).toBe(commitments[1]);
    expect(receipt.winningValue).toBe(2_450n);
    expect(state.phase).toBe("Settled");
    expect(state.settlement).toEqual(receipt);
    // Losing values are absent from the public receipt.
    expect(receipt.winningValue).toBe(2_450n);
    expect(receipt.winnerCommitment).not.toContain("1200");
    expect(receipt.comparisonRoot).not.toContain("1200");
  });

  it("rejects settlement below reserve and leaves state unsettled", () => {
    const state = createTender(highestConfig({ reserve: 5_000n }));
    const bids = [
      { bidderKey: "pk-a", amount: 4_200n, salt: "s1", identitySecret: "i1", now: 1 },
      { bidderKey: "pk-b", amount: 4_920n, salt: "s2", identitySecret: "i2", now: 2 },
    ];
    bids.forEach((bid) => submitBid(state, bid));
    beginEvaluation(state, 1_789_200);

    expectCode(
      () =>
        settle(state, {
          winningIndex: 1,
          bids: bids.map(({ amount, salt, bidderKey }) => ({ amount, salt, bidderKey })),
          now: 1_789_210,
        }),
      "RESERVE_NOT_MET",
    );
    expect(state.phase).toBe("Evaluating");
    expect(state.settlement).toBeNull();
  });

  it("rejects a valid commitment after the deadline without mutating state", () => {
    const state = createTender(highestConfig({ deadline: 1_789_200 }));
    expectCode(
      () =>
        submitBid(state, {
          bidderKey: "pk-late",
          amount: 9_999n,
          salt: "late",
          identitySecret: "late-id",
          now: 1_789_201,
        }),
      "DEADLINE_ELAPSED",
    );
    expect(state.commitments).toHaveLength(0);
  });

  it("prevents double submission with the same identity witness", () => {
    const state = createTender(highestConfig());
    submitBid(state, {
      bidderKey: "pk-a",
      amount: 1_500n,
      salt: "s-a",
      identitySecret: "same-id",
      now: 10,
    });
    expectCode(
      () =>
        submitBid(state, {
          bidderKey: "pk-a-second-key",
          amount: 1_600n,
          salt: "s-b",
          identitySecret: "same-id",
          now: 11,
        }),
      "IDENTITY_ALREADY_USED",
    );
    expect(state.commitments).toHaveLength(1);
  });

  it("supports lowest-compliant procurement with a ceiling", () => {
    const state = createTender(lowestConfig({ reserve: 4_200n }));
    const bids = [
      { bidderKey: "pk-a", amount: 3_900n, salt: "sa", identitySecret: "ia", now: 5 },
      { bidderKey: "pk-b", amount: 3_710n, salt: "sb", identitySecret: "ib", now: 6 },
      { bidderKey: "pk-c", amount: 4_100n, salt: "sc", identitySecret: "ic", now: 7 },
    ];
    bids.forEach((bid) => submitBid(state, bid));
    beginEvaluation(state, 1_789_200);
    const receipt = settle(state, {
      winningIndex: 1,
      bids: bids.map(({ amount, salt, bidderKey }) => ({ amount, salt, bidderKey })),
      now: 1_789_300,
    });
    expect(receipt.winningValue).toBe(3_710n);
  });

  it("rejects a non-optimal winner and an incomplete bid set", () => {
    const state = createTender(highestConfig());
    const bids = [
      { bidderKey: "pk-a", amount: 1_000n, salt: "sa", identitySecret: "ia", now: 5 },
      { bidderKey: "pk-b", amount: 3_000n, salt: "sb", identitySecret: "ib", now: 6 },
    ];
    bids.forEach((bid) => submitBid(state, bid));
    beginEvaluation(state, 1_789_200);

    expectCode(
      () =>
        settle(state, {
          winningIndex: 0,
          bids: bids.map(({ amount, salt, bidderKey }) => ({ amount, salt, bidderKey })),
          now: 1_789_210,
        }),
      "NOT_MAXIMUM",
    );
    expectCode(
      () =>
        settle(state, {
          winningIndex: 1,
          bids: [{ amount: 3_000n, salt: "sb", bidderKey: "pk-b" }],
          now: 1_789_210,
        }),
      "INCOMPLETE_BID_SET",
    );
    expect(state.phase).toBe("Evaluating");
  });

  it("derives stable commitments for identical witnesses", () => {
    expect(makeCommitment(100n, "s", "pk")).toBe(makeCommitment(100n, "s", "pk"));
    expect(makeCommitment(100n, "s", "pk")).not.toBe(makeCommitment(101n, "s", "pk"));
  });

  it("fails closed beyond the 64-bid settlement bound", () => {
    const state = createTender(highestConfig({ reserve: 0n }));
    const bids = Array.from({ length: 65 }, (_, i) => ({
      bidderKey: `pk-${i}`,
      amount: 1_000n + BigInt(i),
      salt: `s-${i}`,
      identitySecret: `id-${i}`,
      now: 5 + i,
    }));
    bids.forEach((bid) => submitBid(state, bid));
    beginEvaluation(state, 1_789_200);
    expectCode(
      () =>
        settle(state, {
          winningIndex: 64,
          bids: bids.map(({ amount, salt, bidderKey }) => ({ amount, salt, bidderKey })),
          now: 1_789_210,
        }),
      "TOO_MANY_BIDS",
    );
    expect(state.phase).toBe("Evaluating");
    expect(state.settlement).toBeNull();
  });
});
