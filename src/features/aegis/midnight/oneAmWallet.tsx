/**
 * Shared 1AM wallet connection. The Live deploy page establishes it; the
 * header wallet button (and later pages) read it from here so the whole app
 * reflects one connected wallet.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

const CONNECT_FLAG = "aegis-1am-connected";

export function detectOneAm(): OneAmInitialApi | null {
  if (typeof window === "undefined") return null;
  const injected = (window as unknown as { midnight?: Record<string, unknown> }).midnight?.[
    "1am"
  ];
  if (!injected || typeof injected !== "object") return null;
  const candidate = injected as Partial<OneAmInitialApi>;
  return typeof candidate.connect === "function" ? (candidate as OneAmInitialApi) : null;
}

function readFlag(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(CONNECT_FLAG) === "1";
  } catch {
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    if (typeof window === "undefined") return;
    if (on) window.localStorage.setItem(CONNECT_FLAG, "1");
    else window.localStorage.removeItem(CONNECT_FLAG);
  } catch {
    /* private mode etc. */
  }
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
    writeFlag(true);
  }, []);
  const disconnect = useCallback(() => {
    setApi(null);
    setInfo(null);
    writeFlag(false);
  }, []);
  // Reconnect quietly on reload when the user connected before. If the
  // wallet needs a fresh gesture it rejects and the user connects manually.
  useEffect(() => {
    let cancelled = false;
    if (!readFlag()) return;
    const found = detectOneAm();
    if (!found) return;
    void found
      .connect("preprod")
      .then(async (connected) => {
        if (cancelled) return;
        const [config, unshielded, dust] = await Promise.all([
          connected.getConfiguration(),
          connected.getUnshieldedAddress(),
          connected.getDustBalance(),
        ]);
        if (cancelled) return;
        setApi(connected);
        setInfo({
          networkId: config.networkId,
          unshieldedAddress: unshielded.unshieldedAddress,
          dustBalance: String(dust.balance),
        });
      })
      .catch(() => writeFlag(false));
    return () => {
      cancelled = true;
    };
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
