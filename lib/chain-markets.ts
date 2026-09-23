import { createPublicClient, erc20Abi, formatEther, http, keccak256, parseAbiItem, toBytes, type Address } from "viem";
import { robinhood } from "./chain";
import { emptyState, launch } from "./protocol";
import { PAIRS } from "./pairs";
import type { Market } from "./types";

/** Old launcher. Its pools were priced from the ETH deposit, so market caps are wrong. */
const RETIRED_LAUNCHERS = new Set(["0x44063290406fb9a716a0e9bf5e2c278d9576d654"]);
/** Shared launcher. Every browser lists pools created here, including launches from localhost. */
export const CANONICAL_LAUNCHER = "0x9e5334bd07bec96f796392c70c32b5b75c7fd75b";
/** Shared curve factory. Every browser lists tokens created here. */
export const CANONICAL_CURVE = "0xaa0b42c5b5663c6faf6c05c48145e1aa1691038c";
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

const SCOUT_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Feeze/1.0)",
};

async function explorerLogs(launcher: string): Promise<ScoutLog[]> {
  const items: ScoutLog[] = [];
  let url: string | null = `https://robinhoodchain.blockscout.com/api/v2/addresses/${launcher}/logs`;
  for (let page = 0; page < 5 && url; page++) {
    const response = await fetch(url, { cache: "no-store", headers: SCOUT_HEADERS });
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

interface RawLaunch {
  token: string;
  pool: string;
  creator: string;
  tx?: string;
  time: number;
}

function rpc() {
  return createPublicClient({ chain: robinhood, transport: http(robinhood.rpcUrls.default.http[0]) });
}

/** Blockscout is empty from some hosts. The chain itself still has the launch logs. */
async function rpcLogs(launcher: string): Promise<RawLaunch[]> {
  const client = rpc();
  const latest = await client.getBlockNumber();
  const span = 49_999n;
  const start = latest > 500_000n ? latest - 500_000n : 0n;
  const event = parseAbiItem("event Launched(address indexed token, address indexed pool, address indexed creator)");
  const found: RawLaunch[] = [];
  for (let from = start; from <= latest; from += span) {
    const to = from + span - 1n > latest ? latest : from + span - 1n;
    const logs = await client.getLogs({
      address: launcher as Address,
      event,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const token = cleanAddress(log.args.token ?? "");
      const pool = cleanAddress(log.args.pool ?? "");
      const creator = cleanAddress(log.args.creator ?? "");
      if (!token || !pool || !creator || pool === ZERO) continue;
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      found.push({
        token,
        pool,
        creator,
        tx: log.transactionHash,
        time: Number(block.timestamp) * 1000,
      });
    }
  }
  return found;
}

async function scoutLaunches(launcher: string): Promise<RawLaunch[]> {
  const logs = await explorerLogs(launcher);
  const found: RawLaunch[] = [];
  for (const log of logs) {
    const topics = log.topics ?? [];
    if (topics[0]?.toLowerCase() !== LAUNCHED_TOPIC) continue;
    const token = topicAddress(topics[1]);
    const pool = topicAddress(topics[2]);
    const creator = topicAddress(topics[3]);
    if (!token || !pool || !creator || pool === ZERO) continue;
    found.push({
      token,
      pool,
      creator,
      tx: log.transaction_hash,
      time: Number.isFinite(Date.parse(log.block_timestamp ?? "")) ? Date.parse(log.block_timestamp ?? "") : Date.now(),
    });
  }
  return found;
}

async function tokenMeta(token: string): Promise<{ name: string; symbol: string }> {
  try {
    const response = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${token}`, {
      cache: "no-store",
      headers: SCOUT_HEADERS,
    });
    if (response.ok) {
      const meta = (await response.json()) as ScoutToken;
      if (meta.name?.trim() && meta.symbol?.trim()) return { name: meta.name.trim(), symbol: meta.symbol.trim() };
    }
  } catch {
    // Fall through to the token contract.
  }
  const client = rpc();
  const address = token as Address;
  const [name, symbol] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { name, symbol };
}

async function readCurveMarkets(factories: string[]): Promise<Market[]> {
  const client = rpc();
  const event = parseAbiItem("event Launched(address indexed token, address indexed curve, address indexed creator)");
  const markets: Market[] = [];
  const seen = new Set<string>();
  for (const factory of factories) {
    const latest = await client.getBlockNumber();
    const span = 49_999n;
    const start = latest > 500_000n ? latest - 500_000n : 0n;
    for (let from = start; from <= latest; from += span) {
      const to = from + span - 1n > latest ? latest : from + span - 1n;
      const logs = await client.getLogs({ address: factory as Address, event, fromBlock: from, toBlock: to });
      for (const log of logs) {
        const token = cleanAddress(log.args.token ?? "");
        const curve = cleanAddress(log.args.curve ?? "");
        const creator = cleanAddress(log.args.creator ?? "");
        if (!token || !curve || !creator || seen.has(token)) continue;
        seen.add(token);
        let name = "Token";
        let symbol = "TOKEN";
        try {
          const meta = await tokenMeta(token);
          name = meta.name;
          symbol = meta.symbol;
        } catch {
          // Keep the placeholder if metadata cannot be read.
        }
        let curveTokens = 1_000_000_000;
        let curveQuote = 0;
        let pool: string | undefined;
        try {
          const curveAbi = [
            { type: "function", name: "realQuote", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
            { type: "function", name: "tokenReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
            { type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
            { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
          ] as const;
          const [quote, tokens, poolAddr, graduated] = await Promise.all([
            client.readContract({ address: curve as Address, abi: curveAbi, functionName: "realQuote" }),
            client.readContract({ address: curve as Address, abi: curveAbi, functionName: "tokenReserve" }),
            client.readContract({ address: curve as Address, abi: curveAbi, functionName: "pool" }),
            client.readContract({ address: curve as Address, abi: curveAbi, functionName: "graduated" }),
          ]);
          curveQuote = Number(formatEther(quote));
          curveTokens = Number(formatEther(tokens));
          if (graduated && poolAddr !== "0x0000000000000000000000000000000000000000") pool = poolAddr.toLowerCase();
        } catch {
          // The launch event is enough to list the market at the opening price.
        }
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        const draft = emptyState();
        draft.now = Number(block.timestamp) * 1000;
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
          chainTx: log.transactionHash,
          curveAddress: curve,
          curveTokens: curveTokens > 0 ? curveTokens : undefined,
          curveQuote,
          poolAddress: pool,
        });
        if (created.ok) markets.push(created.value);
      }
    }
  }
  return markets;
}

/** Recent Launched events from any contract, so a new curve factory can be shared. */
export async function discoverLaunchers(): Promise<
  { address: string; token: string; second: string; creator: string; block: string }[]
> {
  const client = rpc();
  const latest = await client.getBlockNumber();
  const event = parseAbiItem("event Launched(address indexed token, address indexed curve, address indexed creator)");
  const found: { address: string; token: string; second: string; creator: string; block: string }[] = [];
  const span = 2_000n;
  const start = latest > 20_000n ? latest - 20_000n : 0n;
  for (let from = start; from <= latest; from += span) {
    const to = from + span - 1n > latest ? latest : from + span - 1n;
    try {
      const logs = await client.getLogs({ event, fromBlock: from, toBlock: to });
      for (const log of logs) {
        found.push({
          address: log.address.toLowerCase(),
          token: (log.args.token ?? "").toLowerCase(),
          second: (log.args.curve ?? "").toLowerCase(),
          creator: (log.args.creator ?? "").toLowerCase(),
          block: log.blockNumber.toString(),
        });
      }
    } catch (error) {
      found.push({
        address: "error",
        token: from.toString(),
        second: error instanceof Error ? error.message.slice(0, 160) : "fail",
        creator: "",
        block: to.toString(),
      });
    }
  }
  return found;
}

/** Pooled Feeze launches, including ones this browser no longer has in local storage. */
export async function readChainMarkets(extra: string[] = [], curves: string[] = []): Promise<Market[]> {
  const launchers = [
    ...new Set(
      [CANONICAL_LAUNCHER, ...extra]
        .map((item) => cleanAddress(item))
        .filter((item): item is string => item !== null && !RETIRED_LAUNCHERS.has(item)),
    ),
  ];
  const seen = new Set<string>();
  const markets: Market[] = [];
  for (const launcher of launchers) {
    let launches: RawLaunch[] = [];
    try {
      launches = await scoutLaunches(launcher);
    } catch {
      launches = [];
    }
    if (!launches.length) {
      try {
        launches = await rpcLogs(launcher);
      } catch {
        launches = [];
      }
    }
    for (const item of launches) {
      if (seen.has(item.token)) continue;
      seen.add(item.token);
      let name = "Token";
      let symbol = "TOKEN";
      try {
        const meta = await tokenMeta(item.token);
        name = meta.name;
        symbol = meta.symbol;
      } catch {
        // Keep the placeholder if both metadata sources fail.
      }
      const draft = emptyState();
      draft.now = item.time;
      const created = launch(draft, {
        creator: item.creator,
        name,
        symbol,
        description: "",
        pair: ETH_PAIR,
        creatorTaxBps: 0,
        taxToLockers: false,
        onchain: true,
        chainAddress: item.token,
        chainTx: item.tx,
        poolAddress: item.pool,
      });
      if (created.ok) markets.push(created.value);
    }
  }
  const curveFactories = [CANONICAL_CURVE, ...curves]
    .map((item) => cleanAddress(item))
    .filter((item): item is string => item !== null && !RETIRED_LAUNCHERS.has(item));
  const curved = curveFactories.length ? await readCurveMarkets(curveFactories) : [];
  for (const market of curved) {
    if (seen.has(market.address)) continue;
    seen.add(market.address);
    markets.push(market);
  }
  return markets.sort((a, b) => b.launchedAt - a.launchedAt);
}
