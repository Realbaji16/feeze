import { IMAGE_CHUNK_CHARS, IMAGE_TARGET_BYTES } from "./image-budget";

function byteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

function drawDataUrl(dataUrl: string, size: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.fillStyle = "#111311";
      ctx.fillRect(0, 0, size, size);
      const scale = Math.min(size / img.width, size / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = dataUrl;
  });
}

/** Shrink a launch image until every browser can load the same copy. */
export async function shrinkDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image")) return dataUrl;
  if (dataUrl.startsWith("data:image/jpeg") && byteSize(dataUrl) <= IMAGE_TARGET_BYTES) return dataUrl;
  let best = dataUrl;
  for (const size of [96, 80, 64, 48, 40, 32, 24, 16]) {
    for (const quality of [0.62, 0.45, 0.3, 0.18, 0.1]) {
      best = await drawDataUrl(dataUrl, size, quality);
      if (byteSize(best) <= IMAGE_TARGET_BYTES) return best;
    }
  }
  return best;
}

export async function readSharedImage(address: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/image?address=${address.toLowerCase()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { image?: string | null };
    return body.image?.startsWith("data:image") ? body.image : null;
  } catch {
    return null;
  }
}

function imageHex(dataUrl: string): { mime: "png" | "jpg"; hex: string } | null {
  const match = dataUrl.replaceAll(/\s/g, "").match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  let hex = "";
  for (let i = 0; i < binary.length; i += 1) hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  if (hex.length < 16 || hex.length % 2 !== 0) return null;
  return { mime: match[1] === "png" ? "png" : "jpg", hex };
}

async function postImage(body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch("/api/image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return false;
  const payload = (await response.json()) as { ok?: boolean };
  return payload.ok === true;
}

async function mapPool(count: number, run: (index: number) => Promise<void>): Promise<void> {
  const width = 4;
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

const pending = new Map<string, Promise<boolean>>();

async function uploadShared(key: string, image: string): Promise<boolean> {
  const existing = await readSharedImage(key);
  if (existing) return true;
  const small = await shrinkDataUrl(image);
  const parsed = imageHex(small);
  if (!parsed || byteSize(small) > IMAGE_TARGET_BYTES) return false;
  const count = Math.ceil(parsed.hex.length / IMAGE_CHUNK_CHARS);
  let failed = false;
  await mapPool(count, async (index) => {
    if (failed) return;
    const hex = parsed.hex.slice(index * IMAGE_CHUNK_CHARS, (index + 1) * IMAGE_CHUNK_CHARS);
    const ok = await postImage({ address: key, index, hex });
    if (!ok) failed = true;
  });
  if (failed) return false;
  return postImage({
    address: key,
    commit: true,
    mime: parsed.mime,
    total: count,
    hexLength: parsed.hex.length,
  });
}

export function shareTokenImage(address: string, image: string): Promise<boolean> {
  const key = address.toLowerCase();
  if (!image.startsWith("data:image")) return Promise.resolve(false);
  const current = pending.get(key);
  if (current) return current;
  const job = uploadShared(key, image).then((ok) => {
    if (!ok) pending.delete(key);
    return ok;
  });
  pending.set(key, job);
  return job;
}
