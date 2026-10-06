/**
 * Live deployment through a browser wallet (preprod): Lace preferred, 1AM
 * fallback. Both speak the Midnight DApp connector protocol
 * (`window.midnight[<walletId>].connect`), so detection just scans the
 * injected keys. Providers: FetchZkConfigProvider for the hosted proving
 * keys, indexer provider from the wallet's own config, proving delegated to
 * the wallet when it offers (1AM/ProofStation sponsors fees: user pays 0
 * NIGHT/DUST) or to the local proof server otherwise (Lace requires it via
 * Docker: `VITE_PROOF_SERVER_URL`, default `http://127.0.0.1:6300`).
 *
 * ZK artifacts come from `VITE_ZK_CONFIG_BASE` (default: jsDelivr for the
 * committed `managed/aegis-bid` outputs).
 */
import { ensureBrowserBuffer } from "./polyfills";
import { useEffect, useState } from "react";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildLaceProviders, buildOneAmProviders, toBindingTenderConfig } from "./providers";
import { formatConnectorDust } from "../wallet";

import {
  detectWalletConnectors,
  useOneAmWallet,
  type DetectedWallet,
  type OneAmInitialApi,
  type WalletKind,
} from "./oneAmWallet";

// Bump on every deploy-flow change so screenshots identify the bundle.
const BUILD_ID = "2026-09-21C-lace-primary";

function defaultDeadlineInput() {
  const date = new Date(Date.now() + 7 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type PublishedTender = {
  address: string;
  issuer: string;
  mode: "highest" | "lowest";
  reserve: string;
  deadline: string;
  deployedAt: number;
};

const PUBLISHED_KEY = "aegis-published-tenders";

function loadPublished(): PublishedTender[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PUBLISHED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PublishedTender =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>)["address"] === "string",
    );
  } catch {
    return [];
  }
}

