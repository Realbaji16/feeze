const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const SUPPLY = 1_000_000_000;
const ZERO = "0x0000000000000000000000000000000000000000";

export interface ChainHolder {
  address: string;
  amount: number;
  share: number;
}

export interface ChainTrade {
  hash: string;
  side: "buy" | "sell";
  tokenAmount: number;
  quoteAmount: number | null;
  trader: string;
  time: number;
}

interface ScoutParty {
  hash?: string;
}

interface ScoutTransfer {
  from?: ScoutParty;
  to?: ScoutParty;
  timestamp?: string;
  transaction_hash?: string;
  type?: string;
  total?: { value?: string; decimals?: string | number };
  token?: { address_hash?: string; decimals?: string };
}

function units(value: string, decimals: number): number {
  const raw = value.replace(/^-/, "");
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals, -decimals + 8);
  const amount = Number(`${whole}.${frac}`);
  return value.startsWith("-") ? -amount : amount;
}

async function scout<T>(path: string): Promise<T | null> {
  const response = await fetch(`https://robinhoodchain.blockscout.com/api/v2${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function readChainHolders(token: string): Promise<ChainHolder[]> {
  const body = await scout<{ items?: { address?: ScoutParty; value?: string }[] }>(
    `/tokens/${token}/holders`,
  );
  return (body?.items ?? [])
    .map((item) => {
      const address = item.address?.hash?.toLowerCase() ?? "";
      const amount = units(item.value ?? "0", 18);
      return { address, amount, share: amount / SUPPLY };
    })
    .filter((item) => item.address && item.amount > 0);
}

export async function readChainTrades(token: string, pool: string): Promise<ChainTrade[]> {
  const poolAddress = pool.toLowerCase();
  const body = await scout<{ items?: ScoutTransfer[] }>(`/tokens/${token}/transfers`);
  const items = body?.items ?? [];
  const minted = new Set(
    items.filter((item) => item.type === "token_minting" || item.from?.hash?.toLowerCase() === ZERO).map((item) => item.transaction_hash),
  );
  const swaps = items.filter((item) => {
    const hash = item.transaction_hash;
    const from = item.from?.hash?.toLowerCase();
    const to = item.to?.hash?.toLowerCase();
    if (!hash || minted.has(hash)) return false;
    return from === poolAddress || to === poolAddress;
  });
  const quotes = new Map<string, number | null>();
  await Promise.all(
    [...new Set(swaps.map((item) => item.transaction_hash!))].map(async (hash) => {
      quotes.set(hash, await quoteMoved(hash, poolAddress));
    }),
  );
  return swaps.map((item) => {
    const from = item.from?.hash?.toLowerCase() ?? "";
    const to = item.to?.hash?.toLowerCase() ?? "";
    const buy = from === poolAddress;
    const decimals = Number(item.total?.decimals ?? item.token?.decimals ?? 18);
    return {
      hash: item.transaction_hash!,
      side: buy ? "buy" : "sell",
      tokenAmount: units(item.total?.value ?? "0", decimals),
      quoteAmount: quotes.get(item.transaction_hash!) ?? null,
      trader: buy ? to : from,
      time: Date.parse(item.timestamp ?? "") || Date.now(),
    } satisfies ChainTrade;
  });
}

async function quoteMoved(hash: string, pool: string): Promise<number | null> {
  const body = await scout<{ items?: ScoutTransfer[] }>(`/transactions/${hash}/token-transfers`);
  let total = 0;
  let found = false;
  for (const item of body?.items ?? []) {
    if (item.token?.address_hash?.toLowerCase() !== WETH) continue;
    const from = item.from?.hash?.toLowerCase();
    const to = item.to?.hash?.toLowerCase();
    if (from !== pool && to !== pool) continue;
    total += units(item.total?.value ?? "0", Number(item.total?.decimals ?? item.token?.decimals ?? 18));
    found = true;
  }
  return found ? total : null;
}
