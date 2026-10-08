import { describe, expect, it } from "vitest";
import { diagnoseCallAssembly } from "../src/features/aegis/midnight/forensics";
import type { OneAmConnectedApi } from "../src/features/aegis/midnight/oneAmWallet";

const witnesses = {
  amount: 1200n,
  salt: new Uint8Array(32).fill(7),
  bidderKey: new Uint8Array(32).fill(5),
};

describe("diagnoseCallAssembly", () => {
  it("preserves partial notes when assembly throws early", async () => {
    const api = {
      getConfiguration: async () => {
        throw new Error("boom-config");
      },
      getShieldedAddresses: async () => ({
        shieldedCoinPublicKey: "",
        shieldedEncryptionPublicKey: 42,
      }),
    } as unknown as OneAmConnectedApi;
    const out = await diagnoseCallAssembly(
      api,
      {},
      "0279d0b045d7c8a244b3f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8",
      witnesses,
      new Uint8Array(32).fill(5),
    );
    // Key shapes are reported, the throw is captured, and the witness/arg
    // shapes still append (no early return dropping notes).
    expect(out).toContain("coinKey=empty-string");
    expect(out).toContain("encKey=number");
    expect(out).toContain("diag-threw=boom-config");
    expect(out).toContain("witnesses=amount:bigint");
    expect(out).toContain("args=key:32B");
  });
});
