/**
 * Shared forensics for failed bid assemblies.
 * Imported by providers where the error is caught.
 */
import type { OneAmConnectedApi } from "./oneAmWallet";
import { buildConnectorBase, ctorName } from "./providers";

const describeKey = (value: unknown): string => {
  if (typeof value !== "string") return typeof value;
  if (value.length === 0) return "empty-string";
  if (/^(0x)?[0-9a-fA-F]+$/.test(value)) return `hex:${value.length}chars`;
  // Bech32m (mn_addr_…): prefix reveals network/type only, never secrets.
  // Full keys already appear on-chain; lengths + format suffice here.
  return `bech32m:${value.length}chars:${value.slice(0, 12)}`;
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
    identitySecret: Uint8Array;
    bidderKey: Uint8Array;
  },
  bidderKey: Uint8Array,
  nowSec: bigint,
): Promise<string> {
  const notes: string[] = [];
  try {
    const { getPublicStates, createUnprovenCallTxFromInitialStates } =
      await import("@midnight-ntwrk/midnight-js-contracts");
    try {
      const keys = await api.getShieldedAddresses();
      notes.push(`coinKey=${describeKey(keys.shieldedCoinPublicKey)}`);
      notes.push(`encKey=${describeKey(keys.shieldedEncryptionPublicKey)}`);
    } catch {
      notes.push("keys=unreadable");
    }
    const base = await buildConnectorBase(api);
    const states = (await getPublicStates(
      base.publicDataProvider,
      contractAddress,
    )) as unknown as {
      contractState?: unknown;
      zswapChainState?: unknown;
      ledgerParameters?: unknown;
    };
    notes.push(`initialContractState=${ctorName(states.contractState)}`);
    const callData = await createUnprovenCallTxFromInitialStates(
      base.zkConfigProvider,
      {
        compiledContract: compiled,
        contractAddress,
        coinPublicKey: "ab".repeat(32),
        circuitId: "submitBid",
        args: [bidderKey, nowSec],
        initialContractState: states.contractState,
        initialZswapChainState: states.zswapChainState,
        ledgerParameters: states.ledgerParameters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      "ab".repeat(32),
    );
    notes.push(
      `nextContractState=${ctorName((callData as unknown as { public?: { nextContractState?: unknown } }).public?.nextContractState)}`,
    );
  } catch (error) {
    notes.push(
      `diag-threw=${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
    );
  }
  notes.push(
    `witnesses=amount:${typeof witnesses.amount},salt:${witnesses.salt?.length}B,identity:${witnesses.identitySecret?.length}B,key:${witnesses.bidderKey?.length}B`,
    `args=key:${bidderKey?.length}B,now:${typeof nowSec}`,
  );
  return notes.join(" | ");
}
