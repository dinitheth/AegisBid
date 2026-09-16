/**
 * Zero-dependency Midnight deployment status for AegisBid.
 *
 * Usage: `node scripts/midnight-status.mjs`
 * Always exits 0: it reports status, it does not gate. Anything it cannot
 * reach is reported as NOT READY with the next step, never as a crash.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NETWORKS = {
  undeployed: {
    node: "http://localhost:9944",
    indexer: "http://localhost:8088/api/v4/graphql",
    proofServer: "http://localhost:6300",
  },
  preview: {
    node: "https://rpc.preview.midnight.network",
    indexer: "https://indexer.preview.midnight.network/api/v4/graphql",
    proofServer: "http://localhost:6300",
  },
  preprod: {
    node: "https://rpc.preprod.midnight.network",
    indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
    proofServer: "http://localhost:6300",
  },
  mainnet: {
    node: "https://rpc.mainnet.midnight.network",
    indexer: "https://indexer.mainnet.midnight.network/api/v4/graphql",
    proofServer: "http://localhost:6300",
  },
};

const networkId = process.env.VITE_MIDNIGHT_NETWORK_ID ?? "undeployed";
const network = NETWORKS[networkId] ?? NETWORKS.undeployed;
const contractAddress = process.env.VITE_AEGISBID_CONTRACT ?? "";

const managedDir = path.join(root, "managed", "aegis-bid");
const artifacts = {
  "contract bindings (contract/index.js)": path.join(managedDir, "contract", "index.js"),
  "contract types (contract/index.d.ts)": path.join(managedDir, "contract", "index.d.ts"),
  "zk circuits (zkir/)": path.join(managedDir, "zkir"),
  "proving keys (keys/)": path.join(managedDir, "keys"),
};

async function probe(label, fn) {
  try {
    const detail = await fn();
    console.log(`READY    ${label}${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (error) {
    console.log(`NOT READY ${label} — ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function fetchJson(url, init, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

console.log("AegisBid Midnight status");
console.log(`network: ${networkId}`);
console.log(`contract: ${contractAddress || "(not configured — VITE_AEGISBID_CONTRACT is empty)"}`);
console.log("");

console.log("— compile artifacts —");
for (const [label, file] of Object.entries(artifacts)) {
  console.log(`${existsSync(file) ? "READY    " : "NOT READY"} ${label}`);
}
console.log("  (produce via: MIDNIGHT_COMPACT_BIN=<compiler> bun run compact:check)");
console.log("");

console.log("— network endpoints —");
await probe(`node ${network.node}`, async () => {
  const health = await fetchJson(`${network.node.replace(/\/$/, "")}/health`);
  return `isSyncing=${health.isSyncing ?? "?"}`;
});
await probe(`indexer ${network.indexer}`, async () => {
  const data = await fetchJson(network.indexer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ block { height } }" }),
  });
  const height = data?.data?.block?.height;
  if (height === undefined) throw new Error("no block height in response");
  return `block height ${height}`;
});
await probe("proof server http://localhost:6300", async () => {
  const health = await fetchJson("http://localhost:6300/health");
  return `status=${health.status ?? "?"}`;
});

console.log("");
if (!contractAddress || !existsSync(path.join(managedDir, "contract", "index.js"))) {
  console.log("CONCLUSION: NOT DEPLOYED — see docs/MIDNIGHT_INTEGRATION.md for the deploy path.");
} else {
  console.log("CONCLUSION: configured — verify the address on the network explorer.");
}
