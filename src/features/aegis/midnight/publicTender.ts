import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { browserIndexerQueryUrl } from "../chain";

export type PublicTenderSettlement = { winnerCommitment: string; winningValue: string };

export function settlementFromLedger(decoded: {
  settlement: {
    is_some: boolean;
    value: { winnerCommitment: Uint8Array; winningValue: bigint };
  };
}): PublicTenderSettlement | undefined {
  if (!decoded.settlement.is_some) return undefined;
  const { winnerCommitment, winningValue } = decoded.settlement.value;
  const commitment = Array.from(winnerCommitment, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { winnerCommitment: `0x${commitment}`, winningValue: winningValue.toString() };
}

/** Read only the public settlement receipt. No wallet connection is needed. */
export async function readPublicTenderSettlement(
  indexerUrl: string,
  contractAddress: string,
): Promise<PublicTenderSettlement | undefined> {
  // The generated ledger decoder depends on browser Buffer and must only be
  // loaded client-side, after installing that polyfill.
  const { ensureBrowserBuffer } = await import("./polyfills");
  ensureBrowserBuffer();
  const { ledger } = await import("../../../../managed/aegis-bid-v2/contract/index.js");
  const wsUrl = indexerUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  const provider = indexerPublicDataProvider(browserIndexerQueryUrl(indexerUrl), wsUrl);
  const state = await provider.queryContractState(contractAddress);
  if (!state) return undefined;
  return settlementFromLedger(ledger(state.data));
}
