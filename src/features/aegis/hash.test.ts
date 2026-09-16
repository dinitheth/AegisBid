import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("matches the FIPS 180-4 empty-string vector", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it('matches the FIPS 180-4 "abc" vector', () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic and avalanche-sensitive", () => {
    expect(sha256Hex("aegisbid:1")).toBe(sha256Hex("aegisbid:1"));
    expect(sha256Hex("aegisbid:1")).not.toBe(sha256Hex("aegisbid:2"));
    expect(sha256Hex("aegisbid:1")).toHaveLength(64);
  });
});
