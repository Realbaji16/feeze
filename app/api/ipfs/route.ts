import { NextResponse } from "next/server";
import { ipfsImagePath } from "@/lib/ipfs-path";
import { pinImage } from "@/lib/ipfs-pin";
import { saveImageCid } from "@/lib/token-image";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const headers = { "cache-control": "no-store" };

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("probe") !== "1") {
    return NextResponse.json({ error: "Missing image" }, { status: 404, headers });
  }
  try {
    const cid = await pinImage(new Blob([new Uint8Array(TINY_PNG)], { type: "image/png" }));
    return NextResponse.json({ cid, image: ipfsImagePath(cid) }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload that image to ipfs.";
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
  }
  const file = form.get("image");
  if (!(file instanceof Blob) || file.size < 8) {
    return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
  }
  try {
    const cid = await pinImage(file);
    const address = form.get("address");
    if (typeof address === "string" && address) await saveImageCid(address, cid);
    return NextResponse.json({ ok: true, cid, image: ipfsImagePath(cid) }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload that image to ipfs.";
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
}
