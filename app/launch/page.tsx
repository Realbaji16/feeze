"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, formatEther, http } from "viem";
import { useYeeld } from "@/lib/store";
import { PAIRS, type Pair } from "@/lib/pairs";
import { shareTokenImage } from "@/lib/share-image";
import { compact, usd } from "@/lib/format";
import { launch, PONS_PHANTOM_ETH, START_MARKET_CAP_USD } from "@/lib/protocol";
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
  const [initial, setInitial] = useState("0.001");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ethBalance, setEthBalance] = useState<number | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const pairMenu = useRef<HTMLDivElement>(null);
  const [pairOpen, setPairOpen] = useState(false);
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

  useEffect(() => {
    if (!pairOpen) return;
    const close = (event: MouseEvent) => {
      if (!pairMenu.current?.contains(event.target as Node)) setPairOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPairOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [pairOpen]);

  async function onImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file.");
      return;
    }
    try {
      setImage(await resizeImage(file));
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not read that image.");
    }
  }

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
    if (ethPair && !(Number(initial) > 0)) {
      setStatus("Enter the ETH to lock in the pool. That is what opens the DexScreener chart.");
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
      if (image) void shareTokenImage(result.value.address, image);
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
          Launch sends one transaction on Robinhood Chain and opens the pool at a {PONS_PHANTOM_ETH} ETH market cap ({usd(START_MARKET_CAP_USD)}), the same open as a Pons ETH curve. The ETH you add is liquidity at that price. The first launch on this browser also installs the launcher, which is one extra confirmation.
        </p>
        <div className="stack">
          <div className="launch-identity">
            <button type="button" className="add-image" onClick={() => imageInput.current?.click()}>
              {image ? (
                <img src={image} alt="" />
              ) : (
                <>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="9" cy="10" r="1.4" fill="currentColor" />
                    <path d="M4 16.5 9 12l3.2 3 2.3-2 5.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                  Add image
                </>
              )}
            </button>
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void onImage(file);
              }}
            />
            <div className="stack">
              <div className="launch-name">
                <label className="lbl">Token name<input className="field" value={name} placeholder="e.g. Northstar" onChange={(event) => setName(event.target.value)} /></label>
                <label className="lbl">Ticker<input className="field" value={symbol} placeholder="SYMBOL" onChange={(event) => setSymbol(event.target.value.toUpperCase())} /></label>
              </div>
              <label className="lbl">Description<textarea className="field" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            </div>
          </div>
          <div className="grid-2">
            <label className="lbl">Website<input className="field" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
            <label className="lbl">X / Twitter<input className="field" value={twitter} onChange={(event) => setTwitter(event.target.value)} /></label>
          </div>
          <div className="lbl">
            Paired asset
            <div className="pair-select" ref={pairMenu}>
              <button type="button" className="field pair-trigger" onClick={() => setPairOpen((open) => !open)}>
                <PairLogo pair={selected} />
                <span>{selected.symbol}</span>
                <svg className="pair-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {pairOpen && (
                <div className="pair-menu" role="listbox">
                  {PAIRS.map((item) => (
                    <button
                      type="button"
                      key={item.address}
                      className={item.address === pair ? "on" : ""}
                      onClick={() => {
                        setPair(item.address);
                        setPairOpen(false);
                      }}
                    >
                      <PairLogo pair={item} />
                      <span>{item.symbol}</span>
                      <em>{item.name}</em>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="note">Graduates once the curve raises {raisedAmount(selected.threshold)} {selected.symbol}.</p>
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
              ? "This ETH is the pool. The opening price stays 1.68 ETH, and DexScreener charts the pool after the transaction confirms."
              : "Only the ETH pair opens a Uniswap pool. Other quote assets still deploy the token contract."}
          </p>
          <button className="btn-accent launch-submit" disabled={!wallet || busy} onClick={() => void submit()}>
            {wallet ? (busy ? "Confirm in wallet…" : "Launch Token") : "Connect to launch"}
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
            Opens at {PONS_PHANTOM_ETH} ETH ({usd(START_MARKET_CAP_USD)}), from Pons’s 1.68 ETH virtual reserve against 1,000,000,000 tokens. 20% stays in your wallet. The ETH you add buys the pool at that price, and the rest of the supply stays locked in the launcher. The creator-tax slider is not enforced on this pool. The pool fee is Uniswap’s 1% tier.
          </p>
        </div>
      </div>
    </div>
  );
}

function raisedAmount(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function PairLogo({ pair }: { pair: Pair }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`pair-mark${pair.symbol === "ETH" ? " eth" : ""}`}>
        {pair.symbol === "ETH" ? (
          <svg width="14" height="14" viewBox="0 0 32 32" aria-hidden="true">
            <path fill="#fff" d="M16 3 8 16.2 16 20.2 24 16.2 16 3zm0 19.2L8 18.2 16 29l8-10.8-8 3z" />
          </svg>
        ) : (
          pair.symbol.slice(0, 1)
        )}
      </span>
    );
  }
  return (
    <img
      className="pair-logo"
      src={`https://cdn.robinhood.com/ncw_assets/logos/${pair.address}.png`}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that image."));
        return;
      }
      const png = file.type === "image/png";
      if (!png) {
        ctx.fillStyle = "#111311";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}
