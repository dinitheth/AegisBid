import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Award,
  Check,
  ChevronDown,
  FileCheck2,
  History,
  Info,
  LayoutGrid,
  LockKeyhole,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { NotchNavbar, type NotchNavEntry } from "@/components/NotchNavbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultTender, formatCountdown, generateNonce, initialTenders, normalizeStoredBids, type StoredBid, type Tender } from "./protocol";
import { beginEvaluation, makeCommitment, settle, TenderError, type BidWitness, type SettlementReceipt, type TenderState } from "./tenderEngine";
import { buildTenderStateForSettlement, friendlySettlementError, parseReserveToBigInt, storedBidToWitness, uiTenderToConfig } from "./evaluator";
import { useMidnightWallet } from "./wallet";
import { getChainConfig, isConfigured } from "./chain";
import { Suspense, lazy } from "react";
import { useChainTenders, type ChainTenders } from "./useChainTenders";
import { OneAmWalletProvider, useOneAmWallet } from "./midnight/oneAmWallet";
import logo from "@/assets/aegisbid-logo.png";

// WASM-backed Midnight modules must never evaluate during SSR (their loader
// does a7327 readFileSync that only exists in the browser bundle). Lazy-load
// the deploy page so the chain stays client-side.
const DeployPage = lazy(() =>
  import("./midnight/DeployPage").then((mod) => ({ default: mod.DeployPage })),
);

type Page = "home" | "tenders" | "bid" | "bids" | "compare" | "settle" | "deploy" | "balance" | "results" | "about";
type SubmittedBid = StoredBid;
type WalletState = ReturnType<typeof useMidnightWallet>;

const BID_STORAGE_KEY = "aegis-bid-history";
const HOME_IMAGE_URL = "https://res.cloudinary.com/rmwlrytk/image/upload/v1789543574/AegisBid_ghaotn.webp";

function loadBids(): SubmittedBid[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BID_STORAGE_KEY);
    return normalizeStoredBids(raw ? (JSON.parse(raw) as unknown) : []);
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

