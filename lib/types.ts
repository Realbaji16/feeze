export type Phase = "curve" | "escrow" | "graduated";
export type Venue = "yeeld" | "pons";
export type LockKind = "reward" | "yeeld" | "universal";
export type BribeStatus = "pending" | "active" | "refunded";

export interface Trade {
  id: string;
  side: "buy" | "sell";
  tokenAmount: number;
  quoteGross: number;
  quoteNet: number;
  feeBase: number;
  feeTax: number;
  price: number;
  trader: string;
  time: number;
  tx: string;
  venue: "curve" | "v4";
}

export interface Market {
  address: string;
  creator: string;
  name: string;
  symbol: string;
  description: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  pair: string;
  creatorTaxBps: number;
  taxToLockers: boolean;
  venue: Venue;
  isProtocol: boolean;
  launchedAt: number;
  tx: string;
  phase: Phase;
  realTokens: number;
  realQuote: number;
  virtualOffset: number;
  lpTokens: number;
  escrowTokens: number;
  escrowQuote: number;
  poolTokens: number;
  poolQuote: number;
  graduatedAt: number | null;
  lockerCapital: number;
  creatorReserve: number;
  orphanPot: number;
  orphanSince: number | null;
  /** Reward-per-effective-token, keyed by reward asset. */
  indexes: Record<string, number>;
  totalEffective: number;
  trades: Trade[];
  lastTradeAt: number | null;
  volumeQuote: number;
  /** Deployed on Robinhood Chain. Trades for this market are chain transactions. */
  onchain?: boolean;
  /** Uniswap v3 pool, when the curve has graduated or launch locked liquidity. */
  poolAddress?: string;
  /** Bonding curve that holds the supply until graduation. */
  curveAddress?: string;
}

export interface LockPosition {
  id: string;
  owner: string;
  token: string;
  kind: LockKind;
  amount: number;
  multiplier: number;
  effective: number;
  snapshots: Record<string, number>;
  start: number;
  expiry: number;
  withdrawn: boolean;
}

export interface Bribe {
  id: string;
  market: string;
  asset: string;
  amount: number;
  remaining: number;
  briber: string;
  status: BribeStatus;
  createdAt: number;
}

export interface BuybackSchedule {
  id: string;
  creator: string;
  target: string;
  fundingAsset: string;
  budget: number;
  protocolFee: number;
  trancheBudget: number;
  tranches: number;
  executed: number;
  intervalSec: number;
  slippageBps: number;
  nextAt: number;
  createdAt: number;
  burned: number;
  executions: BuybackExecution[];
}

export interface BuybackExecution {
  id: string;
  scheduleId: string;
  caller: string;
  spent: number;
  burned: number;
  time: number;
  tx: string;
}

export interface RevenueEvent {
  id: string;
  kind: "fee" | "orphan" | "burn" | "buyback-fee";
  asset: string;
  amount: number;
  burn: number;
  lockers: number;
  operations: number;
  time: number;
  tx: string;
  note: string;
}

export interface Activity {
  id: string;
  time: number;
  text: string;
  href?: string;
}

export interface ProtocolState {
  now: number;
  wallet: string | null;
  balances: Record<string, Record<string, number>>;
  markets: Market[];
  locks: LockPosition[];
  bribes: Bribe[];
  buybacks: BuybackSchedule[];
  /** Protocol reserves still waiting on a permissionless conversion. */
  burnReserve: Record<string, number>;
  yeeldLockerReserve: Record<string, number>;
  operations: Record<string, number>;
  yeeldIndexes: Record<string, number>;
  yeeldEffective: number;
  burnedYeeld: number;
  revenueEvents: RevenueEvent[];
  activity: Activity[];
  failNextGraduation: boolean;
  nonce: number;
}

export interface ActionOk<T> {
  ok: true;
  state: ProtocolState;
  value: T;
}

export interface ActionErr {
  ok: false;
  error: string;
}

export type ActionResult<T = undefined> = ActionOk<T> | ActionErr;
