/**
 * Live Midnight chain access for AegisBid.
 *
 * Two sources of configuration, in order of priority:
 *   1. Values entered in the app (stored on this device)
 *   2. Build-time values VITE_MIDNIGHT_INDEXER_URL and VITE_AEGISBID_CONTRACT
 */
import type { Tender } from "./protocol";

export type ChainConfig = { indexerUrl: string; contractAddress: string };

const STORAGE_KEY = "aegis-chain-config";

const envIndexer = (import.meta.env["VITE_MIDNIGHT_INDEXER_URL"] as string | undefined) ?? "";
const envContract = (import.meta.env["VITE_AEGISBID_CONTRACT"] as string | undefined) ?? "";

/**
 * Flagship deployment: the verified V2 preprod tender. A fresh visitor sees
 * the supported contract without configuring anything. The V1 demo stays
 * immutable on-chain but is deliberately not surfaced by this application.
 */
export const FLAGSHIP_TENDER = {
  indexerUrl: "https://indexer.preprod.midnight.network/api/v4/graphql",
  contractAddress: "21b2efc6d75311c13c42f131ea48406539a5a461ecb32f7fb7e0e460e9bdc957",
  title: "Parks Authority · V2 preprod tender",
  issuer: "Parks Authority",
  deadline: "2026-10-15T22:42:00.000Z",
  threshold: "Reserve 5,000 credits",
  mode: "Highest bid" as const,
  specification: "Central park landscaping plus 12-month maintenance.",
  contractVersion: 2 as const,
};

/** V2 contracts that predate the versioned share-link format. */
export const KNOWN_V2_CONTRACTS = new Set([
  "21b2efc6d75311c13c42f131ea48406539a5a461ecb32f7fb7e0e460e9bdc957",
]);

const RETIRED_V1_CONTRACTS = new Set([
  "daf54fc95751b84c53da2f402aea96e5f23d19185783453ba067c123d89d0fc4",
]);

export function publishedContractVersion(address: string, declared?: unknown): 1 | 2 {
  if (declared === 2 || declared === "2" || KNOWN_V2_CONTRACTS.has(address.toLowerCase())) return 2;
  return 1;
}

export function getChainConfig(): ChainConfig {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ChainConfig>;
        if (saved.indexerUrl && saved.contractAddress) {
          // Migrate existing browsers away from the former V1 demo instead
          // of reintroducing it after a refresh.
          if (!RETIRED_V1_CONTRACTS.has(saved.contractAddress.toLowerCase())) {
            return { indexerUrl: saved.indexerUrl, contractAddress: saved.contractAddress };
          }
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      /* ignore unreadable local settings */
    }
  }
  if (envIndexer && envContract && !RETIRED_V1_CONTRACTS.has(envContract.toLowerCase())) {
    return { indexerUrl: envIndexer, contractAddress: envContract };
  }
  return {
    indexerUrl: FLAGSHIP_TENDER.indexerUrl,
    contractAddress: FLAGSHIP_TENDER.contractAddress,
  };
}

export function saveChainConfig(config: ChainConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearChainConfig() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function isConfigured(config: ChainConfig) {
  return Boolean(config.indexerUrl && config.contractAddress);
}

/** Build-time configuration flag kept for existing callers. */
export const chainConfigured = Boolean(envIndexer && envContract);
export const indexerUrl = envIndexer || undefined;
export const contractAddress = envContract || undefined;

export type ChainContractState = {
  address: string;
  blockHeight: number | null;
  blockTimestamp: string | null;
  transactionHash: string | null;
  stateHex: string | null;
};

export type ChainActivity = {
  state: ChainContractState;
  /** Every transaction that has touched the contract, newest first. */
  actions: {
    hash: string;
    kind: string;
    blockHeight: number | null;
    timestamp: string | null;
  }[];
};

const STATE_QUERY = `query ContractState($address: String!) {
  contractAction(address: $address) {
    address
    state
    __typename
    transaction { hash block { height timestamp } }
  }
}`;

const HISTORY_QUERY = `query ContractHistory($address: String!) {
  contractActions(address: $address) {
    __typename
    transaction { hash block { height timestamp } }
  }
}`;

async function callIndexer<T>(config: ChainConfig, query: string): Promise<T> {
  const response = await fetch(config.indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { address: config.contractAddress } }),
  });
  if (!response.ok) {
    throw new Error(`Indexer request failed [${response.status}]: ${await response.text()}`);
  }
  const payload = (await response.json()) as { errors?: { message: string }[]; data?: T };
  if (payload.errors?.length)
    throw new Error(payload.errors.map((item) => item.message).join("; "));
  if (!payload.data) throw new Error("The indexer returned no data for this contract.");
  return payload.data;
}

