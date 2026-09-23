import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CID = /^[A-Za-z0-9]{20,100}$/;

function imageType(bytes: Uint8Array, header: string): string | null {
  if (header.startsWith("image/")) return header.split(";")[0] ?? header;
  if (bytes.length < 8) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return null;
}
const memory = new Map<string, { type: string; bytes: Uint8Array; at: number }>();

async function fetchCid(cid: string): Promise<{ type: string; bytes: Uint8Array } | null> {
  const hit = memory.get(cid);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const gates = [
    `https://gateway.pinata.cloud/ipfs/${cid}`,
    `https://ipfs.io/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`,
  ];
  for (const gate of gates) {
    try {
      const response = await fetch(gate, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
      const header = response.headers.get("content-type") ?? "";
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const type = imageType(bytes, header);
      if (!type) continue;
      const saved = { type, bytes, at: Date.now() };
      memory.set(cid, saved);
      return saved;
    } catch {
      continue;
    }
  }
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ cid: string }> }) {
  const { cid } = await context.params;
  if (!CID.test(cid)) return new NextResponse("Missing image", { status: 404 });
  const image = await fetchCid(cid);
  if (!image) return new NextResponse("Missing image", { status: 404 });
  return new NextResponse(new Blob([image.bytes.slice()], { type: image.type }), {
    headers: {
      "content-type": image.type,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
