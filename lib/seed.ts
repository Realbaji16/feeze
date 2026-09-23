import { PAIRS, getPairBySymbol, type Pair } from "./pairs";
import {
  advanceTime,
  createBuyback,
  createLock,
  DEMO_WALLET,
  depositBribe,
  emptyState,
  executeBuyback,
  launch,
  MAKER_WALLET,
  trade,
  type LaunchInput,
} from "./protocol";
import type { ActionResult, ProtocolState } from "./types";

function pair(symbol: string): Pair {
  const found = getPairBySymbol(symbol);
  if (!found) throw new Error(`Missing pair ${symbol}`);
  return found;
}

function fund(state: ProtocolState, account: string, eth: number) {
  state.balances[account] = { ETH: eth };
  for (const item of PAIRS) {
    if (item.symbol === "ETH") continue;
    state.balances[account][item.address] = item.symbol === "USDG" ? 250_000 : 4_000;
  }
}

function take<T>(state: ProtocolState, result: ActionResult<T>, label: string): ProtocolState {
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
  return result.state;
}

function buy(state: ProtocolState, trader: string, market: string, amount: number, hours: number): ProtocolState {
  let next = advanceTime(state, hours * 60 * 60 * 1000);
  next = take(next, trade(next, { trader, market, side: "buy", amount, slippageBps: 800 }), `buy ${amount}`);
  return next;
}

function sell(state: ProtocolState, trader: string, market: string, amount: number, hours: number): ProtocolState {
  let next = advanceTime(state, hours * 60 * 60 * 1000);
  next = take(next, trade(next, { trader, market, side: "sell", amount, slippageBps: 800 }), `sell ${amount}`);
  return next;
}

