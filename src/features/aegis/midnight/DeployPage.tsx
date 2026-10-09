/**
 * Live deployment through the 1AM browser wallet on preprod. It speaks the Midnight DApp connector protocol
 * (`window.midnight[<walletId>].connect`), so detection just scans the
 * injected keys. Providers: FetchZkConfigProvider for the hosted proving
 * keys, indexer provider from the wallet's own config, with proof generation,
 * balancing, and transaction submission delegated to 1AM.
 *
 * ZK artifacts come from `VITE_ZK_CONFIG_BASE` (default: jsDelivr for the
 * committed `managed/aegis-bid-v2` outputs).
 */
import { ensureBrowserBuffer } from "./polyfills";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatConnectorDust } from "../wallet";
import {
  CURRENT_V2_PROOF_CONFIG,
  loadPublishedTenders,
  savePublishedTenders,
  type PublishedTender,
} from "../chain";

import {
  connectDetectedWallet,
  refreshDetectedWallet,
  detectWalletConnectors,
  friendlyWalletError,
  friendlyWalletConnectionError,
  useOneAmWallet,
  type DetectedWallet,
} from "./oneAmWallet";

function defaultDeadlineInput() {
  const date = new Date(Date.now() + 7 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Rotating realistic examples so each new tender starts from a fresh sample. */
type SamplePolicy = {
  issuer: string;
  spec: string;
  reserve: string;
  mode: "highest" | "lowest";
};

const SAMPLE_POLICIES: SamplePolicy[] = [
  {
    issuer: "Municipal Works Department",
    spec: "Road resurfacing — 2 km urban carriageway",
    reserve: "1000",
    mode: "highest",
  },
  {
    issuer: "City Water Board",
    spec: "Supply and install 200 household water meters",
    reserve: "2500",
    mode: "lowest",
  },
  {
    issuer: "Public School District",
    spec: "500 classroom desks with delivery and assembly",
    reserve: "8000",
    mode: "lowest",
  },
  {
    issuer: "Regional Hospital",
    spec: "1,000 cotton bedsheets, hospital grade",
    reserve: "3000",
    mode: "lowest",
  },
  {
    issuer: "Parks Authority",
    spec: "Central park landscaping plus 12-month maintenance",
    reserve: "5000",
    mode: "highest",
  },
];

function randomSampleIndex() {
  return Math.floor(Math.random() * SAMPLE_POLICIES.length);
}

export function DeployPage() {
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const { api, info, setConnected } = useOneAmWallet();
  const [published, setPublished] = useState<PublishedTender[]>(() => loadPublishedTenders());
  const [sampleIndex, setSampleIndex] = useState(randomSampleIndex);
  const sample = (SAMPLE_POLICIES[sampleIndex] ?? SAMPLE_POLICIES[0]) as SamplePolicy;
  const [issuer, setIssuer] = useState(sample.issuer);
  const [deadline, setDeadline] = useState(defaultDeadlineInput);
  const [reserve, setReserve] = useState(sample.reserve);
  const [mode, setMode] = useState<"highest" | "lowest">(sample.mode);
  const [spec, setSpec] = useState(sample.spec);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [failureDetail, setFailureDetail] = useState<string | null>(null);
  const [failureArea, setFailureArea] = useState<"connection" | "publish" | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Keep this screen lightweight. The provider module imports the Midnight
  // ledger WASM runtime, which is only needed after the user chooses to
  // publish. Loading it here used to leave this ordinary form suspended on a
  // slow connection before it could render.

  // Share links carry the public policy so anyone opening one sees the full
  // tender (policy from the link, live counts from the indexer) — no
  // backend registry needed for others to discover it.
  const shareUrlFor = (entry: PublishedTender) => {
    const params = new URLSearchParams({
      contract: entry.address,
      issuer: entry.issuer,
      deadline: entry.deadline,
      mode: entry.mode,
      reserve: entry.reserve,
      v: String(entry.contractVersion ?? 1),
      proof: entry.proofConfig,
    });
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  };

  const copyShareLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const area = document.createElement("textarea");
      area.value = url;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

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

  const connect = async () => {
    const entry = wallets[0];
    if (!entry) return;
    if (publishing) return;
    setConnecting(true);
    setFailure(null);
    setFailureDetail(null);
    setFailureArea(null);
    try {
      setConnectionStatus(
        `Waiting for ${entry.label} approval. Check the wallet extension or its tab — this will stop automatically if it does not respond.`,
      );
      const { api: connectedApi, info } = await connectDetectedWallet(entry);
      setConnected(connectedApi, info);
      setConnectionStatus(null);
    } catch (cause) {
      setFailure(friendlyWalletConnectionError(cause));
      setFailureArea("connection");
      const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
      setFailureDetail(detail.slice(0, 800));
    } finally {
      setConnecting(false);
    }
  };

  const deploy = async () => {
    if (!api) return;
    ensureBrowserBuffer();
    if (connecting) return;
    setPublishing(true);
    setFailure(null);
    setFailureDetail(null);
    setFailureArea(null);
    setPublishStatus(null);
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
          setPublishStatus(`Rate-limited during ${label} — retry ${attempt}/3...`);
          await sleep(attempt * 4000);
        }
      }
      throw new Error(`${label}: ${last instanceof Error ? last.message : String(last)}`);
    };
    try {
      // A connected extension handle is not durable across an extension
      // restart or an abandoned balance request. Refresh it from this click
      // before we create any proof, so the balance request uses a live port.
      step = "refreshing the wallet connection";
      setPublishStatus("Checking the wallet connection...");
      const refreshed = await refreshDetectedWallet(info?.walletName);
      setConnected(refreshed.api, refreshed.info);
      const activeApi = refreshed.api;
      const activeInfo = refreshed.info;
      step = "connecting providers";
      setPublishStatus("Downloading proving keys (one-time, ~14 MB)...");
      const walletLabel = "1AM";
      // V2 stores a commitment to this capability, not the capability itself.
      // It is required to move a tender into evaluation or settle it, so keep
      // a local recovery copy keyed by the deployed address below.
      const evaluatorSecret = crypto.getRandomValues(new Uint8Array(32));
      const deploymentWitnesses = {
        amount: 0n,
        salt: new Uint8Array(32),
        bidderKey: new Uint8Array(32),
        evaluatorSecret,
      };
      const [{ buildOneAmProviders, toBindingTenderConfig, bytesToHex }, { deployContract }] =
        await Promise.all([import("./providers"), import("@midnight-ntwrk/midnight-js-contracts")]);
      const { providers, compiled } = await withRetry("connecting providers", () =>
        buildOneAmProviders(activeApi, deploymentWitnesses, setPublishStatus),
      );

      step = "building the deployment transaction";
      setPublishStatus("Building the deployment transaction...");
      const ledgerConfig = toBindingTenderConfig({
        issuer,
        deadlineSec: BigInt(Math.floor(new Date(deadline).getTime() / 1000)),
        reserve: BigInt(reserve === "" ? "0" : reserve),
        mode,
        spec,
      });

      step = `creating the proof via ${walletLabel}`;
      setPublishStatus(
        `Creating the proof via ${walletLabel}. The approval appears after the proof is ready...`,
      );
      const deployed = await deployContract(providers, {
        compiledContract: compiled,
        args: [ledgerConfig],
      } as never);
      const address: string = deployed.deployTxData.public.contractAddress;
      window.localStorage.setItem(
        `aegisbid-v2-evaluator-secret:${address}`,
        bytesToHex(evaluatorSecret),
      );
      setContractAddress(address);
      const record: PublishedTender = {
        address,
        issuer,
        mode,
        reserve: reserve === "" ? "0" : reserve,
        deadline: new Date(deadline).toISOString(),
        deployedAt: Date.now(),
        contractVersion: 2,
        proofConfig: CURRENT_V2_PROOF_CONFIG,
      };
      setPublished((items) => {
        const next = [record, ...items.filter((item) => item.address !== address)].slice(0, 20);
        savePublishedTenders(next);
        return next;
      });
      // Shared registry: best-effort so everyone else discovers this tender
      // too. Registry failure never fails the publish — it stays local.
      try {
        const { registerTender } = await import("./tenderRegistry.server");
        await registerTender({ data: record });
      } catch {
        /* registry unavailable — local publish still succeeded */
      }
      // Fresh sample for the next tender — the form never repeats itself.
      const upcoming = SAMPLE_POLICIES[(sampleIndex + 1) % SAMPLE_POLICIES.length];
      if (upcoming) {
        setSampleIndex((sampleIndex + 1) % SAMPLE_POLICIES.length);
        setIssuer(upcoming.issuer);
        setSpec(upcoming.spec);
        setReserve(upcoming.reserve);
        setMode(upcoming.mode);
        setDeadline(defaultDeadlineInput());
      }
      setPublishStatus(null);
    } catch (cause) {
      // Full technical detail stays in the console; the screen gets one
      // plain sentence.
      console.error(`Deploy failed during ${step}:`, cause);
      const friendly =
        step === "refreshing the wallet connection"
          ? friendlyWalletConnectionError(cause)
          : friendlyWalletError(cause);
      const hint = /rate|429|limit/i.test(String(cause))
        ? " Public services are busy — wait a minute and retry."
        : "";
      setFailure(`Could not publish. ${friendly}${hint}`);
      setFailureArea("publish");
      const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
      setFailureDetail(detail.slice(0, 800));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Preprod · 1AM wallet</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">
        Publish an opportunity
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Describe the work, set a closing date and a minimum price, then publish it for bidders.
      </p>

      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-xl font-semibold text-card-foreground">
          1 · Connect wallet
        </h2>
        {wallets.length === 0 ? (
          <div className="mt-2 text-sm text-card-foreground/70">
            <p>
              No 1AM wallet detected yet. Install 1AM from{" "}
              <a
                className="underline"
                href="https://chromewebstore.google.com/detail/1am/bphnkdkcnfhompoegfpgnkidcjfbojjp"
                target="_blank"
                rel="noreferrer"
              >
                the Chrome Web Store
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
            <div>
              <dt className="text-xs text-card-foreground/60">Wallet</dt>
              <dd className="mt-1 font-semibold text-card-foreground">{info.walletName}</dd>
            </div>
            <div>
              <dt className="text-xs text-card-foreground/60">Network</dt>
              <dd className="mt-1 font-semibold text-card-foreground">{info.networkId}</dd>
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
            {wallets.slice(0, 1).map((entry) => (
              <Button
                key={entry.kind}
                onClick={() => void connect()}
                disabled={connecting || publishing}
              >
                {connecting ? "Waiting for wallet..." : `Connect ${entry.label} (preprod)`}
              </Button>
            ))}
          </div>
        )}
        {connectionStatus && (
          <p className="mt-3 text-sm text-muted-foreground">{connectionStatus}</p>
        )}
        {failureArea === "connection" && failure && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {failure}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-xl font-semibold text-card-foreground">
          2 · Tender policy
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="deploy-issuer">Issuer name</Label>
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
            <p className="text-xs leading-5 text-card-foreground/60">
              Lowest offer you will accept, in the tender&apos;s own credits — the same unit bidders
              type as their offer amount. Not tDUST: tDUST only pays network fees.
            </p>
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
        <h2 className="font-display text-xl font-semibold text-foreground">3 · Publish</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="lg"
            onClick={() => void deploy()}
            disabled={!api || connecting || publishing || !deadline}
          >
            {publishing ? (publishStatus ?? "Working...") : "Publish opportunity"}
          </Button>
        </div>
        {publishStatus && <p className="mt-3 text-sm text-muted-foreground">{publishStatus}</p>}
        {failureArea === "publish" && failure && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {failure}
          </p>
        )}
        {contractAddress &&
          (() => {
            const record = published.find((item) => item.address === contractAddress);
            const url = record ? shareUrlFor(record) : null;
            return (
              <div className="mt-4 rounded-md border border-success/30 bg-card p-4">
                <p className="text-xs text-card-foreground/60">Contract address</p>
                <p className="mt-1 break-all font-mono text-sm text-card-foreground">
                  {contractAddress}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <a
                    className="text-sm underline"
                    href={`https://explorer.1am.xyz/address/${contractAddress}?network=preprod`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on 1AM explorer
                  </a>
                  {url && (
                    <Button size="sm" variant="outline" onClick={() => void copyShareLink(url)}>
                      {copied ? "Link copied!" : "Copy share link"}
                    </Button>
                  )}
                </div>
                {url && (
                  <p className="mt-2 text-xs text-card-foreground/60">
                    Anyone opening the link sees this tender listed with live bid counts.
                  </p>
                )}
              </div>
            );
          })()}
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
          <div className="nice-scroll mt-4 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
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
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-card-foreground/60">
                  <span>Published {new Date(item.deployedAt).toLocaleString()}</span>
                  <a
                    className="underline"
                    href={`https://explorer.1am.xyz/address/${item.address}?network=preprod`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on explorer
                  </a>
                  <button
                    className="underline"
                    onClick={() => void copyShareLink(shareUrlFor(item))}
                  >
                    {copied ? "Link copied!" : "Copy share link"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
