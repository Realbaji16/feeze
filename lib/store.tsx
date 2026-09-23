"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { readChainMarkets } from "./chain-markets";
import { PAIRS } from "./pairs";
import { cidFromImage } from "./ipfs-path";
import { readSharedImage, shareTokenImage } from "./share-image";
import { advanceTime, asAddress, clone, emptyState, fundSimulator } from "./protocol";
import type { ActionResult, Market, ProtocolState } from "./types";

const KEY = "feeze.simulator.v2";
const PREVIOUS_KEY = "feeze.simulator.v1";

interface Store {
  state: ProtocolState;
  ready: boolean;
  toast: string | null;
  dismiss: () => void;
  setWallet: (address: string | null) => void;
  notify: (message: string) => void;
  reset: () => void;
  advance: (ms: number) => void;
  toggleFailGraduation: () => void;
  commit: <T>(result: ActionResult<T>) => ActionResult<T>;
}

const Ctx = createContext<Store | null>(null);

const PAIR_ASSETS = new Set(PAIRS.map((pair) => pair.address));
/** Launches from the old launcher. Their opening price was the deposit, not 1.68 ETH. */
const RETIRED_MARKETS = new Set([
  "0xcaba674193e2784008e770ce6009334c6afd85a3",
  "0xd10363c3e12538d4042134364b194d1e6f1d7619",
]);

/** Demo coins live only in the simulator. A tradeable launch has a Robinhood pool. */
function keepTradeable(state: ProtocolState): ProtocolState {
  const markets = (state.markets ?? []).filter(
    (market) =>
      market.onchain &&
      (market.poolAddress || market.curveAddress) &&
      !RETIRED_MARKETS.has(market.address.toLowerCase()),
  );
  const keep = new Set(markets.map((market) => market.address));
  const removed = markets.length !== (state.markets ?? []).length;
  const balances: ProtocolState["balances"] = {};
  for (const [account, assets] of Object.entries(state.balances ?? {})) {
    const next: Record<string, number> = {};
    for (const [asset, amount] of Object.entries(assets)) {
      if (asset === "ETH" || keep.has(asset) || PAIR_ASSETS.has(asset)) next[asset] = amount;
    }
    balances[account] = next;
  }
  return {
    ...state,
    markets,
    balances,
    locks: (state.locks ?? []).filter((lock) => keep.has(lock.token)),
    bribes: (state.bribes ?? []).filter((bribe) => keep.has(bribe.market)),
    buybacks: (state.buybacks ?? []).filter((schedule) => keep.has(schedule.target)),
    activity: (state.activity ?? []).filter((item) => !item.href || [...keep].some((address) => item.href?.includes(address))),
    revenueEvents: removed ? [] : state.revenueEvents,
    burnReserve: removed ? {} : state.burnReserve,
    yeeldLockerReserve: removed ? {} : state.yeeldLockerReserve,
    operations: removed ? {} : state.operations,
    yeeldIndexes: removed ? {} : state.yeeldIndexes,
    yeeldEffective: removed ? 0 : state.yeeldEffective,
    burnedYeeld: removed ? 0 : state.burnedYeeld,
  };
}

function mergeChainMarkets(state: ProtocolState, incoming: Market[]): ProtocolState {
  if (!incoming.length) return state;
  const byAddress = new Map(state.markets.map((market) => [market.address, market]));
  let added = false;
  for (const market of incoming) {
    if (RETIRED_MARKETS.has(market.address.toLowerCase())) continue;
    const existing = byAddress.get(market.address);
    if (existing) {
      const next = { ...existing };
      let changed = false;
      if (!existing.image && market.image) {
        next.image = market.image;
        changed = true;
      }
      if (market.curveAddress && existing.curveAddress !== market.curveAddress) {
        next.curveAddress = market.curveAddress;
        changed = true;
      }
      if (existing.curveAddress && (existing.realQuote !== market.realQuote || existing.realTokens !== market.realTokens)) {
        next.realQuote = market.realQuote;
        next.realTokens = market.realTokens;
        changed = true;
      }
      if (!existing.poolAddress && market.poolAddress) {
        next.poolAddress = market.poolAddress;
        next.phase = "graduated";
        next.poolTokens = market.poolTokens;
        next.poolQuote = market.poolQuote;
        changed = true;
      }
      if (changed) {
        byAddress.set(market.address, next);
        added = true;
      }
      continue;
    }
    byAddress.set(market.address, market);
    added = true;
  }
  if (!added) return state;
  return {
    ...state,
    markets: [...byAddress.values()].sort((a, b) => b.launchedAt - a.launchedAt),
  };
}

