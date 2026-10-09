/**
 * Shared 1AM browser-wallet connection using the Midnight DApp connector
 * protocol (`connect(networkId)` on `window.midnight.1am`). The Live deploy
 * page establishes the connection; the header and other pages reuse it.
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
  /** Display name of the connected wallet. */
  walletName: string;
};

export type WalletKind = "1am";

export type DetectedWallet = {
  kind: WalletKind;
  /** `window.midnight` key the wallet injected under (normally "1am"). */
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
 * Pure scan of a `window.midnight`-shaped record for the supported 1AM
 * connector. Exported for unit tests.
 */
export function listWalletConnectors(
  midnight: Record<string, unknown> | undefined,
): DetectedWallet[] {
  if (!midnight || typeof midnight !== "object") return [];
  const found: DetectedWallet[] = [];
  const take = (key: string) => {
    const initial = asInitialApi(midnight[key]);
    if (initial && !found.some((entry) => entry.kind === "1am")) {
      found.push({ kind: "1am", key, label: "1AM", initial });
    }
  };
  take("1am");
  for (const key of Object.keys(midnight)) {
    if (key.toLowerCase().includes("1am")) take(key);
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
 * Start a new connector session immediately before an irreversible wallet
 * operation.  The extension invalidates its connected handle when it restarts,
 * locks, or abandons an earlier balance request; keeping that old handle in
 * React state made the next publish/bid intermittently hang in the wallet.
 *
 * This deliberately performs the normal `connect("preprod")` handshake. It
 * is called only from a user click, so a wallet that needs to ask for consent
 * is allowed to show its approval UI.
 */
export async function refreshDetectedWallet(
  walletName?: string,
): Promise<{ api: OneAmConnectedApi; info: WalletInfo }> {
  const detected = detectWalletConnectors();
  const entry = detected.find((item) => item.label === walletName) ?? detected[0];
  if (!entry) {
    throw new Error("No 1AM wallet was detected. Unlock 1AM and try again.");
  }
  return connectDetectedWallet(entry);
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
  if (/request timed out|timed out|did not finish balancing/i.test(raw)) {
    if (/preparing the transaction|balancing/i.test(raw)) {
      return "1AM did not finish preparing the transaction, so it never reached the wallet approval step. No transaction was submitted. This balancing step is handled by 1AM; check its service status and retry once after it recovers. Reloading the extension alone may not help.";
    }
    if (/submitted transaction/i.test(raw)) {
      return "1AM did not confirm the submitted transaction. Check 1AM activity before retrying so you do not create a duplicate.";
    }
    return "1AM timed out before it could show the approval request. No bid was sent. Confirm the wallet is synced, then retry once.";
  }
  if (/mismatched verifier|verifier keys|operations:.*undefined|contractstate/i.test(raw)) {
    return "This tender was not deployed with the current AegisBid V2 proof configuration. No bid was sent and no wallet approval was requested. Ask the issuer for a newly deployed V2 tender link.";
  }
  if (/expected instance of|scoped transaction|failed to balance/i.test(raw)) {
    return "The wallet could not prepare this private transaction. No bid was sent. Refresh once, confirm 1AM is synced, then try again.";
  }
  const looksTechnical =
    /chrome-extension|\(\S+\.js:\d+|\bat \w+ \(/i.test(raw) || firstLine.length > 220;
  if (!looksTechnical) return firstLine;
  return "The wallet request didn't complete. Please try again, and check the wallet extension if it keeps happening.";
}

/**
 * Connection handshakes can fail with unhelpful transport errors such as
 * "Request failed" when 1AM is closed, locked, or its extension service is
 * temporarily unreachable. Keep this message scoped to connection attempts;
 * the same text during indexer/proof work may have a different cause.
 */
export function friendlyWalletConnectionError(cause: unknown): string {
  const friendly = friendlyWalletError(cause);
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  if (
    /request failed|failed to fetch|could not establish connection|receiving end does not exist|message port closed/i.test(
      raw,
    )
  ) {
    return "AegisBid couldn't reach your 1AM wallet. Open the 1AM extension, unlock it, and make sure it is set to preprod, then try again. If it is already open and unlocked, check your connection and whether 1AM is responding.";
  }
  return friendly;
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
  // Reconnect quietly on reload when the user connected before. No cascade: if 1AM
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
