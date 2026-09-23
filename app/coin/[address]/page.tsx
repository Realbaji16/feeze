"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatEther, parseEther, zeroAddress, type Address } from "viem";
import { useYeeld } from "@/lib/store";
import { compact, formatDate, shortAddr, timeAgo, usd } from "@/lib/format";
import {
  assetKey,
  balanceOf,
  claimCreator,
  attachPool,
  graduate,
  holdersOf,
  positionRewards,
  quoteTrade,
  sweepOrphan,
  syncCurve,
  trade,
  GRACE_MS,
} from "@/lib/protocol";
import type { ChainHolder, ChainTrade } from "@/lib/chain-activity";
import { PhasePill, Progress, TokenMark, marketStats } from "@/components/bits";
import { dexChartUrl, listedMarket, readDexPool, type DexQuote } from "@/lib/dex";
import { GRADUATION_MARKET_CAP_USD, PONS_GRADUATION_ETH, PONS_PHANTOM_ETH } from "@/lib/protocol";
import { dexScreener, explainTx, quoteSwap, readCurveState, readCurveTrades, readHoldings, readUniswapPool, swapOnRobinhood, tokenExplorer, tradeOnCurve, txExplorer } from "@/lib/robinhood-market";
import { quoteCurveBuy, quoteCurveSell } from "@/lib/curve-math";

