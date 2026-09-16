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
};

export const defaultTender: Tender = { id: "AGB-2026-041", title: "Grid-scale battery storage", issuer: "North Sea Energy Authority", deadline: "2026-09-14T18:00:00Z", threshold: "Reserve 4.20M tDUST", commitments: 12, status: "Active", mode: "Lowest compliant", specification: "120 MWh delivery capacity · ISO 27001 operator" };

export const initialTenders: Tender[] = [
  defaultTender,
  { id: "AGB-2026-039", title: "Sovereign fiber backbone", issuer: "Civic Infrastructure Board", deadline: "2026-09-12T09:30:00Z", threshold: "Ceiling 8.75M tDUST", commitments: 8, status: "Active", mode: "Lowest compliant", specification: "420 km route · 99.995% availability" },
  { id: "AGB-2026-036", title: "Spectrum license block C7", issuer: "Digital Markets Office", deadline: "2026-09-11T13:00:00Z", threshold: "Reserve 12.00M tDUST", commitments: 21, status: "Evaluating", mode: "Highest bid", specification: "20-year operating license · region C7" },
  { id: "AGB-2026-031", title: "Municipal compute framework", issuer: "Canton Procurement Office", deadline: "2026-09-04T16:00:00Z", threshold: "Ceiling 2.10M tDUST", commitments: 6, status: "Settled", mode: "Lowest compliant", specification: "Confidential cloud capacity · 36 months" },
  { id: "AGB-2026-027", title: "Carbon removal tranche 08", issuer: "Climate Reserve DAO", deadline: "2026-08-28T12:00:00Z", threshold: "Reserve 880K tDUST", commitments: 17, status: "Settled", mode: "Highest bid", specification: "Verified removal units · vintage 2027" },
];

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
  if (delta <= 0) return "Closed";
  const hours = Math.floor(delta / 3_600_000);
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

export const proofStages = [
  ["Witness binding", "Private inputs loaded into local proving context"],
  ["Commitment synthesis", "Poseidon-compatible commitment constraints generated"],
  ["Eligibility circuit", "Deadline, nullifier and tender policy constraints evaluated"],
  ["Proof construction", "Zero-knowledge transcript produced locally"],
  ["Ledger submission", "Commitment and proof receipt accepted by public state"],
] as const;

export const simulations = [
  { id: "sealed", name: "Three-party sealed bid", detail: "Proves a maximum across three committed bids while redacting two losing values.", logs: ["Deploy tender AGB-SIM-001 with reserve 1,000", "Commit bidder A: 0x1a76…c901", "Commit bidder B: 0x84f2…73de", "Commit bidder C: 0x029b…ea41", "Close tender at ledger time 1,789,120", "Verify three membership proofs", "Prove winner >= each committed candidate", "Publish winner commitment 0x84f2…73de", "Assert losing values absent from public receipt"] },
  { id: "reserve", name: "Under-reserve rejection", detail: "Rejects settlement when the maximum committed value does not satisfy reserve.", logs: ["Deploy highest-bid tender with reserve 5,000", "Commit private bid A", "Commit private bid B", "Advance ledger beyond deadline", "Evaluate maximum witness: 4,920", "Constraint winningAmount >= reserve failed as expected", "Assert settlement state remains empty"] },
  { id: "deadline", name: "Post-deadline submission", detail: "Rejects a valid commitment submitted after the immutable close time.", logs: ["Deploy tender with deadline 1,789,200", "Advance ledger time to 1,789,201", "Construct valid private witness", "Invoke submitBid", "Constraint now < tender.deadline failed as expected", "Assert commitment count unchanged"] },
] as const;
