import { describe, expect, it } from "vitest";
import {
  FLAGSHIP_TENDER,
  activityToTenders,
  getChainConfig,
  isConfigured,
  type ChainActivity,
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
  });
});
