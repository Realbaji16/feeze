"use client";

import { useYeeld } from "@/lib/store";
import { compact, formatDate, usd } from "@/lib/format";
import { executeFlywheel, protocolMarket } from "@/lib/protocol";
import { getPair } from "@/lib/pairs";

function valueOf(asset: string, amount: number) {
  if (asset === "ETH") return amount * 2748;
  return amount * (getPair(asset)?.usd ?? 0);
}

function sum(bucket: Record<string, number>) {
  return Object.entries(bucket).reduce((total, [asset, amount]) => total + valueOf(asset, amount), 0);
}

export default function RevenuePage() {
  const { state, commit } = useYeeld();
  const burn = sum(state.burnReserve);
  const lockers = sum(state.yeeldLockerReserve);
  const ops = sum(state.operations);
  const yeeld = protocolMarket(state);
  const events = [...state.revenueEvents].sort((a, b) => b.time - a.time);

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Revenue</h1>
        <p className="sub">
          Live protocol fee accounting. 70% buys and burns FEEZE. 20% pays FEEZE lockers in stock. 10% is operations. Burns are not counted as revenue kept.
        </p>
      </div>
      <div className="grid-3">
        <div className="card">
          <div className="pill live">70%</div>
          <h3>Buy-and-burn FEEZE</h3>
          <b className="mono" style={{ fontSize: 28 }}>{usd(burn)}</b>
          <p className="note">Waiting in the burn reserve. Removed from supply once the flywheel runs. Not retained.</p>
        </div>
        <div className="card">
          <div className="pill">20%</div>
          <h3>FEEZE locker dividends</h3>
          <b className="mono" style={{ fontSize: 28 }}>{usd(lockers)}</b>
          <p className="note">Paid in the collected quote assets to locked FEEZE.</p>
        </div>
        <div className="card">
          <div className="pill gold">10%</div>
          <h3>Operations</h3>
          <b className="mono" style={{ fontSize: 28 }}>{usd(ops)}</b>
          <p className="note">Only this 10% is labeled as retained revenue.</p>
        </div>
      </div>
      <div className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <strong>{compact(state.burnedYeeld)} {yeeld?.symbol ?? "FEEZE"} burned</strong>
          <div className="note">Permissionless conversion. Anyone can execute when reserves are waiting.</div>
        </div>
        <button className="btn-accent" disabled={!state.wallet} onClick={() => state.wallet && commit(executeFlywheel(state, state.wallet))}>
          Execute flywheel
        </button>
      </div>
      <div className="panel">
        <table className="table">
          <thead>
            <tr><th>Time</th><th>Note</th><th className="right">Amount</th><th className="right">Burn</th><th className="right">Lockers</th><th className="right">Ops</th></tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td className="faint">{formatDate(event.time)}</td>
                <td>{event.note}</td>
                <td className="right mono">{usd(valueOf(event.asset, event.amount))}</td>
                <td className="right mono">{usd(valueOf(event.asset, event.burn))}</td>
                <td className="right mono">{usd(valueOf(event.asset, event.lockers))}</td>
                <td className="right mono">{usd(valueOf(event.asset, event.operations))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
