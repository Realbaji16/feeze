"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, formatEther, http } from "viem";
import { useYeeld } from "@/lib/store";
import { PAIRS, type Pair } from "@/lib/pairs";
import { ipfsImagePath } from "@/lib/ipfs-path";
import { bindTokenImage, uploadImageBlob } from "@/lib/share-image";
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
  const [liquidity, setLiquidity] = useState("0.01");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ethBalance, setEthBalance] = useState<number | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageCid = useRef("");
  const imageUpload = useRef<Promise<string> | null>(null);
  const imageGen = useRef(0);
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
    const gen = imageGen.current + 1;
    imageGen.current = gen;
    imageCid.current = "";
    imageUpload.current = null;
    try {
      setImage(await resizeImage(file));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not read that image.");
      return;
    }
    setStatus("Uploading to ipfs...");
    const task = uploadImageBlob(file)
      .then((uploaded) => {
        if (imageGen.current !== gen) return "";
        imageCid.current = uploaded.cid;
        setImage(uploaded.image);
        setStatus(null);
        return uploaded.cid;
      })
      .catch((error: unknown) => {
        if (imageGen.current !== gen) return "";
        imageUpload.current = null;
        setStatus(error instanceof Error ? error.message : "Could not upload that image to ipfs.");
        return "";
      });
    imageUpload.current = task;
    await task;
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
    if (!ethPair) {
      setStatus("Launches pair with ETH. Pick ETH as the pair.");
      return;
    }
    const liquidityEth = liquidity.trim();
    if (!liquidityEth || !(Number(liquidityEth) > 0)) {
      setStatus("Add ETH liquidity so Uniswap, DexScreener, and trading bots can buy the token right away.");
      return;
    }
    setBusy(true);
    setStatus("Switching to Robinhood Chain…");
    try {
      let cid = imageCid.current;
      if (image && !cid && imageUpload.current) {
        setStatus("Uploading to ipfs...");
        cid = await imageUpload.current;
      }
      if (image && !cid) {
        setStatus("The image did not finish uploading to ipfs.");
        return;
      }
      const deployed = await deployRobinhoodToken({
        name: cleanName,
        symbol: cleanSymbol,
        liquidityEth,
        onStatus: setStatus,
      });
      if (!deployed.pool) {
        setStatus("The Uniswap pool did not open. Add ETH liquidity and try again.");
        return;
      }
      const result = commit(
        launch(state, {
          creator: wallet,
          name,
          symbol,
          description,
          image: cid ? ipfsImagePath(cid) : image,
          website,
          twitter,
          pair,
          creatorTaxBps: Math.round(taxPct * 100),
          taxToLockers: toLockers,
          onchain: true,
          chainAddress: deployed.token,
          chainTx: deployed.tx,
          poolAddress: deployed.pool,
        }),
      );
      if (!result.ok) {
        setStatus(`${result.error} The contract is already live at ${deployed.token}.`);
        return;
      }
      if (cid) {
        let saved = false;
        for (let attempt = 0; attempt < 3 && !saved; attempt += 1) saved = await bindTokenImage(result.value.address, cid);
        if (!saved) setStatus("The token is live. This browser will keep saving the image until every browser can see it.");
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
          Launch deploys the token and locks a Uniswap v3 pool in one transaction, so DexScreener, BasedBot, and other traders can buy it immediately. It opens at {PONS_PHANTOM_ETH} ETH ({usd(START_MARKET_CAP_USD)}). The ETH you attach seeds that pool and is locked forever.
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
              {status === "Uploading to ipfs..." && <p className="note">Uploading to ipfs...</p>}
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
          <p className="note">Opens a locked Uniswap pool against ETH at launch. Explore lists it on every device.</p>
          <label className="lbl">
            Pool liquidity (ETH)
            <input className="field" value={liquidity} inputMode="decimal" placeholder="0.01" onChange={(event) => setLiquidity(event.target.value)} />
          </label>
          <label className="lbl">
            Creator tax {taxPct.toFixed(1)}%
            <input className="range" type="range" min={0} max={100} value={tax} onChange={(event) => setTax(Number(event.target.value))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={toLockers} onChange={(event) => setToLockers(event.target.checked)} />
            Redirect creator tax to lockers
          </label>
          <p className="note">Uniswap takes 1% on every swap. Creator tax is recorded on Feeze for this launch.</p>
          <p className="note">
            {ethPair
              ? "Without ETH in the pool, bots and DexScreener cannot trade the token. Gas is separate from this liquidity."
              : "Launches pair with ETH. Other quote assets are not live on this launcher yet."}
          </p>
          <button className="btn-accent launch-submit" disabled={!wallet || busy} onClick={() => void submit()}>
            {wallet ? (busy ? "Confirm in wallet…" : "Launch Token") : "Connect to launch"}
          </button>
          {status && status !== "Uploading to ipfs..." && <p className="note">{status}</p>}
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <h3>What you sign</h3>
          <div className="quote-box">
            <div><span>Chain</span><span>Robinhood 4663</span></div>
            <div><span>Wallet ETH</span><span className="mono">{ethBalance == null ? "—" : compact(ethBalance, 4)}</span></div>
            <div><span>Pool</span><span>Locked Uniswap v3 at launch</span></div>
            <div><span>Liquidity</span><span className="mono">{liquidity.trim() || "—"} ETH</span></div>
            <div><span>Quote</span><span>{selected.symbol}</span></div>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            One confirmation deploys the token and locks the pool. Explore on every device reads the shared launcher.
          </p>
        </div>
        <div className="card">
          <h3>On-chain launch</h3>
          <p className="note">
            80% of the 1,000,000,000 supply goes into the locked Uniswap pool with your ETH. You receive the remaining 20%. Opening market cap is set to about {usd(START_MARKET_CAP_USD)} from the 1.68 ETH phantom price, not from how much liquidity you deposit.
          </p>
        </div>
      </div>
    </div>
  );
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
