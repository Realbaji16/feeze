"use client";

import { useMemo, useState } from "react";
import { useYeeld } from "@/lib/store";
import { compact, formatDate, formatDuration } from "@/lib/format";
import {
  MAX_REWARD_LOCK_MS,
  MAX_UNIVERSAL_LOCK_MS,
  MIN_LOCK_MS,
  balanceOf,
  createLock,
  lockMultiplier,
  protocolMarket,
  runDailyUnlocker,
  withdrawLock,
} from "@/lib/protocol";
import { getPair } from "@/lib/pairs";
import { TokenMark } from "@/components/bits";

type Mode = "yeeld" | "reward" | "universal";

export default function LockPage() {
  const { state, commit } = useYeeld();
  const [mode, setMode] = useState<Mode>("yeeld");
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState(90);
  const wallet = state.wallet;
  const yeeld = protocolMarket(state);
  const rewardMarkets = state.markets.filter((market) => (wallet ? balanceOf(state, wallet, market.address) > 0 : false));
  const selectedToken = mode === "yeeld" ? yeeld?.address ?? "" : token;
  const maxDays = mode === "universal" ? 3650 : 365;
  const durationMs = Math.min(maxDays, Math.max(mode === "universal" ? 0.5 : 0.5, days)) * 24 * 60 * 60 * 1000;
  const clamped = Math.min(mode === "universal" ? MAX_UNIVERSAL_LOCK_MS : MAX_REWARD_LOCK_MS, Math.max(MIN_LOCK_MS, durationMs));
  const multiplier = mode === "universal" ? 1 : lockMultiplier(clamped);
  const balance = wallet && selectedToken ? balanceOf(state, wallet, selectedToken) : 0;
  const positions = state.locks.filter((lock) => !wallet || lock.owner === wallet);

  const hint = useMemo(() => {
    if (mode === "yeeld") return "Rewards are paid in stock from platform fees. Longer locks receive a larger effective weight.";
    if (mode === "reward") return "Earn this launch’s pair asset. The multiplier is snapshotted and cannot be extended in place.";
    return "A public time lock with no Feeze rewards. Duration can run out to 10 years.";
  }, [mode]);

  function submit() {
    if (!wallet || !selectedToken) return;
    commit(createLock(state, { owner: wallet, token: selectedToken, amount: Number(amount), durationMs: clamped, kind: mode }));
  }

  return (
    <div className="grid-2">
      <div>
        <h1 className="page-title">Put your tokens to work</h1>
        <p className="sub">Lock FEEZE for stock dividends, lock a launch to earn its pair asset, or time-lock any token without rewards.</p>
        <div className="seg" style={{ marginBottom: 16 }}>
          <button className={mode === "yeeld" ? "on" : ""} onClick={() => setMode("yeeld")}>$FEEZE</button>
          <button className={mode === "reward" ? "on" : ""} onClick={() => setMode("reward")}>Earn rewards</button>
          <button className={mode === "universal" ? "on" : ""} onClick={() => setMode("universal")}>Lock any token</button>
        </div>
        <div className="card stack">
          {mode === "yeeld" && (
            <div className="note">
              <div>01 Buy FEEZE · 02 Lock here · 03 Earn stock</div>
              Claim dividends anytime. Withdraw principal after expiry.
            </div>
          )}
          {mode === "reward" && (
            <label className="lbl">
              Launch you hold
              <select className="select" value={token} onChange={(event) => setToken(event.target.value)}>
                <option value="">Select</option>
                {rewardMarkets.map((market) => (
                  <option key={market.address} value={market.address}>{market.symbol}</option>
                ))}
              </select>
            </label>
          )}
          {mode === "universal" && (
            <label className="lbl">
              Token
              <select className="select" value={token} onChange={(event) => setToken(event.target.value)}>
                <option value="">Select</option>
                {wallet &&
                  Object.entries(state.balances[wallet] ?? {})
                    .filter(([, amount]) => amount > 0)
                    .map(([asset]) => (
                      <option key={asset} value={asset}>{labelFor(asset, state)}</option>
                    ))}
              </select>
            </label>
          )}
          <label className="lbl">
            Amount
            <input className="field" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <div className="presets" style={{ display: "flex", gap: 8 }}>
            {[0.25, 0.5, 0.75, 1].map((part) => (
              <button key={part} onClick={() => setAmount(String(balance * part))}>{part === 1 ? "MAX" : `${part * 100}%`}</button>
            ))}
          </div>
          <div className="faint">Balance {compact(balance, 4)}</div>
          <label className="lbl">
            Lock duration · {days < 1 ? "12 hours" : `${days} days`} · {multiplier}×
            <input className="range" type="range" min={0.5} max={maxDays} step={0.5} value={Math.min(maxDays, Math.max(0.5, days))} onChange={(event) => setDays(Number(event.target.value))} />
          </label>
          <div className="presets" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(mode === "universal" ? [0.5, 14, 30, 365, 3650] : [0.5, 7, 30, 90, 180, 365]).map((preset) => (
              <button key={preset} onClick={() => setDays(preset)}>
                {preset < 1 ? "12h" : preset >= 365 ? `${preset / 365}y` : `${preset}d`}
              </button>
            ))}
          </div>
          <p className="note">{hint} Reward multiplier {multiplier}× effective.</p>
          <button className="btn-accent" disabled={!wallet} onClick={submit}>{wallet ? "Create lock" : "Connect to lock"}</button>
        </div>
      </div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Your locks</h3>
          <button className="btn" disabled={!wallet} onClick={() => wallet && commit(runDailyUnlocker(state, wallet))}>Run unlocker</button>
        </div>
        <p className="note">Withdraw returns tokens after expiry. The daily unlocker does the same for every matured position. Claiming rewards leaves the lock in place.</p>
        <table className="table">
          <thead>
            <tr><th>Token</th><th>Amount</th><th>Weight</th><th>Unlocks</th></tr>
          </thead>
          <tbody>
            {positions.map((lock) => {
              const market = state.markets.find((item) => item.address === lock.token);
              const ready = state.now >= lock.expiry && !lock.withdrawn;
              return (
                <tr key={lock.id}>
                  <td>
                    <div className="token-cell">
                      <TokenMark symbol={market?.symbol ?? "TK"} size={28} />
                      <div>
                        <strong>{market?.symbol ?? labelFor(lock.token, state)}</strong>
                        <em>{lock.kind === "yeeld" ? "FEEZE" : lock.kind === "reward" ? "launch rewards" : "time lock"}</em>
                      </div>
                    </div>
                  </td>
                  <td className="mono">{compact(lock.amount)}</td>
                  <td className="mono">{lock.kind === "universal" ? "—" : `${lock.multiplier}×`}</td>
                  <td>
                    {lock.withdrawn ? (
                      <span className="faint">Withdrawn</span>
                    ) : ready ? (
                      <button className="btn" onClick={() => wallet && commit(withdrawLock(state, { owner: wallet, positionId: lock.id }))}>Withdraw</button>
                    ) : (
                      <span className="faint">{formatDuration(lock.expiry - state.now)} · {formatDate(lock.expiry)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {positions.length === 0 && <p className="note">Connect your wallet to see positions.</p>}
      </div>
    </div>
  );
}

function labelFor(asset: string, state: { markets: { address: string; symbol: string }[] }): string {
  if (asset === "ETH") return "ETH";
  const market = state.markets.find((item) => item.address === asset);
  if (market) return market.symbol;
  return getPair(asset)?.symbol ?? asset.slice(0, 8);
}