type ActionNode = {
  __typename?: string;
  address?: string;
  state?: string;
  transaction?: { hash?: string; block?: { height?: number; timestamp?: string } };
};

export async function fetchContractState(
  config: ChainConfig = getChainConfig(),
): Promise<ChainContractState> {
  if (!isConfigured(config)) throw new Error("Midnight indexer is not configured.");
  const data = await callIndexer<{ contractAction?: ActionNode }>(config, STATE_QUERY);
  const action = data.contractAction;
  if (!action) throw new Error("Contract not found on this network.");
  return {
    address: action.address ?? config.contractAddress,
    blockHeight: action.transaction?.block?.height ?? null,
    blockTimestamp: action.transaction?.block?.timestamp ?? null,
    transactionHash: action.transaction?.hash ?? null,
    stateHex: action.state ?? null,
  };
}

export async function fetchChainActivity(
  config: ChainConfig = getChainConfig(),
): Promise<ChainActivity> {
  const state = await fetchContractState(config);
  let actions: ChainActivity["actions"] = [];
  try {
    const data = await callIndexer<{ contractActions?: ActionNode[] }>(config, HISTORY_QUERY);
    actions = (data.contractActions ?? []).map((node) => ({
      hash: node.transaction?.hash ?? "",
      kind: node.__typename ?? "ContractCall",
      blockHeight: node.transaction?.block?.height ?? null,
      timestamp: node.transaction?.block?.timestamp ?? null,
    }));
    actions.sort((a, b) => (b.blockHeight ?? 0) - (a.blockHeight ?? 0));
  } catch {
    // Some indexers expose only the latest action; fall back to that single entry.
    actions = state.transactionHash
      ? [
          {
            hash: state.transactionHash,
            kind: "ContractAction",
            blockHeight: state.blockHeight,
            timestamp: state.blockTimestamp,
          },
        ]
      : [];
  }
  return { state, actions };
}

/**
 * Tenders published from the Live deploy page. The directory only queries
 * one configured contract, so these local records are merged in separately
 * (see `publishedToTender`). Stored under `aegis-published-tenders`.
 */
export type PublishedTender = {
  address: string;
  issuer: string;
  mode: "highest" | "lowest";
  reserve: string;
  deadline: string;
  deployedAt: number;
  /** Every tender surfaced by the app is an authenticated V2 contract. */
  contractVersion: 2;
};

const PUBLISHED_KEY = "aegis-published-tenders";

/** Strict shape check shared by local history, share links, and the registry. */
export function isValidPublishedTender(entry: unknown): entry is PublishedTender {
  if (typeof entry !== "object" || entry === null) return false;
  const record = entry as Record<string, unknown>;
  return (
    typeof record["address"] === "string" &&
    /^[0-9a-f]{64}$/.test(record["address"]) &&
    typeof record["issuer"] === "string" &&
    (record["mode"] === "highest" || record["mode"] === "lowest") &&
    typeof record["reserve"] === "string" &&
    typeof record["deadline"] === "string" &&
    typeof record["deployedAt"] === "number" &&
    record["contractVersion"] === 2
  );
}

export function loadPublishedTenders(): PublishedTender[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PUBLISHED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPublishedTender);
  } catch {
    return [];
  }
}

/**
 * Merges tender sources newest-first, deduplicated by address: shared
 * registry first (same order for every viewer), then device-local records
 * the registry hasn't seen yet.
 */
export function mergePublishedSources(
  registry: PublishedTender[],
  local: PublishedTender[],
): PublishedTender[] {
  const seen = new Set<string>();
  const merged: PublishedTender[] = [];
  for (const entry of [...registry, ...local]) {
    if (!isValidPublishedTender(entry) || seen.has(entry.address)) continue;
    seen.add(entry.address);
    merged.push(entry);
  }
  return merged;
}

export function savePublishedTenders(items: PublishedTender[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PUBLISHED_KEY, JSON.stringify(items));
  } catch {
    /* private mode etc. */
  }
}

