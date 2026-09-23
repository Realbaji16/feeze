"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, formatEther, http } from "viem";
import { useYeeld } from "@/lib/store";
import { PAIRS } from "@/lib/pairs";
import { compact } from "@/lib/format";
import { launch } from "@/lib/protocol";
import { robinhood } from "@/lib/chain";
import { deployRobinhoodToken, explainTx, isWethPair } from "@/lib/robinhood-market";

export default function LaunchPage() {
  const { state, commit } = useYeeld();
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [pair, setPair] = useState(PAIRS[0].address);
  const [tax, setTax] = useState(0);
  const [toLockers, setToLockers] = useState(false);
  const [initial, setInitial] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ethBalance, setEthBalance] = useState<number | null>(null);
  const selected = PAIRS.find((item) => item.address === pair) ?? PAIRS[0];
  const wallet = state.wallet;
  const taxPct = tax / 10;
  const ethPair = isWethPair(selected.address);

  useEffect(() => {
    if (!wallet) return;
    const client = createPublicClient({ chain: robinhood, transport: http(robinhood.rpcUrls.default.http[0]) });
    let stop = false;
    client
      .getBalance({ address: wallet as `0x${string}` })
      .then((value) => {
        if (!stop) setEthBalance(Number(formatEther(value)));
      })
      .catch(() => {
        if (!stop) setEthBalance(null);
      });
    return () => {
      stop = true;
    };
  }, [wallet]);

  async function submit() {
    if (!wallet || busy) return;
    const cleanName = name.trim();
    const cleanSymbol = symbol.trim().toUpperCase().replace(/^\$/, "");
    if (cleanName.length < 2 || cleanName.length > 32) {
      setStatus("Name must be 2–32 characters.");
      return;
    }
    if (!/^[A-Z0-9]{2,10}$/.test(cleanSymbol)) {
      setStatus("Ticker must be 2–10 letters or numbers.");
      return;
    }
    setBusy(true);
    setStatus("Switching to Robinhood Chain…");
    try {
      const deployed = await deployRobinhoodToken({
        name: cleanName,
        symbol: cleanSymbol,
        liquidityEth: ethPair ? initial : "",
        onStatus: setStatus,
      });
      const result = commit(
        launch(state, {
          creator: wallet,
          name,
          symbol,
          description,
          image,
          website,
          twitter,
          pair,
          creatorTaxBps: Math.round(taxPct * 100),
          taxToLockers: toLockers,
          onchain: true,
          chainAddress: deployed.token,
          chainTx: deployed.tx,
          poolAddress: deployed.pool ?? undefined,
        }),
      );
      if (!result.ok) {
        setStatus(`${result.error} The contract is already live at ${deployed.token}.`);
        return;
      }
      router.push(`/coin/${result.value.address}`);
    } catch (error) {
      setStatus(explainTx(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2">
      <div>
        <h1 className="page-title">Launch a token</h1>
        <p className="sub">
          Launch sends one transaction on Robinhood Chain. An ETH amount locks 80% of supply in a Uniswap v3 pool in that same transaction. The first launch on this browser also installs the launcher, which is one extra confirmation.
        </p>
        <div className="stack">
          <label className="lbl">Token name<input className="field" value={name} placeholder="e.g. Northstar" onChange={(event) => setName(event.target.value)} /></label>
          <label className="lbl">Ticker<input className="field" value={symbol} placeholder="SYMBOL" onChange={(event) => setSymbol(event.target.value.toUpperCase())} /></label>
          <label className="lbl">Description<textarea className="field" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label className="lbl">Image URL<input className="field" value={image} placeholder="https://" onChange={(event) => setImage(event.target.value)} /></label>
          <div className="grid-2">
            <label className="lbl">Website<input className="field" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
            <label className="lbl">X / Twitter<input className="field" value={twitter} onChange={(event) => setTwitter(event.target.value)} /></label>
          </div>
          <div>
            <div className="lbl">Pair</div>
            <div className="pair-grid">
              {PAIRS.map((item) => (
                <button key={item.address} className={pair === item.address ? "on" : ""} onClick={() => setPair(item.address)}>
                  <strong>{item.symbol}</strong>
                  <div className="faint">{item.name}</div>
                </button>
              ))}
            </div>
          </div>
          <label className="lbl">
            Creator tax {taxPct.toFixed(1)}%
            <input className="range" type="range" min={0} max={100} value={tax} onChange={(event) => setTax(Number(event.target.value))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={toLockers} onChange={(event) => setToLockers(event.target.checked)} />
            Redirect creator tax to lockers
          </label>
          <p className="note">This slider is stored on the Feeze market. Uniswap does not collect it.</p>
          <label className="lbl">
            ETH locked in the pool
            <input className="field" value={initial} placeholder="0.01" disabled={!ethPair} onChange={(event) => setInitial(event.target.value)} />
          </label>
          <div className="presets" style={{ display: "flex", gap: 8 }}>
            {[0.001, 0.01, 0.05, 0.1].map((preset) => (
              <button key={preset} disabled={!ethPair} onClick={() => setInitial(String(preset))}>{preset}</button>
            ))}
            <button
              disabled={!ethPair || ethBalance == null}
              onClick={() => ethBalance != null && setInitial(Math.max(ethBalance - 0.002, 0).toFixed(6))}
            >
              MAX
            </button>
          </div>
          <p className="note">
            {ethPair
              ? "Leave this empty to deploy the token only. DexScreener stays empty until a pool exists."
              : "Only the ETH pair opens a Uniswap pool. Other quote assets still deploy the token contract."}
          </p>
          <button className="btn-accent" disabled={!wallet || busy} onClick={() => void submit()}>
            {wallet ? (busy ? "Confirm in wallet…" : "Launch on Robinhood Chain") : "Connect to launch"}
          </button>
          {status && <p className="note">{status}</p>}
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <h3>What you sign</h3>
          <div className="quote-box">
            <div><span>Chain</span><span>Robinhood 4663</span></div>
            <div><span>Wallet ETH</span><span className="mono">{ethBalance == null ? "—" : compact(ethBalance, 4)}</span></div>
            <div><span>Pool</span><span>{ethPair && initial.trim() ? "Uniswap v3, 1% fee" : "Token only"}</span></div>
            <div><span>Quote</span><span>{selected.symbol}</span></div>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            After the launcher is installed, Launch is one wallet confirmation. Gas and the ETH you enter leave your wallet.
          </p>
        </div>
        <div className="card">
          <h3>On-chain launch</h3>
          <p className="note">
            1,000,000,000 tokens. 80% is locked in the Uniswap position sent to the burn address, so that liquidity cannot be pulled. 20% stays in your wallet. The creator-tax slider is not enforced on this pool. The pool fee is Uniswap’s 1% tier.
          </p>
        </div>
      </div>
    </div>
  );
}
