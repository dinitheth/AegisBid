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
  submitCallTx,
  verifyContractState,
} from "@midnight-ntwrk/midnight-js-contracts";
import {
  Contract,
  ledger as decodeLedger,
  TenderMode,
  TenderPhase,
} from "../../../../managed/aegis-bid-v2/contract/index.js";
import { CONTRACT_CIRCUITS, hexToBytes, stringToBytes32, type ContractCircuit } from "./contract";
import { fetchLatestBlockTime } from "../chain";
import type { OneAmConnectedApi } from "./oneAmWallet";
import * as forensicsModule from "./forensics";

export const ZK_BASE =
  (import.meta.env["VITE_AEGISBID_V2_ZK_CONFIG_BASE"] as string | undefined) ||
  // Never resolve proving assets through a moving branch ref. A CDN edge can
  // otherwise return an older verifier bundle while the chain has the newer
  // one, which makes the SDK reject the contract before 1AM can open its
  // approval request. This immutable revision is the exact bundle used for
  // the public V2 deployment below.
  "https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@8c335f5f3edca4a431053bfd8ed137afbb2430b5/managed/aegis-bid-v2";

export const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export type PrivateBidWitnesses = {
  amount: bigint;
  salt: Uint8Array;
  bidderKey: Uint8Array;
  /** Deployment/evaluation capability. Keep this private and back it up. */
  evaluatorSecret?: Uint8Array;
  settlementBids?: Array<{ amount: bigint; salt: Uint8Array; bidderKey: Uint8Array }>;
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

export type ProvingVia = "wallet";

export type AegisProviders = {
  providers: Parameters<typeof deployContract>[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compiled: any;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  /** Proofs are generated through the connected 1AM wallet. */
  provingVia: ProvingVia;
  /**
   * Account material already read while assembling the provider stack.
   * Reusing it prevents extra extension RPC calls immediately before a
   * transaction is checked and presented for approval.
   */
  walletCoinPublicKey: string;
  networkId: string;
};

export type WalletOperationReporter = (message: string) => void;

/**
 * Check the address against the exact V2 verifier keys before asking a wallet
 * for its proving provider. This catches legacy contracts, stale share links,
 * and incomplete deployments before the wallet gets stuck in proof setup.
 */
async function verifyLiveV2Contract(
  zkConfigProvider: FetchZkConfigProvider<(typeof CONTRACT_CIRCUITS)[number]>,
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>,
  contractAddress: string,
): Promise<void> {
  const contractState = await publicDataProvider.queryContractState(contractAddress);
  if (!contractState) {
    throw new Error(
      "No deployed tender was found at this address. Open the issuer's current share link.",
    );
  }
  const verifierKeys = await zkConfigProvider.getVerifierKeys([...CONTRACT_CIRCUITS]);
  verifyContractState(verifierKeys, contractState);
}

// A prover only creates a proof; it cannot publish a transaction by itself.
// Timing this out is therefore safe: a late proof is discarded and the user
// can retry without risking a duplicate deployment or bid.
const PROVING_TIMEOUT_MS = 120_000;
const PROVING_PROVIDER_TIMEOUT_MS = 30_000;
const WALLET_BALANCE_TIMEOUT_MS = 45_000;
const WALLET_SUBMIT_TIMEOUT_MS = 90_000;

// 1AM validates the proving configuration when getProvingProvider is called.
// Calling it again for every bid asks the extension to repeat that fragile
// verifier lookup; preprod can return a transient stale state even after a
// prior request succeeded. A successful provider is safe to reuse for the
// same connected wallet session. Failed attempts are never cached.
const oneAmProvingProviders = new WeakMap<object, Promise<unknown>>();

function getCachedOneAmProvingProvider(
  api: OneAmConnectedApi,
  keyProvider: unknown,
): Promise<unknown> {
  const existing = oneAmProvingProviders.get(api);
  if (existing) return existing;
  const pending = withSafeTimeout(
    api.getProvingProvider(keyProvider),
    PROVING_PROVIDER_TIMEOUT_MS,
    "1AM did not make its proving service available in 30 seconds. No transaction was sent. Reload 1AM and try again.",
  );
  oneAmProvingProviders.set(api, pending);
  void pending.catch(() => oneAmProvingProviders.delete(api));
  return pending;
}

function withSafeTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        globalThis.clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

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

export async function buildConnectorBase(
  api: OneAmConnectedApi,
  bid?: PrivateBidWitnesses,
  report?: WalletOperationReporter,
) {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId || "preprod");

  const zkConfigProvider = new FetchZkConfigProvider<ContractCircuit>(ZK_BASE, fetch.bind(window));
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const privateStateProvider = createMemoryPrivateStateProvider();

  const keys = await api.getShieldedAddresses();
  const walletProvider = {
    getCoinPublicKey: () => keys.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => keys.shieldedEncryptionPublicKey,
    async balanceTx(tx: { serialize: () => Uint8Array }) {
      report?.("Preparing the transaction with 1AM...");
      const result = await withSafeTimeout(
        api.balanceUnsealedTransaction(bytesToHex(tx.serialize())),
        WALLET_BALANCE_TIMEOUT_MS,
        "1AM did not finish balancing the transaction in 45 seconds. No transaction was submitted and no approval popup can appear until balancing completes.",
      );
      const { Transaction } = await import("@midnight-ntwrk/ledger-v8");
      return Transaction.deserialize("signature", "proof", "binding", hexToBytes(result.tx));
    },
  };
  const midnightProvider = {
    async submitTx(tx: { serialize: () => Uint8Array; identifiers: () => string[] }) {
      // This is the first point at which 1AM can present a signing/approval
      // request. Do not tell users to approve while a proof is still running.
      report?.("Proof ready — approve the transaction in 1AM...");
      await withSafeTimeout(
        api.submitTransaction(bytesToHex(tx.serialize())),
        WALLET_SUBMIT_TIMEOUT_MS,
        "1AM did not confirm the submitted transaction in 90 seconds. Check the 1AM activity list before retrying so you do not create a duplicate.",
      );
      return tx.identifiers()[0] ?? "";
    },
  };

  const amount = bid?.amount ?? 0n;
  const salt = bid?.salt ?? new Uint8Array(32);
  const bidderKey = bid?.bidderKey ?? new Uint8Array(32);
  const evaluatorSecret = bid?.evaluatorSecret ?? new Uint8Array(32);
  const settlementBids = bid?.settlementBids ?? [{ amount, salt, bidderKey }];
  const settlementWitnessAt = (index: bigint) => {
    const witness = settlementBids[Number(index)];
    if (!witness) throw new Error(`No settlement witness was supplied for bid ${index}.`);
    return witness;
  };
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
      settlementBid: ({ privateState }: AnyWitnessContext, index: bigint) => [
        privateState,
        settlementWitnessAt(index).amount,
      ],
      settlementSalt: ({ privateState }: AnyWitnessContext, index: bigint) => [
        privateState,
        settlementWitnessAt(index).salt,
      ],
      settlementKey: ({ privateState }: AnyWitnessContext, index: bigint) => [
        privateState,
        settlementWitnessAt(index).bidderKey,
      ],
    }),
    "./managed/aegis-bid-v2",
  );
  return {
    config,
    walletCoinPublicKey: keys.shieldedCoinPublicKey,
    networkId: config.networkId || "preprod",
    zkConfigProvider,
    publicDataProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider,
    compiled,
  };
}

