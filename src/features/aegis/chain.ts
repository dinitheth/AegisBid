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

const envIndexer = (import.meta.env['VITE_MIDNIGHT_INDEXER_URL'] as string | undefined) ?? "";
const envContract = (import.meta.env['VITE_AEGISBID_CONTRACT'] as string | undefined) ?? "";

export function getChainConfig(): ChainConfig {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ChainConfig>;
        if (saved.indexerUrl && saved.contractAddress) {
          return { indexerUrl: saved.indexerUrl, contractAddress: saved.contractAddress };
        }
      }
    } catch {
      /* ignore unreadable local settings */
    }
  }
  return { indexerUrl: envIndexer, contractAddress: envContract };
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
  if (payload.errors?.length) throw new Error(payload.errors.map((item) => item.message).join("; "));
  if (!payload.data) throw new Error("The indexer returned no data for this contract.");
  return payload.data;
}

type ActionNode = {
  __typename?: string;
  address?: string;
  state?: string;
  transaction?: { hash?: string; block?: { height?: number; timestamp?: string } };
};

export async function fetchContractState(config: ChainConfig = getChainConfig()): Promise<ChainContractState> {
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

export async function fetchChainActivity(config: ChainConfig = getChainConfig()): Promise<ChainActivity> {
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
      ? [{ hash: state.transactionHash, kind: "ContractAction", blockHeight: state.blockHeight, timestamp: state.blockTimestamp }]
      : [];
  }
  return { state, actions };
}

/** Turns raw indexer activity into the tender records the explorer renders. */
export function activityToTenders(activity: ChainActivity): Tender[] {
  const deploys = activity.actions.filter((item) => item.kind.toLowerCase().includes("deploy"));
  const calls = activity.actions.filter((item) => !item.kind.toLowerCase().includes("deploy"));
  const anchor = deploys[deploys.length - 1] ?? activity.actions[activity.actions.length - 1];
  const settled = activity.actions.some((item) => item.kind.toLowerCase().includes("settle"));
  const deployedAt = anchor?.timestamp ? new Date(anchor.timestamp) : null;
  return [
    {
      id: `${activity.state.address.slice(0, 10)}...${activity.state.address.slice(-6)}`,
      title: "On-chain tender",
      issuer: "Midnight contract",
      deadline: new Date((deployedAt?.getTime() ?? Date.now()) + 7 * 86_400_000).toISOString(),
      threshold: activity.state.blockHeight ? `Last update at block ${activity.state.blockHeight}` : "Live contract state",
      commitments: calls.length,
      status: settled ? "Settled" : "Active",
      mode: "Lowest compliant",
      specification: "Tender data read live from the Midnight indexer for this contract.",
    },
  ];
}
