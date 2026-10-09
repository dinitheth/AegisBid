import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FileCheck2,
  LockKeyhole,
  Menu,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatCountdown,
  generateNonce,
  matchesSavedBidToWinner,
  normalizeStoredBids,
  type StoredBid,
  type Tender,
} from "./protocol";
import {
  beginEvaluation,
  makeCommitment,
  settle,
  TenderError,
  type BidWitness,
  type SettlementReceipt,
  type TenderState,
} from "./tenderEngine";
import {
  buildTenderStateForSettlement,
  friendlySettlementError,
  parseReserveToBigInt,
  storedBidToWitness,
  uiTenderToConfig,
} from "./evaluator";
import { formatConnectorDust } from "./wallet";
import {
  fetchLatestBlockTime,
  getChainConfig,
  isConfigured,
  loadPublishedTenders,
  parseSharedTender,
  savePublishedTenders,
} from "./chain";
import { Component, Suspense, lazy, type ReactNode } from "react";
import { useChainTenders, type ChainTenders } from "./useChainTenders";
import {
  OneAmWalletProvider,
  connectDetectedWallet,
  refreshDetectedWallet,
  detectWalletConnectors,
  friendlyWalletError,
  useOneAmWallet,
} from "./midnight/oneAmWallet";
import { stringToBytes32 } from "./midnight/contract";
import { decryptSettlementWitness, encryptSettlementWitness } from "./witnessPackage";
import logo from "@/assets/aegisbid-logo.png";

// WASM-backed Midnight modules must never evaluate during SSR (their loader
// does a7327 readFileSync that only exists in the browser bundle). Lazy-load
// the deploy page so the chain stays client-side.
const DeployPage = lazy(() =>
  import("./midnight/DeployPage").then((mod) => ({ default: mod.DeployPage })),
);

// A failed live-deploy chunk must not expose browser/build diagnostics to
// users. Keep the details in the console for developers and offer recovery.
class DeployErrorBoundary extends Component<
  { children: ReactNode; onBack: () => void },
  { failure: string | null }