export default function CoinPage() {
  const params = useParams<{ address: string }>();
  const { state, commit } = useYeeld();
  const market = state.markets.find((item) => item.address === params.address.toLowerCase());
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.1");
  const [slippage, setSlippage] = useState(100);
  const [tab, setTab] = useState<"trades" | "holders" | "locks">("trades");
  const [chainTrades, setChainTrades] = useState<ChainTrade[]>([]);
  const [chainHolders, setChainHolders] = useState<ChainHolder[]>([]);
  const [chainBal, setChainBal] = useState<{ eth: number; token: number } | null>(null);
  const [chainOut, setChainOut] = useState<string | null>(null);
  const [chainNote, setChainNote] = useState<string | null>(null);
  const [chainBusy, setChainBusy] = useState(false);
  const [dex, setDex] = useState<DexQuote | null>(null);

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
    if (!market?.onchain || !(numeric > 0)) {
      setChainOut(null);
      return;
    }
    if (market.curveAddress && !market.poolAddress) {
      try {
        const raw = parseEther(amount);
        const realQuote = parseEther(market.realQuote.toFixed(18));
        const tokenReserve = parseEther((market.realTokens || 1_000_000_000).toFixed(18));
        const tax = BigInt(market.creatorTaxBps);
        const quoted =
          side === "buy"
            ? quoteCurveBuy({ quoteIn: raw, realQuote, tokenReserve, creatorTaxBps: tax })
            : quoteCurveSell({ tokensIn: raw, realQuote, tokenReserve, creatorTaxBps: tax });
        const out = "tokensOut" in quoted ? quoted.tokensOut : quoted.quoteOut;
        setChainOut(formatEther(out));
      } catch {
        setChainOut(null);
      }
      return;
    }
    if (!market.poolAddress) {
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
  }, [market?.onchain, market?.poolAddress, market?.curveAddress, market?.address, market?.realQuote, market?.realTokens, market?.creatorTaxBps, side, amount, numeric]);

  const stateRef = useRef(state);
  const commitRef = useRef(commit);
  stateRef.current = state;
  commitRef.current = commit;

  useEffect(() => {
    if (!market?.onchain || market.poolAddress) return;
    let stop = false;
    readUniswapPool(market.address as Address)
      .then((pool) => {
        if (stop || !pool) return;
        commitRef.current(attachPool(stateRef.current, market.address, pool));
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [market?.onchain, market?.poolAddress, market?.address]);

  useEffect(() => {
    if (!market?.poolAddress) {
      setDex(null);
      return;
    }
    let stop = false;
    const load = () => {
      readDexPool(market.poolAddress!)
        .then((quote) => {
          if (!stop && quote) setDex(quote);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 20_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [market?.poolAddress]);

  useEffect(() => {
    if (!market?.curveAddress) return;
    let stop = false;
    const load = () => {
      readCurveState(market.curveAddress as Address)
        .then((chain) => {
          if (stop) return;
          const realQuote = Number(formatEther(chain.realQuote));
          const realTokens = Number(formatEther(chain.tokenReserve));
          const pool = chain.graduated && chain.pool !== zeroAddress ? chain.pool : null;
          const current = stateRef.current.markets.find((item) => item.address === market.address);
          const changed =
            !current ||
            Math.abs(current.realQuote - realQuote) > 1e-12 ||
            Math.abs(current.realTokens - realTokens) > 1e-6 ||
            Boolean(pool && !current.poolAddress);
          if (!changed) return;
          commitRef.current(syncCurve(stateRef.current, market.address, { realQuote, realTokens, pool }));
        })
        .catch(() => undefined);
      readCurveTrades(market.curveAddress as Address)
        .then((rows) => {
          if (!stop) setChainTrades(rows);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 15_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [market?.curveAddress, market?.address]);

  useEffect(() => {
    if (!market?.onchain || (market.curveAddress && !market.poolAddress)) return;
    let stop = false;
    const load = () => {
      const pool = market.poolAddress ?? "";
      fetch(`/api/token?address=${market.address}&pool=${pool}`)
        .then((response) => (response.ok ? response.json() : { holders: [], trades: [] }))
        .then((body: { holders?: ChainHolder[]; trades?: ChainTrade[] }) => {
          if (stop) return;
          setChainHolders(body.holders ?? []);
          setChainTrades(body.trades ?? []);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 20_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [market?.onchain, market?.address, market?.poolAddress]);

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
  const listed = listedMarket({
    onchain,
    phase: market.phase,
    quote: dex ?? undefined,
    statsMcap: stats.mcap,
    statsProgress: stats.progress,
    curve: Boolean(market.curveAddress && !market.poolAddress),
  });
  const candles = buildCandles(market.trades);
  const simHolders = holdersOf(state, market.address);
  const trades = onchain ? chainTrades : market.trades;
  const locks = state.locks.filter((lock) => lock.token === market.address && lock.kind === "reward");

  async function submit() {
    if (!wallet || !market) return;
    if (!onchain) {
      commit(trade(state, { trader: wallet, market: market.address, side, amount: numeric, slippageBps: slippage }));
      return;
    }
    setChainBusy(true);
    setChainNote(null);
    try {
      const hash = market.curveAddress && !market.poolAddress
        ? await tradeOnCurve({
            curve: market.curveAddress as Address,
            side,
            amount,
            slippageBps: slippage,
            onStatus: setChainNote,
          })
        : await swapOnRobinhood({
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
            <PhasePill phase={listed.phase} />
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
        <div className="stat"><span>Price</span><b>{dex ? usd(dex.priceUsd) : onchain && (market.poolAddress || market.curveAddress) ? usd(stats.price * stats.pair.usd) : onchain ? "—" : `${compact(stats.price, 6)} ${stats.pair.symbol}`}</b></div>
        <div className="stat"><span>Market cap</span><b>{onchain && !market.poolAddress && !market.curveAddress ? "—" : usd(listed.mcap)}</b></div>
        <div className="stat"><span>Volume</span><b>{usd(dex ? dex.volume24h : market.volumeQuote * stats.pair.usd)}</b></div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong>{market.poolAddress ? "DexScreener" : market.curveAddress || !onchain ? "Bonding curve" : "DexScreener"}</strong>
              <span className="mono faint">
                {listed.graduated
                  ? "Graduated"
                  : onchain && (market.poolAddress || market.curveAddress)
                    ? `${Math.round(listed.progress * 100)}% to ${PONS_GRADUATION_ETH} ETH · ${usd(GRADUATION_MARKET_CAP_USD)}`
                    : onchain
                      ? "No pool yet"
                      : `${Math.round(listed.progress * 100)}% to target`}
              </span>
            </div>
            <Progress value={listed.progress} graduated={listed.graduated} />
            {market.poolAddress ? (
              <iframe className="dex-frame" title={`${market.symbol} chart`} src={dexChartUrl(market.poolAddress)} />
            ) : market.curveAddress && stats ? (
              <PriceChart points={curvePoints(market.launchedAt, stats.price, chainTrades)} />
            ) : onchain ? (
              <div className="chart note">This launch did not open a curve or a pool.</div>
            ) : (
              <CandleChart candles={candles} />
            )}
          </div>
          <div className="card">
            <div className="tabs">
              {(["trades", "holders", "locks"] as const).map((key) => (
                <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{key}</button>
              ))}
            </div>
            {tab === "trades" && (
              <table className="table">
                <tbody>
                  {onchain
                    ? chainTrades.map((row) => (
                        <tr key={row.hash}>
                          <td className="mono" style={{ color: row.side === "buy" ? "var(--green)" : "var(--red)" }}>{row.side}</td>
                          <td className="mono">{compact(row.tokenAmount)} {market.symbol}</td>
                          <td className="mono">{row.quoteAmount == null ? "—" : `${compact(row.quoteAmount, 4)} ETH`}</td>
                          <td className="faint">{timeAgo(row.time, Date.now())} · {shortAddr(row.trader)}</td>
                          <td className="right"><a href={txExplorer(row.hash)} target="_blank" rel="noreferrer">tx</a></td>
                        </tr>
                      ))
                    : market.trades.map((row) => (
                        <tr key={row.id}>
                          <td className="mono" style={{ color: row.side === "buy" ? "var(--green)" : "var(--red)" }}>{row.side}</td>
                          <td className="mono">{compact(row.tokenAmount)} {market.symbol}</td>
                          <td className="mono">{compact(row.quoteGross, 4)} {stats.pair.symbol}</td>
                          <td className="faint">{timeAgo(row.time, state.now)} · {row.venue}</td>
                        </tr>
                      ))}
                  {trades.length === 0 && (
                    <tr><td className="note">No trades yet.</td></tr>
                  )}
                </tbody>
              </table>
            )}
            {tab === "holders" && (
              <table className="table">
                <tbody>
                  {onchain
                    ? chainHolders.map((holder) => (
                        <tr key={holder.address}>
                          <td className="mono">
                            <a href={`https://robinhoodchain.blockscout.com/address/${holder.address}`} target="_blank" rel="noreferrer">{shortAddr(holder.address)}</a>
                            {market.poolAddress && holder.address === market.poolAddress.toLowerCase() ? " · pool" : ""}
                          </td>
                          <td className="right mono">{compact(holder.amount)} {market.symbol}</td>
                          <td className="right faint">{(holder.share * 100).toFixed(2)}%</td>
                        </tr>
                      ))
                    : simHolders.map((holder) => (
                        <tr key={holder.account}>
                          <td className="mono">{shortAddr(holder.account)}</td>
                          <td className="right mono">{compact(holder.amount)}</td>
                          <td className="right faint">{holder.locked > 0 ? `${compact(holder.locked)} locked` : ""}</td>
                        </tr>
                      ))}
                  {(onchain ? chainHolders : simHolders).length === 0 && (
                    <tr><td className="note">No holders yet.</td></tr>
                  )}
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
                  <div><span>Fee</span><span>{market.curveAddress && !market.poolAddress ? "1% plus creator tax, paid in ETH" : "Uniswap 1%"}</span></div>
                  {market.curveAddress && !market.poolAddress && <div className="note">Trades go to the bonding curve. The Uniswap pool opens once 4.2 ETH has been raised.</div>}
                  {!market.poolAddress && !market.curveAddress && <div className="note">No Uniswap pool yet, so this token is not listed on DexScreener.</div>}
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
              disabled={!wallet || chainBusy || (onchain ? !(market.poolAddress || market.curveAddress) || !(numeric > 0) : !quote || "error" in (quote ?? {}))}
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

function curvePoints(launchedAt: number, spot: number, trades: ChainTrade[]) {
  const open = PONS_PHANTOM_ETH / 1_000_000_000;
  const points = [{ time: launchedAt || Date.now() - 60_000, price: open }];
  for (const row of [...trades].reverse()) {
    if (!row.quoteAmount || !row.tokenAmount) continue;
    points.push({ time: row.time, price: row.quoteAmount / row.tokenAmount });
  }
  const last = points[points.length - 1];
  points.push({ time: Math.max(Date.now(), last.time + 1), price: spot });
  return points;
}

function PriceChart({ points }: { points: { time: number; price: number }[] }) {
  const prices = points.map((point) => point.price);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const pad = (max - min) * 0.35 || max * 0.2 || 1;
  const top = max + pad;
  const bottom = Math.max(0, min - pad);
  const span = top - bottom || 1;
  const width = 640;
  const height = 260;
  const start = points[0]?.time ?? 0;
  const end = points[points.length - 1]?.time ?? start + 1;
  const spanTime = Math.max(1, end - start);
  const coords = points.map((point) => ({
    x: 8 + ((point.time - start) / spanTime) * (width - 16),
    y: 16 + ((top - point.price) / span) * (height - 32),
  }));
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].x.toFixed(2)},${height} L${coords[0].x.toFixed(2)},${height} Z`;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path d={area} fill="rgba(34, 163, 255, 0.14)" />
        <path d={line} fill="none" stroke="#22A3FF" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
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
