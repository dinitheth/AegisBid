/** Display a raw Midnight DUST balance using the wallet's 10^15 base units. */
export function formatConnectorDust(raw: string | undefined): string {
  if (!raw) return "0";
  try {
    const value = BigInt(raw);
    const whole = value / 1_000_000_000_000_000n;
    const frac = value % 1_000_000_000_000_000n;
    const grouped = whole.toLocaleString("en-US");
    if (frac === 0n) return grouped;
    const fracDigits = frac.toString().padStart(15, "0").replace(/0+$/, "").slice(0, 2);
    return `${grouped}.${fracDigits}`;
  } catch {
    return raw;
  }
}
