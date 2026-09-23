import { getPair, PAIRS, type Pair } from "./pairs";
import type {
  ActionResult,
  Activity,
  Bribe,
  BuybackSchedule,
  LockKind,
  LockPosition,
  Market,
  ProtocolState,
  RevenueEvent,
  Trade,
} from "./types";

export const TOTAL_SUPPLY = 1_000_000_000;
/** Curve inventory. The complement seeds the locked v4 position at the final curve price. */
export const CURVE_TOKENS = (TOTAL_SUPPLY * 11) / 12;
export const LP_TOKENS = TOTAL_SUPPLY - CURVE_TOKENS;
export const BASE_FEE = 0.01;
export const LOCKER_SHARE = 0.6;
export const PROTOCOL_SHARE = 0.3;
export const CREATOR_SHARE = 0.1;
export const BURN_SHARE = 0.7;
export const YEELD_LOCKER_SHARE = 0.2;
export const OPS_SHARE = 0.1;
export const BUYBACK_FEE = 0.003;
export const MIN_LOCK_MS = 12 * 60 * 60 * 1000;
export const MAX_REWARD_LOCK_MS = 365 * 24 * 60 * 60 * 1000;
export const MAX_UNIVERSAL_LOCK_MS = 10 * 365 * 24 * 60 * 60 * 1000;
export const GRACE_MS = 24 * 60 * 60 * 1000;
export const DEAD = "0x000000000000000000000000000000000000dead";
export const DEMO_WALLET = "0x1111111111111111111111111111111111111111";
export const MAKER_WALLET = "0x2222222222222222222222222222222222222222";
export const OPS_TREASURY = "0x4deafeaaf09a7887f9a6f17d51445b8beb0d7e2c";

const TOKEN_DP = 6;
const QUOTE_DP = 8;

export function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function roundToken(n: number): number {
  return round(n, TOKEN_DP);
}

export function roundQuote(n: number): number {
  return round(n, QUOTE_DP);
}

/** Continuous x^(5/8) map from the lock window onto a 1x–6x multiplier. */
export function lockMultiplier(durationMs: number, maxMs = MAX_REWARD_LOCK_MS): number {
  const span = maxMs - MIN_LOCK_MS;
  const x = Math.min(1, Math.max(0, (durationMs - MIN_LOCK_MS) / span));
  return round(1 + 5 * Math.pow(x, 5 / 8), 4);
}

export function asAddress(value: string): string {
  const address = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("Wallet address is not a 20-byte hex address");
  return address;
}

export function fundSimulator(state: ProtocolState, account: string) {
  state.balances[account] = { ETH: 40 };
  for (const item of PAIRS) {
    if (item.symbol === "ETH") continue;
    state.balances[account][item.address] = item.symbol === "USDG" ? 250_000 : 4_000;
  }
}

export function toAddress(seed: string): string {
  let hex = "";
  let x = 0x811c9dc5;
  let s = seed;
  while (hex.length < 40) {
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 0x01000193);
    }
    hex += (x >>> 0).toString(16).padStart(8, "0");
    s = hex;
  }
  return "0x" + hex.slice(0, 40);
}

export function txHash(seed: string): string {
  return toAddress(seed).replace(/^0x/, "0x" + "ab").slice(0, 66).padEnd(66, "0");
}

function rid(state: ProtocolState, salt: string): string {
  state.nonce += 1;
  return toAddress(`${salt}:${state.nonce}:${state.now}`);
}

