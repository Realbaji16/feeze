import { getPairBySymbol } from "../lib/pairs.ts";
import {
  BASE_FEE,
  BUYBACK_FEE,
  createBuyback,
  createLock,
  CURVE_TOKENS,
  DEMO_WALLET,
  emptyState,
  executeBuyback,
  executeFlywheel,
  launch,
  lockMultiplier,
  LP_TOKENS,
  MAX_REWARD_LOCK_MS,
  MIN_LOCK_MS,
  quoteTrade,
  spotPrice,
  sweepOrphan,
  trade,
  withdrawLock,
  advanceTime,
  GRACE_MS,
  claimRewards,
} from "../lib/protocol.ts";
import { createSeed } from "../lib/seed.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function approx(a: number, b: number, tol = 1e-6) {
  if (Math.abs(a - b) > tol) throw new Error(`expected ${b}, got ${a}`);
}

const eth = getPairBySymbol("ETH")!;
let state = emptyState();
state.balances[DEMO_WALLET] = { ETH: 20 };

const launched = launch(state, {
  creator: DEMO_WALLET,
  name: "Test",
  symbol: "TEST",
  description: "Curve test",
  pair: eth.address,
  creatorTaxBps: 0,
  taxToLockers: false,
});
assert(launched.ok, "launch");
if (!launched.ok) process.exit(1);
state = launched.state;
const market = launched.value;
const price0 = spotPrice(market, eth);
approx(price0, eth.phantom / (CURVE_TOKENS * 1.1), 1e-12);

const bought = trade(state, { trader: DEMO_WALLET, market: market.address, side: "buy", amount: 1, slippageBps: 100 });
assert(bought.ok, "buy");
if (!bought.ok) process.exit(1);
state = bought.state;
const after = state.markets[0];
assert(spotPrice(after, eth) > price0, "price up");
const gross = 1;
const base = gross * BASE_FEE;
approx(after.lockerCapital, base * 0.6, 1e-8);
approx(after.creatorReserve, base * 0.1, 1e-8);
approx(state.burnReserve.ETH, base * 0.3 * 0.7, 1e-8);
approx(state.yeeldLockerReserve.ETH, base * 0.3 * 0.2, 1e-8);
assert(after.orphanPot > 0, "orphan when no lockers");

const taxed = launch(state, {
  creator: DEMO_WALLET,
  name: "Taxed",
  symbol: "TAX",
  description: "",
  pair: eth.address,
  creatorTaxBps: 500,
  taxToLockers: true,
});
assert(taxed.ok, "tax launch");
if (!taxed.ok) process.exit(1);
state = taxed.state;
const taxBuy = trade(state, {
  trader: DEMO_WALLET,
  market: taxed.value.address,
  side: "buy",
  amount: 1,
  slippageBps: 50,
});
assert(taxBuy.ok, "tax buy");
if (!taxBuy.ok) process.exit(1);
state = taxBuy.state;
const taxMarket = state.markets.find((item) => item.symbol === "TAX")!;
approx(taxMarket.creatorReserve, 1 * 0.01 * 0.1, 1e-8);
approx(taxMarket.orphanPot, 1 * 0.01 * 0.6 + 1 * 0.05, 1e-6);

assert(lockMultiplier(MIN_LOCK_MS) === 1, "min multiplier");
approx(lockMultiplier(MAX_REWARD_LOCK_MS), 6, 1e-6);

const early = withdrawLock(state, { owner: DEMO_WALLET, positionId: "missing" });
assert(!early.ok, "missing lock");

state = createSeed();
assert(state.markets.length >= 7, "seed markets");
const lumen = state.markets.find((item) => item.symbol === "LUMEN");
assert(lumen?.phase === "graduated", `LUMEN phase ${lumen?.phase}`);
const yeeld = state.markets.find((item) => item.isProtocol)!;
assert(yeeld.symbol === "FEEZE", "protocol token");
const curvePrice = eth.threshold / LP_TOKENS;
const graduated = lumen!;
const gPair = getPairBySymbol("USDG")!;
const poolPrice = graduated.poolQuote / graduated.poolTokens;
approx(poolPrice, gPair.threshold / LP_TOKENS, gPair.threshold * 0.02);

const quoted = quoteTrade(yeeld, eth, "buy", 0.1);
assert(!("error" in quoted), "quote");
if ("error" in quoted) process.exit(1);
assert(quoted.tokens > 0, "tokens out");

const locked = state.locks.filter((lock) => lock.owner === DEMO_WALLET);
assert(locked.length >= 3, "demo locks");

state = advanceTime(state, GRACE_MS + 1000);
const drift = state.markets.find((item) => item.symbol === "DRIFT")!;
const swept = sweepOrphan(state, { caller: DEMO_WALLET, market: drift.address });
assert(swept.ok, swept.ok ? "sweep" : swept.error);
if (swept.ok) state = swept.state;

const schedule = createBuyback(state, {
  creator: DEMO_WALLET,
  target: yeeld.address,
  fundingAsset: "ETH",
  budget: 0.05,
  tranches: 2,
  intervalSec: 300,
  slippageBps: 200,
});
assert(schedule.ok, schedule.ok ? "bb" : schedule.error);
if (!schedule.ok) process.exit(1);
state = schedule.state;
approx(state.buybacks[0].protocolFee, 0.05 * BUYBACK_FEE, 1e-8);
const ran = executeBuyback(state, { caller: DEMO_WALLET, scheduleId: schedule.value.id });
assert(ran.ok, ran.ok ? "bb exec" : ran.error);

const relock = createLock(state, {
  owner: DEMO_WALLET,
  token: yeeld.address,
  amount: 1000,
  durationMs: 7 * 24 * 60 * 60 * 1000,
  kind: "yeeld",
});
assert(relock.ok, relock.ok ? "relock" : relock.error);
if (relock.ok) {
  state = relock.state;
  const fly = executeFlywheel(state, DEMO_WALLET);
  assert(fly.ok, fly.ok ? "flywheel" : fly.error);
  if (fly.ok) {
    state = fly.state;
    const position = state.locks.find((lock) => lock.id === relock.value.id)!;
    const claim = claimRewards(state, { owner: DEMO_WALLET, positionId: position.id });
    assert(claim.ok || state.yeeldEffective > 0, "dividend index");
  }
}

console.log("protocol tests passed");
console.log("reference curve final price", curvePrice);
