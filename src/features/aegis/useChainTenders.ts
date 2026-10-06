import { useCallback, useEffect, useState } from "react";
import {
  activityToTenders,
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
import { initialTenders, type Tender } from "./protocol";

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

  const base = activity ? activityToTenders(activity) : initialTenders;
  const known = new Set(base.map((tender) => tender.contractAddress ?? tender.id));
  const tenders: Tender[] = [
    ...base,
    ...published.filter((entry) => !known.has(entry.address)).map(publishedToTender),
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
