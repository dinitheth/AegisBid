import { describe, expect, it } from "vitest";
import { friendlyWalletError } from "./oneAmWallet";

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

  it("points empty-wallet ledger failures at the faucet", () => {
    expect(
      friendlyWalletError(
        new Error(
          "Unexpected error executing scoped transaction '<unnamed>': Error: expected instance of e",
        ),
      ),
    ).toBe(
      "Your wallet couldn't prepare the transaction — this usually means it holds no funds. Get test tokens from the preprod faucet, then try again.",
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
