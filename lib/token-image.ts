const APP_KEY = "eoprd8iz";
const CHUNK = 700;

function keyFor(address: string): string | null {
  const key = address.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(key) ? key.slice(2) : null;
}

function pack(value: string): string {
  return value.replaceAll("/", "_").replaceAll("+", "-").replaceAll("=", ".");
}

function unpack(value: string): string {
  return value.replaceAll("_", "/").replaceAll("-", "+").replaceAll(".", "=");
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

async function setValue(key: string, value: string): Promise<boolean> {
  const response = await fetch(
    `https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/${APP_KEY}/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { method: "POST", cache: "no-store" },
  );
  return response.ok;
}

export async function readTokenImage(address: string): Promise<string | null> {
  const key = keyFor(address);
  if (!key) return null;
  const count = Number(await getValue(`${key}n`));
  if (!Number.isInteger(count) || count < 1 || count > 40) return null;
  let packed = "";
  for (let index = 0; index < count; index++) {
    const part = await getValue(`${key}p${index}`);
    if (!part) return null;
    packed += part;
  }
  const image = unpack(packed);
  if (!image.startsWith("data:image") && !image.startsWith("https://")) return null;
  return image;
}

export async function putTokenImage(address: string, image: string): Promise<"saved" | "kept"> {
  const key = keyFor(address);
  if (!key) throw new Error("Image storage is not ready");
  if (!image.startsWith("data:image")) throw new Error("Expected an image");
  const existing = await readTokenImage(address);
  if (existing) return "kept";
  const packed = pack(image);
  const count = Math.ceil(packed.length / CHUNK);
  if (count < 1 || count > 40) throw new Error("Image is too large");
  for (let index = 0; index < count; index++) {
    const ok = await setValue(`${key}p${index}`, packed.slice(index * CHUNK, (index + 1) * CHUNK));
    if (!ok) throw new Error(`Could not save image part ${index}`);
  }
  let check = "";
  for (let index = 0; index < count; index++) {
    const part = await getValue(`${key}p${index}`);
    if (!part) throw new Error(`Image part ${index} missing`);
    check += part;
  }
  if (unpack(check) !== image) throw new Error("Saved image did not match");
  if (!(await setValue(`${key}n`, String(count)))) throw new Error("Could not save image");
  return "saved";
}

export async function probeImageStore(): Promise<{ match: boolean; len: number; error?: string }> {
  const address = `0x${"11".repeat(20)}`;
  const image = `data:image/jpeg;base64,${"A".repeat(2500)}`;
  try {
    await putTokenImage(address, image);
    const back = await readTokenImage(address);
    return { match: back === image, len: back?.length ?? 0 };
  } catch (error) {
    return { match: false, len: 0, error: error instanceof Error ? error.message : "probe failed" };
  }
}
