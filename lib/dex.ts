import { GRADUATION_MARKET_CAP_USD } from "./protocol";
import type { Phase } from "./types";

export interface DexQuote {
  priceUsd: number;
  priceNative: number;
  marketCap: number;
  volume24h: number;
}

export async function readDexPool(pool: string): Promise<DexQuote | null> {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${pool}`);
  if (!response.ok) return null;
  const body = (await response.json()) as { pair?: DexPair; pairs?: DexPair[] };
  const pair = body.pair ?? body.pairs?.[0];
  if (!pair) return null;
  const marketCap = Number(pair.marketCap ?? pair.fdv ?? 0);
  return {
    priceUsd: Number(pair.priceUsd ?? 0),
    priceNative: Number(pair.priceNative ?? 0),
    marketCap: Number.isFinite(marketCap) ? marketCap : 0,
    volume24h: Number(pair.volume?.h24 ?? 0),
  };
}

export function dexChartUrl(pool: string): string {
  const params = new URLSearchParams({
    embed: "1",
    theme: "dark",
    chartTheme: "dark",
    info: "0",
    trades: "0",
  });
  return `https://dexscreener.com/robinhood/${pool}?${params}`;
}

export function listedMarket(input: {
  onchain: boolean;
  phase: Phase;
  quote?: DexQuote;
  statsMcap: number;
  statsProgress: number;
}) {
  const mcap = input.quote?.marketCap ?? input.statsMcap;
  const graduated = input.onchain ? mcap >= GRADUATION_MARKET_CAP_USD : input.phase === "graduated";
  const progress = input.onchain ? Math.min(1, mcap / GRADUATION_MARKET_CAP_USD) : input.statsProgress;
  const phase: Phase = input.onchain ? (graduated ? "graduated" : "curve") : input.phase;
  return { mcap, graduated, progress, phase };
}

interface DexPair {
  priceUsd?: string;
  priceNative?: string;
  marketCap?: number;
  fdv?: number;
  volume?: { h24?: number };
}
