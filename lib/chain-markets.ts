import { keccak256, toBytes } from "viem";
import { emptyState, launch } from "./protocol";
import { PAIRS } from "./pairs";
import type { Market } from "./types";

/** Old launcher. Its pools were priced from the ETH deposit, so market caps are wrong. */
const RETIRED_LAUNCHERS = new Set(["0x44063290406fb9a716a0e9bf5e2c278d9576d654"]);
const LAUNCHED_TOPIC = keccak256(toBytes("Launched(address,address,address)"));
const ZERO = "0x0000000000000000000000000000000000000000";
const ETH_PAIR = PAIRS.find((pair) => pair.symbol === "ETH")!.address;

interface ScoutLog {
  block_timestamp?: string;
  transaction_hash?: string;
  topics?: string[] | null;
}

interface ScoutPage {
  items?: ScoutLog[];
  next_page_params?: Record<string, string | number | null> | null;
}

interface ScoutToken {
  name?: string;
  symbol?: string;
}

function cleanAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(address) ? address : null;
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || topic.length < 42) return null;
  return cleanAddress(`0x${topic.slice(-40)}`);
}

async function explorerLogs(launcher: string): Promise<ScoutLog[]> {
  const items: ScoutLog[] = [];
  let url: string | null = `https://robinhoodchain.blockscout.com/api/v2/addresses/${launcher}/logs`;
  for (let page = 0; page < 5 && url; page++) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) break;
    const body = (await response.json()) as ScoutPage;
    items.push(...(body.items ?? []));
    const next = body.next_page_params;
    if (!next) break;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value != null) params.set(key, String(value));
    }
    url = `https://robinhoodchain.blockscout.com/api/v2/addresses/${launcher}/logs?${params}`;
  }
  return items;
}

/** Pooled Feeze launches, including ones this browser no longer has in local storage. */
export async function readChainMarkets(extra: string[] = []): Promise<Market[]> {
  const launchers = [
    ...new Set(
      extra
        .map((item) => cleanAddress(item))
        .filter((item): item is string => item !== null && !RETIRED_LAUNCHERS.has(item)),
    ),
  ];
  const seen = new Set<string>();
  const markets: Market[] = [];
  for (const launcher of launchers) {
    const logs = await explorerLogs(launcher);
    for (const log of logs) {
      const topics = log.topics ?? [];
      if (topics[0]?.toLowerCase() !== LAUNCHED_TOPIC) continue;
      const token = topicAddress(topics[1]);
      const pool = topicAddress(topics[2]);
      const creator = topicAddress(topics[3]);
      if (!token || !pool || !creator || pool === ZERO || seen.has(token)) continue;
      seen.add(token);
      const metaResponse = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${token}`, { cache: "no-store" });
      const meta = metaResponse.ok ? ((await metaResponse.json()) as ScoutToken) : {};
      const name = meta.name?.trim() || "Token";
      const symbol = meta.symbol?.trim() || "TOKEN";
      const draft = emptyState();
      draft.now = Number.isFinite(Date.parse(log.block_timestamp ?? "")) ? Date.parse(log.block_timestamp ?? "") : Date.now();
      const created = launch(draft, {
        creator,
        name,
        symbol,
        description: "",
        pair: ETH_PAIR,
        creatorTaxBps: 0,
        taxToLockers: false,
        onchain: true,
        chainAddress: token,
        chainTx: log.transaction_hash,
        poolAddress: pool,
      });
      if (created.ok) markets.push(created.value);
    }
  }
  return markets.sort((a, b) => b.launchedAt - a.launchedAt);
}
