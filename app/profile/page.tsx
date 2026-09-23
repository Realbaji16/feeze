"use client";

import Link from "next/link";
import { useYeeld } from "@/lib/store";
import { compact, shortAddr, usd } from "@/lib/format";
import { balanceOf, claimCreator } from "@/lib/protocol";
import { PAIRS } from "@/lib/pairs";
import { TokenMark } from "@/components/bits";
import { ConnectButton } from "@/components/connect-button";

export default function ProfilePage() {
  const { state, commit } = useYeeld();
  const wallet = state.wallet;
  if (!wallet) {
    return (
      <div className="card">
        <h1 className="page-title">Profile</h1>
        <p className="sub">Connect with Privy to see balances, launches, and creator reserves.</p>
        <ConnectButton />
      </div>
    );
  }
  const created = state.markets.filter((market) => market.creator === wallet);
  const holdings = state.markets.filter((market) => balanceOf(state, wallet, market.address) > 0);
  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Profile</h1>
        <p className="addr">{wallet}</p>
      </div>
      <div className="card">
        <h3>Quote balances</h3>
        <div className="grid-3">
          <div className="stat"><span>ETH</span><b>{compact(balanceOf(state, wallet, "ETH"), 4)}</b></div>
          {PAIRS.filter((pair) => pair.symbol !== "ETH").slice(0, 8).map((pair) => (
            <div className="stat" key={pair.address}>
              <span>{pair.symbol}</span>
              <b>{compact(balanceOf(state, wallet, pair.address), 2)}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>Launch tokens</h3>
        {holdings.map((market) => (
          <Link key={market.address} href={`/coin/${market.address}`} className="token-cell" style={{ marginTop: 10 }}>
            <TokenMark symbol={market.symbol} image={market.image} />
            <div style={{ flex: 1 }}>
              <strong>{market.symbol}</strong>
              <div className="mono">{compact(balanceOf(state, wallet, market.address))}</div>
            </div>
          </Link>
        ))}
        {holdings.length === 0 && <p className="note">No launch tokens in this wallet.</p>}
      </div>
      <div className="card">
        <h3>Created markets</h3>
        {created.map((market) => (
          <div key={market.address} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
            <Link href={`/coin/${market.address}`}>{market.symbol}</Link>
            <span className="mono">{usd(market.creatorReserve * (PAIRS.find((pair) => pair.address === market.pair)?.usd ?? 0))}</span>
            {market.creatorReserve > 0 && (
              <button className="btn" onClick={() => commit(claimCreator(state, market.address, wallet))}>Claim</button>
            )}
          </div>
        ))}
        {created.length === 0 && <p className="note">You have not launched a token from this wallet.</p>}
      </div>
      <p className="note">Privy identifies {shortAddr(wallet)}. Balances and trades stay in this browser and are not mainnet transactions.</p>
    </div>
  );
}
