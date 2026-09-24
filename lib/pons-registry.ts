import { createPublicClient, erc20Abi, formatEther, http, parseAbi, type Address } from "viem";
import { robinhood } from "./chain";
import { cidFromImage, ipfsImagePath } from "./ipfs-path";
import { getValue, setValue } from "./launch-index";
import { PAIRS } from "./pairs";
import { PONS_CURVE_ABI, PONS_FACTORY, PONS_FACTORY_ABI, PONS_LAUNCH_AND_BUY } from "./pons";
import { emptyState, launch } from "./protocol";
import type { Market } from "./types";

/** Tokens launched on Pons from feeze.fun. The Pons factory lists every Pons launch, so Feeze keeps its own list. */
const COUNT_KEY = "feezepn";
const MAX_LAUNCHES = 400;
const ETH_PAIR = PAIRS.find((pair) => pair.symbol === "ETH")!.address;

const TOKEN_INFO_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

interface Entry {
  token: string;
  time: number;
  tx: string;
}

interface Static {
  curve: string;
  creator: string;
  creatorTaxBps: number;
  name: string;
  symbol: string;
  description: string;
  image?: string;
  website?: string;
  twitter?: string;
}

function rpc() {
  return createPublicClient({ chain: robinhood, transport: http(robinhood.rpcUrls.default.http[0]) });
}

const statics = new Map<string, Static>();
let listCache: { at: number; entries: Entry[] } | null = null;

async function readEntries(): Promise<Entry[]> {
  const now = Date.now();
  if (listCache && now - listCache.at < 8_000) return listCache.entries;
  const count = Math.min(MAX_LAUNCHES, Number((await getValue(COUNT_KEY)) || "0") || 0);
  const rows = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const [head, tx] = await Promise.all([getValue(`feezep${index}`), getValue(`feezept${index}`)]);
      const [token, time] = (head ?? "").split("~");
      if (!token || !/^[0-9a-f]{40}$/.test(token)) return null;
      return { token: `0x${token}`, time: Number(time) || 0, tx: tx && /^[0-9a-f]{64}$/.test(tx) ? `0x${tx}` : "" };
    }),
  );
  const seen = new Set<string>();
  const entries = rows.filter((row): row is Entry => {
    if (!row || seen.has(row.token)) return false;
    seen.add(row.token);
    return true;
  });
  listCache = { at: now, entries };
  return entries;
}

async function launchRecord(token: Address) {
  const record = await rpc().readContract({
    address: PONS_FACTORY,
    abi: PONS_FACTORY_ABI,
    functionName: "getLaunchedToken",
    args: [token],
  });
  return record.exists ? record : null;
}

async function readStatic(token: string): Promise<Static | null> {
  const cached = statics.get(token);
  if (cached) return cached;
  const client = rpc();
  const address = token as Address;
  const record = await launchRecord(address);
  if (!record) return null;
  const [name, symbol, info] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: TOKEN_INFO_ABI, functionName: "getTokenInfo" }).catch(() => null),
  ]);
  const cid = info ? cidFromImage(info[1]) : null;
  const found: Static = {
    curve: record.curve.toLowerCase(),
    creator: record.creatorFeeRecipient.toLowerCase(),
    creatorTaxBps: Number(record.creatorTaxBps),
    name,
    symbol,
    description: info?.[2] ?? "",
    image: cid ? ipfsImagePath(cid) : undefined,
    website: info?.[3].website || undefined,
    twitter: info?.[3].twitter || undefined,
  };
  statics.set(token, found);
  return found;
}

async function readReserves(curve: Address): Promise<{ realQuote: number; tokens: number; graduated: boolean } | null> {
  const client = rpc();
  try {
    const [reserves, realQuote, graduated] = await Promise.all([
      client.readContract({ address: curve, abi: PONS_CURVE_ABI, functionName: "getReserves" }),
      client.readContract({ address: curve, abi: PONS_CURVE_ABI, functionName: "realQuoteReserve" }),
      client.readContract({ address: curve, abi: PONS_CURVE_ABI, functionName: "graduated" }),
    ]);
    return { realQuote: Number(formatEther(realQuote)), tokens: Number(formatEther(reserves[1])), graduated };
  } catch {
    return null;
  }
}

