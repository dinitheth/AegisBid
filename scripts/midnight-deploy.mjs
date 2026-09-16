/**
 * AegisBid deploy script: compile (optional) + deploy aegis_bid.compact.
 *
 * Shapes verified against generated bindings (compact toolchain 0.31.1,
 * language 0.23.0): constructor `args: [TenderConfig]`, witnesses
 * `(context[, index]) => [privateState, value]`. Tested path: local
 * `undeployed` network via midnight-local-dev.
 *
 * Usage:
 *   node scripts/midnight-deploy.mjs --network undeployed [--local-dev ../midnight-local-dev]
 *   node scripts/midnight-deploy.mjs --network preprod --indexer <url> --indexer-ws <url>
 *   node scripts/midnight-deploy.mjs --compile-only      # compile + artifact check, no network
 *
 * Env:
 *   MIDNIGHT_SEED            64-hex-char wallet seed (required beyond undeployed)
 *   MIDNIGHT_PS_PASSWORD     private-state encryption password (required beyond undeployed)
 *   MIDNIGHT_COMPACT_BIN     path to the real Midnight compiler binary (else `compact` on PATH)
 *
 * Never commit seeds or passwords: keep them in shell env, not in files.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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

const bindings = await import(pathToFileURL(path.join(outDir, "contract", "index.js")).href).catch(
  () => undefined,
);
const Contract = bindings?.Contract;
const TenderMode = bindings?.TenderMode;
const ledger = bindings?.ledger;
if (!Contract || !TenderMode || !ledger) {
  fail(`generated module at ${outDir}/contract/index.js lacks Contract/TenderMode/ledger exports.`);
}

// Constructor config for the demo tender. Override via CLI flags.
const demoConfig = {
  issuer: args.issuer ?? "AegisBid Wave 1 demo issuer",
  deadline: args.deadline ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
  reserve: args.reserve ?? "1000",
  mode: args.mode ?? "highest",
  spec: args.spec ?? "AegisBid demo specification",
};

const sha32 = (value) => createHash("sha256").update(value, "utf8").digest();
const deadlineArg = /^\d+$/.test(demoConfig.deadline)
  ? BigInt(demoConfig.deadline)
  : BigInt(Math.floor(Date.parse(demoConfig.deadline) / 1000));
const ledgerConfig = {
  issuer: sha32(demoConfig.issuer),
  deadline: deadlineArg,
  reserve: BigInt(demoConfig.reserve),
  mode: demoConfig.mode === "lowest" ? TenderMode.LowestCompliant : TenderMode.HighestBid,
  specificationRoot: sha32(demoConfig.spec),
};
console.log(
  `tender config: ${JSON.stringify({ ...demoConfig, mode: ledgerConfig.mode, deadline: ledgerConfig.deadline.toString(), reserve: ledgerConfig.reserve.toString() })}`,
);

// Deploy-time witness stubs. The constructor never invokes witnesses; these
// exist because withWitnesses requires the full Witnesses<PS> object.
const deployPrivateState = {};
const witnesses = {
  localBidAmount: ({ privateState }) => [privateState, 0n],
  localBidSalt: ({ privateState }) => [privateState, new Uint8Array(32)],
  localIdentitySecret: ({ privateState }) => [privateState, new Uint8Array(32)],
  settlementBid: ({ privateState }) => [privateState, 0n],
  settlementSalt: ({ privateState }) => [privateState, new Uint8Array(32)],
  settlementKey: ({ privateState }) => [privateState, new Uint8Array(32)],
};

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

// Endpoints: local-dev defaults, overridable for public networks.
const endpoints = {
  indexer: args.indexer ?? localConfig.indexer,
  indexerWS: args["indexer-ws"] ?? localConfig.indexerWS,
  proofServer: args["proof-server"] ?? localConfig.proofServer ?? "http://localhost:6300",
};
if (network !== "undeployed" && (!args.indexer || !args["indexer-ws"])) {
  fail("public networks need --indexer and --indexer-ws (see docs/MIDNIGHT_INTEGRATION.md).");
}

const psPassword = process.env.MIDNIGHT_PS_PASSWORD ?? "AegisBid-Local-2026!!";
if (network !== "undeployed" && !process.env.MIDNIGHT_PS_PASSWORD) {
  fail("public networks need MIDNIGHT_PS_PASSWORD (16+ chars, mixed classes).");
}

midnight.networkId.setNetworkId(network);
const ctx = await buildWalletFromHexSeed(localConfig, seed);
let contractAddress = "";
try {
  await registerNightForDust(ctx);
  console.log("wallet: registered for DUST");
  const accountId = ctx.unshieldedKeystore.getBech32Address().asString();

  const zkConfigProvider = new midnight.zkConfig.NodeZkConfigProvider(outDir);
  const walletAndMidnightProvider = {
    getCoinPublicKey: () => ctx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => ctx.shieldedSecretKeys.encryptionPublicKey,
    balanceTx: async (tx, ttl = midnight.utils.ttlOneHour()) => {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl },
      );
      return await ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx) => ctx.wallet.submitTransaction(tx),
  };
  const providers = {
    privateStateProvider: midnight.privateState.levelPrivateStateProvider({
      privateStateStoreName: "aegis-private-state",
      signingKeyStoreName: "aegis-signing-keys",
      privateStoragePasswordProvider: () => psPassword,
      accountId,
    }),
    publicDataProvider: midnight.indexer.indexerPublicDataProvider(endpoints.indexer, endpoints.indexerWS),
    zkConfigProvider,
    proofProvider: midnight.proof.httpClientProofProvider(endpoints.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };

  const compiled = midnight.compactJs.CompiledContract.withCompiledFileAssets(
    midnight.compactJs.CompiledContract.withWitnesses(
      midnight.compactJs.CompiledContract.make("aegisbid", Contract),
      witnesses,
    ),
    outDir,
  );
  const deployed = await midnight.contracts.deployContract(providers, {
    compiledContract: compiled,
    privateStateId: "aegisPrivateState",
    initialPrivateState: deployPrivateState,
    args: [ledgerConfig],
  });
  contractAddress = deployed.deployTxData.public.contractAddress;
  console.log(`deployed at ${contractAddress}`);

  const found = await midnight.contracts.findDeployedContract(providers, {
    contractAddress,
    compiledContract: compiled,
    privateStateId: "aegisPrivateState",
    initialPrivateState: deployPrivateState,
  });
  const onChain = await providers.publicDataProvider.queryContractState(contractAddress);
  const decoded = ledger(onChain.data);
  console.log(
    `on-chain state: phase=${decoded.phase} commitments=${decoded.commitments.size()} ` +
      `nullifiers=${decoded.nullifiers.size()} settled=${decoded.settlement.is_some}`,
  );
  void found;
} finally {
  await closeWallet(ctx).catch(() => undefined);
}

await mkdir(path.join(root, "managed"), { recursive: true });
await appendFile(
  path.join(root, "managed", "DEPLOYMENTS.md"),
  `\n## ${new Date().toISOString()} — ${network}\n- contract: ${contractAddress}\n- config: ${JSON.stringify(demoConfig)}\n`,
);
console.log("recorded deployment in managed/DEPLOYMENTS.md");
console.log(`next: VITE_AEGISBID_CONTRACT=${contractAddress}`);