export function DeployPage() {
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const { api, info, setConnected } = useOneAmWallet();
  const [published, setPublished] = useState<PublishedTender[]>(() => loadPublished());
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
      const found = detectWalletConnectors();
      if (!cancelled && found.length > 0) {
        setWallets(found);
        return true;
      }
      return false;
    };
    if (check()) return;
    // Wallets may inject after lock/unlock or install: keep polling softly.
    const timer = window.setInterval(() => {
      if (check()) window.clearInterval(timer);
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detectTick]);

  // A wallet extension can hang when its own backend is unreachable (1AM's
  // full-page UI then shows "Wallet init timed out ... serverSideScan=true").
  // Never wait forever: surface a clear message instead.
  const CONNECT_TIMEOUT_MS = 90_000;
  const connect = async (kind: WalletKind) => {
    const entry = wallets.find((item) => item.kind === kind);
    if (!entry) return;
    setBusy(true);
    setFailure(null);
    try {
      setStatus(`Waiting for ${entry.label} approval...`);
      const connected = (await Promise.race([
        entry.initial.connect("preprod"),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () =>
              reject(
                new Error(
                  `${entry.label} did not respond in 90s. The wallet extension itself may be stuck ` +
                    "initializing (its page shows a vault/scan timeout when its backend is " +
                    "unreachable). Check your connection, reload the extension, then try again.",
                ),
              ),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ])) as Awaited<ReturnType<OneAmInitialApi["connect"]>>;
      const [config, unshielded, dust] = await Promise.all([
        connected.getConfiguration(),
        connected.getUnshieldedAddress(),
        connected.getDustBalance(),
      ]);
      setConnected(connected, {
        networkId: config.networkId,
        unshieldedAddress: unshielded.unshieldedAddress,
        dustBalance: String(dust.balance),
        walletName: entry.label,
      });
      setStatus(null);
    } catch (cause) {
      setFailure(
        cause instanceof Error ? cause.message : `${entry.label} connection was declined.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const deploy = async () => {
    if (!api) return;
    ensureBrowserBuffer();
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
          if (
            !/rate|429|limit|timeout|network|fetch|econn|socket/i.test(message) ||
            attempt === 3
          ) {
            throw new Error(`${label}: ${message}`);
          }
          setStatus(`Rate-limited during ${label} — retry ${attempt}/3...`);
          await sleep(attempt * 4000);
        }
      }
      throw new Error(`${label}: ${last instanceof Error ? last.message : String(last)}`);
    };
    try {
      step = "connecting providers";
      setStatus("Downloading proving keys (one-time, ~14 MB)...");
      const walletLabel = info?.walletName === "Lace" ? "Lace" : "1AM";
      const { providers, compiled, provingVia } = await withRetry("connecting providers", () =>
        walletLabel === "Lace" ? buildLaceProviders(api) : buildOneAmProviders(api),
      );
      if (provingVia === "proof-server") {
        setStatus("Wallet delegates proving: using your local proof server...");
      }

      step = "building the deployment transaction";
      setStatus("Building the deployment transaction...");
      const ledgerConfig = toBindingTenderConfig({
        issuer,
        deadlineSec: BigInt(Math.floor(new Date(deadline).getTime() / 1000)),
        reserve: BigInt(reserve === "" ? "0" : reserve),
        mode,
        spec,
      });

      step = `proving via ${walletLabel} (approve in the wallet)`;
      setStatus(`Proving via ${walletLabel} (approve in the wallet)...`);
      const deployed = await deployContract(providers, {
        compiledContract: compiled,
        args: [ledgerConfig],
      } as Parameters<typeof deployContract>[1]);
      const address: string = deployed.deployTxData.public.contractAddress;
      setContractAddress(address);
      setPublished((items) => {
        const record: PublishedTender = {
          address,
          issuer,
          mode,
          reserve: reserve === "" ? "0" : reserve,
          deadline: new Date(deadline).toISOString(),
          deployedAt: Date.now(),
        };
        const next = [record, ...items.filter((item) => item.address !== address)].slice(0, 20);
        try {
          window.localStorage.setItem(PUBLISHED_KEY, JSON.stringify(next));
        } catch {
          /* private mode etc. */
        }
        return next;
      });
      setStatus(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Deployment failed.";
      const stack =
        cause instanceof Error && cause.stack ? cause.stack.split("\n").slice(0, 4).join("\n") : "";
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
      <p className="text-sm font-semibold text-primary">Preprod · Lace or 1AM wallet</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">
        Publish an opportunity
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Publish a shielded tender that bidders can find in the explorer. Your policy (deadline,
        limit, selection rule) goes on-chain as a verifiable contract — bid amounts stay private.
        With 1AM, proving and fees are sponsored, so publishing costs you nothing. With Lace,
        proving runs on your local proof server (required by Lace — run it via Docker) and fees come
        from your tDUST.
      </p>

      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-xl font-semibold text-card-foreground">
          1 · Connect wallet
        </h2>
        {wallets.length === 0 ? (
          <div className="mt-2 text-sm text-card-foreground/70">
            <p>
              No wallet detected yet. Install Lace (with Midnight support) or 1AM from{" "}
              <a
                className="underline"
                href="https://1am.xyz/install-beta"
                target="_blank"
                rel="noreferrer"
              >
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
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-card-foreground/60">Wallet</dt>
              <dd className="mt-1 font-semibold text-card-foreground">{info.walletName}</dd>
            </div>
            <div>
              <dt className="text-xs text-card-foreground/60">Network</dt>
              <dd className="mt-1 font-semibold text-card-foreground">{info.networkId}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-card-foreground/60">Unshielded address</dt>
              <dd className="mt-1 break-all font-mono text-xs text-card-foreground">
                {info.unshieldedAddress}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-card-foreground/60">DUST balance</dt>
              <dd className="mt-1 font-semibold text-card-foreground">
                {formatConnectorDust(info.dustBalance)}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            {wallets.map((entry) => (
              <Button key={entry.kind} onClick={() => void connect(entry.kind)} disabled={busy}>
                {busy ? "Waiting..." : `Connect ${entry.label} (preprod)`}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-xl font-semibold text-card-foreground">
          2 · Tender policy
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="deploy-issuer">Issuer label (hashed to Bytes&lt;32&gt; on-chain)</Label>
            <Input id="deploy-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deploy-deadline">Bidding deadline</Label>
            <Input
              id="deploy-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deploy-reserve">Reserve / ceiling (credits)</Label>
            <Input
              id="deploy-reserve"
              inputMode="numeric"
              value={reserve}
              onChange={(e) => setReserve(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deploy-mode">Selection rule</Label>
            <select
              id="deploy-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as "highest" | "lowest")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
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
          <h2 className="font-display text-xl font-semibold text-foreground">3 · Publish</h2>
          <span className="font-mono text-[11px] text-muted-foreground">build {BUILD_ID}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="lg" onClick={() => void deploy()} disabled={!api || busy || !deadline}>
            {busy ? (status ?? "Working...") : "Publish opportunity"}
          </Button>
        </div>
        {status && !busy
          ? null
          : status && <p className="mt-3 text-sm text-muted-foreground">{status}</p>}
        {failure && (
          <p className="mt-4 whitespace-pre-wrap break-all rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
            {failure}
          </p>
        )}
        {contractAddress && (
          <div className="mt-4 rounded-md border border-success/30 bg-card p-4">
            <p className="text-xs text-card-foreground/60">Contract address</p>
            <p className="mt-1 break-all font-mono text-sm text-card-foreground">
              {contractAddress}
            </p>
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

      {published.length > 0 && (
        <section className="mt-6 rounded-lg border border-border bg-card p-6">
          <h2 className="font-display text-xl font-semibold text-card-foreground">
            Your published opportunities
          </h2>
          <p className="mt-1 text-sm text-card-foreground/70">
            Tenders you published from this device. Bidders find them in the explorer; amounts stay
            sealed.
          </p>
          <div className="mt-4 space-y-3">
            {published.map((item) => (
              <article key={item.address} className="rounded-md border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-card-foreground">{item.issuer}</p>
                  <p className="font-display font-semibold text-primary">
                    {Number(item.reserve).toLocaleString()} credits ·{" "}
                    {item.mode === "lowest" ? "lowest wins" : "highest wins"}
                  </p>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-card-foreground/60">
                  {item.address}
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-card-foreground/60">
                  <span>Published {new Date(item.deployedAt).toLocaleString()}</span>
                  <a
                    className="underline"
                    href={`https://explorer.1am.xyz/address/${item.address}?network=preprod`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on explorer
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
