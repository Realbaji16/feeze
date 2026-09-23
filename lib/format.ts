import { getPair } from "./pairs";

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function compact(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v === 0) return "0";
  if (v < 0.000001) return sign + v.toExponential(2);
  if (v < 0.01) return sign + v.toPrecision(3);
  if (v < 1) return sign + v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (v >= 1_000_000_000) return sign + (v / 1_000_000_000).toFixed(2) + "B";
  if (v >= 1_000_000) return sign + (v / 1_000_000).toFixed(2) + "M";
  if (v >= 10_000) return sign + (v / 1_000).toFixed(digits) + "K";
  if (v >= 1000) return sign + v.toLocaleString("en-US", { maximumFractionDigits: digits });
  return sign + v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function usd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1000) {
    return (
      sign +
      "$" +
      abs.toLocaleString("en-US", { maximumFractionDigits: abs >= 10000 ? 0 : 2 })
    );
  }
  if (abs >= 1) return sign + "$" + abs.toFixed(2);
  if (abs === 0) return "$0.00";
  if (abs < 0.000001) return sign + "$" + abs.toExponential(2);
  return sign + "$" + abs.toPrecision(3);
}

export function quoteAmount(n: number, symbol: string): string {
  return `${compact(n, n >= 100 ? 2 : 4)} ${symbol}`;
}

export function timeAgo(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "expired";
  const totalMin = Math.ceil(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 60 * 24) / 60);
  if (days >= 2) return `${days}d ${hours}h`;
  if (days === 1) return `1d ${hours}h`;
  if (hours >= 1) return `${hours}h`;
  return `${totalMin}m`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function pairUsd(pairAddress: string): number {
  return getPair(pairAddress)?.usd ?? 0;
}

export function toUsd(amount: number, pairAddress: string): number {
  return amount * pairUsd(pairAddress);
}
