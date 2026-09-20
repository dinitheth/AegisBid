/**
 * Shared 1AM wallet connection. The Live deploy page establishes it; the
 * header wallet button (and later pages) read it from here so the whole app
 * reflects one connected wallet.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type OneAmInitialApi = {
  name?: string;
  apiVersion?: string;
  connect: (networkId: string) => Promise<OneAmConnectedApi>;
};

export type OneAmConnectedApi = {
  getConfiguration: () => Promise<{
    networkId: string;
    indexerUri: string;
    indexerWsUri: string;
  }>;
  getShieldedAddresses: () => Promise<{
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  getUnshieldedAddress: () => Promise<{ unshieldedAddress: string }>;
  getDustBalance: () => Promise<{ balance: bigint | number | string }>;
  getProvingProvider: (keyProvider: unknown) => Promise<unknown>;
  balanceUnsealedTransaction: (txHex: string) => Promise<{ tx: string }>;
  submitTransaction: (txHex: string) => Promise<unknown>;
};

export type WalletInfo = {
  networkId: string;
  unshieldedAddress: string;
  dustBalance: string;
};

export function detectOneAm(): OneAmInitialApi | null {
  const injected = (window as unknown as { midnight?: Record<string, unknown> }).midnight?.[
    "1am"
  ];
  if (!injected || typeof injected !== "object") return null;
  const candidate = injected as Partial<OneAmInitialApi>;
  return typeof candidate.connect === "function" ? (candidate as OneAmInitialApi) : null;
}

type OneAmWallet = {
  api: OneAmConnectedApi | null;
  info: WalletInfo | null;
  setConnected: (api: OneAmConnectedApi, info: WalletInfo) => void;
  disconnect: () => void;
};

const Ctx = createContext<OneAmWallet | null>(null);

export function OneAmWalletProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<OneAmConnectedApi | null>(null);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const setConnected = useCallback((nextApi: OneAmConnectedApi, nextInfo: WalletInfo) => {
    setApi(nextApi);
    setInfo(nextInfo);
  }, []);
  const disconnect = useCallback(() => {
    setApi(null);
    setInfo(null);
  }, []);
  const value = useMemo(
    () => ({ api, info, setConnected, disconnect }),
    [api, info, setConnected, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOneAmWallet(): OneAmWallet {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOneAmWallet must be used inside OneAmWalletProvider");
  return ctx;
}
