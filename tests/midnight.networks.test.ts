import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearEnvOverrides, overrideEnv } from "../src/features/aegis/midnight/env";
import { MIDNIGHT_NETWORKS, getActiveNetwork, getActiveNetworkId, isNetworkId } from "../src/features/aegis/midnight/networks";

// The repo .env sets preprod values; these default-path tests force a blank
// environment instead (vi.stubEnv can't cross into the modules under test:
// each transformed module gets its own import.meta.env object).
beforeEach(() => {
  overrideEnv({ VITE_MIDNIGHT_NETWORK_ID: "", VITE_MIDNIGHT_PROOF_SERVER: "" });
});

afterEach(() => {
  clearEnvOverrides();
});

describe("midnight networks", () => {
  it("pins the documented v4 endpoints with a local proof server", () => {
    expect(MIDNIGHT_NETWORKS.undeployed.indexer).toBe("http://localhost:8088/api/v4/graphql");
    expect(MIDNIGHT_NETWORKS.preprod.indexer).toBe(
      "https://indexer.preprod.midnight.network/api/v4/graphql",
    );
    for (const config of Object.values(MIDNIGHT_NETWORKS)) {
      expect(config.proofServer).toBe("http://localhost:6300");
      expect(config.indexer).toContain("/api/v4/graphql");
    }
  });

  it("validates network ids", () => {
    expect(isNetworkId("preprod")).toBe(true);
    expect(isNetworkId("undeployed")).toBe(true);
    expect(isNetworkId("mainnet")).toBe(true);
    expect(isNetworkId("preview")).toBe(true);
    expect(isNetworkId("testnet-02")).toBe(false);
    expect(isNetworkId("")).toBe(false);
  });

  it("defaults to the local network when nothing is configured", () => {
    expect(getActiveNetworkId()).toBe("undeployed");
    expect(getActiveNetwork().id).toBe("undeployed");
  });
});
