import { useState } from "react";
import type { Pair } from "@/lib/pairs";

/** Local brand marks. The Robinhood CDN returns one stock placeholder for every tokenized equity. */
export function pairLogoSrc(symbol: string): string {
  return `/pairs/${symbol.toLowerCase()}.svg`;
}

export function PairLogo({ pair, size = 24 }: { pair: Pair; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`pair-mark${pair.symbol === "ETH" ? " eth" : ""}`} style={{ width: size, height: size, fontSize: size * 0.42 }}>
        {pair.symbol === "ETH" ? (
          <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 32 32" aria-hidden="true">
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
      src={pairLogoSrc(pair.symbol)}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
