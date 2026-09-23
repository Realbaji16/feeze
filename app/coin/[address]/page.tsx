"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatEther, type Address } from "viem";
import { useYeeld } from "@/lib/store";
import { compact, formatDate, shortAddr, timeAgo, usd } from "@/lib/format";
import {
  activateBribe,
  assetKey,
  balanceOf,
  claimCreator,
  depositBribe,
  graduate,
  holdersOf,
  positionRewards,
  quoteTrade,
  refundBribe,
  sweepOrphan,
  trade,
  GRACE_MS,
} from "@/lib/protocol";
import { PhasePill, Progress, TokenMark, marketStats } from "@/components/bits";
import { dexScreener, explainTx, quoteSwap, readHoldings, swapOnRobinhood, tokenExplorer, txExplorer } from "@/lib/robinhood-market";

export default function CoinPage() {
  const params = useParams<{ address: string }>();
  const { state, commit } = useYeeld();
  const market = state.markets.find((item) => item.address === params.address.toLowerCase());
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.1");
  const [slippage, setSlippage] = useState(100);
  const [tab, setTab] = useState<"trades" | "holders" | "locks" | "bribes">("trades");
  const [bribeAmt, setBribeAmt] = useState("0.1");
  const [chainBal, setChainBal] = useState<{ eth: number; token: number } | null>(null);
  const [chainOut, setChainOut] = useState<string | null>(null);
  const [chainNote, setChainNote] = useState<string | null>(null);
  const [chainBusy, setChainBusy] = useState(false);

  const stats = market ? marketStats(market) : null;
  const wallet = state.wallet;
  const numeric = Number(amount);
  const quote = useMemo(() => {
    if (!market || !stats || !(numeric > 0)) return null;
    return quoteTrade(market, stats.pair, side, numeric);
  }, [market, stats, side, numeric]);
  const onchain = Boolean(market?.onchain);

  useEffect(() => {
    if (!market?.onchain || !wallet) return;
    let stop = false;
    readHoldings(wallet as Address, market.address as Address)
      .then((holdings) => {
        if (!stop) setChainBal(holdings);
      })
      .catch(() => {
        if (!stop) setChainBal(null);
      });
    return () => {
      stop = true;
    };
  }, [market?.onchain, wallet, market?.address, chainBusy]);

  useEffect(() => {
    if (!market?.onchain || !market.poolAddress || !(numeric > 0)) {
      setChainOut(null);
      return;
    }
    let stop = false;
    quoteSwap({ token: market.address as Address, side, amount })
      .then((out) => {
        if (!stop) setChainOut(formatEther(out));
      })
      .catch(() => {
        if (!stop) setChainOut(null);
      });
    return () => {
      stop = true;
    };
  }, [market?.onchain, market?.poolAddress, market?.address, side, amount, numeric]);

  if (!market || !stats) {
    return (
      <div className="card">
        <h1>Market not found</h1>
        <p className="note">That address is not in this simulator.</p>
        <Link href="/" className="btn">Back to markets</Link>
      </div>
    );
  }

  const spendAsset = assetKey(stats.pair);
  const balance = onchain
    ? (side === "buy" ? chainBal?.eth ?? 0 : chainBal?.token ?? 0)
    : wallet
      ? (side === "buy" ? balanceOf(state, wallet, spendAsset) : balanceOf(state, wallet, market.address))
      : 0;
  const candles = buildCandles(market.trades);
  const holders = holdersOf(state, market.address);
  const locks = state.locks.filter((lock) => lock.token === market.address && lock.kind === "reward");
  const bribes = state.bribes.filter((bribe) => bribe.market === market.address);

  async function submit() {
    if (!wallet || !market) return;
    if (!onchain) {
      commit(trade(state, { trader: wallet, market: market.address, side, amount: numeric, slippageBps: slippage }));
      return;
    }
    setChainBusy(true);
    setChainNote(null);
    try {
      const hash = await swapOnRobinhood({
        token: market.address as Address,
        side,
        amount,
        slippageBps: slippage,
        onStatus: setChainNote,
      });
      setChainNote(`Swap confirmed. ${hash}`);
    } catch (error) {
      setChainNote(explainTx(error));
    } finally {
      setChainBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="token-cell">
        <TokenMark symbol={market.symbol} image={market.image} size={52} />
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <h1 className="page-title" style={{ fontSize: 36 }}>{market.name}</h1>
            <PhasePill phase={market.phase} />
          </div>
          <div className="coin-meta">
            <span>{market.symbol} / {stats.pair.symbol}</span>
            <CopyCa address={market.address} />
            <span>creator {shortAddr(market.creator)}</span>
            {market.onchain && (
              <>
                <a href={tokenExplorer(market.address)} target="_blank" rel="noreferrer">Explorer</a>
                <a href={txExplorer(market.tx)} target="_blank" rel="noreferrer">Deploy tx</a>
                {market.poolAddress && <a href={dexScreener(market.poolAddress)} target="_blank" rel="noreferrer">DexScreener</a>}
              </>
            )}
          </div>
        </div>
      </div>
      {market.description && <p className="sub">{market.description}</p>}
      <div className="grid-3">
        <div className="stat"><span>Price</span><b>{compact(stats.price, 6)} {stats.pair.symbol}</b></div>
        <div className="stat"><span>Market cap</span><b>{usd(stats.mcap)}</b></div>
        <div className="stat"><span>Volume</span><b>{usd(market.volumeQuote * stats.pair.usd)}</b></div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong>{market.phase === "graduated" ? "v4 pool" : "Bonding curve"}</strong>
              <span className="mono faint">{Math.round(stats.progress * 100)}% to target</span>
            </div>
            <Progress value={stats.progress} graduated={market.phase === "graduated"} />
            <CandleChart candles={candles} />
          </div>
          <div className="card">
            <div className="tabs">
              {(["trades", "holders", "locks", "bribes"] as const).map((key) => (
                <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{key}</button>
              ))}
            </div>
            {tab === "trades" && (
              <table className="table">
                <tbody>
                  {market.trades.map((row) => (
                    <tr key={row.id}>
                      <td className={row.side === "buy" ? "mono" : "mono"} style={{ color: row.side === "buy" ? "var(--green)" : "var(--red)" }}>{row.side}</td>
                      <td className="mono">{compact(row.tokenAmount)} {market.symbol}</td>
                      <td className="mono">{compact(row.quoteGross, 4)} {stats.pair.symbol}</td>
                      <td className="faint">{timeAgo(row.time, state.now)} · {row.venue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === "holders" && (
              <table className="table">
                <tbody>
                  {holders.map((holder) => (
                    <tr key={holder.account}>
                      <td className="mono">{shortAddr(holder.account)}</td>
                      <td className="right mono">{compact(holder.amount)}</td>
                      <td className="right faint">{holder.locked > 0 ? `${compact(holder.locked)} locked` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === "locks" && (
              <table className="table">
                <tbody>
                  {locks.map((lock) => {
                    const earned = positionRewards(state, lock);
                    const reward = Object.values(earned).reduce((sum, value) => sum + value, 0);
                    return (
                      <tr key={lock.id}>
                        <td className="mono">{shortAddr(lock.owner)}</td>
                        <td className="mono">{compact(lock.amount)} · {lock.multiplier}×</td>
                        <td className="faint">{lock.withdrawn ? "withdrawn" : formatDate(lock.expiry)}</td>
                        <td className="right mono">{compact(reward, 4)} {stats.pair.symbol}</td>
                      </tr>
                    );
                  })}
                  {locks.length === 0 && <tr><td className="note">No reward locks yet.</td></tr>}
                </tbody>
              </table>
            )}
            {tab === "bribes" && (
              <div className="stack">
                {bribes.map((bribe) => (
                  <div key={bribe.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div>
                      <strong className="mono">{compact(bribe.amount, 4)} {stats.pair.symbol}</strong>
                      <div className="faint">{bribe.status} · {shortAddr(bribe.briber)}</div>
                    </div>
                    {wallet === bribe.briber && bribe.status === "pending" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn" onClick={() => commit(activateBribe(state, { briber: wallet, bribeId: bribe.id }))}>Activate</button>
                        <button className="btn" disabled={state.now < bribe.createdAt + GRACE_MS} onClick={() => commit(refundBribe(state, { briber: wallet, bribeId: bribe.id }))}>Refund</button>
                      </div>
                    )}
                  </div>
                ))}
                <label className="lbl">
                  Deposit bribe ({stats.pair.symbol})
                  <input className="field" value={bribeAmt} onChange={(event) => setBribeAmt(event.target.value)} />
                </label>
                <button className="btn" disabled={!wallet} onClick={() => wallet && commit(depositBribe(state, { briber: wallet, market: market.address, amount: Number(bribeAmt) }))}>
                  Deposit bribe
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="card ticket">
            <div className="seg">
              <button className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>Buy</button>
              <button className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>Sell</button>
            </div>
            <label className="lbl" style={{ marginTop: 12 }}>
              {side === "buy" ? `Pay with ${stats.pair.symbol}` : `Sell ${market.symbol}`}
              <input className="field" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            <div className="amounts">
              {(side === "buy" ? [0.05, 0.1, 1, 5] : []).map((preset) => (
                <button key={preset} onClick={() => setAmount(String(preset))}>{preset}</button>
              ))}
              <button onClick={() => setAmount(String(balance))}>MAX</button>
            </div>
            <div className="faint" style={{ marginBottom: 8 }}>Balance {compact(balance, 4)} {side === "buy" ? stats.pair.symbol : market.symbol}</div>
            <label className="lbl">
              Slippage {slippage / 100}%
              <input className="range" type="range" min={10} max={1000} value={slippage} onChange={(event) => setSlippage(Number(event.target.value))} />
            </label>
            <div className="quote-box">
              {onchain ? (
                <>
                  <div><span>You receive</span><b className="mono">{chainOut ? `${compact(Number(chainOut), 4)} ${side === "buy" ? market.symbol : "ETH"}` : "—"}</b></div>
                  <div><span>Pool fee</span><span>Uniswap 1%</span></div>
                  {!market.poolAddress && <div className="note">No Uniswap pool yet, so this token is not listed on DexScreener.</div>}
                  {chainNote && <div className="note">{chainNote}</div>}
                </>
              ) : quote && !("error" in quote) ? (
                <>
                  <div><span>You receive</span><b className="mono">{compact(side === "buy" ? quote.tokens : quote.quoteNet, 4)} {side === "buy" ? market.symbol : stats.pair.symbol}</b></div>
                  <div><span>Base fee</span><span className="mono">{compact(quote.baseFee, 4)}</span></div>
                  <div><span>Creator tax</span><span className="mono">{compact(quote.taxFee, 4)}</span></div>
                  <div><span>Price impact</span><span className="mono">{(quote.impact * 100).toFixed(2)}%</span></div>
                  {quote.partial && <div><span>Partial fill</span><span>Unused quote is refunded</span></div>}
                  {quote.graduates && <div><span>Graduation</span><span>This buy can complete the curve</span></div>}
                </>
              ) : (
                <div className="note">{quote && "error" in quote ? quote.error : "Enter an amount"}</div>
              )}
            </div>
            <button
              className="btn-accent"
              style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
              disabled={!wallet || chainBusy || (onchain ? !market.poolAddress || !(numeric > 0) : !quote || "error" in (quote ?? {}))}
              onClick={() => void submit()}
            >
              {wallet ? (chainBusy ? "Confirm in wallet…" : side === "buy" ? "Buy" : "Sell") : "Connect to trade"}
            </button>
          </div>
          <div className="card">
            <h3>Fee split</h3>
            <p className="note">
              {market.onchain
                ? "This market trades on Uniswap v3. The 1% pool fee is Uniswap’s. The creator-tax slider is not collected on these swaps."
                : `1% base on the quote leg. Creator tax ${market.creatorTaxBps / 100}% goes to ${market.taxToLockers ? "lockers" : "the creator"}.`}
            </p>
            <div className="split"><i /><i /><i /></div>
            <div className="legend">
              <span><b>60%</b> lockers</span>
              <span><b>30%</b> protocol</span>
              <span><b>10%</b> creator</span>
            </div>
            <div className="quote-box" style={{ marginTop: 12 }}>
              <div><span>Locker capital</span><span className="mono">{compact(market.lockerCapital, 4)} {stats.pair.symbol}</span></div>
              <div><span>Creator reserve</span><span className="mono">{compact(market.creatorReserve, 4)}</span></div>
              <div><span>Orphan pot</span><span className="mono">{compact(market.orphanPot, 4)}</span></div>
            </div>
            <div className="stack" style={{ marginTop: 12 }}>
              {market.phase === "escrow" && (
                <button className="btn-accent" onClick={() => wallet && commit(graduate(state, market.address, wallet))}>Retry graduation</button>
              )}
              {wallet === market.creator && market.creatorReserve > 0 && (
                <button className="btn" onClick={() => commit(claimCreator(state, market.address, wallet))}>Claim creator reserve</button>
              )}
              {market.orphanPot > 0 && (
                <button className="btn" disabled={!market.orphanSince || state.now < market.orphanSince + GRACE_MS} onClick={() => wallet && commit(sweepOrphan(state, { caller: wallet, market: market.address }))}>
                  Sweep orphan to protocol
                </button>
              )}
              <Link className="btn" href="/lock">Lock to earn</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyCa({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const label = `${address.slice(0, 10)}…${address.slice(-8)}`;
  return (
    <button
      type="button"
      className="ca-copy"
      title={address}
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <span>CA: {label}</span>
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12.5 9.5 17 19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      )}
    </button>
  );
}

function buildCandles(trades: { time: number; price: number }[]) {
  const bucket = 60 * 60 * 1000;
  const ordered = [...trades].reverse();
  const map = new Map<number, { t: number; o: number; h: number; l: number; c: number }>();
  for (const tradeRow of ordered) {
    const key = Math.floor(tradeRow.time / bucket) * bucket;
    const price = tradeRow.price;
    const candle = map.get(key);
    if (!candle) map.set(key, { t: key, o: price, h: price, l: price, c: price });
    else {
      candle.h = Math.max(candle.h, price);
      candle.l = Math.min(candle.l, price);
      candle.c = price;
    }
  }
  return [...map.values()];
}

function CandleChart({ candles }: { candles: { o: number; h: number; l: number; c: number }[] }) {
  if (candles.length === 0) return <div className="chart note">No trades yet.</div>;
  const highs = candles.map((candle) => candle.h);
  const lows = candles.map((candle) => candle.l);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = max - min || max || 1;
  const w = 640;
  const h = 260;
  const slot = w / candles.length;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {candles.map((candle, index) => {
          const x = index * slot + slot / 2;
          const y = (value: number) => 12 + ((max - value) / span) * (h - 24);
          const up = candle.c >= candle.o;
          const color = up ? "#b6e36a" : "#ff6d5a";
          const bodyTop = y(Math.max(candle.o, candle.c));
          const bodyBot = y(Math.min(candle.o, candle.c));
          return (
            <g key={index}>
              <line x1={x} x2={x} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth="1.5" />
              <rect x={x - Math.max(2, slot * 0.28)} y={bodyTop} width={Math.max(4, slot * 0.56)} height={Math.max(1.5, bodyBot - bodyTop)} fill={color} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
