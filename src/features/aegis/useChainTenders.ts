import { useCallback, useEffect, useState } from "react";
import {
  activityToTenders,
  applyLiveCounts,
  fetchChainActivity,
  getChainConfig,
  isConfigured,
  loadPublishedTenders,
  publishedToTender,
  saveChainConfig,
  clearChainConfig,
  type ChainActivity,
  type ChainConfig,
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

export function useChainTenders(): ChainTenders {
  const [config, setConfig] = useState<ChainConfig>({ indexerUrl: "", contractAddress: "" });
  const [activity, setActivity] = useState<ChainActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tenders published from this device live under other contract addresses
  // the directory never queries — merge them in so they are biddable. Read
  // fresh every render (tiny sync parse): publishing happens on another page
  // without remounting this hook, so a mount-time snapshot would go stale.
  const published = loadPublishedTenders();

  const load = useCallback(async (next: ChainConfig) => {
    if (!isConfigured(next)) {
      setActivity(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setActivity(await fetchChainActivity(next));
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
  const extraKey = published
    .map((entry) => entry.address)
    .filter((address) => address !== contractAddress)
    .sort()
    .join(",");
  useEffect(() => {
    const addresses = [...new Set(extraKey === "" ? [] : extraKey.split(","))];
    if (addresses.length === 0 || !indexerUrl || !contractAddress) {
      setExtraActivity({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        addresses.map(async (address) => {
          try {
            const item = await fetchChainActivity({ indexerUrl, contractAddress: address });
            return [address, item] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, ChainActivity> = {};
      for (const result of results) {
        if (result) next[result[0]] = result[1];
      }
      setExtraActivity(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [extraKey, indexerUrl, contractAddress]);

  // No demo fallback: when the indexer is unreachable the directory shows
  // only tenders published from this device (possibly none) instead of
  // fictional listings.
  const base = activity ? activityToTenders(activity) : [];
  const known = new Set(base.map((tender) => tender.contractAddress ?? tender.id));
  // Newest first: device publishes (stored newest-first) ahead of chain
  // records, so home and directory always lead with the latest opportunity.
  const tenders: Tender[] = [
    ...published
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
    refresh: () => load(config),
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
