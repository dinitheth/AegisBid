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
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const rawArgs = process.argv.slice(2);
const args = {};
for (let i = 0; i < rawArgs.length; i += 1) {
  const token = rawArgs[i];
  const match = token.match(/^--([^=]+)(?:=(.*))?$/);
  if (!match) {
    args._ = [...(args._ ?? []), token];
    continue;
  }
  if (match[2] !== undefined) {
    args[match[1]] = match[2];
  } else if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith("--")) {
    args[match[1]] = rawArgs[i + 1];
    i += 1;
  } else {
    args[match[1]] = true;
  }
}

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
if (!seed && !process.env.MIDNIGHT_MNEMONIC) {
  fail("no wallet secret: export MIDNIGHT_SEED=<64-hex> or MIDNIGHT_MNEMONIC=<words> (required beyond undeployed).");
}
if (seed === GENESIS_SEED && network !== "undeployed") {
  fail("the public local-dev seed must never target a shared network.");
}
if (network === "mainnet") fail("mainnet deploys are out of scope for this script — see docs.");
console.log(`network: ${network} (local-dev helpers: ${localDevDir})`);

// — phase 3: providers (docs pattern, inside midnight-local-dev context) ----
// midnight-local-dev sources are TypeScript: run this script with the tsx
// loader (`node --import tsx/esm`, see package.json deploy scripts). tsx is a
// loader only (no runtime classes), so it cannot cause SDK identity skew.

let walletHelpers;
try {
  walletHelpers = await import(pathToFileURL(path.join(localDevDir, "src", "wallet.ts")).href);
} catch {
  fail(
    `cannot load midnight-local-dev wallet helpers at ${localDevDir}/src/wallet.ts. ` +
      `Clone https://github.com/midnightntwrk/midnight-local-dev next to this repo and npm install there.`,
  );
}
const { buildWallet, buildWalletFromHexSeed, registerNightForDust, closeWallet } = walletHelpers;
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
} catch (error) {
  fail(
    `Midnight.js packages missing or unloadable (${error instanceof Error ? error.message : error}). ` +
      "Install per docs/MIDNIGHT_INTEGRATION.md " +
      "(@midnight-ntwrk/midnight-js-contracts, -types, -network-id, " +
      "-level-private-state-provider, -indexer-public-data-provider, " +
      "-node-zk-config-provider, -http-client-proof-provider, -utils).",
  );
}

let bindings;
try {
  bindings = await import(pathToFileURL(path.join(outDir, "contract", "index.js")).href);
} catch (error) {
  fail(
    `cannot load generated bindings at ${outDir}/contract/index.js ` +
      `(${error instanceof Error ? error.message : error}). ` +
      `Check @midnight-ntwrk/compact-runtime matches the info file (runtime 0.16.0 per support matrix).`,
  );
}
const Contract = bindings?.Contract;
const TenderMode = bindings?.TenderMode;
const ledger = bindings?.ledger;
if (!Contract || !TenderMode || !ledger) {
  fail(`generated module at ${outDir}/contract/index.js lacks Contract/TenderMode/ledger exports.`);
}

