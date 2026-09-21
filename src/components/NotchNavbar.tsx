/**
 * Notch navbar — faithful port of the Vengeance UI Notch Navbar
 * (https://www.vengenceui.com/components/notch-navbar, MIT-style registry)
 * adapted to AegisBid: no Next.js / framer-motion / next-themes, ocean-navy
 * palette, Lucide icons per entry, xl breakpoint matching the app shell.
 *
 * Signature look: full-width fixed bar where flexible side rails (h-10) frame
 * a deeper center notch (h-16) joined by curved concave cutouts (SVG
 * clip-path corners copied from the original).
 */
import { useState } from "react";
import { Menu, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NotchNavEntry = {
  id: string;
  label: string;
  icon: LucideIcon;
};

function NotchLink({
  entry,
  active,
  onClick,
}: {
  entry: NotchNavEntry;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
        active ? "bg-white/15 text-white" : "text-white/65 hover:text-white",
      )}
    >
      <Icon className="size-4 opacity-70 group-hover:opacity-100" />
      <span>{entry.label}</span>
    </button>
  );
}

function Hairlines({ className }: { className?: string }) {
  return (
    <svg className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="39.5" x2="100%" y2="39.5" stroke="white" strokeOpacity={0.14} strokeWidth={0.5} />
      <line x1="0" y1="36.5" x2="100%" y2="36.5" stroke="white" strokeOpacity={0.14} strokeWidth={0.5} />
    </svg>
  );
}

export function NotchNavbar({
  left,
  right,
  activeId,
  onNavigate,
  brand,
  actions,
  className,
}: {
  left: NotchNavEntry[];
  right: NotchNavEntry[];
  activeId: string;
  onNavigate: (id: string) => void;
  brand: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const go = (id: string) => {
    onNavigate(id);
    setOpen(false);
  };

  return (
    <>
      <header className={cn("fixed inset-x-0 top-0 z-40 flex h-16 px-0", className)}>
        {/* Left rail */}
        <div className="relative z-20 h-10 min-w-0 flex-1 bg-notch">
          <Hairlines />
        </div>

        {/* Notch: 3 slices */}
        <div className="relative z-10 -ml-px flex h-16 shrink-0 shadow-[0_14px_36px_rgba(8,25,48,0.35)]">
          {/* Left corner */}
          <div className="relative h-full w-[50px] shrink-0">
            <div className="absolute inset-0 bg-notch" style={{ clipPath: "path('M0 0 H50 V64 C25 64 25 40 0 40 Z')" }} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 50 64" aria-hidden="true">
              <path d="M0 39.5 C25 39.5 25 63.5 50 63.5" fill="none" stroke="white" strokeOpacity={0.14} strokeWidth={0.5} />
              <path d="M0 36.5 C25 36.5 25 60.5 50 60.5" fill="none" stroke="white" strokeOpacity={0.14} strokeWidth={0.5} />
            </svg>
          </div>

          {/* Center */}
          <div className="relative -ml-px min-w-0 flex-1">
            <div className="absolute inset-0 bg-notch">
              <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
                <line x1="0" y1="63.5" x2="100%" y2="63.5" stroke="white" strokeOpacity={0.14} strokeWidth={0.5} />
                <line x1="0" y1="60.5" x2="100%" y2="60.5" stroke="white" strokeOpacity={0.14} strokeWidth={0.5} />
              </svg>
            </div>
            <div className="relative flex h-full w-full items-end justify-between gap-3 px-4 pb-2 md:px-6">
              <nav className="mb-1 hidden shrink-0 items-center gap-5 xl:flex" aria-label="Main navigation">
                {left.map((entry) => (
                  <NotchLink key={entry.id} entry={entry} active={entry.id === activeId} onClick={() => go(entry.id)} />
                ))}
              </nav>
              <button
                type="button"
                className="mb-1 p-1 text-white/70 transition-colors hover:text-white xl:hidden"
                onClick={() => setOpen((value) => !value)}
                aria-label={open ? "Close navigation" : "Open navigation"}
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
              <div className="mx-1 mb-0.5 flex shrink-0 justify-center">{brand}</div>
              <nav className="mb-1 hidden shrink-0 items-center gap-5 xl:flex" aria-label="Secondary navigation">
                {right.map((entry) => (
                  <NotchLink key={entry.id} entry={entry} active={entry.id === activeId} onClick={() => go(entry.id)} />
                ))}
              </nav>
              <div className="mb-1 flex shrink-0 items-center gap-1.5">{actions}</div>
            </div>
          </div>

          {/* Right corner */}
          <div className="relative -ml-px h-full w-[50px] shrink-0">
            <div className="absolute inset-0 bg-notch" style={{ clipPath: "path('M0 0 H50 V40 C25 40 25 64 0 64 Z')" }} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 50 64" aria-hidden="true">
              <path d="M0 63.5 C25 63.5 25 39.5 50 39.5" fill="none" stroke="white" strokeOpacity={0.14} strokeWidth={0.5} />
              <path d="M0 60.5 C25 60.5 25 36.5 50 36.5" fill="none" stroke="white" strokeOpacity={0.14} strokeWidth={0.5} />
            </svg>
          </div>
        </div>

        {/* Right rail */}
        <div className="relative z-20 -ml-px h-10 min-w-0 flex-1 bg-notch">
          <Hairlines />
        </div>
      </header>

      {open && (
        <nav
          className="fixed inset-x-0 top-16 z-40 border-b border-white/10 bg-notch p-4 shadow-xl xl:hidden"
          aria-label="Mobile navigation"
        >
          <div className="grid gap-1">
            {[...left, ...right].map((entry) => {
              const Icon = entry.icon;
              const active = entry.id === activeId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => go(entry.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors",
                    active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="size-5 opacity-70" />
                  <span className="font-medium">{entry.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
