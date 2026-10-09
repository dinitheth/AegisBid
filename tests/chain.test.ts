import { describe, expect, it, vi } from "vitest";
import {
  FLAGSHIP_TENDER,
  CURRENT_V2_PROOF_CONFIG,
  activityToTenders,
  applyLiveCounts,
  browserIndexerQueryUrl,
  fetchChainActivity,
  fetchLatestBlockTime,
  getChainConfig,
  isConfigured,
  isValidPublishedTender,
  loadPublishedTenders,
  mergePublishedSources,
  parseSharedTender,
  publishedToTender,
  publishedContractVersion,
  type ChainActivity,
  type PublishedTender,
} from "../src/features/aegis/chain";

describe("chain flagship", () => {
  it("defaults to the verified preprod deployment", () => {
    const config = getChainConfig();
    expect(config.contractAddress).toBe(FLAGSHIP_TENDER.contractAddress);
    expect(isConfigured(config)).toBe(true);
  });

  it("renders the flagship tender with live counts", () => {
    const activity: ChainActivity = {
      state: {
        address: FLAGSHIP_TENDER.contractAddress,
        entryPoint: null,
        blockHeight: 2634493,
        blockTimestamp: null,
        transactionHash: "abc",
        stateHex: null,
      },
      actions: [
        { hash: "d1", kind: "Deploy", blockHeight: 1, timestamp: null },
        { hash: "c1", kind: "Call", blockHeight: 2, timestamp: null },
        { hash: "c2", kind: "Call", blockHeight: 3, timestamp: null },
      ],
    };
    const [tender] = activityToTenders(activity);
    expect(tender?.title).toBe(FLAGSHIP_TENDER.title);
    expect(tender?.mode).toBe("Highest bid");
    expect(tender?.commitments).toBe(2);
    expect(tender?.status).toBe("Active");
    expect(tender?.contractAddress).toBe(FLAGSHIP_TENDER.contractAddress);
  });
});

describe("Midnight indexer browser proxy URL", () => {
  it("routes official hosted indexers through the same origin", () => {
    vi.stubGlobal("window", { location: { origin: "https://aegisbid.vercel.app" } });
    expect(browserIndexerQueryUrl("https://indexer.preprod.midnight.network/api/v4/graphql")).toBe(
      "https://aegisbid.vercel.app/api/midnight/indexer?network=preprod",
    );
  });

  it("does not proxy arbitrary or local indexer URLs", () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:8080" } });
    const local = "http://localhost:8088/api/v4/graphql";
    const arbitrary = "https://example.com/api/v4/graphql";
    expect(browserIndexerQueryUrl(local)).toBe(local);
    expect(browserIndexerQueryUrl(arbitrary)).toBe(arbitrary);
    vi.unstubAllGlobals();
  });
});

