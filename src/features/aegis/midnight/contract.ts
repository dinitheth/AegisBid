/**
 * Live-contract wiring for AegisBid.
 *
 * HONEST STATUS: the Compact contract is NOT deployed anywhere yet. There
 * are no generated bindings (`managed/`) in this repo, so every live-call
 * helper below throws a descriptive error until `scripts/midnight-deploy.mjs`
 * has been run against a real network. The deterministic workbench
 * (`tenderEngine.ts`) remains the executable spec judges can run today.
 *
 * This module is zero-dependency (no static Midnight.js imports) so the
 * browser bundle and Vitest stay green without the SDK tree. Anything that
 * needs the SDK or the generated bindings uses a dynamic import and fails
 * with next-step instructions instead of a bundler error.
 */
import { sha256Hex } from "../hash";
import type { BidWitness, TenderConfig } from "../tenderEngine";
import { getActiveNetwork, type MidnightNetworkId } from "./networks";

export const CONTRACT_CIRCUITS = ["submitBid", "beginEvaluation", "settle"] as const;
export type ContractCircuit = (typeof CONTRACT_CIRCUITS)[number];

export type DeploymentStatus =
  | { deployed: false; reason: string; nextSteps: string[] }
  | { deployed: true; network: MidnightNetworkId; contractAddress: string };

function contractAddressFromEnv(): string | undefined {
  try {
    const value = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[
      "VITE_AEGISBID_CONTRACT"
    ];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function getDeploymentStatus(): DeploymentStatus {
  const address = contractAddressFromEnv();
  if (!address) {
    return {
      deployed: false,
      reason:
        "No contract address configured (VITE_AEGISBID_CONTRACT is empty) and no managed/ bindings exist in this repo.",
      nextSteps: [
        "Compile: MIDNIGHT_COMPACT_BIN=<compiler> bun run compact:check",
        "Start a local network per docs/MIDNIGHT_INTEGRATION.md",
        "Deploy: node scripts/midnight-deploy.mjs --network undeployed",
        "Set VITE_AEGISBID_CONTRACT to the printed address and rebuild",
      ],
    };
  }
  return { deployed: true, network: getActiveNetwork().id, contractAddress: address };
}

/** 32-byte hex (`0x…`) derived deterministically from an arbitrary string. */
export function stringToBytes32Hex(value: string): string {
  return `0x${sha256Hex(value)}`;
}

/** Even-length hex (with or without `0x`) to bytes. Throws on bad input. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean) || clean.length === 0) {
    throw new Error("hexToBytes expects non-empty even-length hexadecimal.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Maps an arbitrary string to exactly 32 bytes for live `Bytes<32>` fields.
 * 64-hex inputs are used directly, anything else is SHA-256 hashed.
 * NOTE: live values derived this way differ from workbench demo strings —
 * binding is preserved, display bytes are not identical.
 */
export function stringToBytes32(value: string): Uint8Array {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (clean.length === 64 && /^[0-9a-fA-F]+$/.test(clean)) return hexToBytes(clean);
  return hexToBytes(sha256Hex(value));
}

/** Ledger deadlines are seconds since the Unix epoch; the UI works in ms. */
export function toLedgerDeadlineSeconds(deadlineMs: number): number {
  return Math.floor(deadlineMs / 1000);
}

export type LedgerTenderConfig = {
  /** Bytes<32> hex: SHA-256 of the issuer string. */
  issuer: string;
  /** Uint<64>: seconds since epoch. */
  deadline: number;
  /** Uint<128>. */
  reserve: bigint;
  /** Compact enum variant name. */
  mode: "HighestBid" | "LowestCompliant";
  /** Bytes<32> hex. */
  specificationRoot: string;
};

/** Maps the engine config to the shape the Compact constructor expects. */
export function toLedgerTenderConfig(config: TenderConfig): LedgerTenderConfig {
  return {
    issuer: stringToBytes32Hex(config.issuer),
    deadline: toLedgerDeadlineSeconds(config.deadline),
    reserve: config.reserve,
    mode: config.mode === "highest" ? "HighestBid" : "LowestCompliant",
    specificationRoot: config.specificationRoot,
  };
}

export type PrivateBidState = {
  amount: bigint;
  salt: string;
  identitySecret: string;
};

/**
 * Witness implementations for `submitBid`, in the shape
 * `CompiledContract.withWitnesses` expects: each witness receives the private
 * state and returns `[nextState, value]`.
 */
export function buildSubmitBidWitnesses(state: PrivateBidState) {
  return {
    localBidAmount: ({ privateState }: { privateState: unknown }) => [
      privateState,
      state.amount,
    ],
    localBidSalt: ({ privateState }: { privateState: unknown }) => [privateState, state.salt],
    localIdentitySecret: ({ privateState }: { privateState: unknown }) => [
      privateState,
      state.identitySecret,
    ],
  };
}

/**
 * Witness implementations for `settle`: indexed access over the evaluator's
 * locally held bid set. Mirrors the contract's `settlementBid(i)` /
 * `settlementSalt(i)` / `settlementKey(i)` witnesses.
 */
export function buildSettlementWitnesses(bids: BidWitness[]) {
  const at = (index: number): BidWitness => {
    const bid = bids[index];
    if (!bid) throw new Error(`No settlement witness at index ${index}.`);
    return bid;
  };
  return {
    settlementBid: ({ privateState }: { privateState: unknown }, index: number) => [
      privateState,
      at(index).amount,
    ],
    settlementSalt: ({ privateState }: { privateState: unknown }, index: number) => [
      privateState,
      at(index).salt,
    ],
    settlementKey: ({ privateState }: { privateState: unknown }, index: number) => [
      privateState,
      at(index).bidderKey,
    ],
  };
}

/**
 * Loads the generated contract module (`managed/aegis-bid/contract/index.js`).
 * Throws with next steps when the contract has not been compiled yet.
 */
export async function loadContractModule(): Promise<unknown> {
  try {
    return await import("../../../../managed/aegis-bid/contract/index.js");
  } catch {
    throw new Error(
      "No generated bindings found at managed/aegis-bid. Compile first: " +
        "MIDNIGHT_COMPACT_BIN=<compiler> bun run compact:check " +
        "(see contracts/COMPACT_TOOLCHAIN.md, docs/MIDNIGHT_INTEGRATION.md).",
    );
  }
}
