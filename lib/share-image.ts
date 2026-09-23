import { cidFromImage, ipfsImagePath } from "./ipfs-path";

export async function readSharedImage(address: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/image?address=${address.toLowerCase()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { image?: string | null };
    const image = body.image ?? "";
    if (image.startsWith("data:image") || image.startsWith("/api/ipfs/") || cidFromImage(image)) return image;
    return null;
  } catch {
    return null;
  }
}

export function imageToPngBlob(file: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 512;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that image."));
        return;
      }
      ctx.fillStyle = "#111311";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not read that image."))), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

export async function uploadImageBlob(file: Blob): Promise<{ cid: string; image: string }> {
  const png = file.type === "image/png" && file.size <= 5 * 1024 * 1024 ? file : await imageToPngBlob(file);
  const body = new FormData();
  body.append("image", png, "token.png");
  const response = await fetch("/api/ipfs", { method: "POST", body });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; cid?: string; image?: string; error?: string } | null;
  if (!response.ok || !payload?.cid) throw new Error(payload?.error || "Could not upload that image to ipfs.");
  return { cid: payload.cid, image: payload.image || ipfsImagePath(payload.cid) };
}

export async function bindTokenImage(address: string, cid: string): Promise<boolean> {
  const response = await fetch("/api/image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: address.toLowerCase(), cid }),
  });
  if (!response.ok) return false;
  const payload = (await response.json()) as { ok?: boolean };
  return payload.ok === true;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

const pending = new Map<string, Promise<boolean>>();

async function uploadShared(key: string, image: string): Promise<boolean> {
  const existing = await readSharedImage(key);
  if (existing) return true;
  const known = cidFromImage(image);
  if (known) return bindTokenImage(key, known);
  if (!image.startsWith("data:image")) return false;
  const uploaded = await uploadImageBlob(await dataUrlToBlob(image));
  return bindTokenImage(key, uploaded.cid);
}

export function shareTokenImage(address: string, image: string): Promise<boolean> {
  const key = address.toLowerCase();
  if (!image.startsWith("data:image") && !cidFromImage(image)) return Promise.resolve(false);
  const current = pending.get(key);
  if (current) return current;
  const job = uploadShared(key, image)
    .then((ok) => {
      if (!ok) pending.delete(key);
      return ok;
    })
    .catch(() => {
      pending.delete(key);
      return false;
    });
  pending.set(key, job);
  return job;
}