// Constructor config for the demo tender. Override via CLI flags.
// --e2e runs submitBid/beginEvaluation/settle against the deployment, so it
// implies a near-future deadline unless --deadline/--deadline-in is given.
const e2e = Boolean(args.e2e);
const demoConfig = {
  issuer: args.issuer ?? "AegisBid Wave 1 demo issuer",
  deadline:
    args.deadline ??
    (args["deadline-in"] !== undefined
      ? String(Math.floor(Date.now() / 1000) + Number(args["deadline-in"]))
      : e2e
        ? String(Math.floor(Date.now() / 1000) + 150)
        : new Date(Date.now() + 7 * 86_400_000).toISOString()),
  reserve: args.reserve ?? "1000",
  mode: args.mode ?? "highest",
  spec: args.spec ?? "AegisBid demo specification",
  bidAmount: args["bid-amount"] ?? "1200",
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

// Bid witnesses. Plain deploy uses inert stubs (the constructor never invokes
// witnesses); --e2e uses one real sealed bid exercised through all circuits.
const deployPrivateState = {};
const e2eBid = e2e
  ? {
      amount: BigInt(demoConfig.bidAmount),
      salt: randomBytes(32),
      identitySecret: randomBytes(32),
      bidderKey: randomBytes(32),
    }
  : undefined;
const witnesses = {
  localBidAmount: ({ privateState }) => [privateState, e2eBid?.amount ?? 0n],
  localBidSalt: ({ privateState }) => [privateState, e2eBid?.salt ?? new Uint8Array(32)],
  localIdentitySecret: ({ privateState }) => [privateState, e2eBid?.identitySecret ?? new Uint8Array(32)],
  settlementBid: ({ privateState }) => [privateState, e2eBid?.amount ?? 0n],
  settlementSalt: ({ privateState }) => [privateState, e2eBid?.salt ?? new Uint8Array(32)],
  settlementKey: ({ privateState }) => [privateState, e2eBid?.bidderKey ?? new Uint8Array(32)],
};

let localConfig;
try {
  // StandaloneConfig reads MN_INDEXER_URL / MN_INDEXER_WS / MN_NODE_URL /
  // MN_NODE_WS at construction: CLI flags win over its localhost defaults.
  if (args.indexer) process.env.MN_INDEXER_URL = args.indexer;
  if (args["indexer-ws"]) process.env.MN_INDEXER_WS = args["indexer-ws"];
  if (args.node) process.env.MN_NODE_URL = args.node;
  if (args["node-ws"]) process.env.MN_NODE_WS = args["node-ws"];
  const { StandaloneConfig } = await import(
    pathToFileURL(path.join(localDevDir, "src", "config.ts")).href
  );
  const base = new StandaloneConfig();
  // StandaloneConfig hardcodes networkId='undeployed' (and setNetworkId's it
  // in its constructor). For public networks, shadow the network fields while
  // keeping the prototype (envConfig) intact.
  localConfig =
    network === "undeployed"
      ? base
      : Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
          networkId: network,
        });
} catch {
  fail(
    `cannot load StandaloneConfig from ${localDevDir}/src/config.ts. ` +
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

midnight.networkId.setNetworkId(network);
// Throwaway-wallet friendly: MIDNIGHT_MNEMONIC (24 words, env only, never a
// file) takes precedence over the hex seed. Either way the secret never
// touches disk or the repo.
const ctx = process.env.MIDNIGHT_MNEMONIC
  ? await buildWallet(localConfig, { kind: "mnemonic", value: process.env.MIDNIGHT_MNEMONIC })
  : await buildWalletFromHexSeed(localConfig, seed);

if (args["print-address"]) {
  const addr = ctx.unshieldedKeystore.getBech32Address().asString();
  console.log(`unshielded address (${network}): ${addr}`);
  await closeWallet(ctx).catch(() => undefined);
  process.exit(0);
}

if (args.balance) {
  const { displayWalletBalances, waitForSync } = walletHelpers;
  if (!displayWalletBalances) fail("local-dev wallet.js lacks displayWalletBalances.");
  if (waitForSync && !args["no-sync-wait"]) {
    console.log("waiting for wallet sync to complete...");
    await waitForSync(ctx.wallet);
    console.log("sync complete");
  }
  const balances = await displayWalletBalances(ctx, localConfig);
  console.log(`balances (${network}): ${JSON.stringify(balances)}`);
  await closeWallet(ctx).catch(() => undefined);
  process.exit(0);
}
if (network !== "undeployed" && !process.env.MIDNIGHT_PS_PASSWORD) {
  await closeWallet(ctx).catch(() => undefined);
  fail("public networks need MIDNIGHT_PS_PASSWORD (16+ chars, mixed classes).");
}
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
  const readState = async (label) => {
    const onChain = await providers.publicDataProvider.queryContractState(contractAddress);
    const decoded = ledger(onChain.data);
    console.log(
      `${label}: phase=${decoded.phase} commitments=${decoded.commitments.size()} ` +
        `nullifiers=${decoded.nullifiers.size()} settled=${decoded.settlement.is_some}`,
    );
    return decoded;
  };
  await readState("on-chain state");

  if (e2e && e2eBid) {
    const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
    const submit = await found.callTx.submitBid(e2eBid.bidderKey, nowSec());
    console.log(`submitBid ok: tx=${submit.public.txId} block=${submit.public.blockHeight}`);
    await readState("after submitBid");

    const waitMs = Number(ledgerConfig.deadline) * 1000 - Date.now() + 3000;
    if (waitMs > 0) {
      console.log(`waiting ${Math.ceil(waitMs / 1000)}s for the deadline...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    const evaluated = await found.callTx.beginEvaluation(nowSec());
    console.log(`beginEvaluation ok: tx=${evaluated.public.txId}`);
    await readState("after beginEvaluation");

    const settled = await found.callTx.settle(0n, 1n, nowSec());
    console.log(`settle ok: tx=${settled.public.txId}`);
    const final = await readState("after settle");
    const receipt = final.settlement.value;
    console.log(
      `receipt: winnerCommitment=${Buffer.from(receipt.winnerCommitment).toString("hex")} ` +
        `winningValue=${receipt.winningValue} ` +
        `comparisonRoot=${Buffer.from(receipt.comparisonRoot).toString("hex")} ` +
        `settledAt=${receipt.settledAt}`,
    );
    await appendFile(
      path.join(root, "managed", "E2E-RECEIPT.txt"),
      [
        `network=${network} contract=${contractAddress}`,
        `winnerCommitment=${Buffer.from(receipt.winnerCommitment).toString("hex")}`,
        `winningValue=${receipt.winningValue}`,
        `comparisonRoot=${Buffer.from(receipt.comparisonRoot).toString("hex")}`,
        `settledAt=${receipt.settledAt}`,
        "",
      ].join("\n"),
    );
    console.log("recorded receipt in managed/E2E-RECEIPT.txt");
  }
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
