"use client";

import { getPair } from "@/lib/pairs";
import { compact, usd } from "@/lib/format";
import { marketCapUsd, spotPrice, curveProgress, TOTAL_SUPPLY, GRADUATION_MARKET_CAP_USD, PONS_PHANTOM_ETH, PONS_GRADUATION_ETH } from "@/lib/protocol";
import type { Market, Phase } from "@/lib/types";

export function TokenMark({ symbol, image, size = 36 }: { symbol: string; image?: string; size?: number }) {
  const hue = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  if (image) {
    return (
      <span className="avatar" style={{ width: size, height: size }}>
        <img src={image} alt="" />
      </span>
    );
  }
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, hsl(${hue} 62% 58%), hsl(${(hue + 36) % 360} 45% 22%))`,
        color: "#111",
      }}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

export function PhasePill({ phase }: { phase: Phase }) {
  if (phase === "graduated") return <span className="pill gold">Graduated</span>;
  if (phase === "escrow") return <span className="pill warn">Escrow</span>;
  return <span className="pill">Curve</span>;
}

export function marketStats(market: Market) {
  const pair = getPair(market.pair);
  if (!pair) return null;
  if (market.onchain && market.curveAddress && !market.poolAddress && market.realTokens > 0) {
    const price = (PONS_PHANTOM_ETH + market.realQuote) / market.realTokens;
    const mcap = price * TOTAL_SUPPLY * pair.usd;
    return {
      pair,
      price,
      mcap,
      progress: Math.min(1, market.realQuote / PONS_GRADUATION_ETH),
      fdvQuote: price * TOTAL_SUPPLY,
    };
  }
  if (market.onchain && market.poolAddress && market.poolTokens > 0 && market.poolQuote > 0) {
    const price = market.poolQuote / market.poolTokens;
    const mcap = price * TOTAL_SUPPLY * pair.usd;
    return {
      pair,
      price,
      mcap,
      progress: Math.min(1, mcap / GRADUATION_MARKET_CAP_USD),
      fdvQuote: price * TOTAL_SUPPLY,
    };
  }
  const price = spotPrice(market, pair);
  return {
    pair,
    price,
    mcap: marketCapUsd(market, pair),
    progress: curveProgress(market, pair),
    fdvQuote: price * TOTAL_SUPPLY,
  };
}

export function Money({ amount, pairAddress }: { amount: number; pairAddress: string }) {
  const pair = getPair(pairAddress);
  return <span className="mono">{usd(amount * (pair?.usd ?? 0))}</span>;
}

export function Quote({ amount, symbol }: { amount: number; symbol: string }) {
  return (
    <span className="mono">
      {compact(amount, 4)} {symbol}
    </span>
  );
}

export function Progress({ value, graduated, wide }: { value: number; graduated?: boolean; wide?: boolean }) {
  const tone = graduated ? "bar gold" : "bar";
  return (
    <span className={wide ? `${tone} wide` : tone} title={`${Math.round(value * 100)}%`}>
      <span style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </span>
  );
}