function load(): ProtocolState {
  if (typeof window === "undefined") return emptyState();
  try {
    localStorage.removeItem(PREVIOUS_KEY);
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as ProtocolState;
    if (!parsed.balances) return emptyState();
    return keepTradeable(parsed);
  } catch {
    return emptyState();
  }
}

export function YeeldProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProtocolState>(emptyState);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pendingToast = useRef<string | null>(null);

  const setWallet = useCallback((address: string | null) => {
    setState((current) => {
      if (!address) {
        if (!current.wallet) return current;
        return { ...current, wallet: null };
      }
      let wallet: string;
      try {
        wallet = asAddress(address);
      } catch {
        pendingToast.current = "Privy returned an address this app cannot use.";
        return current;
      }
      if (current.wallet === wallet) return current;
      const next = clone(current);
      const fresh = !next.balances[wallet];
      next.wallet = wallet;
      if (fresh) {
        fundSimulator(next, wallet);
        pendingToast.current = "Connected. Local simulator balances were added for this wallet.";
      }
      return next;
    });
  }, []);

  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    setState(load());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const apply = (markets: Market[]) => {
      if (stop || !markets.length) return;
      setState((current) => mergeChainMarkets(current, markets));
    };
    const load = () => {
      fetch("/api/launches", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : []))
        .then((markets: Market[]) => {
          if (Array.isArray(markets) && markets.length) {
            apply(markets);
            return;
          }
          return readChainMarkets().then(apply);
        })
        .catch(() => {
          readChainMarkets().then(apply).catch(() => undefined);
        });
    };
    load();
    const id = window.setInterval(load, 15_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const tick = () => {
      for (const market of state.markets) {
        if (!market.onchain) continue;
        const picture = market.image;
        if (picture && (picture.startsWith("data:") || cidFromImage(picture))) {
          void shareTokenImage(market.address, picture);
          continue;
        }
        if (market.image) continue;
        void readSharedImage(market.address)
          .then((image) => {
            if (stop || !image) return;
            setState((current) => {
              const match = current.markets.find((item) => item.address === market.address);
              if (!match || match.image) return current;
              return {
                ...current,
                markets: current.markets.map((item) => (item.address === market.address ? { ...item, image } : item)),
              };
            });
          })
          .catch(() => undefined);
      }
    };
    tick();
    const id = window.setInterval(tick, 8000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [ready, state.markets]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(KEY, JSON.stringify(state));
  }, [state, ready]);

  useEffect(() => {
    if (!pendingToast.current) return;
    setToast(pendingToast.current);
    pendingToast.current = null;
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const api = useMemo<Store>(() => {
    return {
      state,
      ready,
      toast,
      dismiss: () => setToast(null),
      setWallet,
      notify,
      reset: () => {
        setState((current) => keepTradeable(current));
        setToast("Demo markets removed");
      },
      advance: (ms: number) => setState((current) => advanceTime(current, ms)),
      toggleFailGraduation: () =>
        setState((current) => ({ ...current, failNextGraduation: !current.failNextGraduation })),
      commit: (result) => {
        if (!result.ok) setToast(result.error);
        else setState(result.state);
        return result;
      },
    };
  }, [state, ready, toast, setWallet, notify]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useYeeld(): Store {
  const value = useContext(Ctx);
  if (!value) throw new Error("useYeeld must be used inside YeeldProvider");
  return value;
}
