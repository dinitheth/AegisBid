/**
 * AegisBid deploy script: compile (optional) + deploy aegis_bid.compact.
 *
 * Status: SCAFFOLDING — written against docs.midnight.network
 * (guides/deploy-and-operate, guides/networks-and-environments) and NOT yet
 * run against a live network on this machine (no Docker toolchain here).
 * It fails fast with the exact missing piece at each phase.
 *
 * Usage:
 *   node scripts/midnight-deploy.mjs --network undeployed [--local-dev ../midnight-local-dev]
 *   node scripts/midnight-deploy.mjs --network preprod   # needs MIDNIGHT_SEED, public endpoints
 *   node scripts/midnight-deploy.mjs --compile-only      # compile + artifact check, no network
 *
 * Env:
 *   MIDNIGHT_SEED            64-hex-char wallet seed (required for preprod/mainnet)
 *   MIDNIGHT_COMPACT_BIN     path to the real Midnight compiler binary (else `compact` on PATH)
 *   VITE_AEGISBID_CONTRACT   (read-only here) existing deployment to reconnect to
 *
 * Never commit seeds: keep them in shell env, not in files.
 */
import { execFile } from "node:child_process";
import { appendFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = Object.fromEntries(
  process.argv.slice(2).map((token) => {
    const match = token.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? true] : ["_", token];
  }),
);

const network = args.network ?? "undeployed";
const localDevDir = path.resolve(root, args["local-dev"] ?? "../midnight-local-dev");
const outDir = path.resolve(root, args.out ?? "managed/aegis-bid");
const contractSrc = path.join(root, "contracts", "aegis_bid.compact");

const GENESIS_SEED = `${"0".repeat(63)}1`; // public local-dev seed from the Midnight docs; local only
const seed = process.env.MIDNIGHT_SEED ?? (network === "undeployed" ? GENESIS_SEED : undefined);

function fail(message) {
  console.error(`\nDEPLOY FAILED: ${message}`);
  process.exit(2);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function runCompiler(binary, subArgs) {
  return new Promise((resolve, reject) => {
    execFile(binary, subArgs, { cwd: root }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) reject(error);
      else resolve();
    });
  });
}

// — phase 1: compile -------------------------------------------------------
if (!args["skip-compile"]) {
  const hasBindings = await exists(path.join(outDir, "contract", "index.js"));
  if (hasBindings && !args["compile-always"]) {
    console.log(`compile: bindings already present at ${outDir} (use --compile-always to redo)`);
  } else {
    const binary = process.env.MIDNIGHT_COMPACT_BIN ?? "compact";
    console.log(`compile: ${binary} compile ${contractSrc} ${outDir}`);
    try {
      await runCompiler(binary, ["compile", contractSrc, outDir]);
    } catch {
      fail(
        `compiler run failed. Point MIDNIGHT_COMPACT_BIN at the real Midnight compiler ` +
          `(see contracts/COMPACT_TOOLCHAIN.md). Do NOT use the Windows NTFS compact.exe.`,
      );
    }
  }
}

for (const required of ["contract/index.js", "contract/index.d.ts", "zkir", "keys"]) {
  if (!(await exists(path.join(outDir, required)))) {
    fail(`missing compile artifact: ${path.join(outDir, required)}. Re-run without --skip-compile.`);
  }
}
console.log("compile: artifacts verified (contract/, zkir/, keys/)");

if (args["compile-only"]) {
  console.log("compile-only: done, no network touched.");
  process.exit(0);
}

// — phase 2: config ---------------------------------------------------------
if (!["undeployed", "preview", "preprod", "mainnet"].includes(network)) {
  fail(`unknown --network ${network}; want undeployed|preview|preprod|mainnet.`);
}
if (!seed) fail("no wallet seed: export MIDNIGHT_SEED=<64-hex> (required beyond undeployed).");
if (seed === GENESIS_SEED && network !== "undeployed") {
  fail("the public local-dev seed must never target a shared network.");
}
if (network === "mainnet") fail("mainnet deploys are out of scope for this script — see docs.");
console.log(`network: ${network} (local-dev helpers: ${localDevDir})`);

