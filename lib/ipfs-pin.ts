const CID = /^[A-Za-z0-9]{20,100}$/;

function cidFrom(result: { uri?: unknown; cid?: unknown } | null): string | null {
  const raw = typeof result?.uri === "string" ? result.uri : typeof result?.cid === "string" ? result.cid : "";
  const cid = raw.replace(/^ipfs:\/\//, "").split("/")[0] ?? "";
  return CID.test(cid) ? cid : null;
}

async function postPin(url: string, field: string, bytes: Blob): Promise<string> {
  const body = new FormData();
  const name = bytes.type === "image/jpeg" ? "token.jpg" : "token.png";
  body.append(field, bytes, name);
  const response = await fetch(url, { method: "POST", body });
  const result = (await response.json().catch(() => null)) as { uri?: unknown; cid?: unknown; error?: unknown } | null;
  const cid = cidFrom(result);
  if (!response.ok || !cid) {
    const message = typeof result?.error === "string" ? result.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return cid;
}

/** Pin a launch image the same way Pons does: one public IPFS upload, then a CID every browser can load. */
export async function pinImage(bytes: Blob): Promise<string> {
  if (bytes.size < 8 || bytes.size > 5 * 1024 * 1024) throw new Error("Image must be under 5 MB");
  try {
    return await postPin("https://pons.family/api/ipfs/image", "image", bytes);
  } catch (first) {
    try {
      return await postPin("https://api.pez.family/api/ipfs/image", "file", bytes);
    } catch {
      throw first instanceof Error ? first : new Error("Could not upload that image to ipfs.");
    }
  }
}