export function emptyState(now = Date.UTC(2026, 8, 22, 12, 0, 0)): ProtocolState {
  return {
    now,
    wallet: null,
    balances: {},
    markets: [],
    locks: [],
    bribes: [],
    buybacks: [],
    burnReserve: {},
    yeeldLockerReserve: {},
    operations: {},
    yeeldIndexes: {},
    yeeldEffective: 0,
    burnedYeeld: 0,
    revenueEvents: [],
    activity: [],
    failNextGraduation: false,
    nonce: 1,
  };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function credit(state: ProtocolState, account: string, asset: string, amount: number) {
  if (!state.balances[account]) state.balances[account] = {};
  const next = roundQuote((state.balances[account][asset] ?? 0) + amount);
  state.balances[account][asset] = next;
}

function debit(
  state: ProtocolState,
  account: string,
  asset: string,
  amount: number,
): string | null {
  const have = state.balances[account]?.[asset] ?? 0;
  if (have + 1e-9 < amount) return "Insufficient balance";
  state.balances[account][asset] = roundQuote(have - amount);
  return null;
}

export function balanceOf(state: ProtocolState, account: string, asset: string): number {
  return state.balances[account]?.[asset] ?? 0;
}

export function assetKey(pair: Pair): string {
  return pair.symbol === "ETH" ? "ETH" : pair.address;
}

export function findMarket(state: ProtocolState, address: string): Market | undefined {
  const key = address.toLowerCase();
  return state.markets.find((market) => market.address === key);
}

export function protocolMarket(state: ProtocolState): Market | undefined {
  return state.markets.find((market) => market.isProtocol);
}

function pushActivity(state: ProtocolState, text: string, href?: string) {
  const item: Activity = { id: rid(state, "act"), time: state.now, text, href };
  state.activity.unshift(item);
  state.activity = state.activity.slice(0, 120);
}

function addReserve(bucket: Record<string, number>, asset: string, amount: number) {
  if (amount <= 0) return;
  bucket[asset] = roundQuote((bucket[asset] ?? 0) + amount);
}

function recordProtocol(
  state: ProtocolState,
  asset: string,
  amount: number,
  kind: RevenueEvent["kind"],
  note: string,
) {
  if (amount <= 0) return;
  const burn = roundQuote(amount * BURN_SHARE);
  const lockers = roundQuote(amount * YEELD_LOCKER_SHARE);
  const operations = roundQuote(amount - burn - lockers);
  addReserve(state.burnReserve, asset, burn);
  addReserve(state.yeeldLockerReserve, asset, lockers);
  addReserve(state.operations, asset, operations);
  credit(state, OPS_TREASURY, asset, operations);
  const event: RevenueEvent = {
    id: rid(state, "rev"),
    kind,
    asset,
    amount: roundQuote(amount),
    burn,
    lockers,
    operations,
    time: state.now,
    tx: txHash(`rev:${state.nonce}:${state.now}`),
    note,
  };
  state.revenueEvents.unshift(event);
  state.revenueEvents = state.revenueEvents.slice(0, 80);
}

function distributeLaunchRewards(state: ProtocolState, market: Market, asset: string, amount: number) {
  if (amount <= 0) return;
  if (market.totalEffective <= 0) {
    market.orphanPot = roundQuote(market.orphanPot + amount);
    if (!market.orphanSince) market.orphanSince = state.now;
    return;
  }
  market.indexes[asset] = (market.indexes[asset] ?? 0) + amount / market.totalEffective;
}

function feeParts(gross: number, taxBps: number) {
  const taxRate = taxBps / 10_000;
  const base = gross * BASE_FEE;
  const tax = gross * taxRate;
  const net = gross - base - tax;
  return { base, tax, net, taxRate };
}

function applyFeeSplit(
  state: ProtocolState,
  market: Market,
  pair: Pair,
  base: number,
  tax: number,
) {
  const asset = assetKey(pair);
  const toLockers = base * LOCKER_SHARE + (market.taxToLockers ? tax : 0);
  const toCreator = base * CREATOR_SHARE + (market.taxToLockers ? 0 : tax);
  const toProtocol = base * PROTOCOL_SHARE;
  market.creatorReserve = roundQuote(market.creatorReserve + toCreator);
  distributeLaunchRewards(state, market, asset, toLockers);
  market.lockerCapital = roundQuote(market.lockerCapital + toLockers);
  recordProtocol(state, asset, toProtocol, "fee", `${market.symbol} trade fee`);
}

interface Spot {
  tokenReserve: number;
  quoteReserve: number;
}

function spot(market: Market, pair: Pair): Spot {
  if (market.phase === "graduated") {
    return { tokenReserve: market.poolTokens, quoteReserve: market.poolQuote };
  }
  if (market.phase === "escrow") {
    return { tokenReserve: market.escrowTokens, quoteReserve: market.escrowQuote };
  }
  return {
    tokenReserve: market.realTokens + market.virtualOffset,
    quoteReserve: market.realQuote + pair.phantom,
  };
}

export function spotPrice(market: Market, pair: Pair): number {
  const s = spot(market, pair);
  if (s.tokenReserve <= 0) return 0;
  return s.quoteReserve / s.tokenReserve;
}

export function marketCapUsd(market: Market, pair: Pair): number {
  return spotPrice(market, pair) * TOTAL_SUPPLY * pair.usd;
}

export function curveProgress(market: Market, pair: Pair): number {
  if (market.phase !== "curve") return 1;
  if (pair.threshold <= 0) return 0;
  return Math.min(1, market.realQuote / pair.threshold);
}

function previewOut(reserveToken: number, reserveQuote: number, netQuote: number): number {
  const k = reserveToken * reserveQuote;
  const nextQuote = reserveQuote + netQuote;
  const nextToken = k / nextQuote;
  return reserveToken - nextToken;
}

function previewSell(reserveToken: number, reserveQuote: number, tokensIn: number): number {
  const k = reserveToken * reserveQuote;
  const nextToken = reserveToken + tokensIn;
  const nextQuote = k / nextToken;
  return reserveQuote - nextQuote;
}

export interface Quote {
  side: "buy" | "sell";
  tokens: number;
  quoteGross: number;
  quoteNet: number;
  refund: number;
  baseFee: number;
  taxFee: number;
  priceAfter: number;
  impact: number;
  graduates: boolean;
  partial: boolean;
}

export function quoteTrade(
  market: Market,
  pair: Pair,
  side: "buy" | "sell",
  amount: number,
): Quote | { error: string } {
  if (market.phase === "escrow") return { error: "Graduation is in progress. Retry it before trading." };
  if (!(amount > 0)) return { error: "Enter an amount" };
  const taxBps = market.creatorTaxBps;
  const feeRate = BASE_FEE + taxBps / 10_000;
  if (feeRate >= 1) return { error: "Fee configuration is invalid" };
  const before = spotPrice(market, pair);
  const s = spot(market, pair);

  if (side === "buy") {
    let gross = amount;
    let partial = false;
    let graduates = false;
    if (market.phase === "curve") {
      const room = pair.threshold - market.realQuote;
      const maxGross = room / (1 - feeRate);
      if (gross > maxGross + 1e-10) {
        gross = Math.max(0, maxGross);
        partial = true;
        graduates = true;
      } else if (Math.abs(gross - maxGross) < 1e-8) {
        graduates = true;
      }
    }
    const parts = feeParts(gross, taxBps);
    if (parts.net <= 0) return { error: "Amount is too small after fees" };
    const tokens = previewOut(s.tokenReserve, s.quoteReserve, parts.net);
    if (!(tokens > 0)) return { error: "Quote returned no tokens" };
    const nextToken = s.tokenReserve - tokens;
    const priceAfter = (s.quoteReserve + parts.net) / nextToken;
    const impact = before > 0 ? (priceAfter - before) / before : 0;
    return {
      side,
      tokens: roundToken(tokens),
      quoteGross: roundQuote(gross),
      quoteNet: roundQuote(parts.net),
      refund: roundQuote(amount - gross),
      baseFee: roundQuote(parts.base),
      taxFee: roundQuote(parts.tax),
      priceAfter,
      impact,
      graduates,
      partial,
    };
  }

  if (market.phase === "curve" && amount > market.realTokens + 1e-9) {
    return { error: "Curve does not hold that many tokens" };
  }
  if (market.phase === "graduated" && amount > market.poolTokens * 0.99) {
    return { error: "Sell exceeds available pool liquidity" };
  }
  const grossOut = previewSell(s.tokenReserve, s.quoteReserve, amount);
  if (!(grossOut > 0) || grossOut >= s.quoteReserve) return { error: "Insufficient liquidity" };
  const parts = feeParts(grossOut, taxBps);
  const nextQuote = s.quoteReserve - grossOut;
  const priceAfter = nextQuote / (s.tokenReserve + amount);
  const impact = before > 0 ? (priceAfter - before) / before : 0;
  return {
    side,
    tokens: roundToken(amount),
    quoteGross: roundQuote(grossOut),
    quoteNet: roundQuote(parts.net),
    refund: 0,
    baseFee: roundQuote(parts.base),
    taxFee: roundQuote(parts.tax),
    priceAfter,
    impact,
    graduates: false,
    partial: false,
  };
}

function applyBuy(market: Market, pair: Pair, net: number, tokens: number) {
  if (market.phase === "graduated") {
    market.poolQuote = roundQuote(market.poolQuote + net);
    market.poolTokens = roundToken(market.poolTokens - tokens);
    return;
  }
  market.realQuote = roundQuote(market.realQuote + net);
  market.realTokens = roundToken(market.realTokens - tokens);
}

function applySell(market: Market, pair: Pair, tokens: number, grossOut: number) {
  if (market.phase === "graduated") {
    market.poolQuote = roundQuote(market.poolQuote - grossOut);
    market.poolTokens = roundToken(market.poolTokens + tokens);
    return;
  }
  market.realQuote = roundQuote(market.realQuote - grossOut);
  market.realTokens = roundToken(market.realTokens + tokens);
}

function maybeEscrow(state: ProtocolState, market: Market, pair: Pair) {
  if (market.phase !== "curve") return;
  if (market.realQuote + 1e-8 < pair.threshold) return;
  market.phase = "escrow";
  market.escrowQuote = market.realQuote;
  market.escrowTokens = market.realTokens;
  market.realQuote = 0;
  market.realTokens = 0;
}

export function graduate(state: ProtocolState, marketAddress: string, caller: string): ActionResult<Market> {
  const next = clone(state);
  const market = findMarket(next, marketAddress);
  if (!market) return { ok: false, error: "Market not found" };
  if (market.phase === "graduated") return { ok: false, error: "Already graduated" };
  if (market.phase !== "escrow") return { ok: false, error: "Curve has not reached its target" };
  if (next.failNextGraduation) {
    next.failNextGraduation = false;
    pushActivity(next, `${market.symbol} graduation retry failed in the v4 seed. Trade still stands.`, `/coin/${market.address}`);
    return { ok: true, state: next, value: market };
  }
  const pair = getPair(market.pair);
  if (!pair) return { ok: false, error: "Pair missing" };
  market.poolQuote = market.escrowQuote;
  market.poolTokens = roundToken(market.lpTokens + market.escrowTokens);
  market.escrowQuote = 0;
  market.escrowTokens = 0;
  market.lpTokens = 0;
  market.phase = "graduated";
  market.graduatedAt = next.now;
  pushActivity(next, `${caller === DEMO_WALLET ? "You" : "Someone"} graduated ${market.symbol} into locked v4 liquidity`, `/coin/${market.address}`);
  return { ok: true, state: next, value: market };
}

function settleGraduation(state: ProtocolState, market: Market, caller: string) {
  if (market.phase !== "escrow") return;
  const result = graduate(state, market.address, caller);
  if (result.ok) {
    const updated = findMarket(result.state, market.address);
    if (updated) Object.assign(market, updated);
    state.failNextGraduation = result.state.failNextGraduation;
    state.activity = result.state.activity;
    state.nonce = result.state.nonce;
  }
}

export interface LaunchInput {
  creator: string;
  name: string;
  symbol: string;
  description: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  pair: string;
  creatorTaxBps: number;
  taxToLockers: boolean;
  initialBuy?: number;
  slippageBps?: number;
  /** Confirmed on-chain token. Skips the hashed preview address. */
  chainAddress?: string;
  chainTx?: string;
  onchain?: boolean;
  poolAddress?: string;
}

export function previewAddress(input: Pick<LaunchInput, "creator" | "symbol" | "pair" | "name">, nonce: number): string {
  return toAddress(`create2:${input.creator}:${input.name}:${input.symbol}:${input.pair}:${nonce}`);
}

export function launch(state: ProtocolState, input: LaunchInput): ActionResult<Market> {
  const name = input.name.trim();
  const symbol = input.symbol.trim().toUpperCase().replace(/^\$/, "");
  if (name.length < 2 || name.length > 32) return { ok: false, error: "Name must be 2–32 characters" };
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) return { ok: false, error: "Ticker must be 2–10 letters or numbers" };
  if (input.creatorTaxBps < 0 || input.creatorTaxBps > 1000 || !Number.isInteger(input.creatorTaxBps)) {
    return { ok: false, error: "Creator tax must be a whole number of basis points from 0 to 1000" };
  }
  const pair = getPair(input.pair);
  if (!pair) return { ok: false, error: "Quote asset is not allowlisted" };
  const next = clone(state);
  const address = input.chainAddress ? asAddress(input.chainAddress) : previewAddress({ ...input, name, symbol }, next.nonce);
  const market: Market = {
    address,
    creator: input.creator,
    name,
    symbol,
    description: input.description.trim(),
    image: input.image?.trim() || undefined,
    website: input.website?.trim() || undefined,
    twitter: input.twitter?.trim() || undefined,
    telegram: input.telegram?.trim() || undefined,
    pair: pair.address,
    creatorTaxBps: input.creatorTaxBps,
    taxToLockers: input.taxToLockers,
    venue: "yeeld",
    isProtocol: false,
    launchedAt: next.now,
    tx: input.chainTx ?? txHash(`launch:${address}`),
    phase: input.onchain && input.poolAddress ? "graduated" : "curve",
    onchain: input.onchain,
    poolAddress: input.poolAddress,
    realTokens: CURVE_TOKENS,
    realQuote: 0,
    virtualOffset: CURVE_TOKENS / 10,
    lpTokens: LP_TOKENS,
    escrowTokens: 0,
    escrowQuote: 0,
    poolTokens: 0,
    poolQuote: 0,
    graduatedAt: null,
    lockerCapital: 0,
    creatorReserve: 0,
    orphanPot: 0,
    orphanSince: null,
    indexes: {},
    totalEffective: 0,
    trades: [],
    lastTradeAt: null,
    volumeQuote: 0,
  };
  next.markets.unshift(market);
  pushActivity(next, `${symbol} launched against ${pair.symbol}`, `/coin/${address}`);
  if (input.onchain) return { ok: true, state: next, value: market };
  if (input.initialBuy && input.initialBuy > 0) {
    const bought = trade(next, {
      trader: input.creator,
      market: address,
      side: "buy",
      amount: input.initialBuy,
      slippageBps: input.slippageBps ?? 100,
    });
    if (!bought.ok) return { ok: false, error: `Launch reverted: ${bought.error}` };
    return { ok: true, state: bought.state, value: findMarket(bought.state, address)! };
  }
  return { ok: true, state: next, value: market };
}