export function createSeed(): ProtocolState {
  let state = emptyState();
  fund(state, MAKER_WALLET, 400);
  fund(state, DEMO_WALLET, 40);

  const open = (input: Omit<LaunchInput, "creator"> & { creator?: string; protocol?: boolean }) => {
    const created = launch(state, { creator: input.creator ?? MAKER_WALLET, slippageBps: 800, ...input });
    state = take(state, created, `launch ${input.symbol}`);
    if (input.protocol) {
      const market = state.markets.find((item) => item.symbol === input.symbol && item.creator === (input.creator ?? MAKER_WALLET));
      if (market) market.isProtocol = true;
    }
    return created.ok ? created.value.address : "";
  };

  const yeeld = open({
    protocol: true,
    name: "Feeze",
    symbol: "FEEZE",
    description: "Protocol token. Lock it to earn stock dividends from platform fees.",
    pair: pair("ETH").address,
    creatorTaxBps: 0,
    taxToLockers: false,
  });

  const apex = open({
    name: "Apex Grid",
    symbol: "APEX",
    description: "A conviction market paired with Apple. Fees pay lockers in AAPL.",
    pair: pair("AAPL").address,
    creatorTaxBps: 200,
    taxToLockers: false,
    creator: DEMO_WALLET,
  });

  const orbit = open({
    name: "Orbit Metal",
    symbol: "ORBIT",
    description: "Tesla-paired launch closing in on graduation.",
    pair: pair("TSLA").address,
    creatorTaxBps: 100,
    taxToLockers: true,
  });

  const lumen = open({
    name: "Lumen Dollar",
    symbol: "LUMEN",
    description: "Graduated USDG market trading on locked Uniswap v4 liquidity.",
    pair: pair("USDG").address,
    creatorTaxBps: 0,
    taxToLockers: false,
  });

  const drift = open({
    name: "Drift Wave",
    symbol: "DRIFT",
    description: "NVIDIA-paired curve with no lockers yet. Fees sit in the orphan pot.",
    pair: pair("NVDA").address,
    creatorTaxBps: 0,
    taxToLockers: false,
  });

  const halo = open({
    name: "Halo Systems",
    symbol: "HALO",
    description: "Microsoft-paired launch. Creator tax is redirected to lockers.",
    pair: pair("MSFT").address,
    creatorTaxBps: 500,
    taxToLockers: true,
    creator: DEMO_WALLET,
  });

  const nexus = open({
    name: "Nexus Index",
    symbol: "NEXUS",
    description: "S&P-paired market for broad conviction.",
    pair: pair("SPY").address,
    creatorTaxBps: 50,
    taxToLockers: false,
  });

  state = buy(state, MAKER_WALLET, yeeld, 0.15, 6);
  state = buy(state, DEMO_WALLET, yeeld, 0.4, 5);
  state = buy(state, MAKER_WALLET, yeeld, 0.25, 8);
  state = sell(state, MAKER_WALLET, yeeld, 8_000_000, 4);
  state = buy(state, MAKER_WALLET, yeeld, 0.55, 10);

  const demoYeeld = state.balances[DEMO_WALLET]?.[yeeld] ?? 0;
  state = advanceTime(state, 2 * 60 * 60 * 1000);
  state = take(
    state,
    createLock(state, {
      owner: DEMO_WALLET,
      token: yeeld,
      amount: demoYeeld * 0.45,
      durationMs: 90 * 24 * 60 * 60 * 1000,
      kind: "yeeld",
    }),
    "yeeld lock",
  );

  state = buy(state, MAKER_WALLET, apex, 2.2, 7);
  state = buy(state, DEMO_WALLET, apex, 1.4, 6);
  state = buy(state, MAKER_WALLET, apex, 3.1, 9);
  const demoApex = state.balances[DEMO_WALLET]?.[apex] ?? 0;
  state = take(
    state,
    createLock(state, {
      owner: DEMO_WALLET,
      token: apex,
      amount: demoApex * 0.5,
      durationMs: 30 * 24 * 60 * 60 * 1000,
      kind: "reward",
    }),
    "apex lock",
  );
  state = buy(state, MAKER_WALLET, apex, 4.4, 12);
  state = sell(state, MAKER_WALLET, apex, 6_000_000, 5);
  state = buy(state, MAKER_WALLET, apex, 2.8, 8);

  state = buy(state, MAKER_WALLET, orbit, 8, 4);
  state = buy(state, MAKER_WALLET, orbit, 12, 6);
  state = buy(state, DEMO_WALLET, orbit, 6, 3);
  state = buy(state, MAKER_WALLET, orbit, 4.5, 5);

  state = buy(state, MAKER_WALLET, lumen, 2800, 3);
  state = buy(state, MAKER_WALLET, lumen, 4200, 4);
  state = buy(state, MAKER_WALLET, lumen, 5200, 5);
  state = buy(state, DEMO_WALLET, lumen, 40, 2);
  state = sell(state, MAKER_WALLET, lumen, 4_000_000, 6);

  state = buy(state, MAKER_WALLET, drift, 1.2, 5);
  state = buy(state, MAKER_WALLET, drift, 0.8, 7);
  state = sell(state, MAKER_WALLET, drift, 3_000_000, 4);

  state = buy(state, MAKER_WALLET, halo, 1.5, 6);
  state = buy(state, DEMO_WALLET, halo, 0.8, 4);
  const demoHalo = state.balances[DEMO_WALLET]?.[halo] ?? 0;
  state = take(
    state,
    createLock(state, {
      owner: DEMO_WALLET,
      token: halo,
      amount: demoHalo * 0.6,
      durationMs: 180 * 24 * 60 * 60 * 1000,
      kind: "reward",
    }),
    "halo lock",
  );
  state = buy(state, MAKER_WALLET, halo, 2.4, 9);

  state = buy(state, MAKER_WALLET, nexus, 0.9, 8);
  state = buy(state, MAKER_WALLET, nexus, 1.6, 11);
  state = buy(state, DEMO_WALLET, nexus, 0.4, 3);

  state = advanceTime(state, 60 * 60 * 1000);
  state = take(state, depositBribe(state, { briber: DEMO_WALLET, market: nexus, amount: 0.25 }), "bribe");

  const aapl = pair("AAPL").address;
  state = take(
    state,
    createLock(state, {
      owner: DEMO_WALLET,
      token: aapl,
      amount: 12,
      durationMs: 14 * 24 * 60 * 60 * 1000,
      kind: "universal",
    }),
    "universal lock",
  );

  state = take(
    state,
    createBuyback(state, {
      creator: DEMO_WALLET,
      target: yeeld,
      fundingAsset: "ETH",
      budget: 0.2,
      tranches: 4,
      intervalSec: 60 * 60,
      slippageBps: 300,
    }),
    "buyback",
  );
  const schedule = state.buybacks[0];
  state = take(state, executeBuyback(state, { caller: MAKER_WALLET, scheduleId: schedule.id }), "execute buyback");
  state = advanceTime(state, 30 * 60 * 1000);

  state.wallet = null;
  return state;
}
