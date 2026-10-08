/**
 * Shared 1AM provider stack for browser contract calls.
 *
 * Follows the 1AM integration reference (1am.xyz/ai.txt + /developers):
 * FetchZkConfigProvider for hosted proving keys, indexer provider from the
 * wallet's own config, proving/balance/submit delegated to the 1AM
 * extension. ProofStation sponsors fees: the user pays 0 NIGHT/DUST.
 *
 * Used by DeployPage (deployContract) and BidPage (submitCallTx). Keeps
 * zero static ledger imports: ledger-v8 is loaded dynamically inside the
 * proving/balancing handlers so the SSR bundle never evaluates WASM.
 */
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import {
  deployContract,
  findDeployedContract,
  submitCallTx,
} from "@midnight-ntwrk/midnight-js-contracts";
import { Contract, TenderMode } from "../../../../managed/aegis-bid-v2/contract/index.js";
import { hexToBytes, stringToBytes32 } from "./contract";
import type { OneAmConnectedApi } from "./oneAmWallet";
import * as forensicsModule from "./forensics";

export const ZK_BASE =
  (import.meta.env["VITE_AEGISBID_V2_ZK_CONFIG_BASE"] as string | undefined) ||
  "https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@main/managed/aegis-bid-v2";

export const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export type PrivateBidWitnesses = {
  amount: bigint;
  salt: Uint8Array;
  bidderKey: Uint8Array;
  /** Deployment/evaluation capability. Keep this private and back it up. */
  evaluatorSecret?: Uint8Array;
};

/**
 * Private state ID for the AegisBid contract.
 * Matches the private state ID used in the contract's witness functions.
 */
export const AegisBidPrivateStateId = "aegis-bid-private-state" as const;

/**
 * Initial private state for the AegisBid contract.
 * Contains the secret key for deriving p1_key/p2_key, and placeholders for myMove/mySalt.
 */
export const INITIAL_AEGISBID_PRIVATE_STATE = {
  secretKey: new Uint8Array(32), // Will be derived from wallet
  myMove: 0n,
  mySalt: new Uint8Array(32),
} as const;

/**
 * Witness implementations MUST be inline object literals at the
 * withWitnesses call site: the SDK's conditional types only resolve when
 * TypeScript infers from a fresh literal. Pre-typed helpers (Record or the
 * generated Witnesses alias) collapse the parameter to `never`.
 */

// Witness functions receive the SDK's context object; typing the parameter as
// `any` matches the documented SDK usage and keeps generic inference intact.
// A precise structural type collapses the withWitnesses conditional to never.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWitnessContext = any;

export type LedgerTenderInput = {
  issuer: string;
  deadlineSec: bigint;
  reserve: bigint;
  mode: "highest" | "lowest";
  spec: string;
};

/** Maps UI-friendly tender fields to the Compact constructor shape. */
export function toBindingTenderConfig(input: LedgerTenderInput) {
  return {
    issuer: stringToBytes32(input.issuer),
    deadline: input.deadlineSec,
    reserve: input.reserve,
    mode: input.mode === "lowest" ? TenderMode.LowestCompliant : TenderMode.HighestBid,
    specificationRoot: stringToBytes32(input.spec),
  };
}

export type ProvingVia = "wallet" | "proof-server";

