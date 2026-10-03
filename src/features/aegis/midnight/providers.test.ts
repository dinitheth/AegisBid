import { describe, expect, it } from "vitest";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { Contract } from "../../../../managed/aegis-bid/contract/index.js";
import { ZK_BASE, bytesToHex, toBindingTenderConfig, type AnyWitnessContext } from "./providers";

describe("midnight providers", () => {
  it("points ZK artifacts at the committed bindings by default", () => {
    expect(ZK_BASE).toContain("managed/aegis-bid");
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
        localIdentitySecret: ({ privateState }: AnyWitnessContext) => [
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
      "./managed/aegis-bid",
    );
    expect(compiled).toBeDefined();
  });
});
