"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useYeeld } from "@/lib/store";
import { compact, formatDate, shortAddr } from "@/lib/format";
import { executeBuyback } from "@/lib/protocol";

export default function BuybackDetailPage() {
  const params = useParams<{ id: string }>();
  const { state, commit } = useYeeld();
  const schedule = state.buybacks.find((item) => item.id === params.id);
  if (!schedule) return <div className="card">Schedule not found. <Link href="/buyback">Back</Link></div>;
  const token = state.markets.find((item) => item.address === schedule.target);
  const due = state.now + 500 >= schedule.nextAt && schedule.executed < schedule.tranches;
  return (
    <div className="stack">
      <div>
        <Link href="/buyback" className="faint">Buybacks</Link>
        <h1 className="page-title">{token?.symbol} buyback</h1>
        <p className="sub">Non-cancellable. {schedule.tranches} tranches, {compact(schedule.trancheBudget, 4)} each, after a {schedule.protocolFee.toFixed(6)} protocol fee.</p>
      </div>
      <div className="grid-3">
        <div className="stat"><span>Burned</span><b>{compact(schedule.burned)}</b></div>
        <div className="stat"><span>Executed</span><b>{schedule.executed}/{schedule.tranches}</b></div>
        <div className="stat"><span>Creator</span><b style={{ fontSize: 14 }}>{shortAddr(schedule.creator)}</b></div>
      </div>
      {due && state.wallet && (
        <button className="btn-accent" onClick={() => commit(executeBuyback(state, { caller: state.wallet!, scheduleId: schedule.id }))}>
          Execute due tranche
        </button>
      )}
      <div className="panel">
        <table className="table">
          <thead><tr><th>Time</th><th>Caller</th><th className="right">Spent</th><th className="right">Burned</th><th>Tx</th></tr></thead>
          <tbody>
            {schedule.executions.map((execution) => (
              <tr key={execution.id}>
                <td>{formatDate(execution.time)}</td>
                <td className="mono">{shortAddr(execution.caller)}</td>
                <td className="right mono">{compact(execution.spent, 4)}</td>
                <td className="right mono">{compact(execution.burned)}</td>
                <td className="mono faint">{execution.tx.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
