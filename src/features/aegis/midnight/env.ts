/**
 * Single choke point for reading build-time env (`import.meta.env`).
 *
 * Why this exists: each transformed module gets its OWN `import.meta.env`
 * object, so test doubles installed with `vi.stubEnv` in a test file never
 * reach the modules under test (verified empirically: the stub reads back
 * fine locally while the source module still sees `.env` values). Routing
 * every read through this shared module makes the suite hermetic via
 * `overrideEnv` regardless of ambient `.env` files or runtimes.
 *
 * Production behavior is unchanged: without overrides this is a plain
 * `import.meta.env` read.
 */
const overrides = new Map<string, string | undefined>();

export function readEnv(name: string): string | undefined {
  if (overrides.has(name)) {
    const value = overrides.get(name);
    return value && value.length > 0 ? value : undefined;
  }
  try {
    const value = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[
      name
    ];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Test-only: force env values for the current test run. */
export function overrideEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) overrides.set(key, value);
}

/** Test-only: drop all forced values. */
export function clearEnvOverrides(): void {
  overrides.clear();
}
