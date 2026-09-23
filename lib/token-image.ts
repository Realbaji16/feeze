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

async function postBytes(url: string, body: Buffer, type: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": type, "user-agent": "feeze" },
    body: new Uint8Array(body),
    cache: "no-store",
  });
  return { status: response.status, text: (await response.text()).slice(0, 180) };
}

export async function probeImageStore(): Promise<Record<string, string | number>> {
  const out: Record<string, string | number> = {};
  for (const size of [40, 120, 250, 500]) {
    const value = "A".repeat(size);
    const ok = await setValue(`feezeprobea${size}`, value);
    out[`kv${size}`] = ok ? "ok" : "fail";
  }
  const colon = await setValue("feezeprobecolon", "data:image");
  out.colon = colon ? "ok" : "fail";

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const boundary = "feezeprobe";
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  try {
    const telegraph = await postBytes("https://telegra.ph/upload", multipart, `multipart/form-data; boundary=${boundary}`);
    out.telegraph = `${telegraph.status} ${telegraph.text}`;
  } catch (error) {
    out.telegraph = error instanceof Error ? error.message : "fail";
  }
  try {
    const blob = await fetch("https://jsonblob.com/api/jsonBlob", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ image: `data:image/png;base64,${"A".repeat(1500)}` }),
      cache: "no-store",
    });
    out.jsonblob = `${blob.status} ${blob.headers.get("location") ?? ""} ${(await blob.text()).slice(0, 80)}`;
  } catch (error) {
    out.jsonblob = error instanceof Error ? error.message : "fail";
  }
  return out;
}