function WalletButton({ wallet, onMissing }: { wallet: WalletState; onMissing: () => void }) {
  const oneAm = useOneAmWallet();
  if (oneAm.info) {
    return (
      <div className="hidden h-10 items-center gap-2 rounded-xl border border-border bg-card/85 px-3 shadow-sm sm:flex" title={oneAm.info.unshieldedAddress}>
        <Wallet className="size-4 text-primary" />
        <div className="leading-tight">
          <p className="font-mono text-xs text-foreground">{shortAddress(oneAm.info.unshieldedAddress)}</p>
          <p className="text-[11px] text-muted-foreground">1AM · {oneAm.info.networkId}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Disconnect 1AM wallet" onClick={oneAm.disconnect}>
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }
  if (wallet.connected && wallet.wallet) {
    return (
      <div className="hidden h-10 items-center gap-2 rounded-xl border border-border bg-card/85 px-3 shadow-sm sm:flex">
        <Wallet className="size-4 text-primary" />
        <div className="leading-tight">
          <p className="font-mono text-xs text-foreground">{shortAddress(wallet.wallet.address)}</p>
          <p className="text-[11px] text-muted-foreground">{wallet.balance} tDUST</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Refresh balance" onClick={() => void wallet.refresh()}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
    );
  }
  // No Lace extension here: bridge to the 1AM live-deploy flow instead of a dead button.
  if (!wallet.available && !wallet.connecting) {
    return (
      <Button className="h-10 rounded-xl px-4 shadow-sm" onClick={onMissing}>
        <Wallet />
        Connect 1AM
      </Button>
    );
  }
  return (
    <Button className="h-10 rounded-xl px-4 shadow-sm" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
      <Wallet />
      {wallet.connecting ? "Connecting..." : "Connect wallet"}
    </Button>
  );
}

function ChainPanel({ chain }: { chain: ChainTenders }) {
  const [open, setOpen] = useState(false);
  const [indexer, setIndexer] = useState("");
  const [address, setAddress] = useState("");
  useEffect(() => {
    setIndexer(chain.config.indexerUrl);
    setAddress(chain.config.contractAddress);
  }, [chain.config.indexerUrl, chain.config.contractAddress]);
  const state = chain.activity?.state;
  return (
    <div className="mt-6 rounded-lg border border-border bg-section p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          {chain.live && state ? (
            <p className="text-foreground">
              <span className="font-semibold text-success">Live network data</span> · contract {shortAddress(state.address)}
              {state.blockHeight ? ` · block ${state.blockHeight}` : ""} · {chain.activity?.actions.length ?? 0} recorded transactions
            </p>
          ) : chain.loading ? (
            <p className="text-muted-foreground">Reading the network...</p>
          ) : chain.error ? (
            <p className="text-destructive">Network unavailable: {chain.error}</p>
          ) : (
            <p className="text-muted-foreground">Showing example tenders. Add a network address and a contract address to read real tenders, bids and results.</p>
          )}
        </div>
        <div className="flex gap-2">
          {chain.live && <Button size="sm" variant="ghost" onClick={() => void chain.refresh()}><RefreshCw className="size-3.5" />Refresh</Button>}
          <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Network settings"}</Button>
        </div>
      </div>
      {open && (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="indexer-url">Network address</Label>
            <Input id="indexer-url" value={indexer} onChange={(event) => setIndexer(event.target.value)} placeholder="https://indexer.testnet.midnight.network/api/v1/graphql" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract-address">Contract address</Label>
            <Input id="contract-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0200...." className="font-mono text-xs" />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={!indexer || !address || chain.loading} onClick={() => void chain.save({ indexerUrl: indexer, contractAddress: address })}>
              {chain.loading ? "Connecting..." : "Use live data"}
            </Button>
            <Button size="sm" variant="ghost" onClick={chain.reset}>Reset</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const navItems: (NotchNavEntry & { id: Page })[] = [
  { id: "tenders", label: "Open tenders", icon: LayoutGrid },
  { id: "bids", label: "Bid history", icon: History },
  { id: "compare", label: "Compare bids", icon: ArrowLeftRight },
  { id: "settle", label: "Settlement", icon: ShieldCheck },
  { id: "deploy", label: "Live deploy", icon: Rocket },
  { id: "balance", label: "Wallet balance", icon: Wallet },
  { id: "results", label: "Results", icon: Award },
  { id: "about", label: "How it works", icon: Info },
];

const leftNavItems = navItems.slice(0, 4);
const rightNavItems = navItems.slice(4);

function Brand({ onClick, light }: { onClick: () => void; light?: boolean }) {
  return (
    <Button variant="ghost" className="h-11 shrink-0 gap-2.5 rounded-xl px-1.5 pr-3 hover:bg-white/10" onClick={onClick} aria-label="AegisBid home">
      <img src={logo} alt="" width={1024} height={1024} className={light ? "size-9 rounded-full bg-white p-1" : "size-9 rounded-lg"} />
      <span className={`font-display text-xl font-semibold ${light ? "text-white" : "text-foreground"}`}>AegisBid</span>
    </Button>
  );
}

function StatusPill({ status }: { status: Tender["status"] }) {
  const label = status === "Active" ? "Open for bids" : status === "Evaluating" ? "Choosing a winner" : "Completed";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${status === "Active" ? "bg-success/12 text-success" : status === "Evaluating" ? "bg-warning/14 text-warning" : "bg-muted text-muted-foreground"}`}>{label}</span>;
}

function TenderCard({ tender, onOpen }: { tender: Tender; onOpen: (tender: Tender) => void }) {
  return (
    <article className="group rounded-lg border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/35 hover:shadow-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <StatusPill status={tender.status} />
          <h3 className="mt-3 font-display text-xl font-semibold text-card-foreground">{tender.title}</h3>
          <p className="mt-1 text-sm text-card-foreground/70">Offered by {tender.issuer}</p>
        </div>
        <div className="sm:text-right">
          <p className="font-display text-lg font-semibold text-primary">{tender.threshold.replace("tDUST", "credits")}</p>
          <p className="mt-1 text-xs text-card-foreground/60">Published price limit</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-card-foreground/70">{tender.specification}</p>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-3">
        <div><dt className="text-xs text-card-foreground/60">Closes</dt><dd className="mt-1 text-sm font-semibold text-card-foreground">{formatCountdown(tender.deadline)}</dd></div>
        <div><dt className="text-xs text-card-foreground/60">Private bids</dt><dd className="mt-1 text-sm font-semibold text-card-foreground">{tender.commitments} received</dd></div>
        <div className="col-span-2 sm:col-span-1"><dt className="text-xs text-card-foreground/60">Selection</dt><dd className="mt-1 text-sm font-semibold text-card-foreground">{tender.mode === "Lowest compliant" ? "Lowest eligible offer" : "Highest eligible offer"}</dd></div>
      </dl>
      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-card-foreground/60"><LockKeyhole className="size-3.5 text-success" />Bid amounts stay private</p>
        <Button onClick={() => onOpen(tender)} disabled={tender.status !== "Active"}>{tender.status === "Active" ? "Review and bid" : "View details"}<ArrowRight /></Button>
      </div>
    </article>
  );
}

function Home({ onBrowse, onLearn, onOpen }: { onBrowse: () => void; onLearn: () => void; onOpen: (tender: Tender) => void }) {
  const open = initialTenders.filter((tender) => tender.status === "Active");
  return (
    <>
      <section className="relative min-h-[34rem] overflow-hidden border-b border-border bg-hero">
        <img src={HOME_IMAGE_URL} alt="A bright architectural gateway above calm water" className="absolute inset-0 size-full object-cover object-[70%_center]" fetchPriority="high" />
        <div className="absolute inset-0 bg-gradient-to-r from-hero via-hero/95 to-hero/10 sm:via-hero/80 sm:to-transparent" aria-hidden="true" />
        <div className="ocean-grid absolute inset-0 opacity-70" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex min-h-[34rem] max-w-6xl items-center px-5 py-16 sm:py-24 lg:py-28">
          <div className="w-full max-w-2xl">
            <div className="inline-flex w-fit items-center rounded-full border border-primary/15 bg-card/80 px-3 py-1.5 shadow-sm">
              <p className="text-xs font-semibold text-primary">Fair tenders. Private offers. Clear results.</p>
            </div>
            <h1 className="mt-7 max-w-3xl font-display text-4xl font-semibold leading-[1.08] text-foreground sm:text-6xl">Private bidding,<br className="hidden sm:block" /> made simple.</h1>
            <p className="mt-6 max-w-xl text-lg font-medium leading-8 text-muted-foreground">Find an opportunity, send your best offer, and follow the result. Your price stays hidden while bidding is open.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-12 rounded-xl px-6 shadow-md" onClick={onBrowse}>Browse open tenders<ArrowRight /></Button>
              <Button size="lg" className="h-12 rounded-xl bg-card px-6" variant="outline" onClick={onLearn}>See how it works</Button>
            </div>
            <div className="mt-12 grid gap-4 border-t border-primary/10 pt-7 text-sm font-medium text-muted-foreground sm:grid-cols-3 lg:mt-16">
              <span className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-card shadow-sm"><ShieldCheck className="size-4 text-success" /></span>Offers stay sealed</span>
              <span className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-card shadow-sm"><FileCheck2 className="size-4 text-success" /></span>Rules are checked fairly</span>
              <span className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-card shadow-sm"><Check className="size-4 text-success" /></span>Results can be verified</span>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <div className="max-w-2xl"><p className="text-sm font-semibold text-primary">Three clear steps</p><h2 className="mt-2 font-display text-3xl font-semibold text-foreground">From opportunity to outcome</h2><p className="mt-3 leading-7 text-muted-foreground">AegisBid handles the privacy work in the background. You only need to choose, offer, and follow the result.</p></div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            ["1", "Choose a tender", "Read the requirements, closing date, and selection rule before you take part."],
            ["2", "Send your private offer", "Enter your amount and confirm. Other bidders cannot see your price."],
            ["3", "Follow the result", "When bidding closes, the rules select a winner without revealing losing offers."],
          ].map(([number, title, text]) => <article key={number} className="rounded-lg border border-border bg-card p-6"><span className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary">{number}</span><h3 className="mt-5 font-display text-lg font-semibold text-card-foreground">{title}</h3><p className="mt-2 text-sm leading-6 text-card-foreground/70">{text}</p></article>)}
        </div>
      </section>

      <section className="border-y border-border bg-section">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold text-primary">Open now</p><h2 className="mt-2 font-display text-3xl font-semibold text-foreground">Available opportunities</h2></div><Button variant="ghost" onClick={onBrowse}>View all tenders<ArrowRight /></Button></div>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">{open.map((tender) => <TenderCard key={tender.id} tender={tender} onOpen={onOpen} />)}</div>
        </div>
      </section>
    </>
  );
}

function Tenders({ onOpen, chain }: { onOpen: (tender: Tender) => void; chain: ChainTenders }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All" | Tender["status"]>("Active");
  const tenders = chain.tenders.filter((tender) => (filter === "All" || tender.status === filter) && `${tender.title} ${tender.issuer}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16"><p className="text-sm font-semibold text-primary">Tender directory</p><h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Find an opportunity</h1><p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Compare requirements and closing dates. Your offer is only shared when you choose to submit it.</p>
    <ChainPanel chain={chain} />
    <div className="mt-8 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search tenders" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by project or organisation" className="pl-9" /></div><div className="flex rounded-md border border-border bg-muted p-1">{(["Active","Evaluating","Settled","All"] as const).map((item) => <Button key={item} size="sm" variant={filter === item ? "secondary" : "ghost"} onClick={() => setFilter(item)}>{item === "Active" ? "Open" : item === "Evaluating" ? "In review" : item === "Settled" ? "Completed" : "All"}</Button>)}</div></div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">{tenders.map((tender) => <TenderCard key={tender.id} tender={tender} onOpen={onOpen} />)}</div>
    {tenders.length === 0 && <div className="mt-6 rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">No tenders match your search.</div>}
  </div>;
}

function BidPage({ tender, onBack, onSubmit, onGoDeploy, wallet }: { tender: Tender; onBack: () => void; onSubmit: (bid: SubmittedBid) => void; onGoDeploy: () => void; wallet: WalletState }) {
  const [amount, setAmount] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const oneAm = useOneAmWallet();
  const balance = Number(wallet.balanceRaw) / 1_000_000;
  const fee = 0.35;
  const enough = !wallet.connected || balance >= fee;
  const submit = async () => {
    if (!amount || !agreed) return;
    setSending(true);
    setFailure(null);
    const submittedAt = Date.now();
    // Binding commitment via the protocol engine (SHA-256 over amount:salt:key),
    // matching the `submitBid` commitment model in contracts/aegis_bid.compact.
    const salt = generateNonce();
    const bidderKey = oneAm.info?.unshieldedAddress ?? wallet.wallet?.address ?? wallet.wallet?.coinPublicKey ?? `local-device:${submittedAt}`;
    const commitment = makeCommitment(BigInt(amount), salt, bidderKey);
    const base = {
      tenderId: tender.id,
      tenderTitle: tender.title,
      tenderStatus: tender.status,
      amount,
      commitment,
      salt,
      bidderKey,
      submittedAt,
    };
    try {
      setStage("Sealing your offer on this device");
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (new Date(tender.deadline).getTime() <= submittedAt) {
        throw new Error("Bidding for this tender has already closed.");
      }
      setStage("Creating the privacy proof");
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      let onChain = false;
      let receipt = commitment;
      const chainConfig = getChainConfig();
      if (wallet.api?.submitTransaction && isConfigured(chainConfig)) {
        setStage("Waiting for wallet confirmation");
        const request = { contract: chainConfig.contractAddress, circuit: "submitBid", tender: tender.id };
        const proven = wallet.api.balanceAndProveTransaction
          ? await wallet.api.balanceAndProveTransaction(request)
          : request;
        receipt = await wallet.api.submitTransaction(proven);
        onChain = true;
        await wallet.refresh();
      }
      onSubmit({ ...base, receipt, onChain, accepted: true, note: onChain ? "Accepted by the network" : "Accepted and recorded locally" });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "The transaction was not completed.";
      setFailure(reason);
      onSubmit({ ...base, receipt: commitment, onChain: false, accepted: false, note: reason });
    } finally {
      setStage(null);
      setSending(false);
    }
  };
  return <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14"><Button variant="ghost" onClick={onBack}><ArrowLeft />Back to tenders</Button><div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
    <section className="rounded-lg border border-border bg-card p-6 sm:p-8"><StatusPill status={tender.status} /><h1 className="mt-4 font-display text-3xl font-semibold text-card-foreground">Submit your offer</h1><p className="mt-2 text-card-foreground/70">For {tender.title}</p>
      <div className="mt-6 rounded-md border border-border bg-muted/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-card-foreground"><Wallet className="size-4 text-primary" />Your wallet</p>
          {oneAm.info
            ? <p className="font-mono text-xs text-card-foreground/60">1AM · {shortAddress(oneAm.info.unshieldedAddress)}</p>
            : wallet.connected && wallet.wallet
              ? <p className="font-mono text-xs text-card-foreground/60">{shortAddress(wallet.wallet.address)}</p>
              : wallet.available
                ? <Button size="sm" variant="outline" onClick={() => void wallet.connect()} disabled={wallet.connecting}>{wallet.connecting ? "Connecting..." : "Connect Lace"}</Button>
                : <Button size="sm" variant="outline" onClick={onGoDeploy}>Connect 1AM</Button>}
        </div>
        <p className="mt-2 text-sm text-card-foreground/70">{oneAm.info ? `Connected with 1AM on ${oneAm.info.networkId}. Your sealed offer binds to this address.` : wallet.connected ? `Available balance ${wallet.balance} tDUST · estimated network fee ${fee} tDUST` : "Connect 1AM to bind this offer to your wallet, or continue without a wallet."}</p>
        {wallet.error && <p className="mt-2 text-sm text-destructive">{wallet.error}</p>}
        {!enough && <p className="mt-2 text-sm text-destructive">Your balance is too low to cover the network fee.</p>}
      </div>
      <div className="mt-6 space-y-2"><Label htmlFor="bid-amount">Your offer amount</Label><div className="relative"><Input id="bid-amount" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} placeholder="Enter amount" className="h-12 pr-20 text-lg" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-card-foreground/60">credits</span></div><p className="text-sm text-card-foreground/70">This amount stays private while bidding is open.</p></div>
      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/50 p-4"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-1 size-4 accent-primary" /><span className="text-sm leading-6 text-card-foreground">I have reviewed the requirements and confirm this is my final offer.</span></label>
      <Button size="lg" className="mt-6 w-full" disabled={!amount || !agreed || sending || !enough} onClick={() => void submit()}>{sending ? stage ?? "Working..." : "Submit private offer"}<LockKeyhole /></Button>
      {failure && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{failure}</p>}
    </section>
    <aside className="self-start rounded-lg border border-border bg-section p-6"><h2 className="font-display text-xl font-semibold text-foreground">Before you submit</h2><dl className="mt-5 space-y-4 text-sm"><div><dt className="text-muted-foreground">Organisation</dt><dd className="mt-1 font-semibold text-foreground">{tender.issuer}</dd></div><div><dt className="text-muted-foreground">Closes</dt><dd className="mt-1 font-semibold text-foreground">{formatCountdown(tender.deadline)}</dd></div><div><dt className="text-muted-foreground">Winner selected by</dt><dd className="mt-1 font-semibold text-foreground">{tender.mode === "Lowest compliant" ? "Lowest eligible offer" : "Highest eligible offer"}</dd></div></dl><div className="mt-6 rounded-md border border-primary/20 bg-accent p-4"><p className="flex items-center gap-2 font-semibold text-primary"><ShieldCheck className="size-4" />Your privacy</p><p className="mt-2 text-sm leading-6 text-muted-foreground">AegisBid sends a sealed proof of your offer. Your exact amount is not shown to other bidders.</p></div></aside>
  </div></div>;
}

function BidHistory({ bids, onBrowse, onClear }: { bids: SubmittedBid[]; onBrowse: () => void; onClear: () => void }) {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Your activity</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Bid history</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Every offer you have sent from this device, with its sealed reference, the time it was sent, and whether it was accepted.</p>
      {bids.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-card p-10 text-center">
          <LockKeyhole className="mx-auto size-8 text-primary" />
          <h2 className="mt-4 font-display text-xl font-semibold text-card-foreground">No bids yet</h2>
          <p className="mt-2 text-sm text-card-foreground/70">When you submit a private offer, it will appear here.</p>
          <Button className="mt-5" onClick={onBrowse}>Browse open tenders</Button>
        </div>
      ) : (
        <>
          <div className="mt-8 space-y-4">
            {bids.map((bid) => (
              <article key={`${bid.commitment}-${bid.submittedAt}`} className="rounded-lg border border-border bg-card p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <StatusPill status={bid.tenderStatus} />
                    <h2 className="mt-3 font-display text-xl font-semibold text-card-foreground">{bid.tenderTitle}</h2>
                    <p className="mt-1 text-sm text-card-foreground/70">{bid.note}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${bid.accepted ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive"}`}>
                    {bid.accepted ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                    {bid.accepted ? "Accepted" : "Rejected"}
                  </span>
                </div>
                <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-xs text-card-foreground/60">Sealed reference</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-card-foreground">{bid.commitment}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-card-foreground/60">Sent at</dt>
                    <dd className="mt-1 text-sm font-semibold text-card-foreground">{formatMoment(bid.submittedAt)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-card-foreground/60">{bid.onChain ? "Network transaction" : "Confirmation"}</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-card-foreground">{bid.receipt}</dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs text-card-foreground/60">Your offer amount stays private and is never shown here to anyone else.</p>
              </article>
            ))}
          </div>
          <Button variant="ghost" className="mt-6" onClick={onClear}>Clear history on this device</Button>
        </>
      )}
    </div>
  );
}

function BalancePage({ wallet, onGoDeploy }: { wallet: WalletState; onGoDeploy: () => void }) {
  const oneAm = useOneAmWallet();
  const others = Object.entries(wallet.wallet?.balances ?? {}).filter(([token]) => token !== "tDUST");
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Your wallet</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Wallet balance</h1>
      <p className="mt-3 leading-7 text-muted-foreground">
        {oneAm.info
          ? "Connected to your 1AM wallet. Balances are read directly from the wallet."
          : "Connected to the Lace Midnight wallet in this browser. Your balance is read directly from the wallet."}
      </p>
      <section className="mt-8 rounded-lg border border-border bg-card p-6 sm:p-8">
        {oneAm.info ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-card-foreground/60">DUST balance (1AM · {oneAm.info.networkId})</p>
                <p className="mt-1 font-display text-4xl font-semibold text-card-foreground">{oneAm.info.dustBalance}</p>
              </div>
              <Button variant="ghost" onClick={oneAm.disconnect}>Disconnect 1AM</Button>
            </div>
            <dl className="mt-6 space-y-4 border-t border-border pt-5 text-sm">
              <div><dt className="text-card-foreground/60">Wallet address</dt><dd className="mt-1 break-all font-mono text-xs text-card-foreground">{oneAm.info.unshieldedAddress}</dd></div>
            </dl>
          </>
        ) : wallet.connected && wallet.wallet ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-card-foreground/60">Available balance</p>
                <p className="mt-1 font-display text-4xl font-semibold text-card-foreground">{wallet.balance} <span className="text-lg text-card-foreground/60">tDUST</span></p>
              </div>
              <Button variant="outline" onClick={() => void wallet.refresh()}><RefreshCw className="size-4" />Refresh</Button>
            </div>
            <dl className="mt-6 space-y-4 border-t border-border pt-5 text-sm">
              <div><dt className="text-card-foreground/60">Wallet address</dt><dd className="mt-1 break-all font-mono text-xs text-card-foreground">{wallet.wallet.address}</dd></div>
              <div><dt className="text-card-foreground/60">Public key</dt><dd className="mt-1 break-all font-mono text-xs text-card-foreground">{wallet.wallet.coinPublicKey}</dd></div>
              {others.map(([token, value]) => (
                <div key={token}><dt className="text-card-foreground/60">{token}</dt><dd className="mt-1 font-mono text-xs text-card-foreground">{value}</dd></div>
              ))}
            </dl>
            <Button variant="ghost" className="mt-6" onClick={wallet.disconnect}>Disconnect wallet</Button>
          </>
        ) : (
          <div className="text-center">
            <Wallet className="mx-auto size-8 text-primary" />
            <h2 className="mt-4 font-display text-xl font-semibold text-card-foreground">Wallet not connected</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-card-foreground/70">Connect your 1AM wallet to see live balances. Lace works too, where installed.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={onGoDeploy}>Connect 1AM</Button>
              {wallet.available && (
                <Button variant="outline" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
                  {wallet.connecting ? "Connecting..." : "Connect Lace"}
                </Button>
              )}
            </div>
          </div>
        )}
        {wallet.error && <p className="mt-4 text-sm text-destructive">{wallet.error}</p>}
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
      .map((bid) => ({ label: bid.tenderTitle, commitment: bid.commitment, amount: Number(bid.amount) })),
    ...manual,
  ].filter((row) => Number.isFinite(row.amount) && row.amount > 0);

  const reserveValue = Number(reserve);
  const hasReserve = reserve !== "" && Number.isFinite(reserveValue);
  const evaluated = rows.map((row) => ({
    ...row,
    eligible: !hasReserve || (rule === "Lowest compliant" ? row.amount <= reserveValue : row.amount >= reserveValue),
  }));
  const eligible = evaluated.filter((row) => row.eligible);
  const winner = eligible.length
    ? eligible.reduce((best, row) => (rule === "Lowest compliant" ? (row.amount < best.amount ? row : best) : row.amount > best.amount ? row : best))
    : null;

  const addManual = () => {
    const amount = Number(manualAmount);
    if (!amount) return;
    const salt = generateNonce();
    setManual((items) => [...items, { label: "Added by you", commitment: makeCommitment(BigInt(amount), salt, `manual-entry:${items.length}`), amount }]);
    setManualAmount("");
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-sm font-semibold text-primary">Check the outcome</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Compare bids against a reserve price</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Enter the price limit for a tender and see which sealed offers meet it. The winner is chosen by the tender's own rule.</p>

      <section className="mt-8 grid gap-4 rounded-lg border border-border bg-card p-6 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="reserve">Reserve price</Label>
          <Input id="reserve" inputMode="numeric" value={reserve} onChange={(event) => setReserve(event.target.value.replace(/\D/g, ""))} placeholder="e.g. 4200000" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule">Selection rule</Label>
          <select id="rule" value={rule} onChange={(event) => setRule(event.target.value as Tender["mode"])} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option value="Lowest compliant">Lowest offer at or below the limit wins</option>
            <option value="Highest bid">Highest offer at or above the limit wins</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tender-filter">Tender</Label>
          <select id="tender-filter" value={tenderId} onChange={(event) => setTenderId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option value="all">All of my bids</option>
            {tenders.map((tender) => <option key={tender.id} value={tender.id}>{tender.title}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="manual-amount">Add another offer to compare</Label>
          <Input id="manual-amount" inputMode="numeric" value={manualAmount} onChange={(event) => setManualAmount(event.target.value.replace(/\D/g, ""))} placeholder="Offer amount" />
        </div>
        <div className="flex items-end"><Button variant="outline" className="w-full" onClick={addManual} disabled={!manualAmount}>Add offer</Button></div>
      </section>

      {evaluated.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-10 text-center text-card-foreground/70">No offers to compare yet. Submit a bid or add an amount above.</div>
      ) : (
        <>
          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-card-foreground/60">
                <tr><th className="p-4 font-medium">Offer</th><th className="p-4 font-medium">Sealed reference</th><th className="p-4 font-medium">Amount</th><th className="p-4 font-medium">Against the limit</th></tr>
              </thead>
              <tbody>
                {evaluated.map((row) => {
                  const isWinner = winner?.commitment === row.commitment;
                  return (
                    <tr key={row.commitment} className={`border-b border-border last:border-0 ${isWinner ? "bg-success/8" : ""}`}>
                      <td className="p-4 text-card-foreground">{row.label}{isWinner && <span className="ml-2 rounded-full bg-success/12 px-2 py-0.5 text-xs font-semibold text-success">Winner</span>}</td>
                      <td className="max-w-[12rem] truncate p-4 font-mono text-xs text-card-foreground/70">{row.commitment}</td>
                      <td className="p-4 font-semibold text-card-foreground">{row.amount.toLocaleString()}</td>
                      <td className={`p-4 font-medium ${row.eligible ? "text-success" : "text-destructive"}`}>{row.eligible ? "Meets the limit" : "Outside the limit"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-6 rounded-lg border border-border bg-section p-6">
            {winner ? (
              <>
                <p className="flex items-center gap-2 font-display text-xl font-semibold text-foreground"><ShieldCheck className="size-5 text-success" />Winner: {winner.amount.toLocaleString()} credits</p>
                <p className="mt-2 text-sm text-muted-foreground">Sealed reference <span className="font-mono text-xs">{winner.commitment}</span>. Chosen because it is the {rule === "Lowest compliant" ? "lowest" : "highest"} offer that meets the limit.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No offer meets this reserve price, so no winner can be declared.</p>
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

function SettlementPage({ bids, tenders }: { bids: SubmittedBid[]; tenders: Tender[] }) {
  const fallbackTender = tenders[0] ?? defaultTender;
  const [tenderId, setTenderId] = useState(fallbackTender.id);
  const [reserveInput, setReserveInput] = useState("");
  const [manual, setManual] = useState<BidWitness[]>([]);
  const [manualAmount, setManualAmount] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [winningIndex, setWinningIndex] = useState(0);
  const [enginePhase, setEnginePhase] = useState<"Open" | "Evaluating" | "Settled">("Open");
  const [engineState, setEngineState] = useState<TenderState | null>(null);
  const [engineCommitments, setEngineCommitments] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<SettlementReceipt | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [history, setHistory] = useState<SettlementRecord[]>(() => loadSettlements());

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTLEMENT_STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* storage full or unavailable */
    }
  }, [history]);

  const tender = tenders.find((item) => item.id === tenderId) ?? fallbackTender;
  const reserveOverride = reserveInput.trim() === "" ? null : /^\d+$/.test(reserveInput.trim()) ? BigInt(reserveInput.trim()) : null;
  const reserveInvalid = reserveInput.trim() !== "" && !/^\d+$/.test(reserveInput.trim());
  const config = useMemo(
    () => uiTenderToConfig(tender, { reserve: reserveOverride }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tender.id, tender.issuer, tender.deadline, tender.threshold, tender.mode, tender.specification, reserveInput],
  );
  const defaultReserve = parseReserveToBigInt(tender.threshold);

  const autoWitnesses = useMemo(
    () =>
      bids
        .filter((bid) => bid.tenderId === tender.id)
        .map((bid) => storedBidToWitness(bid))
        .filter((w): w is BidWitness => w !== null),
    [bids, tender.id],
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
      if (config.mode === "highest" ? w.amount > current.amount : w.amount < current.amount) best = index;
    });
    return best;
  }, [witnesses, eligibility, config.mode]);
  const safeWinningIndex = witnesses.length === 0 ? 0 : Math.min(winningIndex, witnesses.length - 1);
  const deadlineReached = Date.now() >= config.deadline;

  const resetEngine = () => {
    setEnginePhase("Open");
    setEngineState(null);
    setEngineCommitments([]);
    setReceipt(null);
    setFailure(null);
  };

  const selectTender = (id: string) => {
    setTenderId(id);
    setManual([]);
    setManualAmount("");
    setManualKey("");
    setWinningIndex(0);
    setReserveInput("");
    resetEngine();
  };

  const addManual = () => {
    if (!/^\d+$/.test(manualAmount)) return;
    const witness: BidWitness = {
      amount: BigInt(manualAmount),
      salt: generateNonce(),
      bidderKey: manualKey.trim() || `evaluator-key:${Date.now()}`,
    };
    setManual((items) => [...items, witness]);
    setManualAmount("");
    setManualKey("");
    resetEngine();
  };

  const loadDemo = () => {
    const stamp = Date.now() % 100000;
    let demo: BidWitness[];
    if (config.mode === "highest") {
      const base = config.reserve > 10000n ? config.reserve : 1000n;
      demo = [
        { amount: base + 200n, salt: generateNonce(), bidderKey: `demo-a:${stamp}` },
        { amount: base + 450n, salt: generateNonce(), bidderKey: `demo-b:${stamp}` },
        { amount: base + 100n, salt: generateNonce(), bidderKey: `demo-c:${stamp}` },
      ];
    } else {
      const base = config.reserve > 10000n ? config.reserve : 4200n;
      demo = [
        { amount: base - 100n, salt: generateNonce(), bidderKey: `demo-a:${stamp}` },
        { amount: base - 500n, salt: generateNonce(), bidderKey: `demo-b:${stamp}` },
        { amount: base + 200n, salt: generateNonce(), bidderKey: `demo-c:${stamp}` },
      ];
    }
    setManual(demo);
    setWinningIndex(1);
    resetEngine();
  };

  const startEvaluation = () => {
    setFailure(null);
    try {
      if (witnesses.length === 0) throw new Error("Add at least one bid witness before evaluation.");
      const state = buildTenderStateForSettlement(config, witnesses);
      beginEvaluation(state, Date.now());
      // Keep the live engine state for settlement; commitments are the public set.
      setEngineState(state);
      setEngineCommitments([...state.commitments]);
      setEnginePhase("Evaluating");
    } catch (cause) {
      if (cause instanceof TenderError) setFailure(`${friendlySettlementError(cause.code)} [${cause.code}]`);
      else setFailure(cause instanceof Error ? cause.message : "Evaluation could not start.");
    }
  };

  const settleNow = () => {
    setFailure(null);
    try {
      const state = engineState;
      if (!state || enginePhase !== "Evaluating") throw new Error("Start evaluation before settlement.");
      if (witnesses.length !== state.commitments.length) {
        throw new Error("The witness set changed after evaluation started. Restart evaluation.");
      }
      const result = settle(state, { winningIndex: safeWinningIndex, bids: witnesses, now: Date.now() });
      setReceipt(result);
      setEnginePhase("Settled");
      setHistory((items) => [
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
      ].slice(0, 20));
    } catch (cause) {
      if (cause instanceof TenderError) setFailure(`${friendlySettlementError(cause.code)} [${cause.code}]`);
      else setFailure(cause instanceof Error ? cause.message : "Settlement failed.");
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
        Reconstruct the commitment set, open evaluation after closing, then prove the winner with the same
        checks as <span className="font-mono text-xs">contracts/aegis_bid.compact</span>. Only the winning value is disclosed.
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
              <option key={item.id} value={item.id}>{item.title} · {item.id}</option>
            ))}
          </select>
          <p className="text-xs text-card-foreground/60">{tender.issuer} · {tender.mode}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settle-reserve">Reserve / ceiling (credits)</Label>
          <Input
            id="settle-reserve"
            inputMode="numeric"
            value={reserveInput}
            onChange={(event) => {
              setReserveInput(event.target.value.replace(/\D/g, ""));
              resetEngine();
            }}
            placeholder={defaultReserve !== null ? defaultReserve.toString() : "e.g. 4200000"}
          />
          {reserveInvalid && <p className="text-xs text-destructive">Enter whole numbers only.</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Closing status</Label>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-semibold text-card-foreground">{deadlineReached ? "Closed — ready for evaluation" : `Open — ${formatCountdown(tender.deadline)} left`}</p>
            <p className="mt-1 text-xs text-card-foreground/60">Deadline {formatMoment(config.deadline)}</p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-card-foreground">Bid witnesses ({witnesses.length})</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadDemo}>Load 3 demo offers</Button>
            {suggestedIndex !== null && (
              <Button size="sm" variant="ghost" onClick={() => setWinningIndex(suggestedIndex)}>Select optimal</Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-sm text-card-foreground/70">
          {autoWitnesses.length} from this device · {manual.length} added manually. The evaluator supplies every
          committed witness; the circuit rejects incomplete or uncommitted sets.
        </p>
        {witnesses.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-sm text-card-foreground/70">
            No witnesses for this tender yet. Submit a bid first, add one manually, or load demo offers.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-card-foreground/60">
                <tr><th className="p-3 font-medium">Winner</th><th className="p-3 font-medium">Offer</th><th className="p-3 font-medium">Sealed reference</th><th className="p-3 font-medium">Amount</th><th className="p-3 font-medium">Policy</th></tr>
              </thead>
              <tbody>
                {witnesses.map((w, index) => (
                  <tr key={`${commitments[index]}-${index}`} className={`border-b border-border last:border-0 ${index === safeWinningIndex ? "bg-success/8" : ""}`}>
                    <td className="p-3"><input type="radio" aria-label={`Select offer ${index + 1} as winner`} checked={index === safeWinningIndex} onChange={() => setWinningIndex(index)} className="size-4 accent-primary" /></td>
                    <td className="p-3 text-card-foreground">{index < autoWitnesses.length ? "This device" : "Manual"}{suggestedIndex === index && <span className="ml-2 rounded-full bg-success/12 px-2 py-0.5 text-xs font-semibold text-success">Optimal</span>}</td>
                    <td className="max-w-[12rem] truncate p-3 font-mono text-xs text-card-foreground/70">{commitments[index]}</td>
                    <td className="p-3 font-semibold text-card-foreground">{w.amount.toLocaleString()}</td>
                    <td className={`p-3 font-medium ${eligibility[index] ? "text-success" : "text-destructive"}`}>{eligibility[index] ? "Eligible" : "Outside limit"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="manual-amount">Offer amount</Label>
            <Input id="manual-amount" inputMode="numeric" value={manualAmount} onChange={(event) => setManualAmount(event.target.value.replace(/\D/g, ""))} placeholder="e.g. 4250000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-key">Bidder key (optional)</Label>
            <Input id="manual-key" value={manualKey} onChange={(event) => setManualKey(event.target.value)} placeholder="evaluator-known key" className="font-mono text-xs" />
          </div>
          <div className="flex items-end"><Button variant="outline" className="w-full sm:w-auto" onClick={addManual} disabled={!manualAmount}>Add witness</Button></div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-section p-6">
        <ol className="flex flex-wrap gap-2 text-xs font-semibold">
          {(["Open", "Evaluating", "Settled"] as const).map((step, index) => {
            const order = { Open: 0, Evaluating: 1, Settled: 2 } as const;
            const active = order[enginePhase] >= order[step];
            return <li key={step} className={`rounded-full px-3 py-1 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{index + 1}. {step}</li>;
          })}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={startEvaluation} disabled={witnesses.length === 0 || enginePhase !== "Open"}>Start evaluation</Button>
          <Button onClick={settleNow} disabled={enginePhase !== "Evaluating"} variant="secondary">Settle with selected winner</Button>
          <Button onClick={resetEngine} variant="ghost">Reset</Button>
        </div>
        {!deadlineReached && <p className="mt-3 text-sm text-warning">The deadline has not passed in this workbench clock, so the circuit will refuse evaluation until closing.</p>}
        {enginePhase === "Evaluating" && <p className="mt-3 text-sm text-muted-foreground">{engineCommitments.length} commitments locked for proof. Selecting a non-optimal winner will fail closed with NOT_MAXIMUM / NOT_MINIMUM.</p>}
        {failure && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{failure}</p>}
      </section>

      {receipt && (
        <section className="mt-6 rounded-lg border border-success/30 bg-card p-6">
          <p className="flex items-center gap-2 font-display text-xl font-semibold text-foreground"><ShieldCheck className="size-5 text-success" />Settlement receipt</p>
          <dl className="mt-4 grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-xs text-card-foreground/60">Winner commitment</dt><dd className="mt-1 break-all font-mono text-xs text-card-foreground">{receipt.winnerCommitment}</dd></div>
            <div><dt className="text-xs text-card-foreground/60">Clearing value</dt><dd className="mt-1 font-display text-2xl font-semibold text-card-foreground">{receipt.winningValue.toLocaleString()} credits</dd></div>
            <div className="min-w-0"><dt className="text-xs text-card-foreground/60">Comparison root</dt><dd className="mt-1 break-all font-mono text-xs text-card-foreground">{receipt.comparisonRoot}</dd></div>
            <div><dt className="text-xs text-card-foreground/60">Settled at</dt><dd className="mt-1 font-semibold text-card-foreground">{formatMoment(receipt.settledAt)} · {witnesses.length} bids proven</dd></div>
          </dl>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-center gap-2 text-card-foreground/80"><Check className="size-4 text-success" />Winner membership proven against {engineCommitments.length} commitments</li>
            <li className="flex items-center gap-2 text-card-foreground/80"><Check className="size-4 text-success" />Ordering ({tender.mode}) and reserve / ceiling policy satisfied</li>
            <li className="flex items-center gap-2 text-card-foreground/80"><Check className="size-4 text-success" />{losingRedacted ? "Losing amounts absent from the public receipt" : "Receipt discloses only the winning value"}</li>
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-6 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold text-card-foreground">Recent settlements</h2>
            <Button size="sm" variant="ghost" onClick={() => setHistory([])}>Clear</Button>
          </div>
          <div className="mt-4 space-y-3">
            {history.map((record) => (
              <article key={`${record.winnerCommitment}-${record.settledAt}`} className="rounded-md border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-card-foreground">{record.tenderTitle}</p>
                  <p className="font-display font-semibold text-primary">{Number(record.winningValue).toLocaleString()} credits</p>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-card-foreground/60">{record.winnerCommitment} · {record.bidCount} bids · {formatMoment(record.settledAt)}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Results() {
  const completed = initialTenders.filter((tender) => tender.status !== "Active");
  return <div className="mx-auto max-w-5xl px-5 py-12 sm:py-16"><p className="text-sm font-semibold text-primary">Transparent outcomes</p><h1 className="mt-2 font-display text-4xl font-semibold text-foreground">Tender results</h1><p className="mt-3 max-w-2xl leading-7 text-muted-foreground">See which tenders are being reviewed and which have finished. Losing offers remain private.</p><div className="mt-8 space-y-4">{completed.map((tender) => <article key={tender.id} className="rounded-lg border border-border bg-card p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><StatusPill status={tender.status} /><h2 className="mt-3 font-display text-xl font-semibold text-card-foreground">{tender.title}</h2><p className="mt-1 text-sm text-card-foreground/70">{tender.issuer}</p></div><div className="sm:text-right"><p className="text-xs text-card-foreground/60">Outcome</p><p className="mt-1 font-semibold text-card-foreground">{tender.status === "Settled" ? "Winner confirmed" : "Review in progress"}</p></div></div><div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm text-card-foreground/70"><ShieldCheck className="size-4 text-success" />Selection rules verified; non-winning prices stay hidden.</div></article>)}</div></div>;
}

function HowItWorks() {
  const [open, setOpen] = useState(false);
  return <div className="mx-auto max-w-4xl px-5 py-12 sm:py-16"><p className="text-sm font-semibold text-primary">About AegisBid</p><h1 className="mt-2 font-display text-4xl font-semibold text-foreground">A fairer way to submit sealed offers</h1><p className="mt-5 text-lg leading-8 text-muted-foreground">AegisBid lets organisations collect offers without showing each bidder what others have proposed. After closing, the published rule selects the right offer and produces a checkable result.</p><div className="mt-10 space-y-4">{[["Your price remains yours","Your offer is sealed before it leaves your device. Other bidders cannot use it to adjust their own price."],["The rule cannot quietly change","Each tender states how a winner will be chosen before bidding starts."],["Losing offers stay private","The result confirms that the rules were followed without publishing every submitted amount."]].map(([title,text]) => <article key={title} className="rounded-lg border border-border bg-card p-6"><h2 className="font-display text-xl font-semibold text-card-foreground">{title}</h2><p className="mt-2 leading-7 text-card-foreground/70">{text}</p></article>)}</div><div className="mt-8 rounded-lg border border-border bg-section"><button className="flex w-full items-center justify-between gap-4 p-5 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span><span className="block font-semibold text-foreground">Technical details</span><span className="mt-1 block text-sm text-muted-foreground">For auditors and developers</span></span><ChevronDown className={`size-5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} /></button>{open && <div className="border-t border-border p-5 text-sm leading-7 text-muted-foreground"><p>AegisBid uses zero-knowledge proofs on Midnight Network. A public commitment confirms that an offer exists, while its amount and private witness remain off the public ledger. Settlement proofs verify ordering and eligibility without revealing losing values.</p><p className="mt-3 font-mono text-xs">Protocol simulation: Compact circuit v0.9.4 · Local demonstration</p></div>}</div></div>;
}

function SiteFooter({ onNavigate, chain }: { onNavigate: (page: Page) => void; chain: ChainTenders }) {
  const year = new Date().getFullYear();
  const platformLinks: { id: Page; label: string }[] = [
    { id: "tenders", label: "Open tenders" },
    { id: "bids", label: "Bid history" },
    { id: "compare", label: "Compare bids" },
    { id: "settle", label: "Settlement" },
    { id: "deploy", label: "Live deploy" },
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
              Private bidding with clear outcomes. Offers stay sealed on your device, and winners are chosen by rules set before bidding starts.
            </p>
          </div>
          <nav aria-label="Footer: platform">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platform</h2>
            <ul className="mt-4 space-y-2.5">
              {platformLinks.map((link) => (
                <li key={link.id}>
                  <button className="text-sm text-card-foreground/80 transition-colors hover:text-primary" onClick={() => onNavigate(link.id)}>{link.label}</button>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Footer: learn">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Learn</h2>
            <ul className="mt-4 space-y-2.5">
              {learnLinks.map((link) => (
                <li key={link.id}>
                  <button className="text-sm text-card-foreground/80 transition-colors hover:text-primary" onClick={() => onNavigate(link.id)}>{link.label}</button>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Network status</h2>
            <div className="mt-4 rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                <span className={`inline-block size-2 rounded-full ${connected ? "bg-success" : "bg-warning"}`} aria-hidden="true" />
                {connected ? "Connected to Midnight Network" : "Demonstration data"}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {connected
                  ? "Tenders, bids and results are read from the live ledger."
                  : "Example tenders are shown. Connect a network in Network settings to read live data."}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-4 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {year} AegisBid. Built on Midnight Network. Offers and results handled under the platform terms shown with each tender.</span>
          <span>Sealed offers · Verified results · Losing prices stay private</span>
        </div>
      </div>
    </footer>
  );
}

export function AegisUserApp() {
  const [page, setPage] = useState<Page>("home");
  const [selected, setSelected] = useState<Tender>(defaultTender);
  const [bids, setBids] = useState<SubmittedBid[]>([]);
  const wallet = useMidnightWallet();
  const chain = useChainTenders();
  const [hydratedBids, setHydratedBids] = useState(false);
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.removeItem("aegis-theme");
    setBids(loadBids());
    setHydratedBids(true);
  }, []);
  useEffect(() => {
    if (hydratedBids) window.localStorage.setItem(BID_STORAGE_KEY, JSON.stringify(bids));
  }, [bids, hydratedBids]);
  const navigate = (next: Page) => { setPage(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openTender = (tender: Tender) => { setSelected(tender); navigate(tender.status === "Active" ? "bid" : "results"); };
  const activeLabel = useMemo(() => navItems.find((item) => item.id === page)?.label, [page]);
  return <OneAmWalletProvider><main className="min-h-screen bg-background text-foreground">
    <NotchNavbar
      left={leftNavItems}
      right={rightNavItems}
      activeId={page}
      onNavigate={(id) => navigate(id as Page)}
      brand={<Brand onClick={() => navigate("home")} light />}
      actions={<WalletButton wallet={wallet} onMissing={() => navigate("deploy")} />}
    />
    <div className="h-16" aria-hidden="true" />
    {activeLabel && page !== "home" && page !== "bid" && <div className="border-b border-border bg-section"><div className="mx-auto max-w-6xl px-5 py-2 text-xs text-muted-foreground">AegisBid / {activeLabel}</div></div>}
    {page === "home" && <Home onBrowse={() => navigate("tenders")} onLearn={() => navigate("about")} onOpen={openTender} />}
    {page === "tenders" && <Tenders onOpen={openTender} chain={chain} />}
    {page === "bid" && <BidPage wallet={wallet} tender={selected} onBack={() => navigate("tenders")} onGoDeploy={() => navigate("deploy")} onSubmit={(bid) => { setBids((items) => [bid, ...items]); navigate("bids"); }} />}
    {page === "bids" && <BidHistory bids={bids} onBrowse={() => navigate("tenders")} onClear={() => setBids([])} />}
    {page === "compare" && <ComparePage bids={bids} tenders={chain.tenders} />}
    {page === "settle" && <SettlementPage bids={bids} tenders={chain.tenders} />}
    {page === "deploy" && (
      <Suspense
        fallback={
          <div className="mx-auto max-w-5xl px-5 py-12 text-sm text-muted-foreground">
            Loading live-deploy modules...
          </div>
        }
      >
        <DeployPage />
      </Suspense>
    )}
    {page === "balance" && <BalancePage wallet={wallet} onGoDeploy={() => navigate("deploy")} />}
    {page === "results" && <Results />}
    {page === "about" && <HowItWorks />}
    <SiteFooter onNavigate={navigate} chain={chain} />
  </main></OneAmWalletProvider>;
}