export type LiveTenderLedger = {
  phase: number;
  commitmentCount: bigint;
  settled: boolean;
  reserve: bigint;
  mode: "highest" | "lowest";
  deadline: bigint;
  latestBlockTime: bigint;
  settlement?: {
    winnerCommitment: Uint8Array;
    winningValue: bigint;
    comparisonRoot: Uint8Array;
  };
};

/** Read the actual V2 ledger state through the connected wallet's configured indexer. */
export async function readLiveTenderLedger(
  api: OneAmConnectedApi,
  contractAddress: string,
): Promise<LiveTenderLedger> {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId || "preprod");
  const provider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const state = await provider.queryContractState(contractAddress);
  if (!state) throw new Error("The tender could not be found on the selected network.");
  const decoded = decodeLedger(state.data);
  const latestBlockTime = await fetchLatestBlockTime(config.indexerUri);
  const settlement = decoded.settlement.is_some ? decoded.settlement.value : undefined;
  return {
    phase: Number(decoded.phase),
    commitmentCount: decoded.commitmentCount,
    settled: decoded.settlement.is_some,
    reserve: decoded.tender.reserve,
    mode: decoded.tender.mode === TenderMode.LowestCompliant ? "lowest" : "highest",
    deadline: decoded.tender.deadline,
    latestBlockTime: BigInt(Math.floor(latestBlockTime / 1000)),
    ...(settlement ? { settlement } : {}),
  };
}

