"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useYeeld } from "@/lib/store";
import { PAIRS } from "@/lib/pairs";
import { compact, timeAgo, usd } from "@/lib/format";
import { PhasePill, Progress, TokenMark, marketStats } from "@/components/bits";
import type { Market } from "@/lib/types";

type SortKey = "market_cap" | "recent" | "last_trade";

export default function MarketsPage() {
  const { state } = useYeeld();
  const [sort, setSort] = useState<SortKey>("market_cap");
  const [pair, setPair] = useState("all");
  const [graduated, setGraduated] = useState<"all" | "live" | "done">("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = state.markets.filter((market) => {
      if (pair !== "all" && market.pair !== pair) return false;
      if (graduated === "live" && market.phase === "graduated") return false;
      if (graduated === "done" && market.phase !== "graduated") return false;
      if (!query) return true;
      return (
        market.name.toLowerCase().includes(query) ||
        market.symbol.toLowerCase().includes(query) ||
        market.address.includes(query)
      );
    });
    const cap = (market: Market) => marketStats(market)?.mcap ?? 0;
    list = [...list].sort((a, b) => {
      if (sort === "recent") return b.launchedAt - a.launchedAt;
      if (sort === "last_trade") return (b.lastTradeAt ?? 0) - (a.lastTradeAt ?? 0);
      return cap(b) - cap(a);
    });
    return list;
  }, [state.markets, sort, pair, graduated, q, state.now]);

  const volume = state.markets.reduce((sum, market) => {
    const stats = marketStats(market);
    return sum + (stats ? market.volumeQuote * stats.pair.usd : 0);
  }, 0);
  const graduatedCount = state.markets.filter((market) => market.phase === "graduated").length;

  return (
    <>
      <section className="hero">
        <div>
          <h1>Launch coins that reward conviction.</h1>
          <p className="lede">
            Create and discover tokens anchored to real stocks. Lock your supply to capture 60% of all trading fees.
          </p>
          <div className="hero-actions">
            <Link className="btn-accent" href="/launch">Launch token</Link>
            <Link className="btn" href="/docs">Read the docs</Link>
          </div>
        </div>
        <div className="stat-row">
          <div className="stat"><span>Markets</span><b>{state.markets.length}</b></div>
          <div className="stat"><span>Graduated</span><b>{graduatedCount}</b></div>
          <div className="stat"><span>Volume</span><b>{usd(volume)}</b></div>
        </div>
      </section>
      <div className="toolbar">
        <input className="text-input" style={{ maxWidth: 280 }} placeholder="Search markets" value={q} onChange={(event) => setQ(event.target.value)} />
        <div className="seg">
          {(["market_cap", "recent", "last_trade"] as SortKey[]).map((key) => (
            <button key={key} className={sort === key ? "on" : ""} onClick={() => setSort(key)}>
              {key === "market_cap" ? "Market cap" : key === "recent" ? "Recent" : "Last trade"}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={graduated === "all" ? "on" : ""} onClick={() => setGraduated("all")}>All</button>
          <button className={graduated === "live" ? "on" : ""} onClick={() => setGraduated("live")}>Curve</button>
          <button className={graduated === "done" ? "on" : ""} onClick={() => setGraduated("done")}>Graduated</button>
        </div>
      </div>
      <div className="filters" style={{ marginBottom: 12 }}>
        <button className={pair === "all" ? "chip on" : "chip"} onClick={() => setPair("all")}>All pairs</button>
        {PAIRS.map((item) => (
          <button key={item.address} className={pair === item.address ? "chip on" : "chip"} onClick={() => setPair(item.address)}>
            {item.symbol}
          </button>
        ))}
      </div>
      <div className="market-grid">
        {rows.map((market) => {
          const stats = marketStats(market);
          if (!stats) return null;
          return (
            <Link key={market.address} href={`/coin/${market.address}`} className="market-card">
              <div className="market-card-top">
                <TokenMark symbol={market.symbol} image={market.image} size={48} />
                <div>
                  <strong>{market.name}</strong>
                  <em>
                    {market.symbol} · {stats.pair.symbol}
                    {market.isProtocol ? " · protocol" : ""}
                  </em>
                </div>
                <PhasePill phase={market.phase} />
              </div>
              <div className="market-card-cap">
                <span>Market cap</span>
                <b>{usd(stats.mcap)}</b>
              </div>
              <div className="market-card-progress">
                <div className="market-card-meta">
                  <span>{Math.round(stats.progress * 100)}% of curve</span>
                  <span>{compact(stats.price, 6)} {stats.pair.symbol}</span>
                </div>
                <Progress value={stats.progress} graduated={market.phase === "graduated"} wide />
              </div>
              <div className="market-card-foot">
                <span>Vol {usd(market.volumeQuote * stats.pair.usd)}</span>
                <span>{timeAgo(market.launchedAt, state.now)}</span>
              </div>
            </Link>
          );
        })}
      </div>
      {rows.length === 0 && <div className="note">No markets match that filter.</div>}
    </>
  );
}
