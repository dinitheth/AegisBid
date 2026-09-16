import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowRight, Braces, Check, ChevronRight, CircleDot, Clock3, Copy,
  FileCode2, Fingerprint, Gavel, KeyRound, LockKeyhole, Plus, RefreshCw, Search,
  ShieldCheck, TerminalSquare, TestTube2, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { defaultTender, formatCountdown, generateNonce, initialTenders, proofStages, shortHash, simulations, type Tender, type TenderStatus } from "./protocol";

type View = "explorer" | "bid" | "settlement" | "compact" | "tests";
const NAV: { id: View; label: string; icon: typeof Gavel }[] = [
  { id: "explorer", label: "Tender explorer", icon: Gavel },
  { id: "bid", label: "Shielded bid", icon: LockKeyhole },
  { id: "settlement", label: "Settlement", icon: ShieldCheck },
  { id: "compact", label: "Compact", icon: FileCode2 },
  { id: "tests", label: "QA tests", icon: TestTube2 },
];

const STATUS_STYLES: Record<TenderStatus, string> = {
  Active: "border-success/30 bg-success/8 text-success",
  Evaluating: "border-warning/30 bg-warning/8 text-warning",
  Settled: "border-border bg-secondary text-muted-foreground",
};

function Status({ value }: { value: TenderStatus }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[value]}`}><span className="size-1.5 rounded-full bg-current" />{value}</span>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0 border-l border-border px-4 first:border-l-0"><div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div><div className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</div><div className="mt-0.5 truncate text-[10px] text-subtle-foreground">{detail}</div></div>;
}

function PanelTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return <div className="flex items-end justify-between gap-4 border-b border-border px-5 py-4"><div><p className="text-[10px] font-bold uppercase text-primary">{eyebrow}</p><h2 className="mt-1 text-base font-semibold text-foreground">{title}</h2></div>{action}</div>;
}

function NewTenderDialog({ onCreate }: { onCreate: (tender: Tender) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [mode, setMode] = useState<Tender["mode"]>("Lowest compliant");
  const [threshold, setThreshold] = useState("");
  const [specification, setSpecification] = useState("");
  const submit = () => {
    if (!title.trim() || !issuer.trim() || !threshold.trim()) return;
    const deadline = new Date(Date.now() + 7 * 86_400_000).toISOString();
    onCreate({ id: `AGB-2026-${String(Date.now()).slice(-3)}`, title, issuer, deadline, threshold, commitments: 0, status: "Active", mode, specification: specification || "Confidential specification root attached" });
    setOpen(false); setTitle(""); setIssuer(""); setThreshold(""); setSpecification("");
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm"><Plus />New tender</Button></DialogTrigger>
    <DialogContent className="border-border bg-card sm:max-w-xl">
      <DialogHeader><DialogTitle>Create shielded tender</DialogTitle><DialogDescription>Configure public policy. Bid values and bidder witnesses remain private.</DialogDescription></DialogHeader>
      <div className="grid gap-4 py-2 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="title">Tender title</Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Regional energy capacity" /></div>
        <div className="space-y-2"><Label htmlFor="issuer">Issuer</Label><Input id="issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuing authority" /></div>
        <div className="space-y-2"><Label>Evaluation mode</Label><Select value={mode} onValueChange={(value) => setMode(value as Tender["mode"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Lowest compliant">Lowest compliant</SelectItem><SelectItem value="Highest bid">Highest bid</SelectItem></SelectContent></Select></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="threshold">Public threshold</Label><Input id="threshold" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Ceiling 5.00M tDUST" /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="spec">Specification policy</Label><Textarea id="spec" value={specification} onChange={(e) => setSpecification(e.target.value)} placeholder="Compliance requirements committed by specification root" /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={!title || !issuer || !threshold}>Deploy tender</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Explorer({ tenders, selected, onSelect, onCreate, onOpenBid }: { tenders: Tender[]; selected: Tender; onSelect: (t: Tender) => void; onCreate: (t: Tender) => void; onOpenBid: () => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const rows = tenders.filter((t) => (status === "All" || t.status === status) && `${t.id} ${t.title} ${t.issuer}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="workspace-grid">
    <section className="panel min-w-0 overflow-hidden">
      <PanelTitle eyebrow="01 / Discovery" title="Auction & tender explorer" action={<NewTenderDialog onCreate={onCreate} />} />
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search tenders" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ID, issuer, or mandate" className="pl-9" /></div>
        <Tabs value={status} onValueChange={setStatus}><TabsList className="w-full sm:w-auto">{["All", "Active", "Evaluating", "Settled"].map((item) => <TabsTrigger className="flex-1 sm:flex-none" key={item} value={item}>{item}</TabsTrigger>)}</TabsList></Tabs>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="border-b border-border bg-secondary/40 text-[10px] uppercase text-muted-foreground"><tr><th className="px-4 py-3 font-semibold">Tender / issuer</th><th className="px-3 py-3 font-semibold">Mode</th><th className="px-3 py-3 font-semibold">Deadline</th><th className="px-3 py-3 font-semibold">Threshold</th><th className="px-3 py-3 text-right font-semibold">Commits</th><th className="px-3 py-3 font-semibold">State</th></tr></thead>
          <tbody>{rows.map((tender) => <tr key={tender.id} onClick={() => onSelect(tender)} className={`cursor-pointer border-b border-border/80 transition-colors hover:bg-secondary/45 ${selected.id === tender.id ? "bg-primary/8" : ""}`}>
            <td className="px-4 py-3"><div className="font-medium text-foreground">{tender.title}</div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{tender.id} · {tender.issuer}</div></td>
            <td className="px-3 py-3 text-muted-foreground">{tender.mode}</td><td className="px-3 py-3"><span className="font-mono text-foreground">{formatCountdown(tender.deadline)}</span><div className="mt-1 text-[10px] text-muted-foreground">{new Date(tender.deadline).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div></td>
            <td className="px-3 py-3 font-mono text-muted-foreground">{tender.threshold}</td><td className="px-3 py-3 text-right font-mono text-foreground">{String(tender.commitments).padStart(2, "0")}</td><td className="px-3 py-3"><Status value={tender.status} /></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <aside className="panel self-start">
      <PanelTitle eyebrow="Selected tender" title={selected.id} />
      <div className="space-y-5 p-5">
        <div><h3 className="text-lg font-semibold text-foreground">{selected.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{selected.specification}</p></div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
          {[ ["Issuer", selected.issuer], ["Evaluation", selected.mode], ["Public policy", selected.threshold], ["Commitments", `${selected.commitments} accepted`] ].map(([term, value]) => <div className="bg-card p-3" key={term}><dt className="text-[10px] uppercase text-muted-foreground">{term}</dt><dd className="mt-1.5 leading-5 text-foreground">{value}</dd></div>)}
        </dl>
        <div className="rounded-md border border-primary/25 bg-primary/6 p-3 text-xs leading-5 text-muted-foreground"><div className="mb-1 flex items-center gap-2 font-semibold text-primary"><ShieldCheck className="size-4" />Privacy policy active</div>Only commitments, nullifiers, proof receipts, and final settlement outputs enter public state.</div>
        <Button className="w-full" onClick={onOpenBid} disabled={selected.status !== "Active"}>Open shielded bidding terminal<ArrowRight /></Button>
      </div>
    </aside>
  </div>;
}

function BidTerminal({ tender }: { tender: Tender }) {
  const [amount, setAmount] = useState("3850000");
  const [nonce, setNonce] = useState(generateNonce);
  const [identity, setIdentity] = useState("did:midnight:shielded:7f3a…c19e");
  const [stage, setStage] = useState(-1);
  const [submitted, setSubmitted] = useState(false);
  const commitment = shortHash(`${tender.id}:${amount}:${nonce}:${identity}`);
  const runProof = () => { setSubmitted(false); setStage(0); };
  useEffect(() => { if (stage < 0 || stage >= proofStages.length) return; const timer = window.setTimeout(() => setStage((value) => value + 1), 620); return () => window.clearTimeout(timer); }, [stage]);
  useEffect(() => { if (stage === proofStages.length) setSubmitted(true); }, [stage]);
  return <div className="space-y-4">
    <div className="workspace-grid">
      <section className="panel">
        <PanelTitle eyebrow="02 / Private execution" title="Shielded bidding terminal" action={<span className="font-mono text-[10px] text-muted-foreground">{tender.id}</span>} />
        <div className="space-y-5 p-5">
          <div className="rounded-md border border-border bg-secondary/35 p-4"><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-semibold text-foreground">{tender.title}</h3><p className="mt-1 text-xs text-muted-foreground">{tender.mode} · {tender.threshold}</p></div><Status value={tender.status} /></div></div>
          <div className="space-y-2"><Label htmlFor="amount">Private bid amount</Label><div className="relative"><Input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="pr-20 font-mono text-base" /><span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">tDUST</span></div><p className="text-[11px] text-muted-foreground">This value is consumed by the local witness and never broadcast.</p></div>
          <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="nonce">Salt nonce</Label><Button variant="ghost" size="sm" onClick={() => setNonce(generateNonce())}><RefreshCw />Regenerate</Button></div><Input id="nonce" value={nonce} onChange={(e) => setNonce(e.target.value)} className="font-mono text-xs" /></div>
          <div className="space-y-2"><Label htmlFor="identity">Identity witness</Label><Input id="identity" value={identity} onChange={(e) => setIdentity(e.target.value)} className="font-mono text-xs" /></div>
          <Button className="w-full" onClick={runProof} disabled={!amount || stage >= 0 && stage < proofStages.length}>{stage >= 0 && stage < proofStages.length ? <><RefreshCw className="animate-spin" />Generating proof</> : <><Zap />Generate proof & submit</>}</Button>
          {submitted && <div role="status" className="rounded-md border border-success/35 bg-success/8 p-3 text-xs text-success"><div className="flex items-center gap-2 font-semibold"><Check className="size-4" />Commitment accepted</div><p className="mt-1 font-mono text-[10px] text-muted-foreground">Receipt {shortHash(commitment + "receipt")}</p></div>}
        </div>
      </section>
      <section className="panel overflow-hidden">
        <PanelTitle eyebrow="Privacy scope inspector" title="Local witness vs. public transcript" />
        <div className="privacy-grid">
          <div className="p-5"><div className="mb-4 flex items-center gap-2 text-xs font-semibold text-private"><KeyRound className="size-4" />Private local state</div>{[["Bid amount", amount ? `${Number(amount).toLocaleString()} tDUST` : "Not set"], ["Random salt", nonce], ["Identity witness", identity]].map(([label, value]) => <div className="data-row" key={label}><span>{label}</span><code>{value}</code></div>)}</div>
          <div className="border-t border-border p-5 lg:border-l lg:border-t-0"><div className="mb-4 flex items-center gap-2 text-xs font-semibold text-public"><CircleDot className="size-4" />Public Midnight ledger state</div>{[["Commitment", commitment], ["Ledger time", "slot: 1,789,104"], ["Proof receipt", submitted ? shortHash(commitment + "receipt") : "Pending local proof"], ["Visible bid", "REDACTED"]].map(([label, value]) => <div className="data-row" key={label}><span>{label}</span><code>{value}</code></div>)}</div>
        </div>
      </section>
    </div>
    <section className="panel">
      <PanelTitle eyebrow="Local prover" title="Zero-knowledge execution trace" action={<span className="font-mono text-[10px] text-muted-foreground">Aegis circuit v0.9.4</span>} />
      <div className="grid gap-px bg-border md:grid-cols-5">{proofStages.map(([name, detail], index) => { const done = stage > index; const active = stage === index; return <div className="bg-card p-4" key={name}><div className={`mb-3 flex size-7 items-center justify-center rounded-full border font-mono text-[11px] ${done ? "border-success bg-success/10 text-success" : active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{done ? <Check className="size-3.5" /> : String(index + 1).padStart(2, "0")}</div><h3 className="text-xs font-semibold text-foreground">{name}</h3><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{detail}</p>{active && <div className="mt-3 h-0.5 overflow-hidden bg-secondary"><div className="h-full w-2/3 animate-pulse bg-primary" /></div>}</div>; })}</div>
    </section>
  </div>;
}

function Settlement({ tender }: { tender: Tender }) {
  const isLowest = tender.mode === "Lowest compliant";
  const rows = [
    { commitment: "0x84f2…73de", relation: isLowest ? "winner ≤ candidate" : "winner ≥ candidate", proof: "Valid", result: "Winner" },
    { commitment: "0x1a76…c901", relation: isLowest ? "winner ≤ candidate" : "winner ≥ candidate", proof: "Valid", result: "Redacted" },
    { commitment: "0x029b…ea41", relation: isLowest ? "winner ≤ candidate" : "winner ≥ candidate", proof: "Valid", result: "Redacted" },
  ];
  const receiptRows: [string, string][] = [["Winner membership", "VALID"], ["Pairwise ordering", "2 / 2 VALID"], ["Policy compliance", "VALID"], ["Nullifier uniqueness", "VALID"], ["Comparison root", "0x9b31…a02f"], ["Circuit digest", "0x7cc4…811e"]];
  return <div className="space-y-4">
    <section className="panel"><PanelTitle eyebrow="03 / Confidential resolution" title="Cryptographic settlement & winner verification" action={<span className="rounded-sm border border-success/30 bg-success/8 px-2 py-1 text-[10px] font-semibold text-success">VERIFIED ON LEDGER</span>} />
      <div className="grid gap-px bg-border lg:grid-cols-[1.2fr_1fr_1fr]">
        <div className="bg-card p-5"><p className="text-[10px] uppercase text-muted-foreground">Tender under evaluation</p><h3 className="mt-2 text-base font-semibold text-foreground">{tender.title}</h3><p className="mt-2 font-mono text-xs text-muted-foreground">{tender.id} · {tender.mode}</p></div>
        <div className="bg-card p-5"><p className="text-[10px] uppercase text-muted-foreground">Winning commitment</p><p className="mt-2 font-mono text-sm text-primary">0x84f2…73de</p><p className="mt-2 text-xs text-muted-foreground">Identity remains pseudonymous until award acceptance.</p></div>
        <div className="bg-card p-5"><p className="text-[10px] uppercase text-muted-foreground">Public clearing value</p><p className="mt-2 font-mono text-lg font-semibold text-foreground">{isLowest ? "3,710,000" : "13,840,000"} tDUST</p><p className="mt-1 text-xs text-success">Threshold constraint satisfied</p></div>
      </div>
    </section>
    <div className="workspace-grid">
      <section className="panel overflow-hidden"><PanelTitle eyebrow="Comparison proof set" title="Committed bid ordering" /><div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-xs"><thead className="border-b border-border bg-secondary/35 text-[10px] uppercase text-muted-foreground"><tr><th className="px-4 py-3">Commitment</th><th className="px-4 py-3">Proven relation</th><th className="px-4 py-3">Proof</th><th className="px-4 py-3">Value</th></tr></thead><tbody>{rows.map((row) => <tr className="border-b border-border" key={row.commitment}><td className="px-4 py-4 font-mono text-foreground">{row.commitment}</td><td className="px-4 py-4 font-mono text-muted-foreground">{row.relation}</td><td className="px-4 py-4 text-success"><span className="inline-flex items-center gap-1"><Check className="size-3.5" />{row.proof}</span></td><td className="px-4 py-4 font-mono text-muted-foreground">{row.result}</td></tr>)}</tbody></table></div></section>
      <aside className="panel"><PanelTitle eyebrow="Verification receipt" title="Public proof outputs" /><div className="p-5">{receiptRows.map(([k,v]) => <div className="data-row" key={k}><span>{k}</span><code className={v.includes("VALID") ? "text-success" : ""}>{v}</code></div>)}<div className="mt-4 rounded-md border border-border bg-secondary/30 p-3 text-[11px] leading-5 text-muted-foreground">The verifier learns which committed bid satisfies the ordering and policy constraints. Losing values, salts, and identities remain outside the public transcript.</div></div></aside>
    </div>
  </div>;
}

const compactSource = `pragma language_version >= 0.16;\n\nimport CompactStandardLibrary;\n\nexport enum TenderMode { HighestBid, LowestCompliant }\nexport enum TenderPhase { Open, Evaluating, Settled, Cancelled }\n\nexport struct TenderConfig {\n  issuer: Bytes<32>;\n  deadline: Uint<64>;\n  reserve: Uint<128>;\n  mode: TenderMode;\n  specificationRoot: Bytes<32>;\n}\n\nexport ledger tender: TenderConfig;\nexport ledger phase: TenderPhase;\nexport ledger commitmentCount: Counter;\nexport ledger commitments: Map<Bytes<32>, Boolean>;\nexport ledger nullifiers: Set<Bytes<32>>;\nexport ledger settlement: Maybe<SettlementReceipt>;\n\nwitness localBidAmount(): Uint<128>;\nwitness localBidSalt(): Bytes<32>;\nwitness localIdentitySecret(): Bytes<32>;\n\nexport circuit submitBid(\n  bidderPublicKey: Bytes<32>,\n  now: Uint<64>\n): Bytes<32> {\n  assert(phase == TenderPhase.Open, "TENDER_NOT_OPEN");\n  assert(now < tender.deadline, "DEADLINE_ELAPSED");\n  const amount = localBidAmount();\n  const salt = localBidSalt();\n  const identity = localIdentitySecret();\n  const identityNullifier = persistentHash(identity, tender.issuer);\n  assert(!nullifiers.member(identityNullifier));\n  const commitment = persistentHash(amount, salt, bidderPublicKey);\n  commitments.insert(commitment, true);\n  nullifiers.insert(identityNullifier);\n  commitmentCount.increment(1);\n  return commitment;\n}\n\nexport circuit settle(winningIndex: Uint<16>, bidCount: Uint<16>): Void {\n  const winningAmount = settlementBid(winningIndex);\n  for (let i = 0; i < bidCount; i = i + 1) {\n    const candidateAmount = settlementBid(i);\n    if (tender.mode == TenderMode.HighestBid)\n      assert(winningAmount >= candidateAmount, "NOT_MAXIMUM");\n    else\n      assert(winningAmount <= candidateAmount, "NOT_MINIMUM");\n  }\n  phase = TenderPhase.Settled;\n}`;

function CompactExplorer() {
  type CodeSection = "Full contract" | "Public ledger" | "Private witnesses" | "Submit circuit" | "Settlement circuit";
  const sections: CodeSection[] = ["Full contract", "Public ledger", "Private witnesses", "Submit circuit", "Settlement circuit"];
  const [section, setSection] = useState<CodeSection>("Full contract");
  const [copied, setCopied] = useState(false);
  const annotations: Record<CodeSection, [string,string]> = { "Full contract": ["Contract boundary", "The complete protocol keeps bid values in witnesses and writes only commitments, nullifiers, phase, and settlement receipts to replicated state."], "Public ledger": ["Replicated state", "These fields are visible to validators. Raw bid amounts and identity secrets are intentionally absent."], "Private witnesses": ["Local state", "Witness providers resolve secrets on the bidder or evaluator device and feed them directly into the zero-knowledge circuit."], "Submit circuit": ["Commit phase", "The circuit proves timing and uniqueness constraints before recording an opaque commitment."], "Settlement circuit": ["Comparison proof", "Bounded pairwise constraints prove the selected bid is optimal without disclosing losing values."] };
  const ranges: Record<CodeSection, [number, number]> = { "Full contract": [1, 200], "Public ledger": [15, 21], "Private witnesses": [23, 25], "Submit circuit": [27, 43], "Settlement circuit": [45, 56] };
  const lines = compactSource.split("\n"); const [start,end] = ranges[section];
  return <div className="workspace-grid">
    <section className="panel min-w-0 overflow-hidden"><PanelTitle eyebrow="04 / Contract source" title="aegis_bid.compact" action={<Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(compactSource); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>} />
      <div className="flex overflow-x-auto border-b border-border bg-secondary/30 px-2">{sections.map((item) => <button key={item} onClick={() => setSection(item)} className={`shrink-0 border-b-2 px-3 py-3 text-xs transition-colors ${item === section ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item}</button>)}</div>
      <pre className="code-viewer" aria-label="Compact contract source">{lines.map((line,index) => { const n=index+1; return <div className={`${n >= start && n <= end ? "bg-primary/7" : ""}`} key={n}><span>{String(n).padStart(2,"0")}</span><code>{line || " "}</code></div>; })}</pre>
    </section>
    <aside className="panel self-start"><PanelTitle eyebrow="Dual-ledger annotation" title={annotations[section][0]} /><div className="space-y-4 p-5"><p className="text-sm leading-6 text-muted-foreground">{annotations[section][1]}</p><div className="privacy-boundary"><div><KeyRound className="size-4 text-private" /><span>Private</span><strong>Witness provider</strong></div><ChevronRight className="size-4 text-muted-foreground" /><div><Braces className="size-4 text-primary" /><span>Proof</span><strong>ZK circuit</strong></div><ChevronRight className="size-4 text-muted-foreground" /><div><CircleDot className="size-4 text-public" /><span>Public</span><strong>Ledger state</strong></div></div><div className="rounded-md border border-warning/25 bg-warning/6 p-3 text-[11px] leading-5 text-muted-foreground"><strong className="text-warning">Implementation note.</strong> Compact is actively evolving. The bundled source is production-shaped and should be compiled against the exact toolchain version selected for deployment.</div></div></aside>
  </div>;
}

function TestRunner() {
  const [active, setActive] = useState<string | null>(null); const [completed, setCompleted] = useState<string[]>([]); const [visible, setVisible] = useState<Record<string, number>>({});
  const run = (id: string) => { setActive(id); setCompleted((c) => c.filter((x) => x !== id)); setVisible((v) => ({...v,[id]:0})); };
  useEffect(() => { if (!active) return; const sim=simulations.find((s)=>s.id===active); if (!sim) return; const count=visible[active] ?? 0; if(count >= sim.logs.length){ setCompleted((c)=>[...c,active]); setActive(null); return; } const timer=window.setTimeout(()=>setVisible((v)=>({...v,[active]:count+1})),260); return()=>window.clearTimeout(timer); },[active,visible]);
  const runAll = async () => { for (const sim of simulations) { setVisible((v)=>({...v,[sim.id]:sim.logs.length})); await new Promise((r)=>setTimeout(r,180)); setCompleted((c)=>c.includes(sim.id)?c:[...c,sim.id]); } setActive(null); };
  return <section className="panel"><PanelTitle eyebrow="05 / Deterministic validation" title="QA & simulation runner" action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>{setCompleted([]);setVisible({});setActive(null)}}><RefreshCw />Reset</Button><Button size="sm" onClick={runAll}><TestTube2 />Run all</Button></div>} />
    <div className="grid gap-px bg-border lg:grid-cols-3">{simulations.map((sim,index)=>{const done=completed.includes(sim.id); const shown=visible[sim.id] ?? 0; return <article className="flex min-h-[480px] flex-col bg-card" key={sim.id}><div className="border-b border-border p-5"><div className="flex items-start justify-between gap-3"><span className="font-mono text-[10px] text-muted-foreground">TEST {String(index+1).padStart(2,"0")}</span>{done ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success"><Check className="size-3.5" />PASSED</span> : <span className="text-[10px] text-muted-foreground">READY</span>}</div><h3 className="mt-3 text-sm font-semibold text-foreground">{sim.name}</h3><p className="mt-2 min-h-12 text-xs leading-5 text-muted-foreground">{sim.detail}</p><Button className="mt-4 w-full" size="sm" variant={done ? "outline" : "default"} disabled={active !== null} onClick={()=>run(sim.id)}><TerminalSquare />{done ? "Run again" : active===sim.id ? "Running" : "Run simulation"}</Button></div><div className="flex-1 bg-code p-4 font-mono text-[10px] leading-5" aria-live="polite"><div className="mb-3 flex items-center gap-2 text-subtle-foreground"><span className="size-1.5 rounded-full bg-success" />local-dev / aegis-test</div>{sim.logs.slice(0,shown).map((log,i)=><div className="flex gap-2 text-muted-foreground" key={log}><span className="text-subtle-foreground">{String(i+1).padStart(2,"0")}</span><span className={i===sim.logs.length-1 ? "text-success" : ""}>{log}</span></div>)}{done && <div className="mt-3 border-t border-border pt-3 text-success">PASS · {142 + index*37}ms · {sim.logs.length} assertions</div>}</div></article>})}</div>
  </section>;
}

export function AegisBidApp() {
  const [view,setView]=useState<View>("explorer"); const [tenders,setTenders]=useState(initialTenders); const [selected,setSelected]=useState<Tender>(defaultTender);
  const stats=useMemo(()=>({active:tenders.filter((t)=>t.status==="Active").length, commits:tenders.reduce((n,t)=>n+t.commitments,0)}),[tenders]);
  const addTender=(t:Tender)=>{setTenders((list)=>[t,...list]);setSelected(t)};
  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border bg-header"><div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 lg:px-6"><div className="flex items-center gap-3"><div className="brand-mark"><ShieldCheck className="size-5" /></div><div><h1 className="text-sm font-bold">AEGIS<span className="text-primary">BID</span></h1><p className="font-mono text-[9px] uppercase text-muted-foreground">Shielded tender protocol</p></div></div><div className="hidden items-center md:flex"><Metric label="Network" value="MIDNIGHT" detail="Local devnet · synced" /><Metric label="Active" value={String(stats.active).padStart(2,"0")} detail="Open tenders" /><Metric label="Commitments" value={String(stats.commits).padStart(3,"0")} detail="Shielded submissions" /><Metric label="Prover" value="READY" detail="Circuit v0.9.4" /></div><div className="flex items-center gap-2"><span className="hidden items-center gap-2 rounded-sm border border-success/25 bg-success/7 px-2 py-1.5 font-mono text-[10px] text-success sm:inline-flex"><Activity className="size-3" />LEDGER SYNCED</span><NewTenderDialog onCreate={addTender} /></div></div></header>
    <div className="border-b border-border bg-card"><nav aria-label="Protocol workspace" className="mx-auto flex max-w-[1600px] overflow-x-auto px-4 lg:px-6">{NAV.map(({id,label,icon:Icon})=><button key={id} onClick={()=>setView(id)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition-colors ${view===id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="size-3.5" />{label}</button>)}</nav></div>
    <div className="mx-auto max-w-[1600px] p-4 lg:p-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="font-mono">AEGIS</span><ChevronRight className="size-3" /><span>{NAV.find((item)=>item.id===view)?.label}</span>{view!=="explorer"&&<><ChevronRight className="size-3"/><span className="font-mono text-foreground">{selected.id}</span></>}</div><div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"><Clock3 className="size-3" />Ledger slot 1,789,104 · Finality 2.4s</div></div>
      {view==="explorer"&&<Explorer tenders={tenders} selected={selected} onSelect={setSelected} onCreate={addTender} onOpenBid={()=>setView("bid")} />}
      {view==="bid"&&<BidTerminal tender={selected}/>} {view==="settlement"&&<Settlement tender={selected}/>} {view==="compact"&&<CompactExplorer/>} {view==="tests"&&<TestRunner/>}
    </div>
    <footer className="mx-auto flex max-w-[1600px] flex-col justify-between gap-2 border-t border-border px-6 py-4 font-mono text-[9px] text-subtle-foreground sm:flex-row"><span>AEGISBID PROTOCOL WORKBENCH · LOCAL SIMULATION</span><span>PRIVATE BY CONSTRUCTION · PUBLICLY VERIFIABLE</span></footer>
  </main>;
}
