"use client";

import { useState } from "react";
import Link from "next/link";
import { useYeeld } from "@/lib/store";
import { compact, formatDate, shortAddr, timeAgo, usd } from "@/lib/format";
import { claimRewards, positionRewards } from "@/lib/protocol";
import { getPair } from "@/lib/pairs";
import { TokenMark } from "@/components/bits";

function assetLabel(asset: string, markets: { address: string; symbol: string }[]) {
  if (asset === "ETH") return "ETH";
  return markets.find((market) => market.address === asset)?.symbol ?? getPair(asset)?.symbol ?? shortAddr(asset);
}

function assetUsd(asset: string, amount: number) {
  if (asset === "ETH") return amount * 2748;
  return amount * (getPair(asset)?.usd ?? 0);
}

export default function RewardsPage() {
  const { state, commit } = useYeeld();
  const [tab, setTab] = useState<"you" | "network">("you");
  const wallet = state.wallet;
  const positions = state.locks.filter((lock) => wallet && lock.owner === wallet && lock.kind !== "universal");

  return (
    <div>
      <h1 className="page-title">Your rewards, clearly tracked</h1>
      <p className="sub">Lock launch tokens to earn converted trading fees and activated bribes. Longer locks carry more reward weight.</p>
      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === "you" ? "on" : ""} onClick={() => setTab("you")}>Your rewards</button>
        <button className={tab === "network" ? "on" : ""} onClick={() => setTab("network")}>Network activity</button>
      </div>
      {tab === "you" && !wallet && (
        <div className="card">
          <h3>Connect to view your rewards</h3>
          <p className="note">Your positions and claims are wallet-specific. Connecting does not submit a mainnet transaction.</p>
        </div>
      )}
      {tab === "you" && wallet && (
        <div className="stack">
          {positions.map((position) => {
            const market = state.markets.find((item) => item.address === position.token);
            const earned = positionRewards(state, position);
            const entries = Object.entries(earned);
            const total = entries.reduce((sum, [asset, amount]) => sum + assetUsd(asset, amount), 0);
            return (
              <div className="card" key={position.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div className="token-cell">
                    <TokenMark symbol={market?.symbol ?? "Y"} image={market?.image} />
                    <div>
                      <strong>{market?.symbol ?? "FEEZE"} · {position.kind === "yeeld" ? "FEEZE" : "launch rewards"}</strong>
                      <em>{compact(position.amount)} locked · {position.multiplier}× · {position.withdrawn ? "principal out" : `until ${formatDate(position.expiry)}`}</em>
                    </div>
                  </div>
                  <div className="mono">{usd(total)}</div>
                </div>
                <div className="quote-box" style={{ marginTop: 12 }}>
                  {entries.length === 0 && <div className="note">Nothing claimable yet. New locks skip rewards that were already distributed.</div>}
                  {entries.map(([asset, amount]) => (
                    <div key={asset}>
                      <span>{assetLabel(asset, state.markets)}</span>
                      <span className="mono">{compact(amount, 4)}</span>
                    </div>
                  ))}
                </div>
                <button
                  className="btn-accent"
                  style={{ marginTop: 12 }}
                  disabled={entries.length === 0}
                  onClick={() => commit(claimRewards(state, { owner: wallet, positionId: position.id }))}
                >
                  Claim
                </button>
              </div>
            );
          })}
          {positions.length === 0 && (
            <div className="card">
              <p className="note">No reward positions on this wallet.</p>
              <Link className="btn" href="/lock">Create a lock</Link>
            </div>
          )}
        </div>
      )}
      {tab === "network" && (
        <div className="panel">
          <table className="table">
            <thead><tr><th>When</th><th>Activity</th></tr></thead>
            <tbody>
              {state.activity.map((item) => (
                <tr key={item.id}>
                  <td className="faint">{timeAgo(item.time, state.now)}</td>
                  <td>{item.href ? <Link href={item.href}>{item.text}</Link> : item.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
