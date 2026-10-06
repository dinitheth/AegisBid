import { describe, expect, it } from "vitest";
import {
  FLAGSHIP_TENDER,
  activityToTenders,
  applyLiveCounts,
  getChainConfig,
  isConfigured,
  isValidPublishedTender,
  loadPublishedTenders,
  mergePublishedSources,
  parseSharedTender,
  publishedToTender,
  type ChainActivity,
  type PublishedTender,
} from "./chain";

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
    // Flagship deadline (Sep 2026) has passed: no longer open for bids.
    expect(tender?.status).toBe("Evaluating");
    expect(tender?.contractAddress).toBe(FLAGSHIP_TENDER.contractAddress);
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
  };

  it("maps a published tender to a biddable directory record", () => {
    const tender = publishedToTender(entry);
    expect(tender.id).toBe(entry.address);
    expect(tender.contractAddress).toBe(entry.address);
    expect(tender.title).toBe("Neighborhood Bakery");
    expect(tender.status).toBe("Active");
    expect(tender.mode).toBe("Highest bid");
    expect(tender.threshold).toContain("1,000");
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
      actions: [
        ...activity.actions,
        { hash: "s1", kind: "Settle", blockHeight: 11, timestamp: null },
      ],
    });
    expect(settled.status).toBe("Settled");
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
    const parsed = parseSharedTender(`?contract=${address}&mode=bogus&reserve=abc&deadline=nope`);
    expect(parsed?.mode).toBe("highest");
    expect(parsed?.reserve).toBe("0");
    expect(parsed?.issuer).toBe("Shared tender");
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
    expect(isValidPublishedTender({ ...local(addrA, "ok"), mode: "bogus" })).toBe(false);
    expect(isValidPublishedTender({ ...local(addrA, "ok"), address: "short" })).toBe(false);
    expect(isValidPublishedTender(null)).toBe(false);
  });
});
