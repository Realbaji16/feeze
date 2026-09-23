import { NextResponse } from "next/server";
import { commitTokenImage, probeImageStore, putTokenChunk, putTokenImage, readTokenImage } from "@/lib/token-image";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

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
  let body: {
    address?: string;
    image?: string;
    index?: number;
    hex?: string;
    commit?: boolean;
    mime?: string;
    total?: number;
    hexLength?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
  }
  if (!body.address) {
    return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
  }
  try {
    if (body.commit) {
      const result = await commitTokenImage(body.address, body.mime ?? "", body.total ?? 0, body.hexLength ?? 0);
      return NextResponse.json({ ok: true, result }, { headers });
    }
    if (typeof body.index === "number" && typeof body.hex === "string") {
      const result = await putTokenChunk(body.address, body.index, body.hex);
      return NextResponse.json({ ok: true, result }, { headers });
    }
    if (!body.image) {
      return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
    }
    const result = await putTokenImage(body.address, body.image);
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save image";
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
}