export function trade(
  state: ProtocolState,
  args: {
    trader: string;
    market: string;
    side: "buy" | "sell";
    amount: number;
    slippageBps: number;
    minOut?: number;
  },
): ActionResult<Trade> {
  const next = clone(state);
  const market = findMarket(next, args.market);
  if (!market) return { ok: false, error: "Market not found" };
  const pair = getPair(market.pair);
  if (!pair) return { ok: false, error: "Pair missing" };
  const quoted = quoteTrade(market, pair, args.side, args.amount);
  if ("error" in quoted) return { ok: false, error: quoted.error };
  const asset = assetKey(pair);
  if (args.side === "buy") {
    const err = debit(next, args.trader, asset, quoted.quoteGross);
    if (err) return { ok: false, error: err };
    const minTokens =
      args.minOut ?? roundToken(quoted.tokens * (1 - Math.max(0, args.slippageBps) / 10_000));
    if (quoted.tokens + 1e-9 < minTokens) return { ok: false, error: "Slippage: minimum received not met" };
    applyBuy(market, pair, quoted.quoteNet, quoted.tokens);
    credit(next, args.trader, market.address, quoted.tokens);
  } else {
    const err = debit(next, args.trader, market.address, quoted.tokens);
    if (err) return { ok: false, error: err };
    const minQuote =
      args.minOut ?? roundQuote(quoted.quoteNet * (1 - Math.max(0, args.slippageBps) / 10_000));
    if (quoted.quoteNet + 1e-9 < minQuote) return { ok: false, error: "Slippage: minimum received not met" };
    applySell(market, pair, quoted.tokens, quoted.quoteGross);
    credit(next, args.trader, asset, quoted.quoteNet);
  }
  applyFeeSplit(next, market, pair, quoted.baseFee, quoted.taxFee);
  const row: Trade = {
    id: rid(next, "trade"),
    side: args.side,
    tokenAmount: quoted.tokens,
    quoteGross: quoted.quoteGross,
    quoteNet: quoted.quoteNet,
    feeBase: quoted.baseFee,
    feeTax: quoted.taxFee,
    price: spotPrice(market, pair),
    trader: args.trader,
    time: next.now,
    tx: txHash(`trade:${next.nonce}`),
    venue: market.phase === "graduated" ? "v4" : "curve",
  };
  market.trades.unshift(row);
  market.trades = market.trades.slice(0, 80);
  market.lastTradeAt = next.now;
  market.volumeQuote = roundQuote(market.volumeQuote + quoted.quoteGross);
  maybeEscrow(next, market, pair);
  if (market.phase === "escrow") settleGraduation(next, market, args.trader);
  const verb = args.side === "buy" ? "bought" : "sold";
  pushActivity(
    next,
    `${shortTrader(args.trader)} ${verb} ${market.symbol}`,
    `/coin/${market.address}`,
  );
  return { ok: true, state: next, value: row };
}

