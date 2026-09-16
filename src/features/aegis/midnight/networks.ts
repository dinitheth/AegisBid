/**
 * Midnight network configuration for AegisBid.
 *
 * Zero-dependency on purpose: this module is safe to import in the browser
 * bundle and in Vitest without installing the Midnight.js SDK tree.
 * Endpoint values follow `docs.midnight.network/guides/networks-and-environments`.
 *
 * The proof server always runs locally (`http://localhost:6300`) because it
 * processes private witness data — it never moves to a public host.
 */

export type MidnightNetworkId = "undeployed" | "preview" | "preprod" | "mainnet";

export type MidnightNetworkConfig = {
  id: MidnightNetworkId;
  node: string;
  indexer: string;
  indexerWS: string;
  proofServer: string;
  faucet: string | null;
};

export const MIDNIGHT_NETWORKS: Record<MidnightNetworkId, MidnightNetworkConfig> = {
  undeployed: {
    id: "undeployed",
    node: "http://localhost:9944",
    indexer: "http://localhost:8088/api/v4/graphql",
    indexerWS: "ws://localhost:8088/api/v4/graphql/ws",
    proofServer: "http://localhost:6300",
    faucet: null,
  },
  preview: {
    id: "preview",
    node: "https://rpc.preview.midnight.network",
    indexer: "https://indexer.preview.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
    proofServer: "http://localhost:6300",
    faucet: "https://midnight-tmnight-preview.nethermind.dev/",
  },
  preprod: {
    id: "preprod",
    node: "https://rpc.preprod.midnight.network",
    indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
    proofServer: "http://localhost:6300",
    faucet: "https://midnight-tmnight-preprod.nethermind.dev/",
  },
  mainnet: {
    id: "mainnet",
    node: "https://rpc.mainnet.midnight.network",
    indexer: "https://indexer.mainnet.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.mainnet.midnight.network/api/v4/graphql/ws",
    proofServer: "http://localhost:6300",
    faucet: null,
  },
};

export function isNetworkId(value: unknown): value is MidnightNetworkId {
  return (
    value === "undeployed" || value === "preview" || value === "preprod" || value === "mainnet"
  );
}

function env(name: string): string | undefined {
  try {
    const value = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[
      name
    ];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Active network. Defaults to `undeployed` (local, nothing at risk). */
export function getActiveNetworkId(): MidnightNetworkId {
  const raw = env("VITE_MIDNIGHT_NETWORK_ID");
  return raw !== undefined && isNetworkId(raw) ? raw : "undeployed";
}

export function getActiveNetwork(): MidnightNetworkConfig {
  const id = getActiveNetworkId();
  const base = MIDNIGHT_NETWORKS[id];
  const proofServer = env("VITE_MIDNIGHT_PROOF_SERVER");
  return proofServer !== undefined ? { ...base, proofServer } : base;
}

/**
 * Sets the Midnight.js network ID. Dynamically imports the SDK so the browser
 * bundle does not require it until a real contract call is made.
 * Throws a human-readable error when the package is not installed.
 */
export async function setActiveNetworkId(id: MidnightNetworkId): Promise<void> {
  let mod: unknown;
  try {
    mod = await import("@midnight-ntwrk/midnight-js-network-id");
  } catch {
    throw new Error(
      "Midnight.js is not installed. Run `npm install` with the packages in docs/MIDNIGHT_INTEGRATION.md, then retry.",
    );
  }
  const setNetworkId = (mod as { setNetworkId?: unknown }).setNetworkId;
  if (typeof setNetworkId !== "function") {
    throw new Error("Installed midnight-js-network-id does not export setNetworkId.");
  }
  (setNetworkId as (network: string) => void)(id);
}
