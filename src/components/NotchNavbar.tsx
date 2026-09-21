/**
 * Notch navbar — Vengeance UI Notch Navbar
 * (https://www.vengenceui.com/components/notch-navbar) adapted to AegisBid.
 *
 * Adaptation notes: no Next.js / framer-motion / next-themes here, and the
 * app page is light, so the signature full-bleed cutout (which reveals light
 * page wedges beside the notch) is reworked as a floating ocean-navy pill:
 * same centered brand, icon links, active pills, and mobile overlay, minus
 * the white-corner artifacts. Lucide icons per entry, xl breakpoint matching
 * the app shell.
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
      <header className={cn("fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-5", className)}>
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 rounded-2xl bg-notch px-3 shadow-[0_14px_36px_rgba(8,25,48,0.35)] sm:px-5">
          <nav className="hidden min-w-0 flex-1 items-center gap-5 xl:flex" aria-label="Main navigation">
            {left.map((entry) => (
              <NotchLink key={entry.id} entry={entry} active={entry.id === activeId} onClick={() => go(entry.id)} />
            ))}
          </nav>
          <button
            type="button"
            className="p-1 text-white/70 transition-colors hover:text-white xl:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Close navigation" : "Open navigation"}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="flex shrink-0 justify-center">{brand}</div>
          <nav className="hidden min-w-0 flex-1 items-center justify-end gap-5 xl:flex" aria-label="Secondary navigation">
            {right.map((entry) => (
              <NotchLink key={entry.id} entry={entry} active={entry.id === activeId} onClick={() => go(entry.id)} />
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        </div>
      </header>

      {open && (
        <nav
          className="fixed inset-x-3 top-[4.5rem] z-40 rounded-2xl border border-white/10 bg-notch p-4 shadow-xl xl:hidden"
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
