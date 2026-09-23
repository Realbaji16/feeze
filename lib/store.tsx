"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PAIRS } from "./pairs";
import { advanceTime, asAddress, clone, emptyState, fundSimulator } from "./protocol";
import type { ActionResult, ProtocolState } from "./types";

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

/** Demo coins live only in the simulator. A tradeable launch has a Robinhood pool. */
function keepTradeable(state: ProtocolState): ProtocolState {
  const markets = (state.markets ?? []).filter((market) => market.onchain && market.poolAddress);
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
