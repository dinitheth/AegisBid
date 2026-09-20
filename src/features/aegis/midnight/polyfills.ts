/**
 * Browser globals required by the Midnight ledger stack at RUNTIME
 * (ledger-v8/compact-js reference bare `Buffer` when proving/balancing).
 * NOTE: package.json sets sideEffects:false, so a bare side-effect import
 * would be tree-shaken away. Call ensureBrowserBuffer() explicitly in the
 * deploy flow instead — a real call can never be shaken out.
 * The `buffer` specifier resolves via the absolute alias in vite.config.ts.
 */
import { Buffer } from "buffer";

export function ensureBrowserBuffer(): void {
  if (typeof (globalThis as Record<string, unknown>).Buffer === "undefined") {
    (globalThis as Record<string, unknown>).Buffer = Buffer;
  }
}