> {
  override state = { failure: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: Error) {
    console.error("Unable to load the live deploy page", error);
  }
  override render() {
    if (this.state.failure) {
      return (
        <div className="mx-auto max-w-2xl px-5 py-12 text-center">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            This page couldn’t be loaded
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This may be a temporary connection issue or a recent update. Refresh the page and try
            again.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>Refresh page</Button>
            <Button onClick={this.props.onBack}>Back to home</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type Page =
  | "home"
  | "tenders"
  | "bid"
  | "bids"
  | "compare"
  | "settle"
  | "deploy"
  | "balance"
  | "results"
  | "about";
type SubmittedBid = StoredBid;
const BID_STORAGE_KEY = "aegis-bid-history";
const HOME_IMAGE_URL =
  "https://res.cloudinary.com/rmwlrytk/image/upload/v1789543574/AegisBid_ghaotn.webp";

function loadBids(): SubmittedBid[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BID_STORAGE_KEY);
    // A rejected preflight never creates a tender bid or a network
    // transaction. Older releases recorded those failed attempts beside real
    // offers, which made activity look as though the tender had rejected a
    // bid. Keep the history truthful: it contains submitted offers only.
    return normalizeStoredBids(raw ? (JSON.parse(raw) as unknown) : []).filter(
      (bid) => bid.accepted,
    );
  } catch {
    return [];
  }
}

function formatMoment(value: number) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function shortAddress(address: string) {
  return address.length > 16 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address;
}

/** Preloads the lightweight deploy form; proving code remains click-only. */
function preloadDeployChunk() {
  void import("./midnight/DeployPage").catch(() => {
    /* loaded on demand when actually navigated to */
  });
}

/** Start downloading the transaction runtime when a bidder opens an active tender. */
function preloadBidTransactionStack() {
  void (async () => {
    // Do this client-side, before importing packages that reference Buffer.
    // A static polyfill import leaks the CommonJS browser shim into SSR.
    const { ensureBrowserBuffer } = await import("./midnight/polyfills");
    ensureBrowserBuffer();
    await import("./midnight/providers");
  })().catch(() => {
    /* Submit still retries this import and surfaces a useful error. */
  });
}

function HeaderConnectButton({
  oneAm,
  onMissing,
}: {
  oneAm: ReturnType<typeof useOneAmWallet>;
  onMissing: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const entry = detectWalletConnectors()[0];
  const connectHere = async () => {
    if (!entry) {
      onMissing();
      return;
    }
    setConnecting(true);
    try {
      const { api, info } = await connectDetectedWallet(entry);
      oneAm.setConnected(api, info);
    } catch {
      // Rejection/timeout: stay put. The wallet already explained itself;
      // the deploy page keeps full install and retry guidance.
    } finally {
      setConnecting(false);
    }
  };
  return (
    <Button
      className="h-10 rounded-xl px-4 shadow-sm"
      onClick={() => void connectHere()}
      disabled={connecting}
      onMouseEnter={preloadDeployChunk}
      onFocus={preloadDeployChunk}
    >
      <Wallet />
      {connecting ? "Connecting..." : "Connect 1AM"}
    </Button>
  );
}

function WalletButton({ onMissing }: { onMissing: () => void }) {
  const oneAm = useOneAmWallet();
  if (oneAm.info) {
    return (
      <div
        className="hidden h-10 items-center gap-2 rounded-xl border border-border bg-card/85 px-3 shadow-sm sm:flex"
        title={oneAm.info.unshieldedAddress}
      >
        <Wallet className="size-4 text-primary" />
        <div className="leading-tight">
          <p className="font-mono text-xs text-foreground">
            {shortAddress(oneAm.info.unshieldedAddress)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {oneAm.info.walletName} · {oneAm.info.networkId}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Disconnect 1AM wallet"
          onClick={oneAm.disconnect}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }
  return <HeaderConnectButton oneAm={oneAm} onMissing={onMissing} />;
}

const navItems: { id: Page; label: string }[] = [
  { id: "tenders", label: "Open tenders" },
  { id: "bids", label: "Bid history" },
  { id: "compare", label: "Compare bids" },
  { id: "settle", label: "Settlement" },
  { id: "balance", label: "Wallet balance" },
  { id: "results", label: "Results" },
  { id: "about", label: "How it works" },
];

function Brand({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      className="h-11 shrink-0 gap-2.5 rounded-xl px-1.5 pr-3"
      onClick={onClick}
      aria-label="AegisBid home"
    >
      <img src={logo} alt="" width={1024} height={1024} className="size-9 rounded-lg" />
      <span className="font-display text-xl font-semibold text-foreground">AegisBid</span>
    </Button>
  );
}

function StatusPill({ status }: { status: Tender["status"] }) {
  const label =
    status === "Active"
      ? "Open for bids"
      : status === "Evaluating"
        ? "Choosing a winner"
        : "Completed";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${status === "Active" || status === "Settled" ? "bg-success/12 text-success" : "bg-warning/14 text-warning"}`}
    >
      {label}
    </span>
  );
}

function TenderCard({ tender, onOpen }: { tender: Tender; onOpen: (tender: Tender) => void }) {
  return (
    <article className="group rounded-lg border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/35 hover:shadow-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <StatusPill status={tender.status} />
          <h3 className="mt-3 font-display text-xl font-semibold text-card-foreground">
            {tender.title}
          </h3>
          <p className="mt-1 text-sm text-card-foreground/70">Offered by {tender.issuer}</p>
        </div>
        <div className="sm:text-right">
          <p className="font-display text-lg font-semibold text-primary">
            {tender.threshold.replace("tDUST", "credits")}
          </p>
          <p className="mt-1 text-xs text-card-foreground/60">Published price limit</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-card-foreground/70">{tender.specification}</p>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-card-foreground/60">Closes</dt>
          <dd className="mt-1 text-sm font-semibold text-card-foreground">
            {formatCountdown(tender.deadline)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-card-foreground/60">Private bids</dt>
          <dd className="mt-1 text-sm font-semibold text-card-foreground">
            {tender.commitments} received
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs text-card-foreground/60">Selection</dt>
          <dd className="mt-1 text-sm font-semibold text-card-foreground">
            {tender.mode === "Lowest compliant"
              ? "Lowest eligible offer"
              : "Highest eligible offer"}
          </dd>
        </div>
      </dl>
      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-card-foreground/60">
          <LockKeyhole className="size-3.5 text-success" />
          Bid amounts stay private
        </p>
        <Button onClick={() => onOpen(tender)} disabled={tender.status !== "Active"}>
          {tender.status === "Active" ? "Review and bid" : "View details"}
          <ArrowRight />
        </Button>
      </div>
    </article>
  );
}

function Home({
  onBrowse,
  onLearn,
  onOpen,
  tenders,
}: {
  onBrowse: () => void;
  onLearn: () => void;
  onOpen: (tender: Tender) => void;
  tenders: Tender[];
}) {
  // Home teases only the two latest — the full list lives one click away.
  const open = tenders.filter((tender) => tender.status === "Active").slice(0, 2);
  return (
    <>
      <section className="relative min-h-[34rem] overflow-hidden border-b border-border bg-hero">
        <img
          src={HOME_IMAGE_URL}
          alt="A bright architectural gateway above calm water"
          className="absolute inset-0 size-full object-cover object-[70%_center]"
          fetchPriority="high"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-hero via-hero/95 to-hero/10 sm:via-hero/80 sm:to-transparent"
          aria-hidden="true"
        />
        <div className="ocean-grid absolute inset-0 opacity-70" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex min-h-[34rem] max-w-6xl items-center px-5 py-16 sm:py-24 lg:py-28">
          <div className="w-full max-w-2xl">
            <div className="inline-flex w-fit items-center rounded-full border border-primary/15 bg-card/80 px-3 py-1.5 shadow-sm">
              <p className="text-xs font-semibold text-primary">
                Fair tenders. Private offers. Clear results.
              </p>
            </div>
            <h1 className="mt-7 max-w-3xl font-display text-4xl font-semibold leading-[1.08] text-foreground sm:text-6xl">
              Private bidding,
              <br className="hidden sm:block" /> made simple.
            </h1>
            <p className="mt-6 max-w-xl text-lg font-medium leading-8 text-muted-foreground">
              Find an opportunity, send your best offer, and follow the result. Your price stays
              hidden while bidding is open.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-12 rounded-xl px-6 shadow-md" onClick={onBrowse}>
                Browse open tenders
                <ArrowRight />
              </Button>
              <Button
                size="lg"
                className="h-12 rounded-xl bg-card px-6"
                variant="outline"
                onClick={onLearn}
              >
                See how it works
              </Button>
            </div>
            <div className="mt-12 grid gap-4 border-t border-primary/10 pt-7 text-sm font-medium text-muted-foreground sm:grid-cols-3 lg:mt-16">
              <span className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-card shadow-sm">
                  <ShieldCheck className="size-4 text-success" />
                </span>
                Offers stay sealed
              </span>
              <span className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-card shadow-sm">
                  <FileCheck2 className="size-4 text-success" />
                </span>
                Rules are checked fairly
              </span>
              <span className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-card shadow-sm">
                  <Check className="size-4 text-success" />
                </span>
                Results can be verified
              </span>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-primary">Three clear steps</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">
            From opportunity to outcome
          </h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            AegisBid handles the privacy work in the background. You only need to choose, offer, and
            follow the result.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            [
              "1",
              "Choose a tender",
              "Read the requirements, closing date, and selection rule before you take part.",
            ],
            [
              "2",
              "Send your private offer",
              "Enter your amount and confirm. Other bidders cannot see your price.",
            ],
            [
              "3",
              "Follow the result",
              "When bidding closes, the rules select a winner without revealing losing offers.",
            ],
          ].map(([number, title, text]) => (
            <article key={number} className="rounded-lg border border-border bg-card p-6">
              <span className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary">
                {number}
              </span>
              <h3 className="mt-5 font-display text-lg font-semibold text-card-foreground">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-card-foreground/70">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-section">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-primary">Open now</p>
              <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">
                Available opportunities
              </h2>
            </div>
            <Button variant="ghost" onClick={onBrowse}>
              View all tenders
              <ArrowRight />
            </Button>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {open.map((tender) => (
              <TenderCard key={tender.id} tender={tender} onOpen={onOpen} />
            ))}
          </div>
          {open.length === 0 && (
            <p className="mt-8 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              No open tenders right now. Publish one to open bidding.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function Tenders({
  onOpen,
  onPublish,
  chain,
}: {
  onOpen: (tender: Tender) => void;
  onPublish: () => void;
  chain: ChainTenders;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All" | Tender["status"]>("Active");
  const tenders = chain.tenders.filter(
    (tender) =>
      (filter === "All" || tender.status === filter) &&
      `${tender.title} ${tender.issuer}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Tender directory</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">
        Find an opportunity
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Compare requirements and closing dates. Your offer is only shared when you choose to submit
        it.
      </p>
      <div className="mt-4">
        <Button onClick={onPublish}>
          Publish a new tender
          <ArrowRight />
        </Button>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search tenders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by project or organisation"
            className="pl-9"
          />
        </div>
        <div className="flex rounded-md border border-border bg-muted p-1">
          {(["Active", "Evaluating", "Settled", "All"] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={filter === item ? "secondary" : "ghost"}
              onClick={() => setFilter(item)}
            >
              {item === "Active"
                ? "Open"
                : item === "Evaluating"
                  ? "In review"
                  : item === "Settled"
                    ? "Completed"
                    : "All"}
            </Button>
          ))}
        </div>
      </div>
      <div
        className="nice-scroll mt-6 max-h-[min(58vh,46rem)] overflow-y-auto pr-2 sm:pr-3"
        aria-label="Tender directory results"
      >
        <div className="grid gap-5 lg:grid-cols-2">
          {tenders.map((tender) => (
            <TenderCard key={tender.id} tender={tender} onOpen={onOpen} />
          ))}
        </div>
      </div>
      {tenders.length === 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
          No tenders match your search.
        </div>
      )}
    </div>
  );
}

function BidPage({
  tender,
  onBack,
  onSubmit,
  onGoDeploy,
}: {
  tender: Tender;
  onBack: () => void;
  onSubmit: (bid: SubmittedBid) => void;
  onGoDeploy: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [failureDetail, setFailureDetail] = useState<string | null>(null);
  const oneAm = useOneAmWallet();
  const enough = (() => {
    if (!oneAm.info) return true;
    try {
      return BigInt(oneAm.info.dustBalance) >= 350_000_000_000_000n;
    } catch {
      return false;
    }
  })();
  // Warm the heavy provider chunk while the user reads the form, so live
  // submit doesn't stall on first download.
  useEffect(() => {
    // Give the form a paint first, then warm the WASM-backed transaction
    // stack while the bidder enters their amount. The button therefore does
    // not spend its first click downloading SDK code.
    const timer = window.setTimeout(preloadBidTransactionStack, 0);
    return () => window.clearTimeout(timer);
  }, []);
  // Empty wallets die later with a cryptic ledger error — warn up front.
  const noDust = (() => {
    try {
      return oneAm.info != null && BigInt(oneAm.info.dustBalance) === 0n;
    } catch {
      return false;
    }
  })();
  // The on-chain circuit refuses late bids (DEADLINE_ELAPSED) — check up
  // front so nobody pays for a transaction the contract will reject.
  const biddingClosed = new Date(tender.deadline).getTime() <= Date.now();
  const legacyTender = Boolean(tender.contractAddress && tender.contractVersion !== 2);
  const submit = async () => {
    if (!amount || !agreed || biddingClosed) return;
    setSending(true);
    setFailure(null);
    setFailureDetail(null);
    const submittedAt = Date.now();
    // Binding commitment via the protocol engine (SHA-256 over amount:salt:key),
    // matching the `submitBid` commitment model in contracts/aegis_bid.compact.
    const salt = generateNonce();
    let liveApi = oneAm.api;
    let liveInfo = oneAm.info;
    const liveContract = tender.contractVersion === 2 ? tender.contractAddress : undefined;
    if (liveApi && liveContract) {
      try {
        setStage("Checking the wallet connection...");
        const refreshed = await refreshDetectedWallet(liveInfo?.walletName);
        liveApi = refreshed.api;
        liveInfo = refreshed.info;
        oneAm.setConnected(refreshed.api, refreshed.info);
      } catch (cause) {
        const reason = friendlyWalletError(cause);
        setFailure(reason);
        setStage(null);
        setSending(false);
        return;
      }
    }
    const bidderKey = liveInfo?.unshieldedAddress ?? `local-device:${submittedAt}`;
    const commitment = makeCommitment(BigInt(amount), salt, bidderKey);
    const base = {
      tenderId: tender.id,
      tenderTitle: tender.title,
      tenderStatus: tender.status,
      amount,
      commitment,
      salt,
      bidderKey,
      identitySecret: "",
      submittedAt,
    };
    const liveLabel = liveInfo?.walletName ?? "wallet";
    if (tender.contractAddress && tender.contractVersion !== 2) {
      const reason =
        "This is a legacy tender and cannot accept offers through the V2 proof system. Open a V2 share link to submit a bid.";
      setFailure(reason);
      setSending(false);
      return;
    }
    if (tender.contractAddress && (!liveApi || !liveContract)) {
      setFailure("Connect your 1AM wallet before submitting an on-chain offer.");
      setSending(false);
      return;
    }
    if (liveApi && liveContract) {
      if (biddingClosed) {
        const reason = `Bidding closed on ${new Date(tender.deadline).toLocaleString()} — the contract no longer accepts offers for this tender.`;
        setFailure(reason);
        setSending(false);
        return;
      }
      try {
        setStage("Preparing secure transaction...");
        const { ensureBrowserBuffer } = await import("./midnight/polyfills");
        ensureBrowserBuffer();
        // Dynamic import: the provider stack pulls WASM-backed modules that
        // must never evaluate during SSR.
        const { submitLiveBid } = await import("./midnight/providers");
        setStage(`Submitting sealed bid on preprod (approve in ${liveLabel})`);
        const submission = await submitLiveBid({
          api: liveApi,
          contractAddress: liveContract,
          witnesses: {
            amount: BigInt(amount),
            salt: stringToBytes32(salt),
            bidderKey: stringToBytes32(bidderKey),
          },
          bidderKey: stringToBytes32(bidderKey),
        });
        const txHash = submission.transactionHash;
        onSubmit({
          ...base,
          receipt: txHash,
          commitment: submission.commitment,
          chainCommitment: submission.commitment,
          onChain: true,
          accepted: true,
          note: `Submitted on preprod · tx ${txHash.slice(0, 12)}…`,
        });
      } catch (cause) {
        const reason = friendlyWalletError(cause);
        setFailure(reason);
        const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
        setFailureDetail(detail.slice(0, 800));
        if (import.meta.env.DEV) console.error("Live bid failed:", cause);
      } finally {
        setStage(null);
        setSending(false);
      }
      return;
    }
    try {
      setStage("Sealing your offer on this device");
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (new Date(tender.deadline).getTime() <= submittedAt) {
        throw new Error("Bidding for this tender has already closed.");
      }
      setStage("Creating the privacy proof");
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      const onChain = false;
      const receipt = commitment;
      onSubmit({
        ...base,
        receipt,
        onChain,
        accepted: true,
        note: onChain ? "Accepted by the network" : "Accepted and recorded locally",
      });
    } catch (cause) {
      const reason = friendlyWalletError(cause);
      setFailure(reason);
    } finally {
      setStage(null);
      setSending(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft />
        Back to tenders
      </Button>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-lg border border-border bg-card p-6 sm:p-8">
          <StatusPill status={tender.status} />
          <h1 className="mt-4 font-display text-3xl font-semibold text-card-foreground">
            Submit your offer
          </h1>
          <p className="mt-2 text-card-foreground/70">For {tender.title}</p>
          <p className="mt-1 text-xs font-semibold text-primary">
            {legacyTender
              ? "Legacy tender — V2 bids are unavailable"
              : tender.contractAddress
                ? "Live preprod tender — bids settle on-chain"
                : "Demo tender — bids record locally on this device"}
          </p>
          {legacyTender && (
            <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              This historic tender uses an earlier contract version. Open a V2 tender share link to
              submit a private offer.
            </p>
          )}
          {biddingClosed && (
            <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              Bidding closed on {new Date(tender.deadline).toLocaleString()}. This tender no longer
              accepts offers — on-chain bids would be rejected.
            </p>
          )}
          <div className="mt-6 rounded-md border border-border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
                <Wallet className="size-4 text-primary" />
                Your wallet
              </p>
              {oneAm.info ? (
                <p className="font-mono text-xs text-card-foreground/60">
                  {oneAm.info.walletName} · {shortAddress(oneAm.info.unshieldedAddress)}
                </p>
              ) : (
                <Button size="sm" variant="outline" onClick={onGoDeploy}>
                  Connect 1AM
                </Button>
              )}
            </div>
            <p className="mt-2 text-sm text-card-foreground/70">
              {oneAm.info
                ? `Connected with ${oneAm.info.walletName} on ${oneAm.info.networkId}. Your sealed offer binds to this address.`
                : tender.contractAddress
                  ? "Connect 1AM to bind and submit this private offer on-chain."
                  : "Demo offers can be tested locally; connect 1AM to use the live network."}
            </p>
            {!enough && (
              <p className="mt-2 text-sm text-destructive">
                Your balance is too low to cover the network fee.
              </p>
            )}
            {noDust && (
              <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                This wallet holds no DUST. Fund it from the preprod faucet first — empty wallets
                fail when the transaction is built.
              </p>
            )}
          </div>
          <div className="mt-6 space-y-2">
            <Label htmlFor="bid-amount">Your offer amount</Label>
            <div className="relative">
              <Input
                id="bid-amount"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))}
                placeholder="Enter amount"
                className="h-12 pr-20 text-lg"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-card-foreground/60">
                credits
              </span>
            </div>
            <p className="text-sm text-card-foreground/70">
              The price you offer, in the tender&apos;s credits. Credits are not a token and need no
              balance — just type what you would charge. This amount stays private while bidding is
              open.
            </p>
          </div>
          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/50 p-4">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span className="text-sm leading-6 text-card-foreground">
              I have reviewed the requirements and confirm this is my final offer.
            </span>
          </label>
          <Button
            size="lg"
            className="mt-6 w-full"
            disabled={!amount || !agreed || sending || !enough || biddingClosed || legacyTender}
            onClick={() => void submit()}
          >
            {sending
              ? (stage ?? "Working...")
              : legacyTender
                ? "V2 tender required"
                : "Submit private offer"}
            <LockKeyhole />
          </Button>
          {failure && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {failure}
            </p>
          )}
        </section>
        <aside className="self-start rounded-lg border border-border bg-section p-6">
          <h2 className="font-display text-xl font-semibold text-foreground">Before you submit</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Organisation</dt>
              <dd className="mt-1 font-semibold text-foreground">{tender.issuer}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Closes</dt>
              <dd className="mt-1 font-semibold text-foreground">
                {formatCountdown(tender.deadline)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Winner selected by</dt>
              <dd className="mt-1 font-semibold text-foreground">
                {tender.mode === "Lowest compliant"
                  ? "Lowest eligible offer"
                  : "Highest eligible offer"}
              </dd>
            </div>
          </dl>
          <div className="mt-6 rounded-md border border-primary/20 bg-accent p-4">
            <p className="flex items-center gap-2 font-semibold text-primary">
              <ShieldCheck className="size-4" />
              Your privacy
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              AegisBid sends a sealed proof of your offer. Your exact amount is not shown to other
              bidders.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BidHistory({
  bids,
  onBrowse,
  onClear,
}: {
  bids: SubmittedBid[];
  onBrowse: () => void;
  onClear: () => void;
}) {
  const [witnessPassphrases, setWitnessPassphrases] = useState<Record<string, string>>({});
  const [witnessExportError, setWitnessExportError] = useState<Record<string, string>>({});
  const exportWitness = async (bid: SubmittedBid, key: string) => {
    setWitnessExportError((items) => ({ ...items, [key]: "" }));
    try {
      const content = await encryptSettlementWitness(bid, witnessPassphrases[key] ?? "");
      const url = URL.createObjectURL(new Blob([content], { type: "application/octet-stream" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `aegisbid-witness-${bid.tenderId.slice(0, 8)}-${bid.submittedAt}.aegis-witness`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setWitnessExportError((items) => ({
        ...items,
        [key]: cause instanceof Error ? cause.message : "Could not create the encrypted file.",
      }));
    }
  };
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Your activity</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Bid history</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Every offer you have sent from this device, with its sealed reference, the time it was sent,
        and whether it was accepted.
      </p>
      {bids.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-card p-10 text-center">
          <LockKeyhole className="mx-auto size-8 text-primary" />
          <h2 className="mt-4 font-display text-xl font-semibold text-card-foreground">
            No bids yet
          </h2>
          <p className="mt-2 text-sm text-card-foreground/70">
            When you submit a private offer, it will appear here.
          </p>
          <Button className="mt-5" onClick={onBrowse}>
            Browse open tenders
          </Button>
        </div>
      ) : (
        <>
          <div
            className="nice-scroll mt-8 max-h-[min(56vh,46rem)] space-y-4 overflow-y-auto pr-2 sm:pr-3"
            aria-label="Bid history list"
          >
            {bids.map((bid) => (
              <article
                key={`${bid.commitment}-${bid.submittedAt}`}
                className="rounded-lg border border-border bg-card p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <StatusPill status={bid.tenderStatus} />
                    <h2 className="mt-3 font-display text-xl font-semibold text-card-foreground">
                      {bid.tenderTitle}
                    </h2>
                    <p className="mt-1 text-sm text-card-foreground/70">
                      {bid.accepted
                        ? bid.note
                        : friendlyWalletError(bid.note || "The offer was not completed.")}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${bid.accepted ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive"}`}
                  >
                    {bid.accepted ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                    {bid.accepted ? "Accepted" : "Rejected"}
                  </span>
                </div>
                <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-xs text-card-foreground/60">Sealed reference</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-card-foreground">
                      {bid.onChain
                        ? (bid.chainCommitment ?? "Unavailable for this offer")
                        : bid.commitment}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-card-foreground/60">Sent at</dt>
                    <dd className="mt-1 text-sm font-semibold text-card-foreground">
                      {formatMoment(bid.submittedAt)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-card-foreground/60">
                      {bid.onChain ? "Network transaction" : "Confirmation"}
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs text-card-foreground">
                      {bid.receipt}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs text-card-foreground/60">
                  Your offer amount stays private and is never shown here to anyone else.
                </p>
                {bid.onChain && bid.accepted && (
                  <details className="mt-4 rounded-md border border-border bg-muted/30 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-card-foreground">
                      Prepare settlement witness file
                    </summary>
                    <p className="mt-2 text-xs leading-5 text-card-foreground/70">
                      After bidding closes, the issuer needs every bid&apos;s original witness to
                      prove the result. Protect this file with a strong passphrase and send the
                      passphrase separately. The evaluator can learn the bid amount.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input
                        type="password"
                        autoComplete="new-password"
                        aria-label="Passphrase for encrypted settlement witness"
                        placeholder="Passphrase (12+ characters)"
                        value={witnessPassphrases[String(bid.submittedAt)] ?? ""}
                        onChange={(event) =>
                          setWitnessPassphrases((items) => ({
                            ...items,
                            [String(bid.submittedAt)]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        variant="outline"
                        onClick={() => void exportWitness(bid, String(bid.submittedAt))}
                      >
                        Download encrypted file
                      </Button>
                    </div>
                    {witnessExportError[String(bid.submittedAt)] && (
                      <p className="mt-2 text-xs text-destructive">
                        {witnessExportError[String(bid.submittedAt)]}
                      </p>
                    )}
                  </details>
                )}
              </article>
            ))}
          </div>
          <Button variant="ghost" className="mt-6" onClick={onClear}>
            Clear history on this device
          </Button>
        </>
      )}
    </div>
  );
}

function BalancePage({ onGoDeploy }: { onGoDeploy: () => void }) {
  const oneAm = useOneAmWallet();
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Your wallet</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Wallet balance</h1>
      <p className="mt-3 leading-7 text-muted-foreground">
        {oneAm.info
          ? `Connected to your ${oneAm.info.walletName} wallet. Balances are read directly from the wallet.`
          : "Connect 1AM to view your live preprod balance."}
      </p>
      <section className="mt-8 rounded-lg border border-border bg-card p-6 sm:p-8">
        {oneAm.info ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-card-foreground/60">
                  DUST balance ({oneAm.info.walletName} · {oneAm.info.networkId})
                </p>
                <p className="mt-1 font-display text-4xl font-semibold text-card-foreground">
                  {formatConnectorDust(oneAm.info.dustBalance)}{" "}
                  <span className="text-lg text-card-foreground/60">tDUST</span>
                </p>
              </div>
              <Button variant="ghost" onClick={oneAm.disconnect}>
                Disconnect {oneAm.info.walletName}
              </Button>
            </div>
            <dl className="mt-6 space-y-4 border-t border-border pt-5 text-sm">
              <div>
                <dt className="text-card-foreground/60">Wallet address</dt>
                <dd className="mt-1 break-all font-mono text-xs text-card-foreground">
                  {oneAm.info.unshieldedAddress}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="text-center">
            <Wallet className="mx-auto size-8 text-primary" />
            <h2 className="mt-4 font-display text-xl font-semibold text-card-foreground">
              Wallet not connected
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-card-foreground/70">
              Connect your 1AM wallet to see live balances.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={onGoDeploy}>Connect 1AM</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

type CompareRow = { label: string; commitment: string; amount: number };

function ComparePage({ bids, tenders }: { bids: SubmittedBid[]; tenders: Tender[] }) {
  const [reserve, setReserve] = useState("");
  const [rule, setRule] = useState<Tender["mode"]>("Lowest compliant");
  const [tenderId, setTenderId] = useState<string>("all");
  const [manualAmount, setManualAmount] = useState("");
  const [manual, setManual] = useState<CompareRow[]>([]);

  const rows: CompareRow[] = [
    ...bids
      .filter((bid) => tenderId === "all" || bid.tenderId === tenderId)
      .map((bid) => ({
        label: bid.tenderTitle,
        commitment: bid.commitment,
        amount: Number(bid.amount),
      })),
    ...manual,
  ].filter((row) => Number.isFinite(row.amount) && row.amount > 0);

  const reserveValue = Number(reserve);
  const hasReserve = reserve !== "" && Number.isFinite(reserveValue);
  const evaluated = rows.map((row) => ({
    ...row,
    eligible:
      !hasReserve ||
      (rule === "Lowest compliant" ? row.amount <= reserveValue : row.amount >= reserveValue),
  }));
  const eligible = evaluated.filter((row) => row.eligible);
  const winner = eligible.length
    ? eligible.reduce((best, row) =>
        rule === "Lowest compliant"
          ? row.amount < best.amount
            ? row
            : best
          : row.amount > best.amount
            ? row
            : best,
      )
    : null;

  const addManual = () => {
    const amount = Number(manualAmount);
    if (!amount) return;
    const salt = generateNonce();
    setManual((items) => [
      ...items,
      {
        label: "Added by you",
        commitment: makeCommitment(BigInt(amount), salt, `manual-entry:${items.length}`),
        amount,
      },
    ]);
    setManualAmount("");
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Check the outcome</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">
        Compare bids against a reserve price
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Enter the price limit for a tender and see which sealed offers meet it. The winner is chosen
        by the tender's own rule.
      </p>

      <section className="mt-8 grid gap-4 rounded-lg border border-border bg-card p-6 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="reserve">Reserve price</Label>
          <Input
            id="reserve"
            inputMode="numeric"
            value={reserve}
            onChange={(event) => setReserve(event.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 4200000"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule">Selection rule</Label>
          <select
            id="rule"
            value={rule}
            onChange={(event) => setRule(event.target.value as Tender["mode"])}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="Lowest compliant">Lowest offer at or below the limit wins</option>
            <option value="Highest bid">Highest offer at or above the limit wins</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tender-filter">Tender</Label>
          <select
            id="tender-filter"
            value={tenderId}
            onChange={(event) => setTenderId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="all">All of my bids</option>
            {tenders.map((tender) => (
              <option key={tender.id} value={tender.id}>
                {tender.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="manual-amount">Add another offer to compare</Label>
          <Input
            id="manual-amount"
            inputMode="numeric"
            value={manualAmount}
            onChange={(event) => setManualAmount(event.target.value.replace(/\D/g, ""))}
            placeholder="Offer amount"
          />
        </div>
        <div className="flex items-end">
          <Button variant="outline" className="w-full" onClick={addManual} disabled={!manualAmount}>
            Add offer
          </Button>
        </div>
      </section>

      {evaluated.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-10 text-center text-card-foreground/70">
          No offers to compare yet. Submit a bid or add an amount above.
        </div>
      ) : (
        <>
          <div
            className="nice-scroll mt-6 max-h-[min(52vh,34rem)] overflow-auto rounded-lg border border-border bg-card"
            aria-label="Bid comparison results"
          >
            <table className="min-w-[46rem] w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 text-xs text-card-foreground/60 backdrop-blur">
                <tr>
                  <th className="p-4 font-medium">Offer</th>
                  <th className="p-4 font-medium">Sealed reference</th>
                  <th className="p-4 font-medium">Amount</th>
                  <th className="p-4 font-medium">Against the limit</th>
                </tr>
              </thead>
              <tbody>
                {evaluated.map((row) => {
                  const isWinner = winner?.commitment === row.commitment;
                  return (
                    <tr
                      key={row.commitment}
                      className={`border-b border-border last:border-0 ${isWinner ? "bg-success/8" : ""}`}
                    >
                      <td className="p-4 text-card-foreground">
                        {row.label}
                        {isWinner && (
                          <span className="ml-2 rounded-full bg-success/12 px-2 py-0.5 text-xs font-semibold text-success">
                            Winner
                          </span>
                        )}
                      </td>
                      <td className="max-w-[12rem] truncate p-4 font-mono text-xs text-card-foreground/70">
                        {row.commitment}
                      </td>
                      <td className="p-4 font-semibold text-card-foreground">
                        {row.amount.toLocaleString()}
                      </td>
                      <td
                        className={`p-4 font-medium ${row.eligible ? "text-success" : "text-destructive"}`}
                      >
                        {row.eligible ? "Meets the limit" : "Outside the limit"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-6 rounded-lg border border-border bg-section p-6">
            {winner ? (
              <>
                <p className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
                  <ShieldCheck className="size-5 text-success" />
                  Winner: {winner.amount.toLocaleString()} credits
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Sealed reference <span className="font-mono text-xs">{winner.commitment}</span>.
                  Chosen because it is the {rule === "Lowest compliant" ? "lowest" : "highest"}{" "}
                  offer that meets the limit.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No offer meets this reserve price, so no winner can be declared.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type SettlementRecord = {
  tenderId: string;
  tenderTitle: string;
  winnerCommitment: string;
  winningValue: string;
  comparisonRoot: string;
  settledAt: number;
  bidCount: number;
  mode: string;
};

const SETTLEMENT_STORAGE_KEY = "aegis-settlements";

function loadSettlements(): SettlementRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SETTLEMENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SettlementRecord =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>)["tenderId"] === "string" &&
        typeof (entry as Record<string, unknown>)["winnerCommitment"] === "string",
    );
  } catch {
    return [];
  }
}

function SettlementPage({
  bids,
  tenders,
  onSettled,
}: {
  bids: SubmittedBid[];
  tenders: Tender[];
  onSettled: () => Promise<void>;
}) {
  if (tenders.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
        <p className="text-sm font-semibold text-primary">Evaluator flow</p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">
          Settle a tender
        </h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          No tenders available. Publish one first, then return here to evaluate it.
        </p>
      </div>
    );
  }
  return <SettlementWorkbench bids={bids} tenders={tenders} onSettled={onSettled} />;
}

function SettlementWorkbench({
  bids,
  tenders,
  onSettled,
}: {
  bids: SubmittedBid[];
  tenders: Tender[];
  onSettled: () => Promise<void>;
}) {
  const oneAm = useOneAmWallet();
  const fallbackTender = tenders[0] as Tender;
  const [tenderId, setTenderId] = useState(fallbackTender.id);
  const [reserveInput, setReserveInput] = useState("");
  const [manual, setManual] = useState<BidWitness[]>([]);
  const [witnessPassphrase, setWitnessPassphrase] = useState("");
  const [winningIndex, setWinningIndex] = useState(0);
  const [enginePhase, setEnginePhase] = useState<"Open" | "Evaluating" | "Settled">("Open");
  const [engineState, setEngineState] = useState<TenderState | null>(null);
  const [engineCommitments, setEngineCommitments] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<SettlementReceipt | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationStatus, setOperationStatus] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [networkTime, setNetworkTime] = useState<number | null>(null);
  const [history, setHistory] = useState<SettlementRecord[]>(() => loadSettlements());

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTLEMENT_STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* storage full or unavailable */
    }
  }, [history]);

  const tender = tenders.find((item) => item.id === tenderId) ?? fallbackTender;
  const reserveOverride =
    reserveInput.trim() === ""
      ? null
      : /^\d+$/.test(reserveInput.trim())
        ? BigInt(reserveInput.trim())
        : null;
  const reserveInvalid = reserveInput.trim() !== "" && !/^\d+$/.test(reserveInput.trim());
  const liveTender = tender.contractVersion === 2 && Boolean(tender.contractAddress);
  const config = useMemo(
    () => uiTenderToConfig(tender, { reserve: liveTender ? null : reserveOverride }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tender.id,
      tender.issuer,
      tender.deadline,
      tender.threshold,
      tender.mode,
      tender.specification,
      reserveInput,
      liveTender,
    ],
  );
  const defaultReserve = parseReserveToBigInt(tender.threshold);

  useEffect(() => {
    setNetworkTime(null);
    if (!liveTender) {
      return;
    }
    let cancelled = false;
    const refreshNetworkTime = async () => {
      try {
        const walletConfig = oneAm.api ? await oneAm.api.getConfiguration() : null;
        const indexerUrl = walletConfig?.indexerUri || getChainConfig().indexerUrl;
        const timestamp = await fetchLatestBlockTime(indexerUrl);
        if (!cancelled) setNetworkTime(timestamp);
      } catch {
        if (!cancelled) setNetworkTime(null);
      }
    };
    void refreshNetworkTime();
    const timer = window.setInterval(() => void refreshNetworkTime(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [liveTender, oneAm.api, tender.contractAddress]);

  const autoWitnesses = useMemo(
    () =>
      bids
        .filter((bid) => bid.tenderId === tender.id && (!liveTender || bid.onChain))
        .map((bid) => storedBidToWitness(bid))
        .filter((w): w is BidWitness => w !== null),
    [bids, tender.id, liveTender],
  );
  const witnesses = useMemo(() => [...autoWitnesses, ...manual], [autoWitnesses, manual]);
  const commitments = useMemo(
    () => witnesses.map((w) => makeCommitment(w.amount, w.salt, w.bidderKey)),
    [witnesses],
  );
  const eligibility = useMemo(
    () =>
      witnesses.map((w) =>
        config.mode === "highest" ? w.amount >= config.reserve : w.amount <= config.reserve,
      ),
    [witnesses, config],
  );
  const suggestedIndex = useMemo(() => {
    let best: number | null = null;
    witnesses.forEach((w, index) => {
      if (!eligibility[index]) return;
      if (best === null) {
        best = index;
        return;
      }
      const current = witnesses[best as number] as BidWitness;
      if (config.mode === "highest" ? w.amount > current.amount : w.amount < current.amount)
        best = index;
    });
    return best;
  }, [witnesses, eligibility, config.mode]);
  const safeWinningIndex =
    witnesses.length === 0 ? 0 : Math.min(winningIndex, witnesses.length - 1);
  const deadlineReached = liveTender
    ? networkTime !== null && networkTime >= config.deadline
    : Date.now() >= config.deadline;

  const verifyLivePolicy = (ledger: {
    reserve: bigint;
    mode: "highest" | "lowest";
    deadline: bigint;
    latestBlockTime: bigint;
  }) => {
    setNetworkTime(Number(ledger.latestBlockTime) * 1000);
    const expectedDeadline = BigInt(Math.floor(config.deadline / 1000));
    if (
      defaultReserve === null ||
      ledger.reserve !== defaultReserve ||
      ledger.mode !== config.mode ||
      ledger.deadline !== expectedDeadline
    ) {
      throw new Error(
        "This share link’s policy does not match the deployed tender. Ask the issuer for the current V2 share link; no settlement was submitted.",
      );
    }
  };

  const resetEngine = () => {
    setEnginePhase("Open");
    setEngineState(null);
    setEngineCommitments([]);
    setReceipt(null);
    setFailure(null);
    setTransactionHash(null);
    setOperationStatus(null);
  };

  const selectTender = (id: string) => {
    setTenderId(id);
    setNetworkTime(null);
    setManual([]);
    setWitnessPassphrase("");
    setWinningIndex(0);
    setReserveInput("");
    resetEngine();
  };

  const importWitnessFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setFailure(null);
    try {
      const imported: BidWitness[] = [];
      for (const file of Array.from(files)) {
        const item = await decryptSettlementWitness(await file.text(), witnessPassphrase);
        if (item.tenderId !== tender.id) {
          throw new Error(`“${file.name}” belongs to a different tender.`);
        }
        imported.push({ amount: BigInt(item.amount), salt: item.salt, bidderKey: item.bidderKey });
      }
      setManual((items) => {
        const known = new Set(
          [...autoWitnesses, ...items].map((witness) =>
            makeCommitment(witness.amount, witness.salt, witness.bidderKey),
          ),
        );
        const additions = imported.filter((witness) => {
          const id = makeCommitment(witness.amount, witness.salt, witness.bidderKey);
          if (known.has(id)) return false;
          known.add(id);
          return true;
        });
        return [...items, ...additions];
      });
      resetEngine();
      setOperationStatus(`${imported.length} encrypted witness file(s) opened for this tender.`);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not import the witness file.");
    }
  };

  const connectLiveWallet = async () => {
    const refreshed = await refreshDetectedWallet(oneAm.info?.walletName);
    oneAm.setConnected(refreshed.api, refreshed.info);
    return refreshed.api;
  };

  const settlementWitnesses = () =>
    witnesses.map((witness) => ({
      amount: witness.amount,
      salt: stringToBytes32(witness.salt),
      bidderKey: stringToBytes32(witness.bidderKey),
    }));

  const startEvaluation = async () => {
    setFailure(null);
    setOperationStatus(null);
    if (liveTender) {
      setOperationBusy(true);
      try {
        const address = tender.contractAddress as string;
        const secretHex = window.localStorage.getItem(`aegisbid-v2-evaluator-secret:${address}`);
        if (!secretHex) {
          throw new Error(
            "This browser does not have the issuer’s evaluator key for this tender. Use the browser profile that published it.",
          );
        }
        const { ensureBrowserBuffer } = await import("./midnight/polyfills");
        ensureBrowserBuffer();
        const api = await connectLiveWallet();
        const { hexToBytes } = await import("./midnight/contract");
        const { liveTenderPhases, readLiveTenderLedger, submitLiveEvaluatorCall } =
          await import("./midnight/providers");
        const ledger = await readLiveTenderLedger(api, address);
        verifyLivePolicy(ledger);
        if (ledger.latestBlockTime < ledger.deadline) {
          throw new Error(
            "Midnight’s latest block is still before this tender’s deadline. The computer clock may be ahead; evaluation will unlock when the network reaches the deadline. No proof or transaction was submitted.",
          );
        }
        if (ledger.settled || ledger.phase === liveTenderPhases.settled) {
          setEnginePhase("Settled");
          setOperationStatus("This tender is already settled on the network.");
          return;
        }
        if (ledger.commitmentCount > 8n) {
          throw new Error("This tender exceeds the on-chain limit of 8 bids for one settlement.");
        }
        if (BigInt(witnesses.length) !== ledger.commitmentCount) {
          throw new Error(
            `The network has ${ledger.commitmentCount} committed bids, but ${witnesses.length} matching witness file(s) are loaded. Collect every bidder’s encrypted witness before continuing.`,
          );
        }
        if (ledger.phase === liveTenderPhases.evaluating) {
          setEnginePhase("Evaluating");
          setOperationStatus(
            "Evaluation has already started on-chain. You can settle the winner now.",
          );
          return;
        }
        if (ledger.phase !== liveTenderPhases.open) {
          throw new Error("This tender is not open for evaluation on the network.");
        }
        const txHash = await submitLiveEvaluatorCall({
          api,
          contractAddress: address,
          evaluatorSecret: hexToBytes(secretHex),
          settlementBids: settlementWitnesses(),
          circuitId: "beginEvaluation",
          report: setOperationStatus,
        });
        setTransactionHash(txHash);
        setEnginePhase("Evaluating");
        setOperationStatus("Evaluation confirmed on-chain. Choose the optimal offer to settle.");
      } catch (cause) {
        console.error("Live tender evaluation failed", cause);
        setOperationStatus(null);
        const message = cause instanceof Error ? cause.message : "";
        if (/DEADLINE_NOT_REACHED/i.test(message)) {
          setFailure(
            "Midnight’s latest block is still before the deadline, even if this device shows it closed. Wait for a later network block and retry; no transaction was sent.",
          );
        } else {
          setFailure(
            cause instanceof Error && !/\b(at |\.js:\d+|contractstate|verifier key)/i.test(message)
              ? message
              : "We couldn’t start evaluation. Check the wallet connection and tender data, then try again.",
          );
        }
      } finally {
        setOperationBusy(false);
      }
      return;
    }
    try {
      if (witnesses.length === 0)
        throw new Error("Add at least one bid witness before evaluation.");
      const state = buildTenderStateForSettlement(config, witnesses);
      beginEvaluation(state, Date.now());
      // Keep the live engine state for settlement; commitments are the public set.
      setEngineState(state);
      setEngineCommitments([...state.commitments]);
      setEnginePhase("Evaluating");
    } catch (cause) {
      if (cause instanceof TenderError) setFailure(friendlySettlementError(cause.code));
      else {
        console.error("Settlement evaluation could not start", cause);
        setFailure(
          "We couldn’t start the evaluation. Please review the tender details and try again.",
        );
      }
    }
  };

  const settleNow = async () => {
    setFailure(null);
    setOperationStatus(null);
    if (liveTender) {
      setOperationBusy(true);
      try {
        if (suggestedIndex === null) {
          throw new Error("No offer meets this tender’s reserve or ceiling.");
        }
        if (winningIndex !== suggestedIndex) {
          throw new Error("Select the optimal eligible offer before settling this tender.");
        }
        const address = tender.contractAddress as string;
        const secretHex = window.localStorage.getItem(`aegisbid-v2-evaluator-secret:${address}`);
        if (!secretHex) {
          throw new Error("Use the browser profile that published this tender to settle it.");
        }
        const { ensureBrowserBuffer } = await import("./midnight/polyfills");
        ensureBrowserBuffer();
        const api = await connectLiveWallet();
        const { hexToBytes } = await import("./midnight/contract");
        const { liveTenderPhases, readLiveTenderLedger, submitLiveEvaluatorCall } =
          await import("./midnight/providers");
        const ledger = await readLiveTenderLedger(api, address);
        verifyLivePolicy(ledger);
        if (ledger.settled || ledger.phase === liveTenderPhases.settled) {
          throw new Error("This tender is already settled on the network.");
        }
        if (ledger.phase !== liveTenderPhases.evaluating) {
          throw new Error("Start on-chain evaluation after the tender closes before settlement.");
        }
        if (ledger.commitmentCount > 8n || BigInt(witnesses.length) !== ledger.commitmentCount) {
          throw new Error(
            `All ${ledger.commitmentCount} committed bid witness(es) must be loaded before settlement.`,
          );
        }
        if (witnesses.length === 0) throw new Error("Import every bidder’s witness file first.");
        const txHash = await submitLiveEvaluatorCall({
          api,
          contractAddress: address,
          evaluatorSecret: hexToBytes(secretHex),
          settlementBids: settlementWitnesses(),
          circuitId: "settle",
          args: [BigInt(safeWinningIndex), BigInt(witnesses.length)],
          report: setOperationStatus,
        });
        setTransactionHash(txHash);
        setOperationStatus("Settlement transaction confirmed. Verifying the public result…");
        let finalLedger = await readLiveTenderLedger(api, address);
        for (let attempt = 0; !finalLedger.settled && attempt < 8; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          finalLedger = await readLiveTenderLedger(api, address);
        }
        if (!finalLedger.settled || !finalLedger.settlement) {
          throw new Error(
            "The transaction was confirmed, but the indexer has not shown the settlement yet. Keep the transaction reference and refresh Results shortly.",
          );
        }
        const { bytesToHex } = await import("./midnight/providers");
        const confirmedReceipt: SettlementReceipt = {
          winnerCommitment: `0x${bytesToHex(finalLedger.settlement.winnerCommitment)}`,
          winningValue: finalLedger.settlement.winningValue,
          comparisonRoot: `0x${bytesToHex(finalLedger.settlement.comparisonRoot)}`,
          settledAt: Date.now(),
        };
        setReceipt(confirmedReceipt);
        setEnginePhase("Settled");
        setEngineCommitments([...commitments]);
        setHistory((items) =>
          [
            {
              tenderId: tender.id,
              tenderTitle: tender.title,
              winnerCommitment: confirmedReceipt.winnerCommitment,
              winningValue: confirmedReceipt.winningValue.toString(),
              comparisonRoot: confirmedReceipt.comparisonRoot,
              settledAt: confirmedReceipt.settledAt,
              bidCount: witnesses.length,
              mode: tender.mode,
            },
            ...items,
          ].slice(0, 20),
        );
        await onSettled();
        setOperationStatus("Winner confirmed on-chain. Tender Results has been refreshed.");
      } catch (cause) {
        console.error("Live tender settlement failed", cause);
        setOperationStatus(null);
        const message = cause instanceof Error ? cause.message : "";
        setFailure(
          cause instanceof Error && !/\b(at |\.js:\d+|contractstate|verifier key)/i.test(message)
            ? message
            : "We couldn’t settle this tender. Check that every encrypted bid witness is correct, then retry only after checking 1AM activity.",
        );
      } finally {
        setOperationBusy(false);
      }
      return;
    }
    try {
      const state = engineState;
      if (!state || enginePhase !== "Evaluating")
        throw new Error("Start evaluation before settlement.");
      if (witnesses.length !== state.commitments.length) {
        throw new Error("The witness set changed after evaluation started. Restart evaluation.");
      }
      const result = settle(state, {
        winningIndex: safeWinningIndex,
        bids: witnesses,
        now: Date.now(),
      });
      setReceipt(result);
      setEnginePhase("Settled");
      setHistory((items) =>
        [
          {
            tenderId: tender.id,
            tenderTitle: tender.title,
            winnerCommitment: result.winnerCommitment,
            winningValue: result.winningValue.toString(),
            comparisonRoot: result.comparisonRoot,
            settledAt: result.settledAt,
            bidCount: witnesses.length,
            mode: tender.mode,
          },
          ...items,
        ].slice(0, 20),
      );
    } catch (cause) {
      if (cause instanceof TenderError) setFailure(friendlySettlementError(cause.code));
      else {
        console.error("Tender settlement could not be completed", cause);
        setFailure(
          "We couldn’t complete settlement. Please review the selected winner and bid details, then try again.",
        );
      }
    }
  };

  const losingRedacted = receipt
    ? witnesses
        .filter((_, index) => index !== safeWinningIndex)
        .every((w) => !JSON.stringify(receipt).includes(w.amount.toString()))
    : false;

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Evaluator flow</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Settle a tender</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Reconstruct the commitment set, open evaluation after closing, then prove the winner with
        the same on-chain checks. Only the winning value is disclosed.
      </p>

      <section className="mt-8 grid gap-4 rounded-lg border border-border bg-card p-6 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="settle-tender">Tender</Label>
          <select
            id="settle-tender"
            value={tender.id}
            onChange={(event) => selectTender(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {tenders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <p className="text-xs text-card-foreground/60">
            {tender.issuer} · {tender.mode}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settle-reserve">Reserve / ceiling (credits)</Label>
          <Input
            id="settle-reserve"
            inputMode="numeric"
            value={reserveInput}
            disabled={liveTender}
            onChange={(event) => {
              setReserveInput(event.target.value.replace(/\D/g, ""));
              resetEngine();
            }}
            placeholder={defaultReserve !== null ? defaultReserve.toString() : "e.g. 4200000"}
          />
          {liveTender && (
            <p className="text-xs text-card-foreground/60">
              The deployed contract’s reserve is fixed and verified before settlement.
            </p>
          )}
          {reserveInvalid && <p className="text-xs text-destructive">Enter whole numbers only.</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Closing status</Label>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-semibold text-card-foreground">
              {liveTender
                ? networkTime === null
                  ? "Checking Midnight’s block time…"
                  : deadlineReached
                    ? "Closed on Midnight — ready for evaluation"
                    : "Still open on Midnight"
                : deadlineReached
                  ? "Closed — ready for evaluation"
                  : `Open — ${formatCountdown(tender.deadline)} left`}
            </p>
            <p className="mt-1 text-xs text-card-foreground/60">
              Deadline {formatMoment(config.deadline)}
              {liveTender && networkTime !== null && (
                <> · Latest block {formatMoment(networkTime)}</>
              )}
            </p>
            {liveTender && networkTime !== null && !deadlineReached && (
              <p className="mt-2 text-xs text-warning">
                The computer clock may be ahead; the contract allows evaluation only after a later
                Midnight block reaches the deadline.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-card-foreground">
            Bid witnesses ({witnesses.length})
          </h2>
          <div className="flex gap-2">
            {suggestedIndex !== null && (
              <Button size="sm" variant="ghost" onClick={() => setWinningIndex(suggestedIndex)}>
                Select optimal
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-sm text-card-foreground/70">
          {autoWitnesses.length} bid witness(es) loaded from this device · {manual.length} imported
          securely. Before a live settlement, the network commitment count is checked and every
          original bid witness must match. The evaluator can see the bid amounts; they are not
          published in the settlement receipt.
        </p>
        {witnesses.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-sm text-card-foreground/70">
            No witnesses for this tender yet. Submit a bid first, or add one manually.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-card-foreground/60">
                <tr>
                  <th className="p-3 font-medium">Winner</th>
                  <th className="p-3 font-medium">Offer</th>
                  <th className="p-3 font-medium">Sealed reference</th>
                  <th className="p-3 font-medium">Amount</th>
                  <th className="p-3 font-medium">Policy</th>
                </tr>
              </thead>
              <tbody>
                {witnesses.map((w, index) => (
                  <tr
                    key={`${commitments[index]}-${index}`}
                    className={`border-b border-border last:border-0 ${index === safeWinningIndex ? "bg-success/8" : ""}`}
                  >
                    <td className="p-3">
                      <input
                        type="radio"
                        aria-label={`Select offer ${index + 1} as winner`}
                        checked={index === safeWinningIndex}
                        onChange={() => setWinningIndex(index)}
                        className="size-4 accent-primary"
                      />
                    </td>
                    <td className="p-3 text-card-foreground">
                      {index < autoWitnesses.length ? "This device" : "Manual"}
                      {suggestedIndex === index && (
                        <span className="ml-2 rounded-full bg-success/12 px-2 py-0.5 text-xs font-semibold text-success">
                          Optimal
                        </span>
                      )}
                    </td>
                    <td className="max-w-[12rem] truncate p-3 font-mono text-xs text-card-foreground/70">
                      {commitments[index]}
                    </td>
                    <td className="p-3 font-semibold text-card-foreground">
                      {w.amount.toLocaleString()}
                    </td>
                    <td
                      className={`p-3 font-medium ${eligibility[index] ? "text-success" : "text-destructive"}`}
                    >
                      {eligibility[index] ? "Eligible" : "Outside limit"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="witness-passphrase">Witness file passphrase</Label>
            <Input
              id="witness-passphrase"
              type="password"
              autoComplete="current-password"
              value={witnessPassphrase}
              onChange={(event) => setWitnessPassphrase(event.target.value)}
              placeholder="Passphrase from bidder"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="witness-files">Encrypted bid witness file(s)</Label>
            <Input
              id="witness-files"
              type="file"
              multiple
              accept=".aegis-witness"
              onChange={(event) => {
                void importWitnessFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
          <div className="flex items-end text-xs text-card-foreground/60">
            Import each bidder&apos;s original encrypted witness after bidding closes.
          </div>
        </div>
        {!liveTender && (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            This is a local demo tender. Its evaluation receipt is not written to the Midnight
            network.
          </p>
        )}
        {liveTender && (
          <p className="mt-3 text-xs text-card-foreground/60">
            V2 settlement supports up to 8 bids per tender. Bidder files are encrypted in your
            browser with AES-GCM; share the passphrase through a separate trusted channel.
          </p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-section p-6">
        <ol className="flex flex-wrap gap-2 text-xs font-semibold">
          {(["Open", "Evaluating", "Settled"] as const).map((step, index) => {
            const order = { Open: 0, Evaluating: 1, Settled: 2 } as const;
            const active = order[enginePhase] >= order[step];
            return (
              <li
                key={step}
                className={`rounded-full px-3 py-1 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {index + 1}. {step}
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => void startEvaluation()}
            disabled={
              operationBusy ||
              (liveTender && networkTime !== null && !deadlineReached) ||
              (!liveTender && (witnesses.length === 0 || enginePhase !== "Open"))
            }
          >
            {operationBusy
              ? "Please wait…"
              : liveTender
                ? "Start on-chain evaluation"
                : "Run demo evaluation"}
          </Button>
          <Button
            onClick={() => void settleNow()}
            disabled={operationBusy || enginePhase !== "Evaluating"}
            variant="secondary"
          >
            {operationBusy && operationStatus?.toLowerCase().includes("settle")
              ? operationStatus
              : liveTender
                ? "Submit on-chain settlement"
                : "Create demo receipt"}
          </Button>
          <Button onClick={resetEngine} variant="ghost">
            Reset
          </Button>
        </div>
        {operationBusy && (
          <p className="mt-3 text-sm text-muted-foreground" role="status" aria-live="polite">
            {operationStatus ?? "Preparing the evaluation…"} Proof generation may take a few
            minutes. Keep this tab open and approve in 1AM if prompted.
          </p>
        )}
        {operationStatus && !operationBusy && (
          <p className="mt-3 text-sm text-success" role="status">
            {operationStatus}
          </p>
        )}
        {transactionHash && (
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
            Network transaction: {transactionHash}
          </p>
        )}
        {enginePhase === "Evaluating" && !liveTender && (
          <p className="mt-3 text-sm text-muted-foreground">
            {engineCommitments.length} commitments locked for proof. Selecting a non-optimal winner
            will fail closed with NOT_MAXIMUM / NOT_MINIMUM.
          </p>
        )}
        {failure && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {failure}
          </p>
        )}
      </section>

      {receipt && (
        <section className="mt-6 rounded-lg border border-success/30 bg-card p-6">
          <p className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <ShieldCheck className="size-5 text-success" />
            Settlement receipt
          </p>
          <dl className="mt-4 grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-card-foreground/60">Winner commitment</dt>
              <dd className="mt-1 break-all font-mono text-xs text-card-foreground">
                {receipt.winnerCommitment}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-card-foreground/60">Clearing value</dt>
              <dd className="mt-1 font-display text-2xl font-semibold text-card-foreground">
                {receipt.winningValue.toLocaleString()} credits
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-card-foreground/60">Comparison root</dt>
              <dd className="mt-1 break-all font-mono text-xs text-card-foreground">
                {receipt.comparisonRoot}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-card-foreground/60">Settled at</dt>
              <dd className="mt-1 font-semibold text-card-foreground">
                {formatMoment(receipt.settledAt)} · {witnesses.length} bids proven
              </dd>
            </div>
          </dl>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-center gap-2 text-card-foreground/80">
              <Check className="size-4 text-success" />
              Winner membership proven against {engineCommitments.length} commitments
            </li>
            <li className="flex items-center gap-2 text-card-foreground/80">
              <Check className="size-4 text-success" />
              Ordering ({tender.mode}) and reserve / ceiling policy satisfied
            </li>
            <li className="flex items-center gap-2 text-card-foreground/80">
              <Check className="size-4 text-success" />
              {losingRedacted
                ? "Losing amounts absent from the public receipt"
                : "Receipt discloses only the winning value"}
            </li>
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-6 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold text-card-foreground">
              Recent settlements
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setHistory([])}>
              Clear
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {history.map((record) => (
              <article
                key={`${record.winnerCommitment}-${record.settledAt}`}
                className="rounded-md border border-border p-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-card-foreground">{record.tenderTitle}</p>
                  <p className="font-display font-semibold text-primary">
                    {Number(record.winningValue).toLocaleString()} credits
                  </p>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-card-foreground/60">
                  {record.winnerCommitment} · {record.bidCount} bids ·{" "}
                  {formatMoment(record.settledAt)}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Results({ tenders, bids }: { tenders: Tender[]; bids: StoredBid[] }) {
  const completed = tenders.filter((tender) => tender.status !== "Active");
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Transparent outcomes</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Tender results</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        See which tenders are being reviewed and which have finished. Losing offers remain private.
      </p>
      <div className="mt-8 space-y-4">
        {completed.map((tender) => {
          const youWon = matchesSavedBidToWinner(tender, bids);
          return (
            <article key={tender.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <StatusPill status={tender.status} />
                  <h2 className="mt-3 font-display text-xl font-semibold text-card-foreground">
                    {tender.title}
                  </h2>
                  <p className="mt-1 text-sm text-card-foreground/70">{tender.issuer}</p>
                </div>
                <div className="sm:text-right">
                  <p
                    className={`text-xs ${tender.status === "Settled" ? "text-success" : "text-card-foreground/60"}`}
                  >
                    Outcome
                  </p>
                  <p
                    className={`mt-1 font-semibold ${tender.status === "Settled" ? "text-success" : "text-card-foreground"}`}
                  >
                    {youWon
                      ? "You won this tender!"
                      : tender.status === "Settled"
                        ? "Winner confirmed"
                        : "Review in progress"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm text-card-foreground/70">
                <ShieldCheck className="size-4 text-success" />
                {youWon
                  ? "Your saved offer matches the winning on-chain commitment. The award itself is handled by the issuer."
                  : "Selection rules verified; non-winning prices stay hidden."}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">About AegisBid</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">
        A fairer way to submit sealed offers
      </h1>
      <p className="mt-5 text-lg leading-8 text-muted-foreground">
        AegisBid lets organisations collect offers without showing each bidder what others have
        proposed. After closing, the published rule selects the right offer and produces a checkable
        result.
      </p>
      <div className="mt-10 space-y-4">
        {[
          [
            "Your price remains yours",
            "Your offer is sealed before it leaves your device. Other bidders cannot use it to adjust their own price.",
          ],
          [
            "The rule cannot quietly change",
            "Each tender states how a winner will be chosen before bidding starts.",
          ],
          [
            "Losing offers stay private",
            "The result confirms that the rules were followed without publishing every submitted amount.",
          ],
        ].map(([title, text]) => (
          <article key={title} className="rounded-lg border border-border bg-card p-6">
            <h2 className="font-display text-xl font-semibold text-card-foreground">{title}</h2>
            <p className="mt-2 leading-7 text-card-foreground/70">{text}</p>
          </article>
        ))}
      </div>
      <div className="mt-8 rounded-lg border border-border bg-section">
        <button
          className="flex w-full items-center justify-between gap-4 p-5 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span>
            <span className="block font-semibold text-foreground">Technical details</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              For auditors and developers
            </span>
          </span>
          <ChevronDown
            className={`size-5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="border-t border-border p-5 text-sm leading-7 text-muted-foreground">
            <p>
              AegisBid uses zero-knowledge proofs on Midnight Network. A public commitment confirms
              that an offer exists, while its amount and private witness remain off the public
              ledger. Settlement proofs verify ordering and eligibility without revealing losing
              values.
            </p>
            <p className="mt-3 font-mono text-xs">Compact circuits · Live on Midnight preprod</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SiteFooter({
  onNavigate,
  chain,
}: {
  onNavigate: (page: Page) => void;
  chain: ChainTenders;
}) {
  const year = new Date().getFullYear();
  const platformLinks: { id: Page; label: string }[] = [
    { id: "tenders", label: "Open tenders" },
    { id: "bids", label: "Bid history" },
    { id: "compare", label: "Compare bids" },
    { id: "settle", label: "Settlement" },
    { id: "balance", label: "Wallet balance" },
  ];
  const learnLinks: { id: Page; label: string }[] = [
    { id: "results", label: "Results" },
    { id: "about", label: "How it works" },
  ];
  const connected = isConfigured(getChainConfig());
  return (
    <footer className="border-t border-border bg-section">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <img src={logo} alt="" width={1024} height={1024} className="size-9 rounded-lg" />
              <span className="font-display text-xl font-semibold text-foreground">AegisBid</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
              Private bidding with clear outcomes. Offers stay sealed on your device, and winners
              are chosen by rules set before bidding starts.
            </p>
          </div>
          <nav aria-label="Footer: platform">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Platform
            </h2>
            <ul className="mt-4 space-y-2.5">
              {platformLinks.map((link) => (
                <li key={link.id}>
                  <button
                    className="text-sm text-card-foreground/80 transition-colors hover:text-primary"
                    onClick={() => onNavigate(link.id)}
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Footer: learn">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Learn
            </h2>
            <ul className="mt-4 space-y-2.5">
              {learnLinks.map((link) => (
                <li key={link.id}>
                  <button
                    className="text-sm text-card-foreground/80 transition-colors hover:text-primary"
                    onClick={() => onNavigate(link.id)}
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Network status
            </h2>
            <div className="mt-4 rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                <span
                  className={`inline-block size-2 rounded-full ${connected ? "bg-success" : "bg-warning"}`}
                  aria-hidden="true"
                />
                {connected ? "Connected to Midnight Network" : "Not connected"}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {connected
                  ? "Tenders, bids and results are read from the live ledger."
                  : "Tender data is unavailable until the network is reachable."}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-4 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {year} AegisBid. Built on Midnight Network. Offers and results handled under the
            platform terms shown with each tender.
          </span>
          <span>
            Sealed offers · Verified results · Losing prices stay private ·{" "}
            <span className="font-mono" title="Built source commit">
              {typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "local"}
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function AegisUserApp() {
  const [page, setPage] = useState<Page>("home");
  const [selected, setSelected] = useState<Tender | null>(null);
  const [bids, setBids] = useState<SubmittedBid[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const chain = useChainTenders();
  const [hydratedBids, setHydratedBids] = useState(false);
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.removeItem("aegis-theme");
    setBids(loadBids());
    setHydratedBids(true);
    // Tender share links (?contract=<addr>&issuer=&deadline=&mode=&reserve=):
    // import the public policy into this device's publish history so a shared
    // tender lists, counts live bids, and stays biddable here. Idempotent.
    const shared = parseSharedTender(window.location.search);
    if (shared) {
      const known = loadPublishedTenders();
      if (!known.some((entry) => entry.address === shared.address)) {
        savePublishedTenders([shared, ...known].slice(0, 20));
      }
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  useEffect(() => {
    if (hydratedBids) window.localStorage.setItem(BID_STORAGE_KEY, JSON.stringify(bids));
  }, [bids, hydratedBids]);
  const navigate = (next: Page) => {
    setPage(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openTender = (tender: Tender) => {
    if (tender.status === "Active") preloadBidTransactionStack();
    setSelected(tender);
    navigate(tender.status === "Active" ? "bid" : "results");
  };
  const activeLabel = useMemo(() => navItems.find((item) => item.id === page)?.label, [page]);
  return (
    <OneAmWalletProvider>
      <main className="min-h-screen bg-background text-foreground">
        <header className="fixed inset-x-0 top-0 z-40 px-2 pt-2 sm:px-5 sm:pt-4">
          <div className="notch-navbar mx-auto w-full max-w-7xl">
            <div className="grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 sm:gap-3 sm:px-5">
              <Brand onClick={() => navigate("home")} />
              <nav
                className="hidden min-w-0 items-center justify-center gap-0.5 min-[1280px]:flex"
                aria-label="Main navigation"
              >
                {navItems.map((item) => (
                  <Button
                    key={item.id}
                    className={`notch-nav-item h-10 shrink-0 rounded-lg px-2.5 text-[13px] min-[1440px]:px-3 ${page === item.id ? "is-active" : ""}`}
                    variant="ghost"
                    onClick={() => navigate(item.id)}
                    aria-current={page === item.id ? "page" : undefined}
                  >
                    {item.label}
                  </Button>
                ))}
              </nav>
              <div className="flex shrink-0 items-center gap-1.5">
                <WalletButton onMissing={() => navigate("deploy")} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-[1280px]:hidden"
                  onClick={() => setMenuOpen((value) => !value)}
                  aria-label={menuOpen ? "Close navigation" : "Open navigation"}
                >
                  {menuOpen ? <X /> : <Menu />}
                </Button>
              </div>
            </div>
            {menuOpen && (
              <nav
                className="absolute inset-x-0 top-[calc(100%+0.5rem)] grid gap-1 rounded-xl border border-border bg-card p-2 shadow-lg min-[1280px]:hidden"
                aria-label="Mobile navigation"
              >
                {navItems.map((item) => (
                  <Button
                    key={item.id}
                    className="w-full justify-start rounded-lg"
                    variant={page === item.id ? "secondary" : "ghost"}
                    onClick={() => navigate(item.id)}
                  >
                    {item.label}
                  </Button>
                ))}
              </nav>
            )}
          </div>
        </header>
        <div className="h-20" aria-hidden="true" />
        {activeLabel && page !== "home" && page !== "bid" && (
          <div className="border-b border-border bg-section">
            <div className="mx-auto max-w-6xl px-5 py-2 text-xs text-muted-foreground">
              AegisBid / {activeLabel}
            </div>
          </div>
        )}
        {page === "home" && (
          <Home
            onBrowse={() => navigate("tenders")}
            onLearn={() => navigate("about")}
            onOpen={openTender}
            tenders={chain.tenders}
          />
        )}
        {page === "tenders" && (
          <Tenders onOpen={openTender} onPublish={() => navigate("deploy")} chain={chain} />
        )}
        {page === "bid" && selected && (
          <BidPage
            tender={selected}
            onBack={() => navigate("tenders")}
            onGoDeploy={() => navigate("deploy")}
            onSubmit={(bid) => {
              setBids((items) => [bid, ...items]);
              navigate("bids");
            }}
          />
        )}
        {page === "bids" && (
          <BidHistory
            bids={bids}
            onBrowse={() => navigate("tenders")}
            onClear={() => setBids([])}
          />
        )}
        {page === "compare" && <ComparePage bids={bids} tenders={chain.tenders} />}
        {page === "settle" && (
          <SettlementPage bids={bids} tenders={chain.tenders} onSettled={chain.refresh} />
        )}
        {page === "deploy" && (
          <DeployErrorBoundary onBack={() => navigate("home")}>
            <Suspense fallback={null}>
              <DeployPage />
            </Suspense>
          </DeployErrorBoundary>
        )}
        {page === "balance" && <BalancePage onGoDeploy={() => navigate("deploy")} />}
        {page === "results" && <Results tenders={chain.tenders} bids={bids} />}
        {page === "about" && <HowItWorks />}
        <SiteFooter onNavigate={navigate} chain={chain} />
      </main>
    </OneAmWalletProvider>
  );
}
