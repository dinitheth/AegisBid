// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Midnight ledger WASM needs proper wasm loading + node globals. Mirrors the
  // working config from 0xfdbu/midnight-apps dapp-connect (Vite + ledger-v8).
  vite: {
    plugins: [
      wasm(),
      nodePolyfills({
        include: ["crypto", "buffer", "events", "stream", "util", "process"],
        globals: { Buffer: true, process: true },
      }),
    ],
    optimizeDeps: {
      exclude: [
        "@midnight-ntwrk/ledger-v8",
        "@midnight-ntwrk/onchain-runtime-v3",
        "@midnight-ntwrk/compact-runtime",
      ],
    },
    build: { target: "esnext" },
  },
});
