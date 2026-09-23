/** Shrink a launch image until it can be stored for every browser. */
export function shrinkDataUrl(dataUrl: string, maxChars = 14_000): Promise<string> {
  if (!dataUrl.startsWith("data:image") || dataUrl.length <= maxChars) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let size = 128;
      let quality = 0.62;
      let best = dataUrl;
      for (let attempt = 0; attempt < 6; attempt++) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) break;
        ctx.fillStyle = "#111311";
        ctx.fillRect(0, 0, size, size);
        const scale = Math.min(size / img.width, size / img.height);
        const width = img.width * scale;
        const height = img.height * scale;
        ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
        best = canvas.toDataURL("image/jpeg", quality);
        if (best.length <= maxChars) break;
        size = Math.max(48, Math.round(size * 0.72));
        quality = Math.max(0.36, quality - 0.08);
      }
      resolve(best);
    };
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = dataUrl;
  });
}

const sent = new Set<string>();

export async function shareTokenImage(address: string, image: string): Promise<void> {
  const key = address.toLowerCase();
  if (sent.has(key) || !image.startsWith("data:image")) return;
  sent.add(key);
  try {
    const small = await shrinkDataUrl(image);
    if (small.length > 15_000) {
      sent.delete(key);
      return;
    }
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
