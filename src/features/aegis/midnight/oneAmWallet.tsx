/**
 * Shared browser-wallet connection (Lace preferred, 1AM fallback). Both
 * wallets speak the same Midnight DApp connector protocol
 * (`@midnight-ntwrk/dapp-connector-api`: `connect(networkId)` on
 * `window.midnight[<walletId>]`), so one context serves both. The Live
 * deploy page establishes the connection; the header wallet button (and
 * later pages) read it from here so the whole app reflects one wallet.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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
  /** Display name of the connected wallet ("Lace" or "1AM"). */
  walletName: string;
};

export type WalletKind = "lace" | "1am";

export type DetectedWallet = {
  kind: WalletKind;
  /** `window.midnight` key the wallet injected under (e.g. "mnLace", "lace", "1am"). */
  key: string;
  label: string;
  initial: OneAmInitialApi;
};

function asInitialApi(injected: unknown): OneAmInitialApi | null {
  if (!injected || typeof injected !== "object") return null;
  const candidate = injected as Partial<OneAmInitialApi>;
  return typeof candidate.connect === "function" ? (candidate as OneAmInitialApi) : null;
}

/**
 * Pure scan of a `window.midnight`-shaped record. Lace first (it holds real
 * user funds and works today), 1AM second. Exported for unit tests.
 */
export function listWalletConnectors(
  midnight: Record<string, unknown> | undefined,
): DetectedWallet[] {
  if (!midnight || typeof midnight !== "object") return [];
  const found: DetectedWallet[] = [];
  const take = (kind: WalletKind, key: string, label: string) => {
    if (found.some((entry) => entry.kind === kind)) return;
    const initial = asInitialApi(midnight[key]);
    if (initial) found.push({ kind, key, label, initial });
  };
  // Lace: documented as `mnLace`; accept any lace-ish key for robustness.
  take("lace", "mnLace", "Lace");
  for (const key of Object.keys(midnight)) {
    if (key.toLowerCase().includes("lace")) take("lace", key, "Lace");
  }
  take("1am", "1am", "1AM");
  for (const key of Object.keys(midnight)) {
    if (key.toLowerCase().includes("1am")) take("1am", key, "1AM");
  }
  return found;
}

export function detectWalletConnectors(): DetectedWallet[] {
  if (typeof window === "undefined") return [];
  const midnight = (window as unknown as { midnight?: Record<string, unknown> }).midnight;
  return listWalletConnectors(midnight);
}

const CONNECT_FLAG = "aegis-1am-connected";

export function detectOneAm(): OneAmInitialApi | null {
  return detectWalletConnectors().find((entry) => entry.kind === "1am")?.initial ?? null;
}

export function detectLace(): OneAmInitialApi | null {
  return detectWalletConnectors().find((entry) => entry.kind === "lace")?.initial ?? null;
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
  // Reconnect quietly on reload when the user connected before. Lace
  // first (it works today), 1AM second. No cascade: if the preferred wallet
  // rejects (user gesture needed), the user reconnects manually — prompting
  // a second wallet uninvited would be worse. If the wallet needs a fresh
  // gesture it rejects and the user connects manually.
  useEffect(() => {
    let cancelled = false;
    if (!readFlag()) return;
    const wallets = detectWalletConnectors();
    const found = wallets[0];
    if (!found) return;
    void found.initial
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
          walletName: found.label,
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
