"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, formatEther, http } from "viem";
import { useYeeld } from "@/lib/store";
import { PAIRS } from "@/lib/pairs";
import { PairLogo } from "@/components/pair-logo";
import { ipfsImagePath } from "@/lib/ipfs-path";
import { uploadImageBlob } from "@/lib/share-image";
import { compact, usd } from "@/lib/format";
import { GRADUATION_MARKET_CAP_USD, launch, PONS_GRADUATION_ETH, START_MARKET_CAP_USD } from "@/lib/protocol";
import { robinhood } from "@/lib/chain";
import { explainTx, isWethPair, launchOnPons } from "@/lib/robinhood-market";

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
  const [initialBuy, setInitialBuy] = useState("");
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
    const buyEth = initialBuy.trim();
    if (buyEth && !(Number(buyEth) >= 0)) {
      setStatus("Enter the initial buy in ETH, or leave it empty.");
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
      const deployed = await launchOnPons({
        name: cleanName,
        symbol: cleanSymbol,
        logo: cid ? `ipfs://${cid}` : "",
        description: description.trim(),
        website: website.trim(),
        twitter: twitter.trim(),
        creatorTaxBps: tax * 10,
        initialBuyEth: buyEth,
        slippageBps: 500,
        onStatus: setStatus,
      });
      setStatus("Listing it on Feeze…");
      let listed = false;
      for (let attempt = 0; attempt < 4 && !listed; attempt += 1) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 2_000));
        listed = await fetch("/api/launches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: deployed.token, tx: deployed.tx }),
        })
          .then((response) => response.ok)
          .catch(() => false);
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
          creatorTaxBps: tax * 10,
          taxToLockers: false,
          onchain: true,
          chainAddress: deployed.token,
          chainTx: deployed.tx,
          curveAddress: deployed.curve,
        }),
      );
      if (!result.ok) {
        setStatus(`${result.error} The token is already live on Pons at ${deployed.token}.`);
        return;
      }
      if (!listed) setStatus("The token is live on Pons. Explore will list it once the Feeze index catches up.");
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
          Launches go through the Pons v2 factory. The token starts on the Pons bonding curve that trading bots already route, then graduates to a locked Uniswap v4 pool at {PONS_GRADUATION_ETH} ETH raised. Pons is an external protocol.
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
          <p className="note">Pairs with native ETH on Pons. Explore lists it on every device.</p>
          <label className="lbl">
            Initial buy (ETH, optional)
            <input className="field" value={initialBuy} inputMode="decimal" placeholder="0.05" onChange={(event) => setInitialBuy(event.target.value)} />
          </label>
          <label className="lbl">
            Creator tax {taxPct.toFixed(1)}%
            <input className="range" type="range" min={0} max={100} value={tax} onChange={(event) => setTax(Number(event.target.value))} />
          </label>
          <p className="note">Pons charges 1% on every curve trade. Creator tax is optional, charged on top, and paid to you by Pons.</p>
          <p className="note">
            {ethPair
              ? "An initial buy is made in the same transaction as the launch, so nobody can buy ahead of you."
              : "Launches pair with ETH. Other quote assets are not live on Pons from Feeze yet."}
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
            <div><span>Contract</span><span>Pons v2 factory</span></div>
            <div><span>Launch fee</span><span className="mono">0.0005 ETH</span></div>
            <div><span>Initial buy</span><span className="mono">{initialBuy.trim() || "0"} ETH</span></div>
            <div><span>Quote</span><span>{selected.symbol}</span></div>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            One confirmation deploys the token on Pons. Feeze then lists it so Explore shows it on every device.
          </p>
        </div>
        <div className="card">
          <h3>On-chain launch</h3>
          <p className="note">
            The full 1,000,000,000 supply starts on the Pons curve at about {usd(START_MARKET_CAP_USD)}. Once {PONS_GRADUATION_ETH} ETH is raised, around {usd(GRADUATION_MARKET_CAP_USD)}, Pons moves it into a Uniswap v4 pool with liquidity locked forever.
          </p>
        </div>
      </div>
    </div>
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
