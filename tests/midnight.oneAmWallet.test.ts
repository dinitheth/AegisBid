import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  WALLET_DETAILS_TIMEOUT_MS,
  connectDetectedWallet,
  friendlyWalletError,
  refreshDetectedWallet,
  type DetectedWallet,
  type OneAmInitialApi,
} from "../src/features/aegis/midnight/oneAmWallet";

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

  it("times out instead of hanging on a silent 1AM connection", async () => {
    vi.useFakeTimers();
    const entry = {
      kind: "1am",
      key: "1am",
      label: "1AM",
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

describe("refreshDetectedWallet", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  });

  it("creates a fresh session for the active wallet", async () => {
    const connected = {
      getConfiguration: async () => ({ networkId: "preprod" }),
      getUnshieldedAddress: async () => ({ unshieldedAddress: "fresh-address" }),
      getDustBalance: async () => ({ balance: 12n }),
    };
    const connect = vi.fn(async () => connected);
    Object.defineProperty(globalThis, "window", {
      value: { midnight: { "1am": { connect } } },
      configurable: true,
    });

    const result = await refreshDetectedWallet("1AM");

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith("preprod");
    expect(result.info.unshieldedAddress).toBe("fresh-address");
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

  it("keeps wallet preparation failures customer-safe", () => {
    expect(
      friendlyWalletError(
        new Error(
          "Unexpected error executing scoped transaction '<unnamed>': Error: expected instance of e",
        ),
      ),
    ).toBe(
      "The wallet could not prepare this private transaction. No bid was sent. Refresh once, confirm 1AM is synced, then try again.",
    );
  });

  it("explains that a 1AM balancing timeout happens before approval", () => {
    expect(
      friendlyWalletError(
        new Error(
          "1AM did not finish balancing the transaction in 45 seconds. No transaction was submitted and no approval popup can appear until balancing completes.",
        ),
      ),
    ).toBe(
      "1AM did not finish preparing the transaction, so it never reached the wallet approval step. No transaction was submitted. This balancing step is handled by 1AM; check its service status and retry once after it recovers. Reloading the extension alone may not help.",
    );
  });

  it("points explicit insufficient-funds errors at the faucet", () => {
    expect(friendlyWalletError(new Error("insufficient funds for transaction"))).toBe(
      "Your wallet couldn't prepare the transaction — it may hold no funds. Get test tokens from the preprod faucet, then try again.",
    );
  });

  it("hides verifier-key and operation diagnostics from end users", () => {
    expect(
      friendlyWalletError(
        new Error(
          "Following operations: submitBid, beginEvaluation, settle, are undefined or have mismatched verifier keys for contract state ContractState (Array(6))",
        ),
      ),
    ).toBe(
      "This tender was not deployed with the current AegisBid V2 proof configuration. No bid was sent and no wallet approval was requested. Ask the issuer for a newly deployed V2 tender link.",
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