describe("published tenders", () => {
  const entry: PublishedTender = {
    address: "131a7eba8ad55b204943564196b96f64c17e9bb2d2bf1a733a9119a9c266e4d8",
    issuer: "Neighborhood Bakery",
    mode: "highest",
    reserve: "1000",
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    deployedAt: Date.now(),
    contractVersion: 2,
    proofConfig: CURRENT_V2_PROOF_CONFIG,
  };

  it("maps a published tender to a biddable directory record", () => {
    const tender = publishedToTender(entry);
    expect(tender.id).toBe(entry.address);
    expect(tender.contractAddress).toBe(entry.address);
    expect(tender.title).toBe("Neighborhood Bakery");
    expect(tender.status).toBe("Active");
    expect(tender.mode).toBe("Highest bid");
    expect(tender.threshold).toContain("1,000");
    expect(tender.contractVersion).toBe(2);
  });

  it("marks past-deadline publishes as ready for evaluation", () => {
    const tender = publishedToTender({
      ...entry,
      deadline: new Date(Date.now() - 1000).toISOString(),
    });
    expect(tender.status).toBe("Evaluating");
  });

  it("overlays live counts and settled status", () => {
    const tender = publishedToTender(entry);
    const activity: ChainActivity = {
      state: {
        address: entry.address,
        entryPoint: null,
        blockHeight: 10,
        blockTimestamp: null,
        transactionHash: "d0",
        stateHex: null,
      },
      actions: [
        { hash: "d0", kind: "Deploy", blockHeight: 9, timestamp: null },
        { hash: "c1", kind: "Call", blockHeight: 10, timestamp: null },
      ],
    };
    const live = applyLiveCounts(tender, activity);
    expect(live.commitments).toBe(1);
    expect(live.status).toBe("Active");
    expect(applyLiveCounts(tender, null)).toEqual(tender);
    const settled = applyLiveCounts(tender, {
      ...activity,
      state: { ...activity.state, entryPoint: "settle" },
      actions: [{ hash: "s1", kind: "ContractCall", blockHeight: 11, timestamp: null }],
    });
    expect(settled.status).toBe("Settled");
  });

  it("reads the latest circuit from Midnight and marks a settled tender", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { query: string };
      if (request.query.includes("ContractState")) {
        expect(request.query).toContain("$address: HexEncoded!");
        return new Response(
          JSON.stringify({
            data: {
              contractAction: {
                __typename: "ContractCall",
                entryPoint: "settle",
                address: entry.address,
                state: "encoded-state",
                transaction: { hash: "settlement-tx", block: { height: 12, timestamp: null } },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: { block: { timestamp: Date.now() } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const activity = await fetchChainActivity({
        indexerUrl: "https://indexer.example/graphql",
        contractAddress: entry.address,
      });
      expect(activity.state.entryPoint).toBe("settle");
      expect(activity.actions[0]?.kind).toBe("settle");
      expect(applyLiveCounts(publishedToTender(entry), activity).status).toBe("Settled");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the network clock instead of a fast device clock", () => {
    const tender = publishedToTender({
      ...entry,
      deadline: new Date(Date.now() - 60_000).toISOString(),
    });
    const activity: ChainActivity = {
      state: {
        address: entry.address,
        entryPoint: null,
        blockHeight: 10,
        blockTimestamp: null,
        transactionHash: "d0",
        stateHex: null,
      },
      actions: [],
      latestBlockTime: Date.now() - 120_000,
    };

    expect(tender.status).toBe("Evaluating");
    expect(applyLiveCounts(tender, activity).status).toBe("Active");
    expect(applyLiveCounts(tender, { ...activity, latestBlockTime: Date.now() }).status).toBe(
      "Evaluating",
    );
  });

  it("reads the latest network block timestamp from the indexer", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { block: { timestamp: 1_791_544_908_001 } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(fetchLatestBlockTime("https://indexer.example/graphql")).resolves.toBe(
        1_791_544_908_001,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores corrupt publish history", () => {
    const globals = globalThis as Record<string, unknown>;
    const prev = globals["window"];
    globals["window"] = {
      localStorage: { getItem: () => "{not json" },
    };
    try {
      expect(loadPublishedTenders()).toEqual([]);
    } finally {
      if (prev === undefined) delete globals["window"];
      else globals["window"] = prev;
    }
  });
});

describe("shared tender links", () => {
  const address = "131a7eba8ad55b204943564196b96f64c17e9bb2d2bf1a733a9119a9c266e4d8";

  it("parses a full share link into a publish record", () => {
    const params = new URLSearchParams({
      contract: address,
      issuer: "Neighborhood Bakery",
      deadline: "2026-10-20T12:00:00.000Z",
      mode: "lowest",
      reserve: "2500",
      v: "2",
      proof: CURRENT_V2_PROOF_CONFIG,
    });
    const parsed = parseSharedTender(`?${params.toString()}`);
    expect(parsed).toMatchObject({
      address,
      issuer: "Neighborhood Bakery",
      mode: "lowest",
      reserve: "2500",
    });
    expect(parsed?.deadline).toContain("2026-10-20");
  });

  it("rejects malformed addresses and sanitizes fields", () => {
    expect(parseSharedTender("?contract=xyz")).toBeNull();
    expect(parseSharedTender("")).toBeNull();
    const parsed = parseSharedTender(
      `?contract=${address}&v=2&proof=${CURRENT_V2_PROOF_CONFIG}&mode=bogus&reserve=abc&deadline=nope`,
    );
    expect(parsed?.mode).toBe("highest");
    expect(parsed?.reserve).toBe("0");
    expect(parsed?.issuer).toBe("Shared tender");
  });

  it("marks V2 share links and migrates the known V2 deployment", () => {
    const v2 = "21b2efc6d75311c13c42f131ea48406539a5a461ecb32f7fb7e0e460e9bdc957";
    expect(publishedContractVersion(v2)).toBe(2);
    expect(publishedContractVersion(address, 2)).toBe(2);
    expect(publishedContractVersion(address)).toBe(1);
    expect(
      parseSharedTender(`?contract=${address}&v=2&proof=${CURRENT_V2_PROOF_CONFIG}`)
        ?.contractVersion,
    ).toBe(2);
    expect(parseSharedTender(`?contract=${address}&v=2`)).toBeNull();
    expect(parseSharedTender(`?contract=${address}`)).toBeNull();
  });
});

describe("tender registry merge", () => {
  const local = (address: string, issuer: string): PublishedTender => ({
    address,
    issuer,
    mode: "highest",
    reserve: "1000",
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    deployedAt: Date.now(),
    contractVersion: 2,
    proofConfig: CURRENT_V2_PROOF_CONFIG,
  });
  const addrA = "a".repeat(64);
  const addrB = "b".repeat(64);

  it("prefers registry order and drops duplicates and invalid rows", () => {
    const merged = mergePublishedSources(
      [local(addrA, "from-registry")],
      [
        local(addrA, "from-device"),
        local(addrB, "from-device"),
        { address: "bogus" } as unknown as PublishedTender,
      ],
    );
    expect(merged.map((entry) => entry.address)).toEqual([addrA, addrB]);
    expect(merged[0]?.issuer).toBe("from-registry");
  });

  it("validates registry records strictly", () => {
    expect(isValidPublishedTender(local(addrA, "ok"))).toBe(true);
    expect(isValidPublishedTender({ ...local(addrA, "old V2"), proofConfig: undefined })).toBe(
      false,
    );
    expect(
      isValidPublishedTender({ ...local(addrA, "stale verifier"), proofConfig: "aegis-v2-old" }),
    ).toBe(false);
    const legacy = { ...local(addrA, "legacy") } as Partial<PublishedTender>;
    delete legacy.contractVersion;
    expect(isValidPublishedTender(legacy)).toBe(false);
    expect(isValidPublishedTender({ ...local(addrA, "ok"), mode: "bogus" })).toBe(false);
    expect(isValidPublishedTender({ ...local(addrA, "ok"), address: "short" })).toBe(false);
    expect(isValidPublishedTender(null)).toBe(false);
  });
});
