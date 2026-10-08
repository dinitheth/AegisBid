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

// A wallet extension can hang when its own backend is unreachable (1AM's
// full-page UI then shows "Wallet init timed out ... serverSideScan=true").
// Never wait forever: callers surface a clear message instead.
export const CONNECT_TIMEOUT_MS = 90_000;
export const WALLET_DETAILS_TIMEOUT_MS = 20_000;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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
 * Connects a detected wallet with a timeout, returning the connected API
 * plus display info. Shared by the header button and the deploy page so
 * connecting behaves identically everywhere.
 */
export async function connectDetectedWallet(
  entry: DetectedWallet,
): Promise<{ api: OneAmConnectedApi; info: WalletInfo }> {
  const connected = await withTimeout(
    entry.initial.connect("preprod"),
    CONNECT_TIMEOUT_MS,
    `${entry.label} did not respond in 90s. The wallet extension itself may be stuck ` +
      "initializing (its page shows a vault/scan timeout when its backend is " +
      "unreachable). Check your connection, reload the extension, then try again.",
  );
  const [config, unshielded, dust] = await withTimeout(
    Promise.all([
      connected.getConfiguration(),
      connected.getUnshieldedAddress(),
      connected.getDustBalance(),
    ]),
    WALLET_DETAILS_TIMEOUT_MS,
    `${entry.label} connected but did not return account details in 20s. Unlock the wallet, ` +
      "reload its extension, then try again.",
  );
  return {
    api: connected,
    info: {
      networkId: config.networkId,
      unshieldedAddress: unshielded.unshieldedAddress,
      dustBalance: String(dust.balance),
      walletName: entry.label,
    },
  };
}

/**
 * Plain-language wallet errors for normal users. Extension stack traces and
 * raw SDK text never reach the screen; callers can still `console.error` the
 * original cause for debugging.
 */
export function friendlyWalletError(cause: unknown): string {
  if (cause === null || cause === undefined) return "The transaction was not completed.";
  const raw = cause instanceof Error ? cause.message : String(cause);
  const firstLine = raw.split("\n")[0]?.trim() || "Something went wrong.";
  if (/user rejected|rejected the request|declined|denied|cancelled/i.test(firstLine)) {
    return "You declined the request in your wallet. Nothing was sent — try again whenever you're ready.";
  }
  if (/insufficient (funds|balance|dust)/i.test(firstLine)) {
    return "Your wallet couldn't prepare the transaction — it may hold no funds. Get test tokens from the preprod faucet, then try again.";
  }
  if (/request timed out|timed out/i.test(raw)) {
    return "1AM timed out before it could show the approval request. No bid was sent. Confirm the wallet is synced, then retry once.";
  }
  if (/mismatched verifier|verifier keys|operations:.*undefined|contractstate/i.test(raw)) {
    return "This tender's proof configuration is not ready in the wallet yet. No bid was sent. Refresh the tender once, wait for 1AM to finish syncing, then try again.";
  }
  if (/expected instance of|scoped transaction|failed to balance/i.test(raw)) {
    return "The wallet could not prepare this private transaction. No bid was sent. Refresh once, confirm 1AM is synced, then try again.";
  }
  const looksTechnical =
    /chrome-extension|\(\S+\.js:\d+|\bat \w+ \(/i.test(raw) || firstLine.length > 220;
  if (!looksTechnical) return firstLine;
  return "The wallet request didn't complete. Please try again, and check the wallet extension if it keeps happening.";
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
    void connectDetectedWallet(found)
      .then(({ api: connected, info: connectedInfo }) => {
        if (cancelled) return;
        setApi(connected);
        setInfo(connectedInfo);
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
