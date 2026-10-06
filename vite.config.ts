// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import wasm from "vite-plugin-wasm";

const require = createRequire(import.meta.url);
// Absolute path: the wrapper's alias handling needs a resolvable file, not a
// bare specifier (its rewrite of 'buffer' otherwise breaks the build).
const bufferEntry = path.join(path.dirname(require.resolve("buffer/package.json")), "index.js");

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Midnight ledger WASM needs proper wasm loading. Buffer/process shims come
  // from the wrapper's alias handling; nodePolyfills is intentionally NOT used
  // here because its bare 'buffer' rewrite conflicts with the wrapper at
  // build time (UNLOADABLE_DEPENDENCY). wasm() alone matches the ledger's
  // documented Vite requirement.
  // Self-hosted on a VPS (not Cloudflare): the node-server preset makes the
  // SSR build resolve node conditions, under which ledger-v8 and friends
  // export correctly. (The default cloudflare-module target resolves with
  // workerd conditions that those packages do not provide.)
  // On Vercel (VERCEL=1 is set by their build environment), use the vercel
  // preset instead: it emits .vercel/output with Node.js serverless
  // functions. Never use an edge/workerd preset — the ledger stack cannot
  // run on those runtimes.
  nitro: { preset: process.env["VERCEL"] ? "vercel" : "node-server" },
  vite: {
    plugins: [wasm()],
    resolve: {
      alias: [{ find: /^buffer$/, replacement: bufferEntry }],
    },
    define: { global: "globalThis" },
    optimizeDeps: {
      // buffer + compact-runtime MUST be pre-bundled: the absolute buffer
      // alias serves raw CJS (`require` at index.js:11) and compact-runtime's
      // dist/error.js default-imports CJS object-inspect — both throw in the
      // browser when served unbundled (broke the deploy chunk in dev).
      include: ["buffer", "@midnight-ntwrk/compact-runtime"],
      exclude: ["@midnight-ntwrk/ledger-v8", "@midnight-ntwrk/onchain-runtime-v3"],
    },
    build: { target: "esnext" },
  },
});