/** Reads the live Pons contracts and checks the selectors Feeze calls are deployed. */
export async function probePons(curve: string) {
  const client = rpc();
  const [fee, maxTax, config, open, factoryCode, routerCode] = await Promise.all([
    client.readContract({ address: PONS_FACTORY, abi: PONS_FACTORY_ABI, functionName: "launchFee" }),
    client.readContract({ address: PONS_FACTORY, abi: PONS_FACTORY_ABI, functionName: "maxCreatorTaxBps" }),
    client.readContract({ address: PONS_FACTORY, abi: PONS_FACTORY_ABI, functionName: "getLaunchConfig", args: [0n] }),
    client.readContract({
      address: PONS_FACTORY,
      abi: PONS_FACTORY_ABI,
      functionName: "canLaunch",
      args: ["0x1111111111111111111111111111111111111111"],
    }),
    client.getCode({ address: PONS_FACTORY }),
    client.getCode({ address: PONS_LAUNCH_AND_BUY }),
  ]);
  const has = (code: string | undefined, selector: string) => Boolean(code?.toLowerCase().includes(selector));
  let curveCode: string | undefined;
  let reserves: unknown = null;
  if (/^0x[0-9a-fA-F]{40}$/.test(curve)) {
    curveCode = await client.getCode({ address: curve as Address });
    reserves = await readReserves(curve as Address);
  }
  return {
    launchFee: fee.toString(),
    maxCreatorTaxBps: maxTax.toString(),
    config: {
      supply: config.supply.toString(),
      curveFeeBps: config.curveFeeBps.toString(),
      phantomQuote: config.phantomQuote.toString(),
      graduationThreshold: config.graduationThreshold.toString(),
      enabled: config.enabled,
    },
    publicLaunch: open,
    launchToken3: has(factoryCode, "f35abbcf"),
    launchAndBuy: has(routerCode, "f85f8e41"),
    curveBuy: curveCode ? has(curveCode, "59a87bc1") : null,
    curveSell: curveCode ? has(curveCode, "d04c6983") : null,
    curveCodeSize: curveCode ? curveCode.length : null,
    reserves,
  };
}

/** Record a Feeze launch after checking the Pons factory actually created it. */
export async function registerPonsLaunch(token: string, tx: string): Promise<void> {
  const address = token.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("Expected a token address");
  const hash = tx.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error("Expected a transaction hash");
  if (!(await launchRecord(address as Address))) throw new Error("That token was not launched on Pons");
  listCache = null;
  const entries = await readEntries();
  if (entries.some((entry) => entry.token === address)) return;
  const count = Number((await getValue(COUNT_KEY)) || "0") || 0;
  if (count >= MAX_LAUNCHES) throw new Error("The Feeze launch list is full");
  await setValue(`feezep${count}`, `${address.slice(2)}~${Date.now()}`);
  await setValue(`feezept${count}`, hash.slice(2));
  await setValue(COUNT_KEY, String(count + 1));
  listCache = null;
}

export async function readPonsMarkets(): Promise<Market[]> {
  const entries = await readEntries();
  const markets = await Promise.all(
    entries.map(async (entry) => {
      const meta = await readStatic(entry.token).catch(() => null);
      if (!meta) return null;
      const reserves = await readReserves(meta.curve as Address);
      const draft = emptyState();
      draft.now = entry.time || Date.now();
      const created = launch(draft, {
        creator: meta.creator,
        name: meta.name,
        symbol: meta.symbol,
        description: meta.description,
        image: meta.image,
        website: meta.website,
        twitter: meta.twitter,
        pair: ETH_PAIR,
        creatorTaxBps: Math.min(1000, meta.creatorTaxBps),
        taxToLockers: false,
        onchain: true,
        chainAddress: entry.token,
        chainTx: entry.tx || undefined,
        curveAddress: meta.curve,
        curveTokens: reserves && reserves.tokens > 0 ? reserves.tokens : undefined,
        curveQuote: reserves?.realQuote ?? 0,
      });
      return created.ok ? created.value : null;
    }),
  );
  return markets.filter((market): market is Market => market !== null);
}
