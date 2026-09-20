/**
 * Live deployment through the 1AM browser wallet (preprod).
 *
 * Follows the 1AM integration reference (1am.xyz/ai.txt): detect
 * `window.midnight['1am']`, connect, build providers (FetchZkConfigProvider
 * for the hosted proving keys, indexer provider from the wallet's own
 * config, proving/balance/submit delegated to the wallet), then the standard
 * `deployContract` call. ProofStation sponsors fees: user pays 0 NIGHT/DUST.
 *
 * ZK artifacts come from `VITE_ZK_CONFIG_BASE` (default: jsDelivr for the
 * committed `managed/aegis-bid` outputs).
 */
import "./polyfills";
import { useEffect, useState } from "react";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import {
  Contract,
  TenderMode,
} from "../../../../managed/aegis-bid/contract/index.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hexToBytes, stringToBytes32 } from "./contract";

type OneAmInitialApi = {
  name?: string;
  apiVersion?: string;
  connect: (networkId: string) => Promise<OneAmConnectedApi>;
};

type OneAmConnectedApi = {
  getConfiguration: () => Promise<{
    networkId: string;
    indexerUri: string;
    indexerWsUri: string;
  }>;
  getShieldedAddresses: () => Promise<{
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  getUnshieldedAddress: () => Promise<{ unshieldedAddress: string }>;
  getDustBalance: () => Promise<{ balance: bigint | number | string }>;
  getProvingProvider: (keyProvider: unknown) => Promise<unknown>;
  balanceUnsealedTransaction: (txHex: string) => Promise<{ tx: string }>;
  submitTransaction: (txHex: string) => Promise<unknown>;
};

type WalletInfo = {
  networkId: string;
  unshieldedAddress: string;
  dustBalance: string;
};

const ZK_BASE =
  (import.meta.env["VITE_ZK_CONFIG_BASE"] as string | undefined) ||
  "https://cdn.jsdelivr.net/gh/dinitheth/AegisBid@main/managed/aegis-bid";

// Bump on every deploy-flow change so screenshots identify the bundle.
const BUILD_ID = "2026-09-20C-buffer-global+stack";

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function detectOneAm(): OneAmInitialApi | null {
  const injected = (window as unknown as { midnight?: Record<string, unknown> }).midnight?.[
    "1am"
  ];
  if (!injected || typeof injected !== "object") return null;
  const candidate = injected as Partial<OneAmInitialApi>;
  return typeof candidate.connect === "function" ? (candidate as OneAmInitialApi) : null;
}

function defaultDeadlineInput() {
  const date = new Date(Date.now() + 7 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DeployPage() {
  const [wallet, setWallet] = useState<OneAmInitialApi | null>(null);
  const [api, setApi] = useState<OneAmConnectedApi | null>(null);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [issuer, setIssuer] = useState("AegisBid Wave 1 demo issuer");
  const [deadline, setDeadline] = useState(defaultDeadlineInput);
  const [reserve, setReserve] = useState("1000");
  const [mode, setMode] = useState<"highest" | "lowest">("highest");
  const [spec, setSpec] = useState("AegisBid demo specification");
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [detectTick, setDetectTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const found = detectOneAm();
      if (!cancelled && found) {
        setWallet(found);
        return true;
      }
      return false;
    };
    if (check()) return;
    // 1AM may inject after lock/unlock or install: keep polling softly.
    const timer = window.setInterval(() => {
      if (check()) window.clearInterval(timer);
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detectTick]);

  const connect = async () => {
    if (!wallet) return;
    setBusy(true);
    setFailure(null);
    try {
      setStatus("Waiting for 1AM approval...");
      const connected = await wallet.connect("preprod");
      const [config, unshielded, dust] = await Promise.all([
        connected.getConfiguration(),
        connected.getUnshieldedAddress(),
        connected.getDustBalance(),
      ]);
      setApi(connected);
      setInfo({
        networkId: config.networkId,
        unshieldedAddress: unshielded.unshieldedAddress,
        dustBalance: String(dust.balance),
      });
      setStatus(null);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "1AM connection was declined.");
    } finally {
      setBusy(false);
    }
  };

  const deploy = async () => {
    if (!api) return;
    setBusy(true);
    setFailure(null);
    setContractAddress(null);
    let step = "starting";
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Key download + proving have no chain effects: safe to retry on 429s.
    const withRetry = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
      let last: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          return await fn();
        } catch (error) {
          last = error;
          const message = error instanceof Error ? error.message : String(error);
          if (!/rate|429|limit|timeout|network|fetch|econn|socket/i.test(message) || attempt === 3) {
            throw new Error(`${label}: ${message}`);
          }
          setStatus(`Rate-limited during ${label} — retry ${attempt}/3...`);
          await sleep(attempt * 4000);
        }
      }
      throw new Error(`${label}: ${last instanceof Error ? last.message : String(last)}`);
    };
    try {
      const config = await api.getConfiguration();
      setNetworkId(config.networkId || "preprod");

      step = "downloading proving keys";
      setStatus("Downloading proving keys (one-time, ~14 MB)...");
      const zkConfigProvider = new FetchZkConfigProvider(ZK_BASE, fetch.bind(window));
      const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);

      step = "waiting for 1AM approval";
      setStatus("Waiting for 1AM approval...");
      const provingProvider = await withRetry("getProvingProvider", () =>
        api.getProvingProvider(zkConfigProvider),
      );
      const proofProvider = {
        async proveTx(unprovenTx: {
          prove: (prover: unknown, cost: unknown) => Promise<unknown>;
        }) {
          return withRetry("proving", async () => {
            const { CostModel } = await import("@midnight-ntwrk/ledger-v8");
            return unprovenTx.prove(provingProvider, CostModel.initialCostModel());
          });
        },
      };
      const keys = await api.getShieldedAddresses();
      const walletProvider = {
        getCoinPublicKey: () => keys.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => keys.shieldedEncryptionPublicKey,
        async balanceTx(tx: { serialize: () => Uint8Array }) {
          const result = await api.balanceUnsealedTransaction(bytesToHex(tx.serialize()));
          const { Transaction } = await import("@midnight-ntwrk/ledger-v8");
          return Transaction.deserialize(
            "signature",
            "proof",
            "binding",
            hexToBytes(result.tx),
          );
        },
      };
      const midnightProvider = {
        async submitTx(tx: { serialize: () => Uint8Array; identifiers: () => string[] }) {
          await api.submitTransaction(bytesToHex(tx.serialize()));
          return tx.identifiers()[0] ?? "";
        },
      };

      step = "building the deployment transaction";
      setStatus("Building the deployment transaction...");
      const witnesses = {
        localBidAmount: ({ privateState }: { privateState: unknown }) => [privateState, 0n],
        localBidSalt: ({ privateState }: { privateState: unknown }) => [privateState, new Uint8Array(32)],
        localIdentitySecret: ({ privateState }: { privateState: unknown }) => [
          privateState,
          new Uint8Array(32),
        ],
        settlementBid: ({ privateState }: { privateState: unknown }) => [privateState, 0n],
        settlementSalt: ({ privateState }: { privateState: unknown }) => [privateState, new Uint8Array(32)],
        settlementKey: ({ privateState }: { privateState: unknown }) => [privateState, new Uint8Array(32)],
      };
      const compiled = CompiledContract.withCompiledFileAssets(
        CompiledContract.withWitnesses(CompiledContract.make("aegisbid", Contract), witnesses),
        "./managed/aegis-bid",
      );
      const ledgerConfig = {
        issuer: stringToBytes32(issuer),
        deadline: BigInt(Math.floor(new Date(deadline).getTime() / 1000)),
        reserve: BigInt(reserve === "" ? "0" : reserve),
        mode: mode === "lowest" ? TenderMode.LowestCompliant : TenderMode.HighestBid,
        specificationRoot: stringToBytes32(spec),
      };

      step = "proving via 1AM (approve in the wallet)";
      setStatus("Proving via 1AM (approve in the wallet)...");
      const deployed = await deployContract(
        {
          publicDataProvider,
          zkConfigProvider,
          proofProvider,
          walletProvider,
          midnightProvider,
        } as Parameters<typeof deployContract>[0],
        { compiledContract: compiled, args: [ledgerConfig] } as Parameters<
          typeof deployContract
        >[1],
      );
      setContractAddress(deployed.deployTxData.public.contractAddress);
      setStatus(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Deployment failed.";
      const stack =
        cause instanceof Error && cause.stack
          ? cause.stack.split("\n").slice(0, 4).join("\n")
          : "";
      const hint = /rate|429|limit/i.test(message)
        ? " Public infra is throttling — wait a minute and retry."
        : "";
      setFailure(`Failed during ${step}: ${message}.${hint}${stack ? `\n${stack}` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Preprod · 1AM wallet</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Deploy live</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Deploys <span className="font-mono text-xs">contracts/aegis_bid.compact</span> to Midnight
        preprod through your 1AM wallet. Proving and fees are sponsored — you pay nothing.
      </p>

      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-xl font-semibold text-card-foreground">1 · Connect wallet</h2>
        {!wallet ? (
          <div className="mt-2 text-sm text-card-foreground/70">
            <p>
              1AM wallet not detected yet. Install it from{" "}
              <a className="underline" href="https://1am.xyz/install-beta" target="_blank" rel="noreferrer">
                1am.xyz/install-beta
              </a>
              , switch it to preprod, unlock it, then{" "}
              <button className="underline" onClick={() => setDetectTick((n) => n + 1)}>
                check again
              </button>
              . This page keeps listening automatically.
            </p>
          </div>
        ) : info && api ? (
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-card-foreground/60">Network</dt><dd className="mt-1 font-semibold text-card-foreground">{info.networkId}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-card-foreground/60">Unshielded address</dt><dd className="mt-1 break-all font-mono text-xs text-card-foreground">{info.unshieldedAddress}</dd></div>
            <div><dt className="text-xs text-card-foreground/60">DUST balance</dt><dd className="mt-1 font-semibold text-card-foreground">{info.dustBalance}</dd></div>
          </dl>
        ) : (
          <Button className="mt-4" onClick={() => void connect()} disabled={busy}>
            {busy ? "Waiting..." : "Connect 1AM (preprod)"}
          </Button>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-xl font-semibold text-card-foreground">2 · Tender policy</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="deploy-issuer">Issuer label (hashed to Bytes&lt;32&gt; on-chain)</Label>
            <Input id="deploy-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deploy-deadline">Bidding deadline</Label>
            <Input id="deploy-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deploy-reserve">Reserve / ceiling (credits)</Label>
            <Input id="deploy-reserve" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deploy-mode">Selection rule</Label>
            <select id="deploy-mode" value={mode} onChange={(e) => setMode(e.target.value as "highest" | "lowest")} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="highest">Highest bid at or above reserve</option>
              <option value="lowest">Lowest offer at or below ceiling</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deploy-spec">Specification reference</Label>
            <Input id="deploy-spec" value={spec} onChange={(e) => setSpec(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-section p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-foreground">3 · Deploy</h2>
          <span className="font-mono text-[11px] text-muted-foreground">build {BUILD_ID}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="lg" onClick={() => void deploy()} disabled={!api || busy || !deadline}>
            {busy ? (status ?? "Working...") : "Deploy to preprod"}
          </Button>
        </div>
        {status && !busy ? null : status && <p className="mt-3 text-sm text-muted-foreground">{status}</p>}
        {failure && <p className="mt-4 whitespace-pre-wrap break-all rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">{failure}</p>}
        {contractAddress && (
          <div className="mt-4 rounded-md border border-success/30 bg-card p-4">
            <p className="text-xs text-card-foreground/60">Contract address</p>
            <p className="mt-1 break-all font-mono text-sm text-card-foreground">{contractAddress}</p>
            <a
              className="mt-2 inline-block text-sm underline"
              href={`https://explorer.1am.xyz/address/${contractAddress}?network=preprod`}
              target="_blank"
              rel="noreferrer"
            >
              View on 1AM explorer
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
