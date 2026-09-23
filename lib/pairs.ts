export interface Pair {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Virtual quote liquidity on a fresh curve. */
  phantom: number;
  /** Real quote that completes the curve. Always 10× phantom on the live registry. */
  threshold: number;
  /** Indicative USD price for display only. */
  usd: number;
}

/** Allowlisted quote assets. Phantom and threshold match the public pair registry. */
export const PAIRS: Pair[] = [
  {
    address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    phantom: 0.42,
    threshold: 4.2,
    usd: 2748,
  },
  {
    address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
    phantom: 1143.774005,
    threshold: 11437.740055,
    usd: 1,
  },
  {
    address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    symbol: "AAPL",
    name: "Apple",
    decimals: 18,
    phantom: 3.408830165310660214,
    threshold: 34.08830165310660214,
    usd: 228,
  },
  {
    address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
    symbol: "NVDA",
    name: "NVIDIA",
    decimals: 18,
    phantom: 5.108178384513343117,
    threshold: 51.08178384513343117,
    usd: 118,
  },
  {
    address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d",
    symbol: "TSLA",
    name: "Tesla",
    decimals: 18,
    phantom: 3.100682354215384615,
    threshold: 31.00682354215384615,
    usd: 248,
  },
  {
    address: "0xe93237c50d904957cf27e7b1133b510c669c2e74",
    symbol: "MSFT",
    name: "Microsoft",
    decimals: 18,
    phantom: 2.309377714075351491,
    threshold: 23.09377714075351491,
    usd: 415,
  },
  {
    address: "0x12f190a9f9d7d37a250758b26824b97ce941bf54",
    symbol: "AMZN",
    name: "Amazon",
    decimals: 18,
    phantom: 4.485877567600894222,
    threshold: 44.85877567600894222,
    usd: 198,
  },
  {
    address: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3",
    symbol: "GOOGL",
    name: "Alphabet Class A",
    decimals: 18,
    phantom: 3.259720197899462321,
    threshold: 32.59720197899462321,
    usd: 172,
  },
  {
    address: "0xc0d6457c16cc70d6790dd43521c899c87ce02f35",
    symbol: "META",
    name: "Meta Platforms",
    decimals: 18,
    phantom: 1.683699479613604272,
    threshold: 16.83699479613604272,
    usd: 590,
  },
  {
    address: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    symbol: "SPY",
    name: "S&P 500 ETF",
    decimals: 18,
    phantom: 1.494545140741164934,
    threshold: 14.94545140741164934,
    usd: 560,
  },
  {
    address: "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68",
    symbol: "QQQ",
    name: "Invesco QQQ",
    decimals: 18,
    phantom: 1.573352321188511059,
    threshold: 15.73352321188511059,
    usd: 490,
  },
  {
    address: "0x6330d8c3178a418788df01a47479c0ce7ccf450b",
    symbol: "COIN",
    name: "Coinbase",
    decimals: 18,
    phantom: 5.612877945828487302,
    threshold: 56.12877945828487302,
    usd: 210,
  },
  {
    address: "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a",
    symbol: "PLTR",
    name: "Palantir",
    decimals: 18,
    phantom: 6.371487527699680635,
    threshold: 63.71487527699680635,
    usd: 78,
  },
  {
    address: "0x1b0e319c6a659f002271b69db8a7df2f911c153e",
    symbol: "GME",
    name: "GameStop",
    decimals: 18,
    phantom: 50.132005119918650189,
    threshold: 501.320051199186501892,
    usd: 24,
  },
];

export const ETH_PAIR = PAIRS[0];

export function getPair(address: string): Pair | undefined {
  const key = address.toLowerCase();
  return PAIRS.find((pair) => pair.address === key);
}

export function getPairBySymbol(symbol: string): Pair | undefined {
  return PAIRS.find((pair) => pair.symbol === symbol);
}
