import { useCallback, useEffect, useState } from "react";
import {
  activityToTenders,
  applyLiveCounts,
  fetchChainActivity,
  getChainConfig,
  isConfigured,
  isValidPublishedTender,
  loadPublishedTenders,
  mergePublishedSources,
  publishedToTender,
  saveChainConfig,
  clearChainConfig,
  type ChainActivity,
  type ChainConfig,
  type PublishedTender,
} from "./chain";
import { type Tender } from "./protocol";

export type ChainTenders = {
  config: ChainConfig;
  connected: boolean;
  live: boolean;
  loading: boolean;
  error: string | null;
  activity: ChainActivity | null;
  tenders: Tender[];
  refresh: () => Promise<void>;
  save: (config: ChainConfig) => Promise<void>;
  reset: () => void;
};

async function includeSettlementReceipt(
  activity: ChainActivity,
  indexerUrl: string,
): Promise<ChainActivity> {
  const isSettled =
    activity.state.entryPoint?.toLowerCase() === "settle" ||
    activity.actions.some((action) => action.kind.toLowerCase() === "settle");
  if (!isSettled) return activity;
  try {
    const { readPublicTenderSettlement } = await import("./midnight/publicTender");
    const settlement = await readPublicTenderSettlement(indexerUrl, activity.state.address);
    return settlement ? { ...activity, settlement } : activity;
  } catch {
    // Keep the public tender/result visible if the ledger decoder or indexer
    // is temporarily unavailable; just omit the private winner notification.
    return activity;
  }
}

export function useChainTenders(): ChainTenders {
  const [config, setConfig] = useState<ChainConfig>({ indexerUrl: "", contractAddress: "" });
  const [activity, setActivity] = useState<ChainActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep server and first client render identical. Local storage is loaded
  // after hydration, then same-tab publish events keep this list current.
  const [published, setPublished] = useState<PublishedTender[]>([]);
  useEffect(() => {
    const refreshPublished = () => setPublished(loadPublishedTenders());
    refreshPublished();
    window.addEventListener("storage", refreshPublished);
    window.addEventListener("aegisbid:published", refreshPublished);
    return () => {
      window.removeEventListener("storage", refreshPublished);
      window.removeEventListener("aegisbid:published", refreshPublished);
    };
  }, []);

  // Shared registry: what everyone else published (same shape, newest
  // first). Unavailable without backend config — the directory then shows
  // flagship + device-local publishes exactly as before.
  const [registry, setRegistry] = useState<PublishedTender[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { listRegistryTenders } = await import("./midnight/tenderRegistry.server");
        const items = await listRegistryTenders();
        if (cancelled || !Array.isArray(items)) return;
        setRegistry(items.filter(isValidPublishedTender));
      } catch {
        /* registry unavailable — local data still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const merged = mergePublishedSources(registry, published);

  const load = useCallback(async (next: ChainConfig) => {
    if (!isConfigured(next)) {
      setActivity(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchChainActivity(next);
      setActivity(await includeSettlementReceipt(fetched, next.indexerUrl));
    } catch (cause) {
      setActivity(null);
      setError(cause instanceof Error ? cause.message : "The indexer could not be reached.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = getChainConfig();
    setConfig(saved);
    void load(saved);
  }, [load]);

  // Live activity for published addresses beyond the configured contract
  // (including tenders imported via share links): real bid counts and
  // settled detection per tender. Failures fall back to the stored policy
  // with zero counts — the tender stays listed and biddable.
  const [extraActivity, setExtraActivity] = useState<Record<string, ChainActivity>>({});
  const { indexerUrl, contractAddress } = config;
  const extraKey = merged
    .map((entry) => entry.address)
    .filter((address) => address !== contractAddress)
    .sort()
    .join(",");
  const loadExtra = useCallback(async () => {
    const addresses = [...new Set(extraKey === "" ? [] : extraKey.split(","))];
    if (addresses.length === 0 || !indexerUrl || !contractAddress) {
      setExtraActivity({});
      return;
    }
    const results = await Promise.all(
      addresses.map(async (address) => {
        try {
          const item = await fetchChainActivity({ indexerUrl, contractAddress: address });
          const enriched = await includeSettlementReceipt(item, indexerUrl);
          return [address, enriched] as const;
        } catch {
          return null;
        }
      }),
    );
    const next: Record<string, ChainActivity> = {};
    for (const result of results) {
      if (result) next[result[0]] = result[1];
    }
    setExtraActivity(next);
  }, [extraKey, indexerUrl, contractAddress]);

  useEffect(() => {
    void loadExtra();
  }, [loadExtra]);

  // Settlement is performed by an evaluator on another device. Refresh the
  // public receipt periodically so a bidder viewing Results can see a win
  // without needing a manual reload.
  useEffect(() => {
    if (!isConfigured(config)) return;
    const timer = window.setInterval(() => {
      void load(config);
      void loadExtra();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [config, load, loadExtra]);

  const refresh = useCallback(async () => {
    await Promise.all([load(config), loadExtra()]);
  }, [load, loadExtra, config]);

  // No demo fallback: when the indexer is unreachable the directory shows
  // only tenders published from this device (possibly none) instead of
  // fictional listings.
  const base = activity ? activityToTenders(activity) : [];
  const known = new Set(base.map((tender) => tender.contractAddress ?? tender.id));
  // Newest first: shared registry, then device publishes, ahead of chain
  // records, so home and directory always lead with the latest opportunity.
  const tenders: Tender[] = [
    ...merged
      .filter((entry) => !known.has(entry.address))
      .map((entry) =>
        applyLiveCounts(publishedToTender(entry), extraActivity[entry.address] ?? null),
      ),
    ...base,
  ];

  return {
    config,
    connected: isConfigured(config),
    live: Boolean(activity),
    loading,
    error,
    activity,
    tenders,
    refresh,
    save: async (next) => {
      const trimmed = {
        indexerUrl: next.indexerUrl.trim(),
        contractAddress: next.contractAddress.trim(),
      };
      setConfig(trimmed);
      saveChainConfig(trimmed);
      await load(trimmed);
    },
    reset: () => {
      clearChainConfig();
      const fallback = getChainConfig();
      setConfig(fallback);
      void load(fallback);
    },
  };
}
