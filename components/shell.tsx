"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useYeeld } from "@/lib/store";
import { ConnectButton } from "./connect-button";
import { TokenMark } from "./bits";

const LINKS = [
  { href: "/", label: "Markets" },
  { href: "/launch", label: "Launch" },
  { href: "/lock", label: "Lock" },
  { href: "/rewards", label: "Rewards" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { ready, state, toast, dismiss, reset, advance, toggleFailGraduation } = useYeeld();
  const path = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const [sim, setSim] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!ready) return [];
    return state.markets
      .filter((market) => {
        if (!q) return true;
        return (
          market.name.toLowerCase().includes(q) ||
          market.symbol.toLowerCase().includes(q) ||
          market.address.includes(q)
        );
      })
      .slice(0, 8);
  }, [query, ready, state.markets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return (
      <div className="boot">
        <div>Preparing markets…</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="wrap top-inner">
          <Link href="/" className="brand">
            <img src="/logo.png?v=2" alt="" width={36} height={31} className="mark" />
            FEEZE
          </Link>
          <nav className="nav">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={path === link.href ? "active" : ""}>
                {link.label}
              </Link>
            ))}
            <div className="menu">
              <button className="ghost" onClick={() => setMore((value) => !value)}>
                More
              </button>
              {more && (
                <div className="menu-pop" onMouseLeave={() => setMore(false)}>
                  <Link href="/buyback" onClick={() => setMore(false)}>Buyback</Link>
                  <Link href="/revenue" onClick={() => setMore(false)}>Revenue</Link>
                  <Link href="/docs" onClick={() => setMore(false)}>Docs</Link>
                  <Link href="/profile" onClick={() => setMore(false)}>Profile</Link>
                </div>
              )}
            </div>
          </nav>
          <div className="top-spacer" />
          <button className="search-btn" onClick={() => setOpen(true)}>
            Search… <kbd>⌘K</kbd>
          </button>
          <div className="menu">
            <button className="chain-pill" onClick={() => setSim((value) => !value)}>
              <i /> 4663 · sim
            </button>
            {sim && (
              <div className="drawer">
                <div className="note" style={{ padding: 8 }}>
                  Local clock {new Date(state.now).toLocaleString()}. Advance it to mature locks and tranches.
                </div>
                <div className="clock">
                  <button onClick={() => advance(60 * 60 * 1000)}>+1h</button>
                  <button onClick={() => advance(6 * 60 * 60 * 1000)}>+6h</button>
                  <button onClick={() => advance(24 * 60 * 60 * 1000)}>+1d</button>
                  <button onClick={() => advance(7 * 24 * 60 * 60 * 1000)}>+7d</button>
                  <button onClick={() => advance(30 * 24 * 60 * 60 * 1000)}>+30d</button>
                </div>
                <label className="check">
                  <input type="checkbox" checked={state.failNextGraduation} onChange={toggleFailGraduation} />
                  Fail the next v4 seed
                </label>
                <button className="menu-item" onClick={reset}>Remove demo markets</button>
              </div>
            )}
          </div>
          <ConnectButton />
        </div>
      </header>
      <main className="main">
        <div className="wrap">{children}</div>
      </main>
      <footer>
        <div className="wrap foot">
          <span>© 2026 FEEZE · local protocol simulator · chain model 4663</span>
          <nav>
            <Link href="/revenue">Revenue</Link>
            <Link href="/">Markets</Link>
            <Link href="/lock">Lock & Earn</Link>
            <Link href="/docs">Docs</Link>
          </nav>
        </div>
      </footer>
      {open && (
        <div className="palette-back" onClick={() => setOpen(false)}>
          <div className="palette" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              placeholder="Token name, ticker, or address"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") setActive((value) => Math.min(results.length - 1, value + 1));
                if (event.key === "ArrowUp") setActive((value) => Math.max(0, value - 1));
                if (event.key === "Enter" && results[active]) {
                  router.push(`/coin/${results[active].address}`);
                  setOpen(false);
                }
              }}
            />
            {results.map((market, index) => (
              <button
                key={market.address}
                className={index === active ? "hit active" : "hit"}
                onClick={() => {
                  router.push(`/coin/${market.address}`);
                  setOpen(false);
                }}
              >
                <span className="token-cell">
                  <TokenMark symbol={market.symbol} image={market.image} size={28} />
                  <span>
                    <strong>{market.name}</strong> <em style={{ color: "var(--muted)" }}>{market.symbol}</em>
                  </span>
                </span>
                <span className="mono faint">{market.phase}</span>
              </button>
            ))}
            {results.length === 0 && <div className="note" style={{ padding: 12 }}>No markets</div>}
          </div>
        </div>
      )}
      {toast && (
        <button className="toast" onClick={dismiss}>
          {toast}
        </button>
      )}
    </div>
  );
}