/** Submit an evaluator circuit and wait for the SDK's finalized transaction result. */
export async function submitLiveEvaluatorCall(input: {
  api: OneAmConnectedApi;
  contractAddress: string;
  evaluatorSecret: Uint8Array;
  settlementBids: Array<{ amount: bigint; salt: Uint8Array; bidderKey: Uint8Array }>;
  circuitId: "beginEvaluation" | "settle";
  args?: bigint[];
  report?: WalletOperationReporter;
}): Promise<string> {
  const { providers, compiled, walletCoinPublicKey, networkId } = await buildOneAmProviders(
    input.api,
    {
      amount: 0n,
      salt: new Uint8Array(32),
      bidderKey: new Uint8Array(32),
      evaluatorSecret: input.evaluatorSecret,
      settlementBids: input.settlementBids,
    },
    input.report,
    input.contractAddress,
  );
  const { parseCoinPublicKeyToHex } = await import("@midnight-ntwrk/midnight-js-utils");
  const coinHex = parseCoinPublicKeyToHex(walletCoinPublicKey, networkId);
  const privateStateProvider = providers.privateStateProvider as {
    setContractAddress(address: string): void;
    set(privateStateId: string, state: unknown): Promise<void>;
  };
  privateStateProvider.setContractAddress(input.contractAddress);
  await privateStateProvider.set(AegisBidPrivateStateId, {
    secretKey: hexToBytes(coinHex),
    myMove: 0n,
    mySalt: new Uint8Array(32),
  });
  const result = await submitCallTx(providers, {
    compiledContract: compiled,
    contractAddress: input.contractAddress,
    circuitId: input.circuitId,
    privateStateId: AegisBidPrivateStateId,
    args: input.args ?? [],
    // Generated call option types do not infer the circuit union from this
    // dynamic UI action; runtime circuit signatures are asserted above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return result.public.txId;
}

export const liveTenderPhases = {
  open: TenderPhase.Open,
  evaluating: TenderPhase.Evaluating,
  settled: TenderPhase.Settled,
} as const;

/**
 * Builds the provider stack + compiled contract.
 * Pass a bid to attach its real witnesses; otherwise zero stubs are used
 * (the constructor never invokes witnesses).
 */
function makeWalletProofProvider(provingProvider: unknown, report?: WalletOperationReporter) {
  return {
    // Proving has no chain effects: retry transient (rate-limit) failures.
    async proveTx(unprovenTx: { prove: (prover: unknown, cost: unknown) => Promise<unknown> }) {
      let last: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const { CostModel } = await import("@midnight-ntwrk/ledger-v8");
          report?.("Generating zero-knowledge proof…");
          return await withSafeTimeout(
            unprovenTx.prove(provingProvider, CostModel.initialCostModel()),
            PROVING_TIMEOUT_MS,
            "1AM did not finish generating the proof in two minutes. No transaction was sent. Reload the 1AM extension and try again.",
          );
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
  report?: WalletOperationReporter,
  contractAddress?: string,
): Promise<AegisProviders> {
  const {
    walletCoinPublicKey,
    networkId,
    zkConfigProvider,
    publicDataProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider,
    compiled,
  } = await buildConnectorBase(api, bid, report);

  if (contractAddress) {
    report?.("Checking this tender's proof configuration...");
    await verifyLiveV2Contract(zkConfigProvider, publicDataProvider, contractAddress);
  }

  report?.("Preparing 1AM's proving service...");
  const provingProvider = await getCachedOneAmProvingProvider(api, zkConfigProvider);
  const proofProvider = makeWalletProofProvider(provingProvider, report);
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
    walletCoinPublicKey,
    networkId,
  };
}

export const ctorName = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array[${value.length}]`;
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name ?? typeof value;
  return typeof name === "string" ? name : typeof value;
};

/** Submits one sealed bid and returns its exact on-chain commitment and tx hash. */
export async function submitLiveBid(input: {
  api: OneAmConnectedApi;
  contractAddress: string;
  witnesses: PrivateBidWitnesses;
  bidderKey: Uint8Array;
}): Promise<{ transactionHash: string; commitment: string }> {
  const { providers, compiled, walletCoinPublicKey, networkId } = await buildOneAmProviders(
    input.api,
    input.witnesses,
    undefined,
    input.contractAddress,
  );

  // Derive the secret key from the wallet's shielded coin public key for the private state.
  // The contract uses this secret key to derive p1_key/p2_key for the bid commitment.
  // The shielded coin public key is in bech32m format; convert to 32-byte array.
  const { parseCoinPublicKeyToHex } = await import("@midnight-ntwrk/midnight-js-utils");
  const coinHex = parseCoinPublicKeyToHex(walletCoinPublicKey, networkId);
  const secretKey = hexToBytes(coinHex); // 32-byte array for the contract's Bytes<32> secretKey

  // Initial private state for the contract - contains secret key for key derivation
  const initialPrivateState = {
    secretKey,
    myMove: 0n,
    mySalt: new Uint8Array(32),
  };

  try {
    // `findDeployedContract` first runs a verifier-key identity comparison.
    // On the public preprod contract those keys are valid, but 1AM's
    // extension can hand the SDK a stale cached representation of that state
    // and reject before it ever creates a proof or opens its approval UI.
    // Build the call through the supported SDK submit path instead: it obtains
    // current public state, produces a proof with the immutable V2 assets, and
    // submits only after the wallet approves it.
    const privateStateProvider = providers.privateStateProvider as {
      setContractAddress(address: string): void;
      set(privateStateId: string, state: unknown): Promise<void>;
    };
    privateStateProvider.setContractAddress(input.contractAddress);
    await privateStateProvider.set(AegisBidPrivateStateId, initialPrivateState);
    const result = await submitCallTx(providers, {
      compiledContract: compiled,
      contractAddress: input.contractAddress,
      circuitId: "submitBid",
      privateStateId: AegisBidPrivateStateId,
      args: [input.bidderKey],
      // The SDK's generated circuit option inference cannot express the
      // V2 witness literal; its runtime shape is covered by our provider
      // integration tests.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const commitment = result.private.result;
    if (!(commitment instanceof Uint8Array)) {
      throw new Error("The wallet returned an unexpected bid commitment.");
    }
    return {
      transactionHash: result.public.txId,
      commitment: `0x${bytesToHex(commitment)}`,
    };
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
