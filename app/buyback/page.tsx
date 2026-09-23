"use client";

import { useState } from "react";
import Link from "next/link";
import { useYeeld } from "@/lib/store";
import { compact, timeAgo } from "@/lib/format";
import { assetKey, balanceOf, createBuyback, executeBuyback } from "@/lib/protocol";
import { getPair } from "@/lib/pairs";
import { TokenMark } from "@/components/bits";

const INTERVALS = [
  { label: "5 min", sec: 5 * 60 },
  { label: "1 hour", sec: 60 * 60 },
  { label: "6 hours", sec: 6 * 60 * 60 },
  { label: "1 day", sec: 24 * 60 * 60 },
  { label: "7 days", sec: 7 * 24 * 60 * 60 },
  { label: "30 days", sec: 30 * 24 * 60 * 60 },
];

export default function BuybackPage() {
  const { state, commit } = useYeeld();
  const [target, setTarget] = useState(state.markets[0]?.address ?? "");
  const [budget, setBudget] = useState("0.25");
  const [tranches, setTranches] = useState(4);
  const [slippage, setSlippage] = useState(100);
  const [interval, setInterval] = useState(INTERVALS[3].sec);
  const wallet = state.wallet;
  const market = state.markets.find((item) => item.address === target);
  const pair = market ? getPair(market.pair) : undefined;
  const funding = pair ? assetKey(pair) : "ETH";
  const balance = wallet ? balanceOf(state, wallet, funding) : 0;
  const burnedByToken = new Map<string, number>();
  for (const schedule of state.buybacks) {
    burnedByToken.set(schedule.target, (burnedByToken.get(schedule.target) ?? 0) + schedule.burned);
  }

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Buy back. Burn forever.</h1>
        <p className="sub">Fund a public schedule that buys a target token in controlled tranches. Every purchased token is sent to the dead address.</p>
        <div className="grid-3">
          <div className="stat"><span>TWAP tranches</span><b>Price-aware</b></div>
          <div className="stat"><span>Execution</span><b>Permissionless</b></div>
          <div className="stat"><span>Destination</span><b>Burned</b></div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card stack">
          <h3>Build a buyback</h3>
          <label className="lbl">
            Target
            <select className="select" value={target} onChange={(event) => setTarget(event.target.value)}>
              {state.markets.map((item) => (
                <option key={item.address} value={item.address}>{item.symbol}</option>
              ))}
            </select>
          </label>
          <label className="lbl">
            Total budget ({pair?.symbol ?? "quote"})
            <input className="field" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
          <div className="faint">Balance {compact(balance, 4)} · 0.3% inbound fee is protocol revenue</div>
          <label className="lbl">
            Tranches {tranches}
            <input className="range" type="range" min={1} max={48} value={tranches} onChange={(event) => setTranches(Number(event.target.value))} />
          </label>
          <label className="lbl">
            Slippage {slippage} bps
            <input className="range" type="range" min={10} max={500} value={slippage} onChange={(event) => setSlippage(Number(event.target.value))} />
          </label>
          <label className="lbl">
            Execution interval
            <select className="select" value={interval} onChange={(event) => setInterval(Number(event.target.value))}>
              {INTERVALS.map((item) => (
                <option key={item.sec} value={item.sec}>{item.label}</option>
              ))}
            </select>
          </label>
          <p className="note warn-note">Funding is committed once. A schedule cannot be cancelled. Anyone can execute a due tranche.</p>
          <button
            className="btn-accent"
            disabled={!wallet || !market}
            onClick={() =>
              wallet &&
              market &&
              commit(
                createBuyback(state, {
                  creator: wallet,
                  target: market.address,
                  fundingAsset: funding,
                  budget: Number(budget),
                  tranches,
                  intervalSec: interval,
                  slippageBps: slippage,
                }),
              )
            }
          >
            {wallet ? "Fund schedule" : "Connect wallet"}
          </button>
        </div>
        <div className="stack">
          <div className="card">
            <h3>Live activity</h3>
            <table className="table">
              <thead><tr><th>Time</th><th>Token</th><th className="right">Burned</th><th></th></tr></thead>
              <tbody>
                {state.buybacks.flatMap((schedule) =>
                  schedule.executions.map((execution) => {
                    const token = state.markets.find((item) => item.address === schedule.target);
                    return (
                      <tr key={execution.id}>
                        <td className="faint">{timeAgo(execution.time, state.now)}</td>
                        <td>{token?.symbol}</td>
                        <td className="right mono">{compact(execution.burned)}</td>
                        <td className="mono faint">{execution.tx.slice(0, 10)}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Most burned</h3>
            {[...burnedByToken.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([address, burned]) => {
                const token = state.markets.find((item) => item.address === address);
                return (
                  <div key={address} className="token-cell" style={{ marginTop: 8 }}>
                    <TokenMark symbol={token?.symbol ?? "?"} />
                    <div style={{ flex: 1 }}>
                      <strong>{token?.symbol}</strong>
                      <div className="mono">{compact(burned)} burned</div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
      <div className="panel">
        <table className="table">
          <thead>
            <tr><th>Schedule</th><th>Progress</th><th>Next</th><th></th></tr>
          </thead>
          <tbody>
            {state.buybacks.map((schedule) => {
              const token = state.markets.find((item) => item.address === schedule.target);
              const due = state.now + 500 >= schedule.nextAt && schedule.executed < schedule.tranches;
              return (
                <tr key={schedule.id}>
                  <td>
                    <Link href={`/buyback/${schedule.id}`}>{token?.symbol} · {compact(schedule.budget, 4)} budget</Link>
                  </td>
                  <td className="mono">{schedule.executed}/{schedule.tranches}</td>
                  <td className="faint">{schedule.executed >= schedule.tranches ? "Complete" : due ? "Due" : timeAgo(state.now, schedule.nextAt).replace(/^/, "in ")}</td>
                  <td>
                    {due && wallet && (
                      <button className="btn" onClick={() => commit(executeBuyback(state, { caller: wallet, scheduleId: schedule.id }))}>Execute</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
