import { NextResponse } from "next/server";
import { readChainHolders, readChainTrades } from "@/lib/chain-activity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("address") ?? "").toLowerCase();
  const pool = (url.searchParams.get("pool") ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) return NextResponse.json({ holders: [], trades: [] });
  try {
    const [holders, trades] = await Promise.all([
      readChainHolders(token),
      /^0x[0-9a-f]{40}$/.test(pool) ? readChainTrades(token, pool) : Promise.resolve([]),
    ]);
    return NextResponse.json({ holders, trades });
  } catch {
    return NextResponse.json({ holders: [], trades: [] });
  }
}
