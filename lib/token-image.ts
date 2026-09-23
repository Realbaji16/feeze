export const IMAGE_BUCKET = "PQ15J63mEi4dPkGu5hqvzA";

const TTL = "604800";

function keyFor(address: string): string | null {
  const key = address.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(key) ? key : null;
}

export async function readTokenImage(address: string): Promise<string | null> {
  const key = keyFor(address);
  if (!key) return null;
  const response = await fetch(`https://kvdb.io/${IMAGE_BUCKET}/${key}`, { cache: "no-store" });
  if (!response.ok) return null;
  const image = (await response.text()).trim();
  if (!image.startsWith("data:image") && !image.startsWith("https://")) return null;
  void fetch(`https://kvdb.io/${IMAGE_BUCKET}/${key}?ttl=${TTL}`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "text/plain" },
    body: image,
  }).catch(() => undefined);
  return image;
}

export async function putTokenImage(address: string, image: string): Promise<"saved" | "kept"> {
  const key = keyFor(address);
  if (!key) throw new Error("Image storage is not ready");
  if (!image.startsWith("data:image") || image.length > 15_000) throw new Error("Image is too large");
  const current = await readTokenImage(key);
  if (current) return "kept";
  const saved = await fetch(`https://kvdb.io/${IMAGE_BUCKET}/${key}?ttl=${TTL}`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "text/plain" },
    body: image,
  });
  if (!saved.ok) throw new Error(`Could not save image (${saved.status})`);
  return "saved";
}
