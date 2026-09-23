/** Integer twin of FeezeCurve. Display quotes use this so they match the chain. */
export const CURVE_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const CURVE_PHANTOM = 168n * 10n ** 16n;
export const CURVE_THRESHOLD = 42n * 10n ** 17n;
export const CURVE_FEE_BPS = 100n;

const K = CURVE_PHANTOM * CURVE_SUPPLY;

export function quoteCurveBuy(input: {
  quoteIn: bigint;
  realQuote: bigint;
  tokenReserve: bigint;
  creatorTaxBps: bigint;
}): { tokensOut: bigint; used: bigint; fee: bigint } {
  const maxNet = CURVE_THRESHOLD - input.realQuote;
  if (input.quoteIn <= 0n || maxNet <= 0n) return { tokensOut: 0n, used: 0n, fee: 0n };
  const bps = CURVE_FEE_BPS + input.creatorTaxBps;
  let used = input.quoteIn;
  let fee = (used * bps) / 10_000n;
  let netIn = used - fee;
  if (netIn > maxNet) {
    used = (maxNet * 10_000n) / (10_000n - bps);
    if (used > input.quoteIn) used = input.quoteIn;
    fee = (used * bps) / 10_000n;
    netIn = used - fee;
    if (netIn > maxNet) {
      netIn = maxNet;
      fee = used - netIn;
    }
  }
  const newY = K / (CURVE_PHANTOM + input.realQuote + netIn);
  const tokensOut = input.tokenReserve - newY;
  return { tokensOut, used, fee };
}

export function quoteCurveSell(input: {
  tokensIn: bigint;
  realQuote: bigint;
  tokenReserve: bigint;
  creatorTaxBps: bigint;
}): { quoteOut: bigint; fee: bigint } {
  if (input.tokensIn <= 0n) return { quoteOut: 0n, fee: 0n };
  const newY = input.tokenReserve + input.tokensIn;
  if (newY > CURVE_SUPPLY) return { quoteOut: 0n, fee: 0n };
  const newX = K / newY;
  const oldX = CURVE_PHANTOM + input.realQuote;
  if (newX >= oldX) return { quoteOut: 0n, fee: 0n };
  const grossOut = oldX - newX;
  if (grossOut > input.realQuote) return { quoteOut: 0n, fee: 0n };
  const fee = (grossOut * (CURVE_FEE_BPS + input.creatorTaxBps)) / 10_000n;
  return { quoteOut: grossOut - fee, fee };
}
