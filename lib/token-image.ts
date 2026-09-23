import { IMAGE_CHUNK_CHARS, IMAGE_MAX_BYTES } from "./image-budget";
import { ipfsImagePath } from "./ipfs-path";

const APP_KEY = "eoprd8iz";
const MAX_CHUNKS = 48;

function keyFor(address: string): string | null {
  const key = address.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(key) ? key.slice(2) : null;
}

function xmlValue(text: string): string {
  const match = text.match(/<string[^>]*>([\s\S]*?)<\/string>/);
  let value = (match ? match[1] : text).replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "string") value = parsed;
    } catch {
      value = value.slice(1, -1);
    }
  }
  return value;
}

async function getValue(key: string): Promise<string | null> {
  const response = await fetch(`https://keyvalue.immanuel.co/api/KeyVal/GetValue/${APP_KEY}/${encodeURIComponent(key)}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  const value = xmlValue(await response.text());
  if (!value || value === "null") return null;
  return value;
}

async function setValue(key: string, value: string): Promise<void> {
  const response = await fetch(
    `https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/${APP_KEY}/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { method: "POST", cache: "no-store" },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`save ${response.status} ${text.slice(0, 80)}`);
  }
}

async function eachChunk(count: number, run: (index: number) => Promise<void>): Promise<void> {
  const width = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < count) {
      const index = cursor;
      cursor += 1;
      await run(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, count) }, () => worker()));
}

const memory = new Map<string, { image: string | null; at: number }>();

function remember(key: string, image: string | null) {
  memory.set(key, { image, at: Date.now() });
}

function dataUrl(mime: string, hex: string): string {
  const encoded = Buffer.from(hex, "hex").toString("base64");
  return `data:image/${mime === "png" ? "png" : "jpeg"};base64,${encoded}`;
}

async function loadHex(key: string, count: number): Promise<string | null> {
  const parts = new Array<string>(count);
  await eachChunk(count, async (index) => {
    parts[index] = (await getValue(`${key}h${index}`)) ?? "";
  });
  if (parts.some((part) => !part || !/^[0-9a-f]+$/i.test(part))) return null;
  const hex = parts.join("");
  if (hex.length % 2 !== 0 || hex.length / 2 > IMAGE_MAX_BYTES) return null;
  return hex;
}

export async function readTokenImage(address: string): Promise<string | null> {
  const key = keyFor(address);
  if (!key) return null;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < (hit.image ? 10 * 60_000 : 3_000)) return hit.image;
  const image = await loadTokenImage(key);
  remember(key, image);
  return image;
}

const CID = /^[A-Za-z0-9]{20,100}$/;

export async function saveImageCid(address: string, cid: string): Promise<"saved" | "kept"> {
  const key = keyFor(address);
  if (!key) throw new Error("Image storage is not ready");
  if (!CID.test(cid)) throw new Error("IPFS returned an invalid image");
  const existing = await getValue(`${key}u`);
  if (existing && CID.test(existing)) return "kept";
  await setValue(`${key}u`, cid);
  remember(key, ipfsImagePath(cid));
  return "saved";
}

async function loadTokenImage(key: string): Promise<string | null> {
  const cid = await getValue(`${key}u`);
  if (cid && CID.test(cid)) return ipfsImagePath(cid);
  const count = Number(await getValue(`${key}n`));
  if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) return null;
  const mime = await getValue(`${key}m`);
  if (mime !== "png" && mime !== "jpg") return null;
  const hex = await loadHex(key, count);
  if (!hex) return null;
  return dataUrl(mime, hex);
}

function parseDataUrl(image: string): { mime: "png" | "jpg"; hex: string } | null {
  const match = image.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replaceAll(/\s/g, ""), "base64");
  if (bytes.length < 8 || bytes.length > IMAGE_MAX_BYTES) return null;
  return { mime: match[1] === "png" ? "png" : "jpg", hex: bytes.toString("hex") };
}

async function alreadyStored(key: string): Promise<boolean> {
  const count = Number(await getValue(`${key}n`));
  return Number.isInteger(count) && count >= 1 && count <= MAX_CHUNKS;
}

export async function putTokenChunk(address: string, index: number, hex: string): Promise<"saved" | "kept"> {
  const key = keyFor(address);
  if (!key) throw new Error("Image storage is not ready");
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) throw new Error("Image is too large");
  const part = hex.trim().toLowerCase();
  if (part.length < 2 || part.length > IMAGE_CHUNK_CHARS || part.length % 2 !== 0 || !/^[0-9a-f]+$/.test(part)) {
    throw new Error("Image is too large");
  }
  if (await alreadyStored(key)) return "kept";
  await setValue(`${key}h${index}`, part);
  return "saved";
}

export async function commitTokenImage(
  address: string,
  mime: string,
  total: number,
  hexLength: number,
): Promise<"saved" | "kept"> {
  const key = keyFor(address);
  if (!key) throw new Error("Image storage is not ready");
  if (mime !== "png" && mime !== "jpg") throw new Error("Expected an image");
  if (!Number.isInteger(total) || total < 1 || total > MAX_CHUNKS) throw new Error("Image is too large");
  if (!Number.isInteger(hexLength) || hexLength < 16 || hexLength > IMAGE_MAX_BYTES * 2 || hexLength % 2 !== 0) {
    throw new Error("Image is too large");
  }
  if (await alreadyStored(key)) return "kept";
  const hex = await loadHex(key, total);
  if (!hex || hex.length !== hexLength) throw new Error("Saved image did not match");
  await setValue(`${key}m`, mime);
  await setValue(`${key}n`, String(total));
  remember(key, dataUrl(mime, hex));
  return "saved";
}

export async function putTokenImage(address: string, image: string): Promise<"saved" | "kept"> {
  const key = keyFor(address);
  if (!key) throw new Error("Image storage is not ready");
  if (await alreadyStored(key)) return "kept";
  const parsed = parseDataUrl(image);
  if (!parsed) throw new Error(image.startsWith("data:image") ? "Image is too large" : "Expected an image");
  const count = Math.ceil(parsed.hex.length / IMAGE_CHUNK_CHARS);
  await eachChunk(count, async (index) => {
    const part = parsed.hex.slice(index * IMAGE_CHUNK_CHARS, (index + 1) * IMAGE_CHUNK_CHARS);
    await setValue(`${key}h${index}`, part);
  });
  const back = await loadHex(key, count);
  if (back !== parsed.hex) throw new Error("Saved image did not match");
  await setValue(`${key}m`, parsed.mime);
  await setValue(`${key}n`, String(count));
  remember(key, dataUrl(parsed.mime, parsed.hex));
  return "saved";
}

export async function probeImageStore(): Promise<{ match: boolean; len: number; result?: string; error?: string }> {
  const address = `0x${"22".repeat(20)}`;
  const bytes = Buffer.alloc(1500, 9);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  const image = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  try {
    const result = await putTokenImage(address, image);
    memory.delete(address.slice(2));
    const back = await readTokenImage(address);
    return { result, match: back === image, len: back?.length ?? 0 };
  } catch (error) {
    return { match: false, len: 0, error: error instanceof Error ? error.message : "probe failed" };
  }
}
