import { describe, expect, it } from "vitest";
import {
  FLAGSHIP_TENDER,
  activityToTenders,
  getChainConfig,
  isConfigured,
  loadPublishedTenders,
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
    expect(tender?.status).toBe("Active");
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
