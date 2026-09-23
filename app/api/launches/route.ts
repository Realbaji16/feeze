import { NextResponse } from "next/server";
import { CANONICAL_LAUNCHER, readChainMarkets } from "@/lib/chain-markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const extra = url.searchParams.get("launchers") ?? "";
  if (url.searchParams.get("probe") === "1") {
    const started = Date.now();
    let scoutStatus = 0;
    let scoutHead = "";
    let scoutError = "";
    try {
      const response = await fetch(
        `https://robinhoodchain.blockscout.com/api/v2/addresses/${CANONICAL_LAUNCHER}/logs`,
        { cache: "no-store", headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } },
      );
      scoutStatus = response.status;
      scoutHead = (await response.text()).slice(0, 180);
    } catch (error) {
      scoutError = error instanceof Error ? error.message : "scout failed";
    }
    return NextResponse.json(
      { at: started, scoutStatus, scoutError, scoutHead },
      { headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const markets = await readChainMarkets(extra.split(",").filter(Boolean));
    return NextResponse.json(markets, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "launch index failed";
    return NextResponse.json([], { headers: { "cache-control": "no-store", "x-feeze-error": message } });
  }
}
