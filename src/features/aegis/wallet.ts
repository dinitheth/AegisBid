import { useCallback, useEffect, useState } from "react";

/**
 * Midnight DApp connector (Lace Midnight preview wallet).
 * The wallet injects `window.midnight.mnLace` following the Midnight DApp connector API.
 */
export type MidnightWalletState = {
  address: string;
  coinPublicKey: string;
  balances: Record<string, string>;
};

type MidnightConnectorApi = {
  state: () => Promise<{
    address: string;
    coinPublicKey: string;
    balances?: Record<string, bigint | string | number>;
  }>;
  balanceAndProveTransaction?: (tx: unknown) => Promise<unknown>;
  submitTransaction?: (tx: unknown) => Promise<string>;
};

type MidnightConnector = {
  name?: string;
  apiVersion?: string;
  isEnabled: () => Promise<boolean>;
  enable: () => Promise<MidnightConnectorApi>;
  serviceUriConfig?: () => Promise<Record<string, string>>;
};

declare global {
  interface Window {
    midnight?: { mnLace?: MidnightConnector } & Record<string, MidnightConnector | undefined>;
  }
}

function connector(): MidnightConnector | undefined {
  if (typeof window === "undefined") return undefined;
  return window.midnight?.mnLace ?? Object.values(window.midnight ?? {})[0];
}

const NATIVE = "tDUST";

function readBalance(balances: Record<string, bigint | string | number> | undefined) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(balances ?? {})) out[key] = value.toString();
  return out;
}

export function formatDust(raw: string | undefined) {
  if (!raw) return "0";
  const value = Number(raw) / 1_000_000;
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function useMidnightWallet() {
  const [available, setAvailable] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<MidnightWalletState | null>(null);
  const [api, setApi] = useState<MidnightConnectorApi | null>(null);

  const load = useCallback(async (connected: MidnightConnectorApi) => {
    const state = await connected.state();
    setWallet({
      address: state.address,
      coinPublicKey: state.coinPublicKey,
      balances: readBalance(state.balances),
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const provider = connector();
      if (!provider) return;
      if (cancelled) return;
      setAvailable(true);
      try {
        if (await provider.isEnabled()) {
          const connected = await provider.enable();
          if (cancelled) return;
          setApi(connected);
          await load(connected);
        }
      } catch {
        /* wallet present but not authorised yet */
      }
    };
    void check();
    const timer = window.setTimeout(() => void check(), 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  const connect = useCallback(async () => {
    const provider = connector();
    if (!provider) {
      setError("No Midnight wallet found. Install the Lace Midnight wallet extension to continue.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const connected = await provider.enable();
      setApi(connected);
      await load(connected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet request was declined.");
    } finally {
      setConnecting(false);
    }
  }, [load]);

  const refresh = useCallback(async () => {
    if (api) await load(api);
  }, [api, load]);

  const disconnect = useCallback(() => {
    setApi(null);
    setWallet(null);
  }, []);

  return {
    available,
    connected: Boolean(wallet),
    connecting,
    error,
    wallet,
    api,
    balance: formatDust(wallet?.balances?.[NATIVE]),
    balanceRaw: wallet?.balances?.[NATIVE] ?? "0",
    connect,
    refresh,
    disconnect,
  };
}
