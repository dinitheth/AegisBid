export type TenderStatus = "Active" | "Evaluating" | "Settled";
export type TenderMode = "Highest bid" | "Lowest compliant";

export type Tender = {
  id: string;
  title: string;
  issuer: string;
  deadline: string;
  threshold: string;
  commitments: number;
  status: TenderStatus;
  mode: TenderMode;
  specification: string;
  /** Live on-chain contract address. */
  contractAddress?: string;
  /** V2 tenders can use the V2 prover/verifier bundle. Legacy contracts cannot. */
  contractVersion?: 1 | 2;
  /** Public winner receipt, present after the V2 settlement is indexed. */
  settlement?: { winnerCommitment: string; winningValue: string };
};

/**
 * DISPLAY-ONLY truncated hash for receipts and short labels.
 * NOT a binding commitment: it is FNV-1a, non-cryptographic, and must never
 * be presented as the protocol commitment. Binding commitments are derived
 * via `makeCommitment` in `tenderEngine.ts` (SHA-256 over amount:salt:key).
 */
export const shortHash = (seed: string) => {
  let a = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) a = Math.imul(a ^ seed.charCodeAt(i), 16777619);
  const chunk = (a >>> 0).toString(16).padStart(8, "0");
  return `0x${chunk}${chunk.split("").reverse().join("")}${chunk.slice(2)}${chunk.slice(0, 2)}`;
};

export const generateNonce = () => {
  const values = new Uint32Array(4);
  if (typeof crypto !== "undefined") crypto.getRandomValues(values);
  else values.set([1937, 4112, 8103, 5521]);
  return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
};

export const formatCountdown = (deadline: string) => {
  const delta = new Date(deadline).getTime() - Date.now();
  if (!Number.isFinite(delta)) return "Date to be announced";
  if (delta <= 0) return "Closed";
  const hours = Math.floor(delta / 3_600_000);
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

/**
 * A bid recorded on this device. `commitment` MUST be a `makeCommitment`
 * (tenderEngine.ts) value over (`amount`, `salt`, `bidderKey`); older
 * locally stored entries predate `salt`/`bidderKey` and are migrated by
 * `normalizeStoredBids`.
 */
export type StoredBid = {
  tenderId: string;
  tenderTitle: string;
  tenderStatus: Tender["status"];
  amount: string;
  receipt: string;
  commitment: string;
  /** Exact persistentCommit returned by the live V2 submitBid circuit. */
  chainCommitment?: string;
  salt: string;
  bidderKey: string;
  /** Identity witness for live settlement proofs; empty for legacy rows. */
  identitySecret: string;
  submittedAt: number;
  accepted: boolean;
  note: string;
  onChain: boolean;
};

/** Tolerantly normalize untrusted localStorage data into StoredBid records. */
export function normalizeStoredBids(raw: unknown): StoredBid[] {
  if (!Array.isArray(raw)) return [];
  const bids: StoredBid[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record["tenderId"] !== "string" ||
      typeof record["tenderTitle"] !== "string" ||
      typeof record["amount"] !== "string" ||
      typeof record["commitment"] !== "string" ||
      typeof record["submittedAt"] !== "number"
    ) {
      continue;
    }
    const status = record["tenderStatus"];
    bids.push({
      tenderId: record["tenderId"] as string,
      tenderTitle: record["tenderTitle"] as string,
      tenderStatus:
        status === "Active" || status === "Evaluating" || status === "Settled" ? status : "Active",
      amount: record["amount"] as string,
      receipt:
        typeof record["receipt"] === "string"
          ? (record["receipt"] as string)
          : (record["commitment"] as string),
      commitment: record["commitment"] as string,
      ...(typeof record["chainCommitment"] === "string"
        ? { chainCommitment: record["chainCommitment"] }
        : {}),
      salt: typeof record["salt"] === "string" ? (record["salt"] as string) : "",
      bidderKey: typeof record["bidderKey"] === "string" ? (record["bidderKey"] as string) : "",
      identitySecret:
        typeof record["identitySecret"] === "string" ? (record["identitySecret"] as string) : "",
      submittedAt: record["submittedAt"] as number,
      accepted: record["accepted"] === true,
      note: typeof record["note"] === "string" ? (record["note"] as string) : "",
      onChain: record["onChain"] === true,
    });
  }
  return bids;
}

/** True only when this device has the exact on-chain commitment for this tender. */
export function matchesSavedBidToWinner(tender: Tender, bids: StoredBid[]): boolean {
  const winner = tender.settlement?.winnerCommitment;
  const contractAddress = tender.contractAddress?.toLowerCase();
  if (!winner || !contractAddress) return false;
  const normalize = (value: string) => value.replace(/^0x/i, "").toLowerCase();
  return bids.some(
    (bid) =>
      bid.accepted &&
      bid.onChain &&
      (bid.tenderId.toLowerCase() === tender.id.toLowerCase() ||
        bid.tenderId.toLowerCase() === contractAddress) &&
      typeof bid.chainCommitment === "string" &&
      normalize(bid.chainCommitment) === normalize(winner),
  );
}

export const proofStages = [
  ["Witness binding", "Private inputs loaded into local proving context"],
  ["Commitment synthesis", "SHA-256 model of the persistentCommit binding (workbench only)"],
  ["Eligibility circuit", "Deadline, nullifier and tender policy constraints evaluated"],
  ["Proof construction", "Zero-knowledge transcript produced locally"],
  ["Ledger submission", "Commitment and proof receipt accepted by public state"],
] as const;

export const simulations = [
  {
    id: "sealed",
    name: "Three-party sealed bid",
    detail: "Proves a maximum across three committed bids while redacting two losing values.",
    logs: [
      "Deploy tender AGB-SIM-001 with reserve 1,000",
      "Commit bidder A: 0x1a76…c901",
      "Commit bidder B: 0x84f2…73de",
      "Commit bidder C: 0x029b…ea41",
      "Close tender at ledger time 1,789,120",
      "Verify three membership proofs",
      "Prove winner >= each committed candidate",
      "Publish winner commitment 0x84f2…73de",
      "Assert losing values absent from public receipt",
    ],
  },
  {
    id: "reserve",
    name: "Under-reserve rejection",
    detail: "Rejects settlement when the maximum committed value does not satisfy reserve.",
    logs: [
      "Deploy highest-bid tender with reserve 5,000",
      "Commit private bid A",
      "Commit private bid B",
      "Advance ledger beyond deadline",
      "Evaluate maximum witness: 4,920",
      "Constraint winningAmount >= reserve failed as expected",
      "Assert settlement state remains empty",
    ],
  },
  {
    id: "deadline",
    name: "Post-deadline submission",
    detail: "Rejects a valid commitment submitted after the immutable close time.",
    logs: [
      "Deploy tender with deadline 1,789,200",
      "Advance ledger time to 1,789,201",
      "Construct valid private witness",
      "Invoke submitBid",
      "Constraint now < tender.deadline failed as expected",
      "Assert commitment count unchanged",
    ],
  },
] as const;
