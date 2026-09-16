/**
 * Deterministic, dependency-free model of `contracts/aegis_bid.compact`.
 *
 * This is the executable specification the Vitest suite asserts against.
 * It mirrors the on-chain circuits:
 *   submitBid  -> deadline, phase, nullifier uniqueness, commitment uniqueness
 *   beginEvaluation -> phase transition after the deadline
 *   settle     -> membership, pairwise ordering, reserve/ceiling, receipt
 *
 * Amounts are `bigint` (tDUST base units). Time is a numeric ledger slot /
 * unix timestamp — callers must use the same unit for `deadline` and `now`.
 */
import { sha256Hex } from "./hash";

export type TenderMode = "highest" | "lowest";
export type TenderPhase = "Open" | "Evaluating" | "Settled";

export type TenderConfig = {
  issuer: string;
  deadline: number;
  /** Highest-bid: minimum; lowest-compliant: maximum. */
  reserve: bigint;
  mode: TenderMode;
  specificationRoot: string;
};

export type BidWitness = {
  amount: bigint;
  salt: string;
  bidderKey: string;
};

export type SettlementReceipt = {
  winnerCommitment: string;
  winningValue: bigint;
  comparisonRoot: string;
  settledAt: number;
};

export type TenderState = {
  config: TenderConfig;
  phase: TenderPhase;
  commitments: string[];
  nullifiers: Set<string>;
  settlement: SettlementReceipt | null;
};

export type TenderErrorCode =
  | "TENDER_NOT_OPEN"
  | "DEADLINE_ELAPSED"
  | "DEADLINE_NOT_REACHED"
  | "NOT_EVALUATING"
  | "IDENTITY_ALREADY_USED"
  | "DUPLICATE_COMMITMENT"
  | "INCOMPLETE_BID_SET"
  | "UNCOMMITTED_BID"
  | "UNKNOWN_WINNER"
  | "NOT_MAXIMUM"
  | "NOT_MINIMUM"
  | "RESERVE_NOT_MET";

export class TenderError extends Error {
  readonly code: TenderErrorCode;

  constructor(code: TenderErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "TenderError";
    this.code = code;
  }
}

export function makeCommitment(amount: bigint, salt: string, bidderKey: string): string {
  return `0x${sha256Hex(`${amount.toString(10)}:${salt}:${bidderKey}`)}`;
}

export function makeNullifier(identitySecret: string, issuer: string): string {
  return `0x${sha256Hex(`${identitySecret}:${issuer}`)}`;
}

export function makeComparisonRoot(
  winnerCommitment: string,
  bidCount: number,
  specificationRoot: string,
): string {
  return `0x${sha256Hex(`${winnerCommitment}:${bidCount}:${specificationRoot}`)}`;
}

export function createTender(config: TenderConfig): TenderState {
  return {
    config,
    phase: "Open",
    commitments: [],
    nullifiers: new Set<string>(),
    settlement: null,
  };
}

export function submitBid(
  state: TenderState,
  input: {
    bidderKey: string;
    amount: bigint;
    salt: string;
    identitySecret: string;
    now: number;
  },
): string {
  if (state.phase !== "Open") throw new TenderError("TENDER_NOT_OPEN");
  if (input.now >= state.config.deadline) throw new TenderError("DEADLINE_ELAPSED");

  const nullifier = makeNullifier(input.identitySecret, state.config.issuer);
  if (state.nullifiers.has(nullifier)) throw new TenderError("IDENTITY_ALREADY_USED");

  const commitment = makeCommitment(input.amount, input.salt, input.bidderKey);
  if (state.commitments.includes(commitment)) throw new TenderError("DUPLICATE_COMMITMENT");

  state.commitments.push(commitment);
  state.nullifiers.add(nullifier);
  return commitment;
}

export function beginEvaluation(state: TenderState, now: number): void {
  if (state.phase !== "Open") throw new TenderError("TENDER_NOT_OPEN");
  if (now < state.config.deadline) throw new TenderError("DEADLINE_NOT_REACHED");
  state.phase = "Evaluating";
}

export function settle(
  state: TenderState,
  input: { winningIndex: number; bids: BidWitness[]; now: number },
): SettlementReceipt {
  if (state.phase !== "Evaluating") throw new TenderError("NOT_EVALUATING");
  if (input.bids.length !== state.commitments.length) throw new TenderError("INCOMPLETE_BID_SET");

  const winner = input.bids[input.winningIndex];
  if (!winner) throw new TenderError("UNKNOWN_WINNER");

  const winnerCommitment = makeCommitment(winner.amount, winner.salt, winner.bidderKey);
  if (!state.commitments.includes(winnerCommitment)) throw new TenderError("UNKNOWN_WINNER");

  for (const candidate of input.bids) {
    const candidateCommitment = makeCommitment(candidate.amount, candidate.salt, candidate.bidderKey);
    if (!state.commitments.includes(candidateCommitment)) {
      throw new TenderError("UNCOMMITTED_BID", candidateCommitment);
    }
    if (state.config.mode === "highest" && winner.amount < candidate.amount) {
      throw new TenderError("NOT_MAXIMUM", `${winner.amount} < ${candidate.amount}`);
    }
    if (state.config.mode === "lowest" && winner.amount > candidate.amount) {
      throw new TenderError("NOT_MINIMUM", `${winner.amount} > ${candidate.amount}`);
    }
  }

  if (state.config.mode === "highest" && winner.amount < state.config.reserve) {
    throw new TenderError("RESERVE_NOT_MET", `${winner.amount} < ${state.config.reserve}`);
  }
  if (state.config.mode === "lowest" && winner.amount > state.config.reserve) {
    throw new TenderError("RESERVE_NOT_MET", `${winner.amount} > ${state.config.reserve}`);
  }

  const receipt: SettlementReceipt = {
    winnerCommitment,
    winningValue: winner.amount,
    comparisonRoot: makeComparisonRoot(
      winnerCommitment,
      input.bids.length,
      state.config.specificationRoot,
    ),
    settledAt: input.now,
  };
  state.settlement = receipt;
  state.phase = "Settled";
  return receipt;
}
