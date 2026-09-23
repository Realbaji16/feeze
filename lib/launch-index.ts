/** Shared launch list. Explore reads this, not the browser that created the token. */

const APP_KEY = "eoprd8iz";
const CHUNK = 100;
const ZERO = "0".repeat(40);

export interface LaunchRow {
  token: string;
  creator: string;
  curve: string;
  pool: string;
  block: number;
  tx: string;
  name: string;
  symbol: string;
  time: number;
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
  if (!response.ok) throw new Error(`index ${response.status}`);
}

function cleanLabel(value: string, fallback: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 16) || fallback;
}

function pack(row: LaunchRow): string {
  const curve = row.curve.replace(/^0x/, "") || ZERO;
  const pool = row.pool.replace(/^0x/, "") || ZERO;
  return [
    row.token.replace(/^0x/, ""),
    row.creator.replace(/^0x/, ""),
    curve,
    pool,
    String(row.block),
    row.tx.replace(/^0x/, ""),
    cleanLabel(row.name, "Token"),
    cleanLabel(row.symbol, "TOKEN"),
    String(row.time),
  ].join("~");
}

function unpack(value: string): LaunchRow | null {
  const [token, creator, curve, pool, block, tx, name, symbol, time] = value.split("~");
  if (!token || !creator || !block || !tx) return null;
  return {
    token: `0x${token}`,
    creator: `0x${creator}`,
    curve: curve && curve !== ZERO ? `0x${curve}` : "",
    pool: pool && pool !== ZERO ? `0x${pool}` : "",
    block: Number(block),
    tx: `0x${tx}`,
    name: name || "Token",
    symbol: symbol || "TOKEN",
    time: Number(time) || 0,
  };
}

export async function loadLaunchIndex(): Promise<{ head: bigint; rows: LaunchRow[] }> {
  const head = BigInt((await getValue("feezehead")) || "0");
  const count = Number(await getValue("feezein"));
  if (!Number.isInteger(count) || count < 1 || count > 80) return { head: 0n, rows: [] };
  const parts = await Promise.all(Array.from({ length: count }, (_, index) => getValue(`feezeip${index}`)));
  if (parts.some((part) => !part)) return { head: 0n, rows: [] };
  const rows = parts.join("").split("!").map(unpack).filter((row): row is LaunchRow => row !== null);
  return { head, rows };
}

export async function saveLaunchIndex(head: bigint, rows: LaunchRow[]): Promise<void> {
  const packed = rows.map(pack).join("!");
  const count = Math.max(1, Math.ceil(packed.length / CHUNK));
  for (let index = 0; index < count; index += 1) {
    await setValue(`feezeip${index}`, packed.slice(index * CHUNK, (index + 1) * CHUNK) || "-");
  }
  await setValue("feezein", String(count));
  await setValue("feezehead", head.toString());
}