export type AegisProviders = {
  providers: Parameters<typeof deployContract>[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compiled: any;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  /** Where proofs come from: the wallet (1AM/ProofStation) or the local proof server (Lace fallback). */
  provingVia: ProvingVia;
};

/** Local proof server for wallets that don't prove in-extension (Lace). */
export const PROOF_SERVER_URL =
  (import.meta.env["VITE_MIDNIGHT_PROOF_SERVER"] as string | undefined) ||
  (import.meta.env["VITE_PROOF_SERVER_URL"] as string | undefined) ||
  "http://127.0.0.1:6300";

/**
 * In-memory private-state provider. `deployContract`/`submitCallTx` require
 * one (they call `setContractAddress` first — omitting it crashes with
 * "Cannot read properties of undefined"). Ephemeral by design: it only
 * scopes a single deploy/call session. Maintenance-authority keys stored via
 * `setSigningKey` do NOT survive reloads — acceptable for the demo flow
 * (deploy + bid); a persistent level-backed provider can replace this later.
 */
export function createMemoryPrivateStateProvider() {
  let scope = "";
  const states = new Map<string, unknown>();
  const signingKeys = new Map<string, unknown>();
  const scoped = (id: unknown) => `${scope}::${String(id)}`;
  return {
    setContractAddress(address: string) {
      scope = String(address);
    },
    async set(privateStateId: unknown, state: unknown) {
      states.set(scoped(privateStateId), state);
    },
    async get(privateStateId: unknown) {
      return states.has(scoped(privateStateId)) ? states.get(scoped(privateStateId)) : null;
    },
    async remove(privateStateId: unknown) {
      states.delete(scoped(privateStateId));
    },
    async clear() {
      states.clear();
    },
    async setSigningKey(address: unknown, signingKey: unknown) {
      signingKeys.set(String(address), signingKey);
    },
    async getSigningKey(address: unknown) {
      const key = String(address);
      return signingKeys.has(key) ? signingKeys.get(key) : null;
    },
    async removeSigningKey(address: unknown) {
      signingKeys.delete(String(address));
    },
    async clearSigningKeys() {
      signingKeys.clear();
    },
  };
}

export async function buildConnectorBase(api: OneAmConnectedApi, bid?: PrivateBidWitnesses) {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId || "preprod");

  const zkConfigProvider = new FetchZkConfigProvider(ZK_BASE, fetch.bind(window));
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const privateStateProvider = createMemoryPrivateStateProvider();

  const keys = await api.getShieldedAddresses();
  const walletProvider = {
    getCoinPublicKey: () => keys.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => keys.shieldedEncryptionPublicKey,
    async balanceTx(tx: { serialize: () => Uint8Array }) {
      const result = await api.balanceUnsealedTransaction(bytesToHex(tx.serialize()));
      const { Transaction } = await import("@midnight-ntwrk/ledger-v8");
      return Transaction.deserialize("signature", "proof", "binding", hexToBytes(result.tx));
    },
  };
  const midnightProvider = {
    async submitTx(tx: { serialize: () => Uint8Array; identifiers: () => string[] }) {
      await api.submitTransaction(bytesToHex(tx.serialize()));
      return tx.identifiers()[0] ?? "";
    },
  };

  const amount = bid?.amount ?? 0n;
  const salt = bid?.salt ?? new Uint8Array(32);
  const bidderKey = bid?.bidderKey ?? new Uint8Array(32);
  const evaluatorSecret = bid?.evaluatorSecret ?? new Uint8Array(32);
  // The SDK's withWitnesses conditional types cannot infer through this call
  // shape (its witnesses parameter collapses to `never` no matter how the
  // object is typed — verified against the .d.ts). The object below is still
  // the exact executable shape: it settled end-to-end on a local devnet and
  // is covered by the providers.test.ts smoke test.
  const compiled = CompiledContract.withCompiledFileAssets(
    // @ts-expect-error: SDK withWitnesses witnesses param collapses to never; runtime-verified
    CompiledContract.withWitnesses(CompiledContract.make("aegisbid", Contract), {
      localBidAmount: ({ privateState }: AnyWitnessContext) => [privateState, amount],
      localBidSalt: ({ privateState }: AnyWitnessContext) => [privateState, salt],
      evaluatorSecret: ({ privateState }: AnyWitnessContext) => [privateState, evaluatorSecret],
      settlementBid: ({ privateState }: AnyWitnessContext) => [privateState, amount],
      settlementSalt: ({ privateState }: AnyWitnessContext) => [privateState, salt],
      settlementKey: ({ privateState }: AnyWitnessContext) => [privateState, bidderKey],
    }),
    "./managed/aegis-bid-v2",
  );
  return {
    config,
    zkConfigProvider,
    publicDataProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider,
    compiled,
  };
}

/**
 * Builds the provider stack + compiled contract.
 * Pass a bid to attach its real witnesses; otherwise zero stubs are used
 * (the constructor never invokes witnesses).
 */
function makeWalletProofProvider(provingProvider: unknown) {
  return {
    // Proving has no chain effects: retry transient (rate-limit) failures.
    async proveTx(unprovenTx: { prove: (prover: unknown, cost: unknown) => Promise<unknown> }) {
      let last: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const { CostModel } = await import("@midnight-ntwrk/ledger-v8");
          return await unprovenTx.prove(provingProvider, CostModel.initialCostModel());
        } catch (error) {
          last = error;
          const message = error instanceof Error ? error.message : String(error);
          if (
            !/rate|429|limit|timeout|network|fetch|econn|socket/i.test(message) ||
            attempt === 3
          ) {
            throw error;
          }
          await new Promise((r) => setTimeout(r, attempt * 4000));
        }
      }
      throw last;
    },
  };
}