/**
 * Parses a V2 tender share link (`?contract=<64-hex>&issuer=&deadline=&mode=&reserve=&v=2`).
 * Tender policy is public by design, so encoding it in the link is safe —
 * it lets anyone who opens the link see the full honest tender (policy from
 * the link, live counts from the indexer) without a backend registry.
 * Returns null unless the address is a well-formed contract address.
 */
export function parseSharedTender(search: string): PublishedTender | null {
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(search);
  } catch {
    return null;
  }
  const address = (query.get("contract") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(address)) return null;
  // V1 links are historical records only. Do not re-import them into the
  // directory or present a disabled bid form to users.
  if (publishedContractVersion(address, query.get("v")) !== 2) return null;
  const reserve = query.get("reserve") ?? "";
  const deadline = query.get("deadline") ?? "";
  return {
    address,
    issuer: (query.get("issuer") ?? "").slice(0, 120) || "Shared tender",
    mode: query.get("mode") === "lowest" ? "lowest" : "highest",
    reserve: /^\d+$/.test(reserve) ? reserve : "0",
    deadline: deadline && !Number.isNaN(Date.parse(deadline)) ? deadline : "",
    deployedAt: Date.now(),
    contractVersion: 2,
  };
}

/**
 * Overlays live indexer activity onto a published tender record: real bid
 * counts and settled detection. Falls back to the record untouched when
 * there is no activity (indexer unreachable).
 */
export function applyLiveCounts(tender: Tender, activity: ChainActivity | null): Tender {
  if (!activity) return tender;
  const calls = activity.actions.filter((item) => !item.kind.toLowerCase().includes("deploy"));
  const settled = activity.actions.some((item) => item.kind.toLowerCase().includes("settle"));
  return {
    ...tender,
    commitments: calls.length,
    status: settled ? "Settled" : tender.status,
  };
}

/** Maps a locally published tender to the directory record shape. */
export function publishedToTender(entry: PublishedTender): Tender {
  const closesAt = new Date(entry.deadline).getTime();
  const reserve = Number(entry.reserve === "" ? "0" : entry.reserve);
  const reserveLabel = Number.isFinite(reserve) ? reserve.toLocaleString("en-US") : entry.reserve;
  return {
    id: entry.address,
    title: entry.issuer || "Published tender",
    issuer: entry.issuer || "Unknown issuer",
    deadline: entry.deadline,
    threshold:
      entry.mode === "lowest"
        ? `Ceiling ${reserveLabel} credits`
        : `Reserve ${reserveLabel} credits`,
    commitments: 0,
    status: Number.isNaN(closesAt) || closesAt > Date.now() ? "Active" : "Evaluating",
    mode: entry.mode === "lowest" ? "Lowest compliant" : "Highest bid",
    specification: "Published from this device; bid counts update after the first offer.",
    contractAddress: entry.address,
    contractVersion: publishedContractVersion(entry.address, entry.contractVersion),
  };
}

/** Turns raw indexer activity into the tender records the explorer renders. */
export function activityToTenders(activity: ChainActivity): Tender[] {
  const calls = activity.actions.filter((item) => !item.kind.toLowerCase().includes("deploy"));
  const settled = activity.actions.some((item) => item.kind.toLowerCase().includes("settle"));
  if (activity.state.address === FLAGSHIP_TENDER.contractAddress) {
    // Verified on-chain parameters of the flagship deployment (see
    // FLAGSHIP_TENDER); only counts and status are read live. A past
    // deadline means bidding is over even though the on-chain phase is
    // still Open — showing "Open for bids" would invite rejected bids.
    const deadlinePassed = new Date(FLAGSHIP_TENDER.deadline).getTime() <= Date.now();
    return [
      {
        id: `${activity.state.address.slice(0, 10)}...${activity.state.address.slice(-6)}`,
        title: FLAGSHIP_TENDER.title,
        issuer: FLAGSHIP_TENDER.issuer,
        deadline: FLAGSHIP_TENDER.deadline,
        threshold: FLAGSHIP_TENDER.threshold,
        commitments: calls.length,
        status: settled ? "Settled" : deadlinePassed ? "Evaluating" : "Active",
        mode: FLAGSHIP_TENDER.mode,
        specification: `${FLAGSHIP_TENDER.specification} Live bid count below.`,
        contractAddress: activity.state.address,
        contractVersion: FLAGSHIP_TENDER.contractVersion,
      },
    ];
  }
  // A manually configured legacy address remains inspectable in an explorer
  // but is not a platform opportunity.
  return [];
}