function shortTrader(addr: string): string {
  if (addr === DEMO_WALLET) return "You";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function claimCreator(state: ProtocolState, marketAddress: string, caller: string): ActionResult<number> {
  const next = clone(state);
  const market = findMarket(next, marketAddress);
  if (!market) return { ok: false, error: "Market not found" };
  if (caller !== market.creator) return { ok: false, error: "Only the creator can claim this reserve" };
  if (market.creatorReserve <= 0) return { ok: false, error: "Nothing to claim" };
  const pair = getPair(market.pair);
  if (!pair) return { ok: false, error: "Pair missing" };
  const amount = market.creatorReserve;
  market.creatorReserve = 0;
  credit(next, caller, assetKey(pair), amount);
  pushActivity(next, `Creator claimed ${market.symbol} fees`, `/coin/${market.address}`);
  return { ok: true, state: next, value: amount };
}

export function createLock(
  state: ProtocolState,
  args: { owner: string; token: string; amount: number; durationMs: number; kind: LockKind },
): ActionResult<LockPosition> {
  if (!(args.amount > 0)) return { ok: false, error: "Enter an amount" };
  const max = args.kind === "universal" ? MAX_UNIVERSAL_LOCK_MS : MAX_REWARD_LOCK_MS;
  if (args.durationMs < MIN_LOCK_MS || args.durationMs > max) {
    return { ok: false, error: "Duration is outside the allowed window" };
  }
  const next = clone(state);
  const err = debit(next, args.owner, args.token, args.amount);
  if (err) return { ok: false, error: err };
  const market = findMarket(next, args.token);
  const multiplier =
    args.kind === "universal" ? 1 : lockMultiplier(args.durationMs, args.kind === "yeeld" ? MAX_REWARD_LOCK_MS : max);
  const effective = args.kind === "universal" ? 0 : roundToken(args.amount * multiplier);
  const snapshots: Record<string, number> = {};
  if (args.kind === "reward") {
    if (!market) return { ok: false, error: "Only Feeze launch tokens can earn launch rewards" };
    if (market.venue !== "yeeld" && !market.isProtocol) {
      return { ok: false, error: "This token is not registered for reward locks" };
    }
    for (const [asset, index] of Object.entries(market.indexes)) snapshots[asset] = index;
    market.totalEffective = roundToken(market.totalEffective + effective);
  }
  if (args.kind === "yeeld") {
    const protocol = protocolMarket(next);
    if (!protocol || args.token !== protocol.address) {
      return { ok: false, error: "Stock dividends require the FEEZE token" };
    }
    for (const [asset, index] of Object.entries(next.yeeldIndexes)) snapshots[asset] = index;
    next.yeeldEffective = roundToken(next.yeeldEffective + effective);
  }
  const position: LockPosition = {
    id: rid(next, "lock"),
    owner: args.owner,
    token: args.token,
    kind: args.kind,
    amount: roundToken(args.amount),
    multiplier,
    effective,
    snapshots,
    start: next.now,
    expiry: next.now + args.durationMs,
    withdrawn: false,
  };
  next.locks.unshift(position);
  const symbol = market?.symbol ?? "tokens";
  pushActivity(next, `${shortTrader(args.owner)} locked ${symbol} for rewards`, "/lock");
  return { ok: true, state: next, value: position };
}

export function positionRewards(
  state: ProtocolState,
  position: LockPosition,
): Record<string, number> {
  if (position.kind === "universal") return {};
  const indexes =
    position.kind === "yeeld" ? state.yeeldIndexes : findMarket(state, position.token)?.indexes ?? {};
  const earned: Record<string, number> = {};
  for (const [asset, index] of Object.entries(indexes)) {
    const snap = position.snapshots[asset] ?? 0;
    const amount = (index - snap) * position.effective;
    if (amount > 1e-10) earned[asset] = amount;
  }
  return earned;
}

export function claimRewards(
  state: ProtocolState,
  args: { owner: string; positionId: string; recipient?: string },
): ActionResult<Record<string, number>> {
  const next = clone(state);
  const position = next.locks.find((lock) => lock.id === args.positionId);
  if (!position) return { ok: false, error: "Position not found" };
  if (position.owner !== args.owner) return { ok: false, error: "Only the owner can claim" };
  const earned = positionRewards(next, position);
  const assets = Object.keys(earned);
  if (assets.length === 0) return { ok: false, error: "Nothing to claim" };
  const recipient = args.recipient || args.owner;
  const indexes =
    position.kind === "yeeld" ? next.yeeldIndexes : findMarket(next, position.token)?.indexes ?? {};
  for (const asset of assets) {
    credit(next, recipient, asset, earned[asset]);
    position.snapshots[asset] = indexes[asset] ?? position.snapshots[asset] ?? 0;
  }
  pushActivity(next, `${shortTrader(args.owner)} claimed lock rewards`, "/rewards");
  return { ok: true, state: next, value: earned };
}

function releasePrincipal(state: ProtocolState, position: LockPosition) {
  if (position.withdrawn) return;
  position.withdrawn = true;
  credit(state, position.owner, position.token, position.amount);
  if (position.kind === "reward") {
    const market = findMarket(state, position.token);
    if (market) market.totalEffective = roundToken(Math.max(0, market.totalEffective - position.effective));
  }
  if (position.kind === "yeeld") {
    state.yeeldEffective = roundToken(Math.max(0, state.yeeldEffective - position.effective));
  }
}

export function withdrawLock(state: ProtocolState, args: { owner: string; positionId: string }): ActionResult {
  const next = clone(state);
  const position = next.locks.find((lock) => lock.id === args.positionId);
  if (!position) return { ok: false, error: "Position not found" };
  if (position.owner !== args.owner) return { ok: false, error: "Only the owner can withdraw" };
  if (position.withdrawn) return { ok: false, error: "Principal already withdrawn" };
  if (next.now < position.expiry) return { ok: false, error: "Early withdrawal is impossible" };
  releasePrincipal(next, position);
  pushActivity(next, `${shortTrader(args.owner)} withdrew a matured lock`, "/lock");
  return { ok: true, state: next, value: undefined };
}

export function runDailyUnlocker(state: ProtocolState, caller: string): ActionResult<number> {
  const next = clone(state);
  let count = 0;
  for (const position of next.locks) {
    if (!position.withdrawn && position.expiry <= next.now) {
      releasePrincipal(next, position);
      count += 1;
    }
  }
  if (count === 0) return { ok: false, error: "No expired positions" };
  pushActivity(next, `${shortTrader(caller)} ran the daily unlocker for ${count} position${count === 1 ? "" : "s"}`, "/lock");
  return { ok: true, state: next, value: count };
}

export function depositBribe(
  state: ProtocolState,
  args: { briber: string; market: string; amount: number },
): ActionResult<Bribe> {
  if (!(args.amount > 0)) return { ok: false, error: "Enter an amount" };
  const next = clone(state);
  const market = findMarket(next, args.market);
  if (!market) return { ok: false, error: "Market not found" };
  const pair = getPair(market.pair);
  if (!pair) return { ok: false, error: "Pair missing" };
  const asset = assetKey(pair);
  const err = debit(next, args.briber, asset, args.amount);
  if (err) return { ok: false, error: err };
  const bribe: Bribe = {
    id: rid(next, "bribe"),
    market: market.address,
    asset,
    amount: roundQuote(args.amount),
    remaining: roundQuote(args.amount),
    briber: args.briber,
    status: "pending",
    createdAt: next.now,
  };
  next.bribes.unshift(bribe);
  pushActivity(next, `Bribe deposited on ${market.symbol}`, `/coin/${market.address}`);
  return { ok: true, state: next, value: bribe };
}

export function activateBribe(state: ProtocolState, args: { briber: string; bribeId: string }): ActionResult {
  const next = clone(state);
  const bribe = next.bribes.find((item) => item.id === args.bribeId);
  if (!bribe) return { ok: false, error: "Bribe not found" };
  if (bribe.briber !== args.briber) return { ok: false, error: "Only the original briber can activate" };
  if (bribe.status !== "pending") return { ok: false, error: "Bribe is not pending" };
  const market = findMarket(next, bribe.market);
  if (!market) return { ok: false, error: "Market not found" };
  if (market.totalEffective <= 0) return { ok: false, error: "Wait until effective lockers exist" };
  distributeLaunchRewards(next, market, bribe.asset, bribe.remaining);
  market.lockerCapital = roundQuote(market.lockerCapital + bribe.remaining);
  bribe.remaining = 0;
  bribe.status = "active";
  pushActivity(next, `Bribe activated on ${market.symbol}`, `/coin/${market.address}`);
  return { ok: true, state: next, value: undefined };
}

export function refundBribe(state: ProtocolState, args: { briber: string; bribeId: string }): ActionResult {
  const next = clone(state);
  const bribe = next.bribes.find((item) => item.id === args.bribeId);
  if (!bribe) return { ok: false, error: "Bribe not found" };
  if (bribe.briber !== args.briber) return { ok: false, error: "Only the original briber can refund" };
  if (bribe.status !== "pending") return { ok: false, error: "Bribe is not pending" };
  const market = findMarket(next, bribe.market);
  if (market && market.totalEffective > 0) return { ok: false, error: "Lockers exist. Activate instead of refunding." };
  if (next.now < bribe.createdAt + GRACE_MS) return { ok: false, error: "Grace period has not elapsed" };
  credit(next, bribe.briber, bribe.asset, bribe.remaining);
  bribe.remaining = 0;
  bribe.status = "refunded";
  pushActivity(next, "Unresolved bribe refunded", market ? `/coin/${market.address}` : "/rewards");
  return { ok: true, state: next, value: undefined };
}

export function sweepOrphan(state: ProtocolState, args: { caller: string; market: string }): ActionResult<number> {
  const next = clone(state);
  const market = findMarket(next, args.market);
  if (!market) return { ok: false, error: "Market not found" };
  if (market.orphanPot <= 0 || !market.orphanSince) return { ok: false, error: "No orphan pot" };
  if (next.now < market.orphanSince + GRACE_MS) return { ok: false, error: "Grace period has not elapsed" };
  const pair = getPair(market.pair);
  if (!pair) return { ok: false, error: "Pair missing" };
  const amount = market.orphanPot;
  market.orphanPot = 0;
  market.orphanSince = null;
  recordProtocol(next, assetKey(pair), amount, "orphan", `${market.symbol} orphan sweep`);
  pushActivity(next, `${market.symbol} orphan rewards swept to protocol revenue`, `/coin/${market.address}`);
  return { ok: true, state: next, value: amount };
}

export function createBuyback(
  state: ProtocolState,
  args: {
    creator: string;
    target: string;
    fundingAsset: string;
    budget: number;
    tranches: number;
    intervalSec: number;
    slippageBps: number;
  },
): ActionResult<BuybackSchedule> {
  if (!(args.budget > 0)) return { ok: false, error: "Enter a budget" };
  if (!Number.isInteger(args.tranches) || args.tranches < 1 || args.tranches > 365) {
    return { ok: false, error: "Tranches must be a whole number from 1 to 365" };
  }
  if (args.intervalSec < 5 * 60 || args.intervalSec > 30 * 24 * 60 * 60) {
    return { ok: false, error: "Interval must be between 5 minutes and 30 days" };
  }
  if (args.slippageBps < 1 || args.slippageBps > 2000) {
    return { ok: false, error: "Slippage must be between 1 and 2000 bps" };
  }
  const target = findMarket(state, args.target);
  if (!target) return { ok: false, error: "Target token is not a Feeze market" };
  if (args.fundingAsset !== "ETH" && !getPair(args.fundingAsset) && args.fundingAsset !== target.pair) {
    return { ok: false, error: "Funding asset is not available" };
  }
  const next = clone(state);
  const err = debit(next, args.creator, args.fundingAsset, args.budget);
  if (err) return { ok: false, error: err };
  const protocolFee = roundQuote(args.budget * BUYBACK_FEE);
  const net = roundQuote(args.budget - protocolFee);
  recordProtocol(next, args.fundingAsset, protocolFee, "buyback-fee", "Buyback inbound fee");
  const scheduleId = rid(next, "bb");
  credit(next, scheduleId, args.fundingAsset, net);
  const schedule: BuybackSchedule = {
    id: scheduleId,
    creator: args.creator,
    target: target.address,
    fundingAsset: args.fundingAsset,
    budget: roundQuote(args.budget),
    protocolFee,
    trancheBudget: roundQuote(net / args.tranches),
    tranches: args.tranches,
    executed: 0,
    intervalSec: args.intervalSec,
    slippageBps: args.slippageBps,
    nextAt: next.now,
    createdAt: next.now,
    burned: 0,
    executions: [],
  };
  next.buybacks.unshift(schedule);
  pushActivity(next, `Buyback schedule created for ${target.symbol}`, `/buyback/${schedule.id}`);
  return { ok: true, state: next, value: schedule };
}

export function executeBuyback(state: ProtocolState, args: { caller: string; scheduleId: string }): ActionResult {
  const next = clone(state);
  const schedule = next.buybacks.find((item) => item.id === args.scheduleId);
  if (!schedule) return { ok: false, error: "Schedule not found" };
  if (schedule.executed >= schedule.tranches) return { ok: false, error: "Schedule is complete" };
  if (next.now + 500 < schedule.nextAt) return { ok: false, error: "Tranche is not due" };
  const market = findMarket(next, schedule.target);
  if (!market) return { ok: false, error: "Target missing" };
  const pair = getPair(market.pair);
  if (!pair) return { ok: false, error: "Pair missing" };
  if (schedule.fundingAsset !== assetKey(pair)) {
    return { ok: false, error: "This adapter only buys with the target's quote asset" };
  }
  const spent = Math.min(schedule.trancheBudget, balanceOf(next, schedule.id, schedule.fundingAsset));
  const quoted = quoteTrade(market, pair, "buy", spent);
  if ("error" in quoted) return { ok: false, error: quoted.error };
  const minTokens = quoted.tokens * (1 - schedule.slippageBps / 10_000);
  const bought = trade(next, {
    trader: schedule.id,
    market: market.address,
    side: "buy",
    amount: spent,
    slippageBps: schedule.slippageBps,
    minOut: minTokens,
  });
  if (!bought.ok) return bought;
  const burned = bought.value.tokenAmount;
  const after = clone(bought.state);
  const err = debit(after, schedule.id, market.address, burned);
  if (err) return { ok: false, error: err };
  credit(after, DEAD, market.address, burned);
  const live = after.buybacks.find((item) => item.id === schedule.id)!;
  live.executed += 1;
  live.burned = roundToken(live.burned + burned);
  live.nextAt = after.now + live.intervalSec * 1000;
  live.executions.unshift({
    id: rid(after, "bbx"),
    scheduleId: live.id,
    caller: args.caller,
    spent,
    burned,
    time: after.now,
    tx: bought.value.tx,
  });
  if (market.isProtocol) after.burnedYeeld = roundToken(after.burnedYeeld + burned);
  pushActivity(after, `Buyback burned ${market.symbol}`, `/buyback/${live.id}`);
  return { ok: true, state: after, value: undefined };
}

export function executeFlywheel(state: ProtocolState, caller: string): ActionResult<{ burned: number }> {
  const next = clone(state);
  const protocol = protocolMarket(next);
  if (!protocol) return { ok: false, error: "FEEZE is not configured" };
  const pair = getPair(protocol.pair);
  if (!pair) return { ok: false, error: "FEEZE pair missing" };
  const asset = assetKey(pair);
  let burned = 0;
  const spend = next.burnReserve[asset] ?? 0;
  if (spend > 0.0000001) {
    next.burnReserve[asset] = 0;
    credit(next, "flywheel", asset, spend);
    const bought = trade(next, {
      trader: "flywheel",
      market: protocol.address,
      side: "buy",
      amount: spend,
      slippageBps: 500,
    });
    if (!bought.ok) return bought;
    const tokens = bought.value.tokenAmount;
    const after = bought.state;
    const moved = debit(after, "flywheel", protocol.address, tokens);
    if (moved) return { ok: false, error: moved };
    credit(after, DEAD, protocol.address, tokens);
    after.burnedYeeld = roundToken(after.burnedYeeld + tokens);
    burned = tokens;
    after.revenueEvents.unshift({
      id: rid(after, "burn"),
      kind: "burn",
      asset,
      amount: spend,
      burn: spend,
      lockers: 0,
      operations: 0,
      time: after.now,
      tx: bought.value.tx,
      note: "TWAP conversion burned FEEZE",
    });
    Object.assign(next, after);
  }
  const live = clone(next);
  const dividendAssets = Object.keys(live.yeeldLockerReserve);
  if (live.yeeldEffective <= 0 && dividendAssets.some((key) => (live.yeeldLockerReserve[key] ?? 0) > 0)) {
    return {
      ok: burned > 0,
      state: live,
      ...(burned > 0
        ? { value: { burned } }
        : {}),
      error: "FEEZE was burned where reserved. Stock dividends are waiting for a FEEZE lock.",
    } as ActionResult<{ burned: number }>;
  }
  for (const key of dividendAssets) {
    const amount = live.yeeldLockerReserve[key] ?? 0;
    if (amount <= 0 || live.yeeldEffective <= 0) continue;
    live.yeeldIndexes[key] = (live.yeeldIndexes[key] ?? 0) + amount / live.yeeldEffective;
    live.yeeldLockerReserve[key] = 0;
  }
  if (burned <= 0 && dividendAssets.length === 0) return { ok: false, error: "Nothing is ready to convert" };
  pushActivity(live, `${shortTrader(caller)} executed the FEEZE flywheel`, "/revenue");
  return { ok: true, state: live, value: { burned } };
}

export function advanceTime(state: ProtocolState, ms: number): ProtocolState {
  const next = clone(state);
  next.now += ms;
  return next;
}

export function holdersOf(state: ProtocolState, token: string): { account: string; amount: number; locked: number }[] {
  const map = new Map<string, { amount: number; locked: number }>();
  for (const [account, assets] of Object.entries(state.balances)) {
    const amount = assets[token] ?? 0;
    if (amount > 0.000001 && account !== token && account !== DEAD && account !== "flywheel") {
      map.set(account, { amount, locked: 0 });
    }
  }
  for (const lock of state.locks) {
    if (lock.token !== token || lock.withdrawn) continue;
    const row = map.get(lock.owner) ?? { amount: 0, locked: 0 };
    row.locked += lock.amount;
    row.amount += lock.amount;
    map.set(lock.owner, row);
  }
  return [...map.entries()]
    .map(([account, row]) => ({ account, amount: row.amount, locked: row.locked }))
    .sort((a, b) => b.amount - a.amount);
}

export function connectDemo(state: ProtocolState): ProtocolState {
  const next = clone(state);
  next.wallet = DEMO_WALLET;
  return next;
}