export async function buildOneAmProviders(
  api: OneAmConnectedApi,
  bid?: PrivateBidWitnesses,
): Promise<AegisProviders> {
  const {
    zkConfigProvider,
    publicDataProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider,
    compiled,
  } = await buildConnectorBase(api, bid);

  const provingProvider = await api.getProvingProvider(zkConfigProvider);
  const proofProvider = makeWalletProofProvider(provingProvider);
  return {
    providers: {
      publicDataProvider,
      zkConfigProvider,
      privateStateProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    compiled,
    publicDataProvider,
    provingVia: "wallet",
  };
}

/**
 * Lace provider stack. Tries wallet-delegated proving first; if the wallet
 * declines (Lace proves via an external proof server, not in-extension),
 * falls back to the local proof server — `VITE_PROOF_SERVER_URL`, default
 * `http://127.0.0.1:6300`, which Lace itself requires running via Docker.
 */
export async function buildLaceProviders(
  api: OneAmConnectedApi,
  bid?: PrivateBidWitnesses,
  opts?: { proofServerUrl?: string },
): Promise<AegisProviders> {
  const {
    zkConfigProvider,
    publicDataProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider,
    compiled,
  } = await buildConnectorBase(api, bid);

  let provingVia: ProvingVia = "wallet";
  // Loose on purpose: the assembled providers object is cast for
  // deployContract below (its generics can't express both provers).
  let proofProvider: unknown;
  try {
    const provingProvider = await api.getProvingProvider(zkConfigProvider);
    proofProvider = makeWalletProofProvider(provingProvider);
  } catch {
    provingVia = "proof-server";
    const { httpClientProofProvider } =
      await import("@midnight-ntwrk/midnight-js-http-client-proof-provider");
    proofProvider = httpClientProofProvider(
      opts?.proofServerUrl ?? PROOF_SERVER_URL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zkConfigProvider as any,
    );
  }
  return {
    providers: {
      publicDataProvider,
      zkConfigProvider,
      privateStateProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    compiled,
    publicDataProvider,
    provingVia,
  };
}

export const ctorName = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array[${value.length}]`;
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name ?? typeof value;
  return typeof name === "string" ? name : typeof value;
};

/** Submits one sealed bid to a live contract; resolves with the tx hash. */
export async function submitLiveBid(input: {
  api: OneAmConnectedApi;
  contractAddress: string;
  witnesses: PrivateBidWitnesses;
  bidderKey: Uint8Array;
  /** Lace uses wallet-or-proof-server proving; 1AM always delegates to the wallet. */
  walletKind?: "lace" | "1am";
  proofServerUrl?: string;
}): Promise<string> {
  const laceOpts =
    input.proofServerUrl === undefined ? undefined : { proofServerUrl: input.proofServerUrl };
  const { providers, compiled } =
    input.walletKind === "lace"
      ? await buildLaceProviders(input.api, input.witnesses, laceOpts)
      : await buildOneAmProviders(input.api, input.witnesses);

  // Derive the secret key from the wallet's shielded coin public key for the private state.
  // The contract uses this secret key to derive p1_key/p2_key for the bid commitment.
  // The shielded coin public key is in bech32m format; convert to 32-byte array.
  const keys = await input.api.getShieldedAddresses();
  const { parseCoinPublicKeyToHex } = await import("@midnight-ntwrk/midnight-js-utils");
  const networkId = (await input.api.getConfiguration()).networkId || "preprod";
  const coinHex = parseCoinPublicKeyToHex(keys.shieldedCoinPublicKey, networkId);
  const secretKey = hexToBytes(coinHex); // 32-byte array for the contract's Bytes<32> secretKey

  // Initial private state for the contract - contains secret key for key derivation
  const initialPrivateState = {
    secretKey,
    myMove: 0n,
    mySalt: new Uint8Array(32),
  };

  // Use high-level contract API (like RPS sample) instead of raw submitCallTx.
  // This correctly handles ChargedState/StateValue wrapping.
  const { findDeployedContract } = await import("@midnight-ntwrk/midnight-js-contracts");
  const foundContract = await findDeployedContract(providers, {
    compiledContract: compiled,
    contractAddress: input.contractAddress,
    privateStateId: AegisBidPrivateStateId,
    initialPrivateState,
  });

  try {
    // Use high-level contract API (matches RPS sample pattern)
    const result = await (foundContract.callTx as any)["submitBid"](input.bidderKey);
    const pub = result as { txHash?: string; txId?: string };
    return pub.txHash ?? pub.txId ?? "";
  } catch (cause) {
    // Attach assembly forensics so the Technical details box shows WHAT was
    // malformed, not just that the merge rejected it. Read-only: no wallet
    // popups, no chain effects. If forensics itself fails, still attach
    // whatever we could gather before re-throwing.
    let forensics = "";
    try {
      forensics = await forensicsModule.diagnoseCallAssembly(
        input.api,
        compiled,
        input.contractAddress,
        input.witnesses,
        input.bidderKey,
      );
    } catch (diagError) {
      forensics = `forensics-failed: ${diagError instanceof Error ? diagError.message.slice(0, 120) : String(diagError).slice(0, 120)}`;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${message}\n[forensics: ${forensics}]`, { cause });
  }
}
