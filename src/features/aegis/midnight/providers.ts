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
import { deployContract, submitCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import { Contract, TenderMode } from "../../../../managed/aegis-bid/contract/index.js";
import { hexToBytes, stringToBytes32 } from "./contract";
import type { OneAmConnectedApi } from "./oneAmWallet";

export const ZK_BASE =
  (import.meta.env["VITE_ZK_CONFIG_BASE"] as string | undefined) ||
  "https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@main/managed/aegis-bid";

export const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export type PrivateBidWitnesses = {
  amount: bigint;
  salt: Uint8Array;
  identitySecret: Uint8Array;
  bidderKey: Uint8Array;
};

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

async function buildConnectorBase(api: OneAmConnectedApi, bid?: PrivateBidWitnesses) {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId || "preprod");

  const zkConfigProvider = new FetchZkConfigProvider(ZK_BASE, fetch.bind(window));
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);

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
  const identitySecret = bid?.identitySecret ?? new Uint8Array(32);
  const bidderKey = bid?.bidderKey ?? new Uint8Array(32);
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
      localIdentitySecret: ({ privateState }: AnyWitnessContext) => [privateState, identitySecret],
      settlementBid: ({ privateState }: AnyWitnessContext) => [privateState, amount],
      settlementSalt: ({ privateState }: AnyWitnessContext) => [privateState, salt],
      settlementKey: ({ privateState }: AnyWitnessContext) => [privateState, bidderKey],
    }),
    "./managed/aegis-bid",
  );
  return {
    config,
    zkConfigProvider,
    publicDataProvider,
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
  const { zkConfigProvider, publicDataProvider, walletProvider, midnightProvider, compiled } =
    await buildConnectorBase(api, bid);

  const provingProvider = await api.getProvingProvider(zkConfigProvider);
  const proofProvider = makeWalletProofProvider(provingProvider);
  return {
    providers: {
      publicDataProvider,
      zkConfigProvider,
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
  const { zkConfigProvider, publicDataProvider, walletProvider, midnightProvider, compiled } =
    await buildConnectorBase(api, bid);

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

/** Submits one sealed bid to a live contract; resolves with the tx hash. */
export async function submitLiveBid(input: {
  api: OneAmConnectedApi;
  contractAddress: string;
  witnesses: PrivateBidWitnesses;
  bidderKey: Uint8Array;
  nowSec: bigint;
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
  const result = await submitCallTx(providers, {
    compiledContract: compiled,
    contractAddress: input.contractAddress,
    circuitId: "submitBid",
    args: [input.bidderKey, input.nowSec],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const pub = result.public as { txHash?: string; txId?: string };
  return pub.txHash ?? pub.txId ?? "";
}
