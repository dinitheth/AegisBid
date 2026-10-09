import { describe, expect, it } from "vitest";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { Contract } from "../managed/aegis-bid-v2/contract/index.js";
import {
  ZK_BASE,
  buildOneAmProviders,
  bytesToHex,
  createMemoryPrivateStateProvider,
  toBindingTenderConfig,
  type AnyWitnessContext,
} from "../src/features/aegis/midnight/providers";
import { listWalletConnectors } from "../src/features/aegis/midnight/oneAmWallet";
import type { OneAmConnectedApi } from "../src/features/aegis/midnight/oneAmWallet";

function mockConnectorApi(proving: "wallet" | "reject"): OneAmConnectedApi {
  return {
    getConfiguration: async () => ({
      networkId: "preprod",
      indexerUri: "http://localhost:8088/api/v4/graphql",
      indexerWsUri: "ws://localhost:8088/api/v4/graphql/ws",
    }),
    getShieldedAddresses: async () => ({
      shieldedCoinPublicKey: "coin",
      shieldedEncryptionPublicKey: "enc",
    }),
    getProvingProvider: async () => {
      if (proving === "reject") throw new Error("proving not supported by wallet");
      return {};
    },
    balanceUnsealedTransaction: async () => ({ tx: "00" }),
    submitTransaction: async () => undefined,
  } as unknown as OneAmConnectedApi;
}

describe("midnight providers", () => {
  it("points ZK artifacts at the committed bindings by default", () => {
    expect(ZK_BASE).toContain("managed/aegis-bid-v2");
  });

  it("round-trips bytes through hex", () => {
    const bytes = new Uint8Array([0, 1, 255, 16]);
    expect(bytesToHex(bytes)).toBe("0001ff10");
  });

  it("maps tender policy to the Compact constructor shape", () => {
    const config = toBindingTenderConfig({
      issuer: "Test issuer",
      deadlineSec: 1_789_200n,
      reserve: 1_000n,
      mode: "highest",
      spec: "Test spec",
    });
    expect(config.deadline).toBe(1_789_200n);
    expect(config.reserve).toBe(1_000n);
    expect(config.mode).toBe(0);
    expect(config.issuer).toHaveLength(32);
    expect(config.specificationRoot).toHaveLength(32);
  });

  it("maps lowest mode to the enum variant", () => {
    const config = toBindingTenderConfig({
      issuer: "x",
      deadlineSec: 1n,
      reserve: 0n,
      mode: "lowest",
      spec: "y",
    });
    expect(config.mode).toBe(1);
  });

  it("attaches bid witnesses to the compiled contract", () => {
    const compiled = CompiledContract.withCompiledFileAssets(
      // @ts-expect-error: SDK withWitnesses witnesses param collapses to never; runtime-verified
      CompiledContract.withWitnesses(CompiledContract.make("aegisbid", Contract), {
        localBidAmount: ({ privateState }: AnyWitnessContext) => [privateState, 2_450n],
        localBidSalt: ({ privateState }: AnyWitnessContext) => [
          privateState,
          new Uint8Array(32).fill(7),
        ],
        evaluatorSecret: ({ privateState }: AnyWitnessContext) => [
          privateState,
          new Uint8Array(32).fill(9),
        ],
        settlementBid: ({ privateState }: AnyWitnessContext) => [privateState, 2_450n],
        settlementSalt: ({ privateState }: AnyWitnessContext) => [
          privateState,
          new Uint8Array(32).fill(7),
        ],
        settlementKey: ({ privateState }: AnyWitnessContext) => [
          privateState,
          new Uint8Array(32).fill(3),
        ],
      }),
      "./managed/aegis-bid-v2",
    );
    expect(compiled).toBeDefined();
  });

  it("detects only 1AM and ignores Lace connectors", () => {
    const connect = async () => ({}) as never;
    expect(listWalletConnectors(undefined)).toEqual([]);
    expect(listWalletConnectors({})).toEqual([]);
    const wallets = listWalletConnectors({ mnLace: { connect }, "1am": { connect }, other: {} });
    expect(wallets.map((entry) => entry.kind)).toEqual(["1am"]);
    expect(wallets[0]?.key).toBe("1am");
    expect(listWalletConnectors({ lace: { connect }, mnLace: { connect } })).toEqual([]);
  });

  // Provider setup binds fetch to window (browser global); the node test env
  // has none, so stub it for the duration of each builder call.
  async function withBrowserWindow<T>(fn: () => Promise<T>): Promise<T> {
    const globals = globalThis as Record<string, unknown>;
    const prev = globals["window"];
    globals["window"] = globalThis;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete globals["window"];
      else globals["window"] = prev;
    }
  }

  it("reads wallet account details only once while assembling a 1AM stack", async () => {
    let configurationReads = 0;
    let addressReads = 0;
    const api = mockConnectorApi("wallet");
    const originalConfiguration = api.getConfiguration;
    const originalAddresses = api.getShieldedAddresses;
    api.getConfiguration = async () => {
      configurationReads += 1;
      return originalConfiguration();
    };
    api.getShieldedAddresses = async () => {
      addressReads += 1;
      return originalAddresses();
    };
    const built = await withBrowserWindow(() => buildOneAmProviders(api));
    expect(configurationReads).toBe(1);
    expect(addressReads).toBe(1);
    expect(built.walletCoinPublicKey).toBe("coin");
    expect(built.networkId).toBe("preprod");
  });

  it("reuses a successful 1AM proving provider for the connected wallet session", async () => {
    let provingReads = 0;
    const api = mockConnectorApi("wallet");
    api.getProvingProvider = async () => {
      provingReads += 1;
      return {};
    };
    await withBrowserWindow(() => buildOneAmProviders(api));
    await withBrowserWindow(() => buildOneAmProviders(api));
    expect(provingReads).toBe(1);
  });

  it("reports the balance stage through the 1AM provider stack", async () => {
    const messages: string[] = [];
    const built = await withBrowserWindow(() =>
      buildOneAmProviders(mockConnectorApi("wallet"), undefined, (message) =>
        messages.push(message),
      ),
    );
    const providers = built.providers as unknown as {
      walletProvider: { balanceTx(tx: { serialize: () => Uint8Array }): Promise<unknown> };
    };
    await expect(
      providers.walletProvider.balanceTx({ serialize: () => new Uint8Array() }),
    ).rejects.toThrow();
    expect(messages).toContain("Preparing the transaction with 1AM...");
  });

  it("scopes private states per contract address", async () => {
    const store = createMemoryPrivateStateProvider();
    store.setContractAddress("addr-a");
    await store.set("bid", { amount: 1 });
    await store.setSigningKey("addr-a", "key-a");
    store.setContractAddress("addr-b");
    expect(await store.get("bid")).toBeNull();
    await store.set("bid", { amount: 2 });
    expect(await store.get("bid")).toEqual({ amount: 2 });
    // Signing keys are global (address-keyed), not scope-keyed.
    expect(await store.getSigningKey("addr-a")).toBe("key-a");
    expect(await store.getSigningKey("addr-b")).toBeNull();
    await store.remove("bid");
    expect(await store.get("bid")).toBeNull();
  });
});
