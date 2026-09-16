/**
 * Evaluator adapter: bridges UI tenders + local witnesses to `tenderEngine.ts`.
 *
 * The on-chain circuits (`contracts/aegis_bid.compact`) expect:
 *   Open -> beginEvaluation(now >= deadline) -> settle(winningIndex, bids)
 * with membership, pairwise ordering, and reserve/ceiling checks.
 *
 * This module keeps all phase transitions inside the engine so the UI
 * cannot "pick a winner" without satisfying the same invariants Vitest
 * asserts (`tenderEngine.test.ts`).
 */
import { sha256Hex } from "./hash";
import type { StoredBid, Tender } from "./protocol";
import {
  makeCommitment,
  makeNullifier,
  type BidWitness,
  type TenderConfig,
  type TenderErrorCode,
  type TenderState,
} from "./tenderEngine";

export type { BidWitness };

export function parseReserveToBigInt(threshold: string): bigint | null {
  const match = threshold.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([MK])?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const suffix = (match[2] ?? "").toUpperCase();
  const multiplier = suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  return BigInt(Math.round(value * multiplier));
}

export function uiModeToEngineMode(mode: Tender["mode"]): TenderConfig["mode"] {
  return mode === "Highest bid" ? "highest" : "lowest";
}

export function specificationRootForTender(tender: Tender): string {
  return `0x${sha256Hex(tender.specification)}`;
}

export function uiTenderToConfig(
  tender: Tender,
  overrides: { reserve?: bigint | null; specificationRoot?: string | null } = {},
): TenderConfig {
  const parsed = parseReserveToBigInt(tender.threshold);
  return {
    issuer: tender.issuer,
    deadline: Date.parse(tender.deadline),
    reserve: overrides.reserve ?? parsed ?? 0n,
    mode: uiModeToEngineMode(tender.mode),
    specificationRoot: overrides.specificationRoot ?? specificationRootForTender(tender),
  };
}

/** Convert a locally stored bid into an engine witness. Null when unusable. */
export function storedBidToWitness(bid: StoredBid): BidWitness | null {
  if (!bid.salt || !bid.bidderKey) return null;
  if (!/^\d+$/.test(bid.amount)) return null;
  try {
    return { amount: BigInt(bid.amount), salt: bid.salt, bidderKey: bid.bidderKey };
  } catch {
    return null;
  }
}

/**
 * Reconstruct the public commitment set the evaluator must prove against.
 * Nullifiers are derived deterministically (`evaluator:${bidderKey}`) because
 * raw identity secrets never leave bidder devices; the binding property that
 * matters for settlement is the commitment list.
 */
export function buildTenderStateForSettlement(
  config: TenderConfig,
  witnesses: BidWitness[],
): TenderState {
  const commitments = witnesses.map((w) => makeCommitment(w.amount, w.salt, w.bidderKey));
  const nullifiers = new Set(
    witnesses.map((w) => makeNullifier(`evaluator:${w.bidderKey}`, config.issuer)),
  );
  return { config, phase: "Open", commitments, nullifiers, settlement: null };
}

export function friendlySettlementError(code: TenderErrorCode): string {
  switch (code) {
    case "TENDER_NOT_OPEN":
      return "This tender is no longer open for evaluation.";
    case "DEADLINE_ELAPSED":
      return "A bid was submitted after the deadline.";
    case "DEADLINE_NOT_REACHED":
      return "The deadline has not been reached yet. Evaluation can start only after closing.";
    case "NOT_EVALUATING":
      return "Start evaluation first — settlement requires the tender to be in review.";
    case "IDENTITY_ALREADY_USED":
      return "The same bidder identity appears twice in this set.";
    case "DUPLICATE_COMMITMENT":
      return "Two bids produce the same sealed reference. Check salts and keys.";
    case "INCOMPLETE_BID_SET":
      return "The witness set does not match the commitment count. Include every committed bid.";
    case "TOO_MANY_BIDS":
      return "This tender exceeds the 64-bid settlement bound. Split it into smaller tenders.";
    case "UNCOMMITTED_BID":
      return "A supplied bid does not match any on-ledger commitment.";
    case "UNKNOWN_WINNER":
      return "The selected winner does not match any committed bid.";
    case "NOT_MAXIMUM":
      return "The selected winner is not the highest committed offer.";
    case "NOT_MINIMUM":
      return "The selected winner is not the lowest committed offer.";
    case "RESERVE_NOT_MET":
      return "The winning offer does not satisfy the reserve / ceiling policy.";
    default:
      return "Settlement failed the circuit checks.";
  }
}
