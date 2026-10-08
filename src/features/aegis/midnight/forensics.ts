/**
 * Shared forensics for failed bid assemblies.
 * Imported by providers where the error is caught.
 */
import type { OneAmConnectedApi } from "./oneAmWallet";
import { buildConnectorBase, ctorName } from "./providers";

/** Minimal structural type for wasm-bindgen classes used in instanceof checks. */
interface WasmClass {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): unknown;
}

const describeKey = (value: unknown): string => {
  if (typeof value !== "string") return typeof value;
  if (value.length === 0) return "empty-string";
  if (/^(0x)?[0-9a-fA-F]+$/.test(value)) return `hex:${value.length}chars`;
  // Bech32m (mn_addr_…): prefix reveals network/type only, never secrets.
  // Full keys already appear on-chain; lengths + format suffice here.
  return `bech32m:${value.length}chars:${value.slice(0, 12)}`;
};

type States = {
  contractState?: unknown;
  zswapChainState?: unknown;
  ledgerParameters?: unknown;
};

/**
 * Read-only forensics for a failed bid assembly: replays everything up to
 * (not including) the wallet interaction and reports the shapes involved.
 * No chain effects, no wallet popups, no secrets — constructor names,
 * key shapes and byte lengths only. Partial progress is always preserved:
 * every note appends, nothing early-returns.
 */
export async function diagnoseCallAssembly(
  api: OneAmConnectedApi,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compiled: any,
  contractAddress: string,
  witnesses: {
    amount: bigint;
    salt: Uint8Array;
    bidderKey: Uint8Array;
    evaluatorSecret?: Uint8Array;
  },
  bidderKey: Uint8Array,
): Promise<string> {
  const notes: string[] = [];
  try {
    const [
      { getPublicStates, createUnprovenCallTxFromInitialStates },
      { parseCoinPublicKeyToHex, parseEncPublicKeyToHex },
      { getNetworkId },
      { StateValue, ChargedState },
      { StateValue: LedgerStateValue },
    ] = await Promise.all([
      import("@midnight-ntwrk/midnight-js-contracts"),
      import("@midnight-ntwrk/midnight-js-utils"),
      import("@midnight-ntwrk/midnight-js-network-id"),
      import("@midnight-ntwrk/midnight-js-protocol/onchain-runtime"),
      import("@midnight-ntwrk/ledger-v8"),
    ]);
    const OnchainStateValue = StateValue as unknown as WasmClass;
    const OnchainChargedState = ChargedState as unknown as WasmClass;
    const LedgerStateValueClass = LedgerStateValue as unknown as WasmClass;
    let coinHex = "";
    let encHex = "";
    try {
      const keys = await api.getShieldedAddresses();
      notes.push(`coinKey=${describeKey(keys.shieldedCoinPublicKey)}`);
      notes.push(`encKey=${describeKey(keys.shieldedEncryptionPublicKey)}`);
      // Parse EXACTLY like the real submit path does (same functions, same
      // network id) — a silent mis-parse here poisons everything downstream.
      const networkId = getNetworkId();
      notes.push(`networkId=${String(networkId)}`);
      coinHex = parseCoinPublicKeyToHex(keys.shieldedCoinPublicKey, networkId);
      encHex = parseEncPublicKeyToHex(keys.shieldedEncryptionPublicKey, networkId);
      notes.push(`coinHexLen=${coinHex.length}`, `encHexLen=${encHex.length}`);
    } catch (error) {
      notes.push(
        `keyparse-threw=${(error instanceof Error ? error.message : String(error)).slice(0, 160)}`,
      );
    }
    const base = await buildConnectorBase(api);
    const states = (await getPublicStates(
      base.publicDataProvider,
      contractAddress,
    )) as unknown as States;
    notes.push(`initialContractState=${ctorName(states.contractState)}`);
    const runAssembly = async (label: string, withPrivateState: boolean) => {
      const options: Record<string, unknown> = {
        compiledContract: compiled,
        contractAddress,
        coinPublicKey: coinHex === "" ? "ab".repeat(32) : coinHex,
        circuitId: "submitBid",
        args: [bidderKey],
        initialContractState: states.contractState,
        initialZswapChainState: states.zswapChainState,
        ledgerParameters: states.ledgerParameters,
      };
      if (withPrivateState) options["initialPrivateState"] = {};
      const callData = await createUnprovenCallTxFromInitialStates(
        base.zkConfigProvider,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options as any,
        encHex === "" ? "ab".repeat(32) : encHex,
      );
      const next = (callData as unknown as { public?: { nextContractState?: unknown } }).public
        ?.nextContractState;
      notes.push(`${label}Next=${ctorName(next)}`);
      notes.push(`${label}IsStateValue=${next instanceof OnchainStateValue}`);
      notes.push(`${label}IsLedgerStateValue=${next instanceof LedgerStateValueClass}`);
      notes.push(
        `${label}HasWbgPtr=${typeof next === "object" && next !== null && "__wbg_ptr" in next}`,
      );
      try {
        new OnchainChargedState(next as never);
        notes.push(`${label}Wrap=OK`);
      } catch {
        notes.push(`${label}Wrap=THROWS`);
      }
    };
    await runAssembly("", false);
    await runAssembly("ps:", true);
  } catch (error) {
    notes.push(
      `diag-threw=${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
    );
  }
  notes.push(
    `witnesses=amount:${typeof witnesses.amount},salt:${witnesses.salt?.length}B,key:${witnesses.bidderKey?.length}B,evaluator:${witnesses.evaluatorSecret?.length ?? 0}B`,
    `args=key:${bidderKey?.length}B`,
  );
  return notes.join(" | ");
}
