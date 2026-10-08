import { describe, expect, it } from "vitest";
import { formatConnectorDust } from "../src/features/aegis/wallet";

describe("formatConnectorDust", () => {
  it("formats the 1AM-reported scale (raw 2.5e19 = 25,000 DUST)", () => {
    expect(formatConnectorDust("25000000000000000000")).toBe("25,000");
  });

  it("returns zero for missing input", () => {
    expect(formatConnectorDust(undefined)).toBe("0");
    expect(formatConnectorDust("")).toBe("0");
  });

  it("rounds to at most 2 fractional digits", () => {
    expect(formatConnectorDust("2500123456000000000")).toBe("2,500.12");
    expect(formatConnectorDust("1500000000000000")).toBe("1.5");
  });

  it("falls back to raw input when it is not an integer", () => {
    expect(formatConnectorDust("not-a-number")).toBe("not-a-number");
  });
});
