import { NextResponse } from "next/server";
import { readChainMarkets } from "@/lib/chain-markets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const extra = new URL(request.url).searchParams.get("launchers") ?? "";
  try {
    const markets = await readChainMarkets(extra.split(",").filter(Boolean));
    return NextResponse.json(markets);
  } catch {
    return NextResponse.json([]);
  }
}
