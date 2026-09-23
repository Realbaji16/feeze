import { IMAGE_BUCKET } from "./token-image";

/** Shrink a launch image until it can be stored for every browser. */
export function shrinkDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image")) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 96;
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
      resolve(canvas.toDataURL("image/jpeg", 0.55));
    };
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = dataUrl;
  });
}

export async function readSharedImage(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  try {
    const direct = await fetch(`https://kvdb.io/${IMAGE_BUCKET}/${key}`, { cache: "no-store" });
    if (direct.ok) {
      const image = (await direct.text()).trim();
      if (image.startsWith("data:image") || image.startsWith("https://")) return image;
    }
  } catch {
    // The browser may not be allowed to read the store directly.
  }
  try {
    const response = await fetch(`/api/image?address=${key}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { image?: string | null };
    return body.image ?? null;
  } catch {
    return null;
  }
}

const sent = new Set<string>();

export async function shareTokenImage(address: string, image: string): Promise<void> {
  const key = address.toLowerCase();
  if (sent.has(key) || !image.startsWith("data:image")) return;
  sent.add(key);
  try {
    const small = await shrinkDataUrl(image);
    if (!small.startsWith("data:image") || small.length > 15_000) {
      sent.delete(key);
      return;
    }
    const direct = await fetch(`https://kvdb.io/${IMAGE_BUCKET}/${key}?ttl=604800`, {
      method: "POST",
      cache: "no-store",
      body: small,
    }).catch(() => null);
    if (direct?.ok) return;
    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: key, image: small }),
    });
    if (!response.ok) sent.delete(key);
  } catch {
    sent.delete(key);
  }
}
