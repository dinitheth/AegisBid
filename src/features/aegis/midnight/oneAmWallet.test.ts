import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  WALLET_DETAILS_TIMEOUT_MS,
  connectDetectedWallet,
  friendlyWalletError,
  type DetectedWallet,
  type OneAmInitialApi,
} from "./oneAmWallet";

describe("connectDetectedWallet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the connected api and display info", async () => {
    const connected = {
      getConfiguration: async () => ({ networkId: "preprod" }),
      getUnshieldedAddress: async () => ({ unshieldedAddress: "addr-1" }),
      getDustBalance: async () => ({ balance: 42n }),
    };
    const entry = {
      kind: "1am",
      key: "1am",
      label: "1AM",
      initial: { connect: async () => connected },
    } as unknown as DetectedWallet;
    const result = await connectDetectedWallet(entry);
    expect(result.api).toBe(connected);
    expect(result.info).toMatchObject({
      networkId: "preprod",
      unshieldedAddress: "addr-1",
      dustBalance: "42",
      walletName: "1AM",
    });
  });

  it("times out instead of hanging on a silent wallet", async () => {
    vi.useFakeTimers();
    const entry = {
      kind: "lace",
      key: "mnLace",
      label: "Lace",
      initial: { connect: () => new Promise<OneAmInitialApi>(() => {}) },
    } as unknown as DetectedWallet;
    const pending = connectDetectedWallet(entry);
    const rejected = expect(pending).rejects.toThrow("did not respond in 90s");
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    await rejected;
  });

  it("times out when a connected wallet never returns account details", async () => {
    vi.useFakeTimers();
    const connected = {
      getConfiguration: () => new Promise(() => {}),
      getUnshieldedAddress: () => new Promise(() => {}),
      getDustBalance: () => new Promise(() => {}),
    };
    const entry = {
      kind: "1am",
      key: "1am",
      label: "1AM",
      initial: { connect: async () => connected },
    } as unknown as DetectedWallet;
    const pending = connectDetectedWallet(entry);
    const rejected = expect(pending).rejects.toThrow("did not return account details in 20s");
    await vi.advanceTimersByTimeAsync(WALLET_DETAILS_TIMEOUT_MS);
    await rejected;
  });
});

describe("friendlyWalletError", () => {
  it("turns a wallet rejection into one plain sentence", () => {
    const cause = new Error(
      "Failed during proving via 1AM (approve in the wallet): User rejected the request.\nError: User rejected the request\n    at A (chrome-extension://bphnkdkcnfhompoegfpgnkidcjfbojjp/content-scripts/injected.js:1:2726)\n    at chrome-extension://bphnkdkcnfhompoegfpgnkidcjfbojjp/content-scripts/injected.js:1:7705",
    );
    expect(friendlyWalletError(cause)).toBe(
      "You declined the request in your wallet. Nothing was sent — try again whenever you're ready.",
    );
  });

  it("passes short plain messages through untouched", () => {
    expect(friendlyWalletError(new Error("Bidding for this tender has already closed."))).toBe(
      "Bidding for this tender has already closed.",
    );
  });

  it("asks for the technical text on wallet preparation failures", () => {
    expect(
      friendlyWalletError(
        new Error(
          "Unexpected error executing scoped transaction '<unnamed>': Error: expected instance of e",
        ),
      ),
    ).toBe(
      "The wallet failed while preparing the transaction. Open Technical details below and share the text so the cause can be traced.",
    );
  });

  it("points explicit insufficient-funds errors at the faucet", () => {
    expect(friendlyWalletError(new Error("insufficient funds for transaction"))).toBe(
      "Your wallet couldn't prepare the transaction — it may hold no funds. Get test tokens from the preprod faucet, then try again.",
    );
  });

  it("hides extension internals behind a generic message", () => {
    expect(
      friendlyWalletError(new Error("boom\n    at A (chrome-extension://abc/content.js:1:2)")),
    ).toBe(
      "The wallet request didn't complete. Please try again, and check the wallet extension if it keeps happening.",
    );
  });

  it("handles empty causes", () => {
    expect(friendlyWalletError(undefined)).toBe("The transaction was not completed.");
    expect(friendlyWalletError(null)).toBe("The transaction was not completed.");
  });
});