// — phase 3: providers (docs pattern, inside midnight-local-dev context) ----
let walletHelpers;
try {
  walletHelpers = await import(pathToFileURL(path.join(localDevDir, "src", "wallet.js")).href);
} catch {
  fail(
    `cannot load midnight-local-dev wallet helpers at ${localDevDir}/src/wallet.js. ` +
      `Clone https://github.com/midnightntwrk/midnight-local-dev next to this repo and npm install there.`,
  );
}
const { buildWalletFromHexSeed, registerNightForDust, closeWallet } = walletHelpers;
if (!buildWalletFromHexSeed || !registerNightForDust || !closeWallet) {
  fail("local-dev wallet.js lacks buildWalletFromHexSeed/registerNightForDust/closeWallet.");
}

let midnight;
try {
  midnight = {
    contracts: await import("@midnight-ntwrk/midnight-js-contracts"),
    compactJs: await import("@midnight-ntwrk/midnight-js-protocol/compact-js"),
    networkId: await import("@midnight-ntwrk/midnight-js-network-id"),
    privateState: await import("@midnight-ntwrk/midnight-js-level-private-state-provider"),
    indexer: await import("@midnight-ntwrk/midnight-js-indexer-public-data-provider"),
    zkConfig: await import("@midnight-ntwrk/midnight-js-node-zk-config-provider"),
    proof: await import("@midnight-ntwrk/midnight-js-http-client-proof-provider"),
    utils: await import("@midnight-ntwrk/midnight-js-utils"),
  };
} catch {
  fail(
    "Midnight.js packages missing here. Install per docs/MIDNIGHT_INTEGRATION.md " +
      "(@midnight-ntwrk/midnight-js-contracts, -types, -network-id, " +
      "-level-private-state-provider, -indexer-public-data-provider, " +
      "-node-zk-config-provider, -http-client-proof-provider, -utils).",
  );
}

const { default: ContractModule } = await import(pathToFileURL(path.join(outDir, "contract", "index.js")).href).catch(() => ({ default: undefined }));
if (!ContractModule?.Contract) fail(`generated module at ${outDir}/contract/index.js has no Contract export.`);

// Constructor config for the demo tender. Override via CLI flags.
const demoConfig = {
  issuer: args.issuer ?? "AegisBid Wave 1 demo issuer",
  deadline: args.deadline ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
  reserve: args.reserve ?? "1000",
  mode: args.mode ?? "highest",
  spec: args.spec ?? "AegisBid demo specification",
};
console.log(`tender config: ${JSON.stringify(demoConfig)}`);

// NOTE: the exact constructor-arg and private-state shapes must be reconciled
// against ${outDir}/contract/index.d.ts after compiling. The deploy call below
// passes the constructor config positionally; if the installed SDK expects a
// different DeployContractOptions shape it throws verbatim — paste that error
// into docs/MIDNIGHT_INTEGRATION.md follow-up.
let localConfig;
try {
  const { StandaloneConfig } = await import(
    pathToFileURL(path.join(localDevDir, "src", "config.js")).href
  );
  localConfig = new StandaloneConfig();
} catch {
  fail(
    `cannot load StandaloneConfig from ${localDevDir}/src/config.js. ` +
      `Use a midnight-local-dev checkout matching the docs (guides/networks-and-environments).`,
  );
}

midnight.networkId.setNetworkId(network);
const ctx = await buildWalletFromHexSeed(localConfig, seed);

try {
  await registerNightForDust(ctx);
  console.log("wallet: registered for DUST");
  // Full deploy (deployContract + findDeployedContract + callTx) goes here once
  // the generated index.d.ts shapes are confirmed. Until then this script
  // proves: compile works, wallet builds, DUST registration succeeds.
  console.log("deploy: stopping before deployContract — confirm generated types first (see note above).");
} finally {
  await closeWallet(ctx).catch(() => undefined);
}

await mkdir(path.join(root, "managed"), { recursive: true });
await appendFile(
  path.join(root, "managed", "DEPLOYMENTS.md"),
  `\n## ${new Date().toISOString()} — ${network}\n- deploy script reached wallet+DUST stage; deployContract pending generated-type reconciliation\n- config: ${JSON.stringify(demoConfig)}\n`,
);
console.log("recorded run in managed/DEPLOYMENTS.md");
