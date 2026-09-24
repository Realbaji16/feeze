import { parseAbi, type Address } from "viem";

/** Pons v2 on Robinhood Chain. Public, permissionless launch contracts. */
export const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address;
export const PONS_LAUNCH_AND_BUY = "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948" as Address;
export const PONS_NATIVE = "0x0000000000000000000000000000000000000000" as Address;
export const PONS_CONFIG_ID = 0n;

export const PONS_FACTORY_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function canLaunch(address account) view returns (bool)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
]);

export const PONS_ROUTER_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "function launchAndBuy(TokenParams params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)",
]);

export const PONS_CURVE_ABI = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function tokenReserve() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
  "function readyToGraduate() view returns (bool)",
  "function graduated() view returns (bool)",
  "function graduationThreshold() view returns (uint256)",
  "function isNativeQuote() view returns (bool)",
  "function pairToken() view returns (address)",
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
]);

const BPS = 10_000n;

function amountOut(inAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (inAmount * reserveOut) / (reserveIn + inAmount);
}

function amountIn(outAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (outAmount * reserveIn) / (reserveOut - outAmount) + 1n;
}

/** Pons curve buy, in the curve's own integer order. */
export function quotePonsBuy(input: {
  quoteIn: bigint;
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellable: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  snipeBps: bigint;
}): { tokensOut: bigint; spent: bigint } {
  let snipeBps = input.snipeBps;
  if (snipeBps > 0n) {
    const cap = BPS - input.feeBps - input.creatorTaxBps - 100n;
    if (snipeBps > cap) snipeBps = cap;
  }
  let spent = input.quoteIn;
  const cut = (spent * input.feeBps) / BPS + (spent * input.creatorTaxBps) / BPS + (spent * snipeBps) / BPS;
  let tokensOut = amountOut(spent - cut, input.quoteReserve, input.tokenReserve);
  if (tokensOut > input.sellable) {
    tokensOut = input.sellable;
    const net = amountIn(input.sellable, input.quoteReserve, input.tokenReserve);
    const denominator = BPS - input.feeBps - input.creatorTaxBps - snipeBps;
    const grossed = (net * BPS + denominator - 1n) / denominator;
    spent = grossed < input.quoteIn ? grossed : input.quoteIn;
  }
  return { tokensOut, spent };
}

/** Pons curve sell. Fees come off the output, and there is no snipe tax. */
export function quotePonsSell(input: {
  tokensIn: bigint;
  quoteReserve: bigint;
  tokenReserve: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
}): bigint {
  const gross = amountOut(input.tokensIn, input.tokenReserve, input.quoteReserve);
  return gross - (gross * input.feeBps) / BPS - (gross * input.creatorTaxBps) / BPS;
}
