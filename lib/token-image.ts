const APP_KEY = "eoprd8iz";
const CHUNK = 100;
const MAX_BYTES = 400;

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

function parseDataUrl(image: string): { mime: "png" | "jpg"; hex: string } | null {
  const match = image.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replaceAll(/\s/g, ""), "base64");
  if (bytes.length < 8 || bytes.length > MAX_BYTES) return null;
  return { mime: match[1] === "png" ? "png" : "jpg", hex: bytes.toString("hex") };
}

async function eachChunk(count: number, run: (index: number) => Promise<void>): Promise<void> {
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

export async function readTokenImage(address: string): Promise<string | null> {
  const key = keyFor(address);
  if (!key) return null;
  const count = Number(await getValue(`${key}n`));
  if (!Number.isInteger(count) || count < 1 || count > 40) return null;
  const mime = await getValue(`${key}m`);
  if (mime !== "png" && mime !== "jpg") return null;
  const parts = new Array<string>(count);
  await eachChunk(count, async (index) => {
    const part = await getValue(`${key}h${index}`);
    parts[index] = part ?? "";
  });
  const hex = parts.join("");
  if (parts.some((part) => !part) || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const encoded = Buffer.from(hex, "hex").toString("base64");
  return `data:image/${mime === "png" ? "png" : "jpeg"};base64,${encoded}`;
}

export async function putTokenImage(address: string, image: string): Promise<"saved" | "kept"> {
  const key = keyFor(address);
  if (!key) throw new Error("Image storage is not ready");
  const existing = await readTokenImage(address);
  if (existing) return "kept";
  const parsed = parseDataUrl(image);
  if (!parsed) throw new Error(image.startsWith("data:image") ? "Image is too large" : "Expected an image");
  const count = Math.ceil(parsed.hex.length / CHUNK);
  await eachChunk(count, async (index) => {
    await setValue(`${key}h${index}`, parsed.hex.slice(index * CHUNK, (index + 1) * CHUNK));
  });
  const back = new Array<string>(count);
  await eachChunk(count, async (index) => {
    back[index] = (await getValue(`${key}h${index}`)) ?? "";
  });
  if (back.join("") !== parsed.hex) throw new Error("Saved image did not match");
  await setValue(`${key}m`, parsed.mime);
  await setValue(`${key}n`, String(count));
  return "saved";
}

export async function probeImageStore(): Promise<{ match: boolean; len: number; result?: string; error?: string }> {
  const address = `0x${"11".repeat(20)}`;
  const bytes = Buffer.alloc(400, 7);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  const image = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  try {
    const result = await putTokenImage(address, image);
    const back = await readTokenImage(address);
    return { result, match: back === image, len: back?.length ?? 0 };
  } catch (error) {
    return { match: false, len: 0, error: error instanceof Error ? error.message : "probe failed" };
  }
}
