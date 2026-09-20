/**
 * Browser globals required by the Midnight ledger stack at RUNTIME
 * (ledger-v8/compact-js reference bare `Buffer` when proving/balancing).
 * Imported first by DeployPage so the global exists before any proving call.
 * The `buffer` specifier resolves via the absolute alias in vite.config.ts.
 */
import { Buffer } from "buffer";

if (typeof (globalThis as Record<string, unknown>).Buffer === "undefined") {
  (globalThis as Record<string, unknown>).Buffer = Buffer;
}

export {};
