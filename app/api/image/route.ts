import { NextResponse } from "next/server";
import { probeImageStore, putTokenImage, readTokenImage } from "@/lib/token-image";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("probe") === "1") {
    try {
      return NextResponse.json(await probeImageStore(), { headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : "probe failed";
      return NextResponse.json({ error: message }, { headers });
    }
  }
  const address = url.searchParams.get("address") ?? "";
  try {
    const image = await readTokenImage(address);
    return NextResponse.json({ image }, { headers });
  } catch {
    return NextResponse.json({ image: null }, { headers });
  }
}

export async function POST(request: Request) {
  let body: { address?: string; image?: string };
  try {
    body = (await request.json()) as { address?: string; image?: string };
  } catch {
    return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
  }
  if (!body.address || !body.image) {
    return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
  }
  try {
    const result = await putTokenImage(body.address, body.image);
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save image";
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
}
