export interface DocPage {
  slug: string;
  title: string;
  kicker: string;
  summary: string;
  sections: { heading: string; body: string[] }[];
}

export const DOCS: DocPage[] = [
  {
    slug: "",
    title: "Welcome to Feeze",
    kicker: "Start here",
    summary:
      "A lock-first token launchpad. Communities launch against real assets, graduate to Uniswap v4, and turn trading fees into rewards for people who lock.",
    sections: [
      {
        heading: "What Feeze does",
        body: [
          "Every launch is a fixed-supply token on Robinhood Chain (chain ID 4663). It starts on a dedicated bonding curve paired with an allowlisted stock token, WETH, or USDG. When tracked quote reaches that pair’s threshold, liquidity migrates into a permanently locked Uniswap v4 position.",
          "Holding the token is not enough to earn. A holder creates a time lock. Longer locks receive more effective weight, snapshotted when the position is opened.",
        ],
      },
      {
        heading: "The model",
        body: [
          "Creation is deterministic and there is no owner mint. The curve phase is public, then v4 liquidity is permanent. A 1% base fee on the quote leg splits 60% to launch lockers, 30% to protocol revenue, and 10% to the creator reserve. An optional creator tax of 0–10% stacks on top and is routed, immutably, to the creator or to lockers.",
          "Protocol revenue itself splits 70% to a FEEZE buy-and-burn, 20% to stock dividends for FEEZE lockers, and 10% to operations. Outside projects can also fund permissionless buyback-and-burn schedules.",
        ],
      },
      {
        heading: "This build",
        body: [
          "The app in this repository runs those rules locally in the browser so launches, trades, locks, bribes, graduation, and burns can be exercised without a wallet extension. The reference contract directory in these docs lists the public mainnet deployment. Signing a transaction on that deployment is a separate, irreversible step — this simulator never receives a private key.",
        ],
      },
    ],
  },
  {
    slug: "quick-start",
    title: "Quick start",
    kicker: "Start here",
    summary: "Connect, find a market, trade, lock, and claim.",
    sections: [
      {
        heading: "Connect",
        body: [
          "Choose Connect. Privy opens email, social, or an external wallet login and returns an address on Robinhood Chain (4663). The first time an address appears, the simulator credits local quote balances so you can launch and trade in this browser. Those balances are not mainnet funds, and this app never asks Privy for a private key.",
        ],
      },
      {
        heading: "Trade",
        body: [
          "Open Markets and search by name, ticker, or address. Check phase, pair, market cap, fee split, and curve progress. Buy spends the paired asset. Sell spends the launch token. Curve quotes are constant-product. After graduation, the same ticket routes through the locked v4 pool.",
        ],
      },
      {
        heading: "Lock and claim",
        body: [
          "Open Lock, choose Earn rewards, and pick a launch you hold. Durations run from 12 hours to 365 days. The multiplier is snapshotted. Rewards and matured principal are claimed from Rewards or the lock list. Early exit is impossible.",
        ],
      },
    ],
  },
  {
    slug: "launching",
    title: "Launch a token",
    kicker: "Use Feeze",
    summary: "Configure an immutable market, preview its address, and optionally buy in the same action.",
    sections: [
      {
        heading: "What you set",
        body: [
          "Name, ticker, image, and links. An allowlisted quote asset. A reward asset, which in this build is the quote asset itself. Creator tax from 0% to 10%, and a permanent destination: creator earnings or extra locker rewards. An optional initial buy in the paired asset, not always ETH.",
          "The pair, tax, destination, and supply cannot be changed after launch. Supply is 1,000,000,000. There is no mint function for the creator.",
        ],
      },
      {
        heading: "Curve shape",
        body: [
          "Each pair carries phantom quote liquidity and a graduation threshold of ten times that phantom. The curve is constant-product. 11/12 of supply is sold on the curve and the rest seeds the locked v4 position so the graduation price matches the final curve price.",
          "The initial buy is atomic with creation. If it cannot satisfy the minimum output, the whole launch reverts.",
        ],
      },
    ],
  },
  {
    slug: "trading",
    title: "Trading",
    kicker: "Use Feeze",
    summary: "Curve quotes before graduation, v4 after, with the same fee economics on the quote leg.",
    sections: [
      {
        heading: "Curve",
        body: [
          "Buys take a gross amount of the paired asset. Sells take an exact token amount. Fees come out of the quote leg: 1% base plus the creator tax. The final curve buy can partially fill and refund unused quote, then hand the market to graduation. A minimum-received check protects every trade. Transferring tokens directly to the curve does not move its tracked reserves.",
        ],
      },
      {
        heading: "After graduation",
        body: [
          "The market switches to its Uniswap v4 pool. The hook keeps the same quote-leg fee split. Set a real minimum received. A zero minimum is not a safe signature on mainnet.",
        ],
      },
    ],
  },
  {
    slug: "graduation",
    title: "Graduation and migration",
    kicker: "Use Feeze",
    summary: "A completed curve becomes permanently locked v4 liquidity. A failed seed does not unwind the trade.",
    sections: [
      {
        heading: "Two phases",
        body: [
          "When tracked quote reaches the pair threshold, phase one moves reserves into factory escrow. Phase two initializes the v4 pool and locks the position. If the external v4 call fails, the completing trade still stands and anyone can retry graduation.",
          "The position and leftover token dust are held by the liquidity locker, which has no withdrawal path. The creator cannot pull liquidity or edit launch settings. Graduated markets are marked in gold.",
        ],
      },
    ],
  },
  {
    slug: "locking",
    title: "Locking",
    kicker: "Use Feeze",
    summary: "Reward locks and universal time locks are different products.",
    sections: [
      {
        heading: "Reward-bearing locks",
        body: [
          "The reward vault accepts registered launch tokens and FEEZE. Positions last from 12 hours to 365 days and cannot exit early. A continuous x^(5/8) curve maps that window to a 1×–6× multiplier. Effective weight is amount times multiplier, snapshotted at creation. Rewards use cumulative reward-per-effective-token accounting, so a new position never inherits distributions that happened before it existed.",
          "Lock FEEZE on the FEEZE tab to earn stock dividends from the protocol’s 20% share. Lock a launch token to earn that market’s pair asset.",
        ],
      },
      {
        heading: "Universal locks",
        body: [
          "Any ERC-20 can be locked from 12 hours to 10 years. That creates a public time-lock record and does not pay Feeze rewards. After expiry the owner withdraws principal, or the daily unlocker returns it. A third party cannot redirect someone else’s tokens. Accrued rewards stay claimable after principal is withdrawn.",
        ],
      },
    ],
  },
  {
    slug: "rewards",
    title: "Rewards and bribes",
    kicker: "Use Feeze",
    summary: "Fees and external deposits accrue to effective lock weight. Empty vaults do not leak value to future lockers.",
    sections: [
      {
        heading: "Claims",
        body: [
          "The Rewards page groups positions, claimable assets, and history. Claims are user-initiated and pay the chosen recipient. Live earnings come from the vault index. History is only a record of completed claims.",
        ],
      },
      {
        heading: "Bribes and orphans",
        body: [
          "A bribe is a deposit of the launch’s reward asset. It starts pending. Once effective lockers exist, only the original briber can activate it. If nobody locks through the grace period, that briber can refund.",
          "Fee rewards that arrive with no effective lockers enter an orphan pot. Future lockers do not inherit it. After the grace period anyone can sweep the pot into protocol revenue.",
        ],
      },
    ],
  },
  {
    slug: "buyback",
    title: "Buyback and burn",
    kicker: "Use Feeze",
    summary: "A public schedule buys a target token in tranches and sends it to the dead address.",
    sections: [
      {
        heading: "Schedule",
        body: [
          "Pick a target and a funding asset the adapter can swap. Set a budget, 1–365 tranches, an interval from 5 minutes to 30 days, and a slippage bound. A 0.3% inbound fee is protocol revenue. The rest funds the tranches. A funded schedule cannot be cancelled.",
          "When a tranche is due, anyone can execute it. The swap must clear the onchain minimum. Output is transferred to the dead address.",
        ],
      },
    ],
  },
  {
    slug: "fees",
    title: "Fees and the FEEZE flywheel",
    kicker: "Protocol",
    summary: "Every fee unit is assigned to exactly one liability.",
    sections: [
      {
        heading: "Trade fee",
        body: [
          "Curve and graduated trades charge a fixed 1% base fee on the quote leg. 60% becomes launch-locker reward capital, 30% becomes protocol revenue, and 10% becomes creator reserve. Optional creator tax is additive: it never reduces the 1% split. Its destination is chosen at launch and stays fixed.",
        ],
      },
      {
        heading: "Protocol split",
        body: [
          "Of protocol revenue, 70% is converted to FEEZE and sent to the dead address, 20% pays FEEZE lockers in the stock or quote assets that were collected, and 10% is the operations reserve. Conversions are permissionless. Until they run, assets sit in dedicated reserves. Rounding dust stays in the last branch so the parts sum to the amount received.",
        ],
      },
    ],
  },
  {
    slug: "architecture",
    title: "Architecture",
    kicker: "Protocol",
    summary: "A non-custodial core, with an indexer and workers around it on mainnet.",
    sections: [
      {
        heading: "Mainnet stack",
        body: [
          "Wallets sign through Privy or wagmi. viem reads Robinhood Chain. A Fastify API serves indexed lists. Ponder writes events to PostgreSQL. A websocket tells the app to refresh. A worker retries permissionless maintenance. None of those services custody funds. If they stop, curve and v4 trading still exist on the contracts.",
          "Creators cannot mint, upgrade, remove liquidity, or rewrite economics. Governance controls allowlists, adapters, thresholds, treasury settings, and whether future launches are paused. Approved swap adapters are privileged and have to be reviewed.",
        ],
      },
      {
        heading: "This simulator",
        body: [
          "The same state machine runs in the browser and persists in local storage. The clock can be advanced so locks, grace periods, and tranches can be tested without waiting. Failing the next v4 seed leaves the market in escrow, which is the retry path described above.",
        ],
      },
    ],
  },
  {
    slug: "contracts",
    title: "Contracts and addresses",
    kicker: "Reference",
    summary: "Public frontend deployment directory. Verify on the explorer before sending mainnet funds.",
    sections: [
      {
        heading: "Directory",
        body: [
          "Launch Factory 0xc9dd8344a270d6893aceb783106ce59bf64683cb",
          "Feeze v4 Hook 0x3ac60e33fbb7071ff1d428b878d59c21c94b30cc",
          "Liquidity Locker 0x22c0bd67d61baa2584599e6025b7d9d05046ba8e",
          "Fee Router 0x62b06f1b1b27a11e10dc90e31c85b3c94d5e395a",
          "Reward Token Vault 0x0a9727d8d047d77b0461d5f9d2158145c3065b66",
          "Universal Token Locker 0x9de6457899b7ca1d9985fe79a0da89daa4ee0a7a",
          "Basket Executor 0xf1298e78f78f3649ba2e5501dec019b5cba42c22",
          "Buyback Vault 0xb70a5e8a216ee7ceb35f7a20d49e0f0474d2b423",
          "Pair Registry 0xf296f8e670727da9a8cfba74ab7344842d60614d",
          "Uniswap v4 Pool Manager 0x8366a39cc670b4001a1121b8f6a443a643e40951",
          "Uniswap v4 Position Manager 0x58daec3116aae6d93017baaea7749052e8a04fa7",
          "Permit2 0x000000000022d473030f116ddee9f6b43ac78ba3",
          "Feeze Swap Router 0x3663cd640be1d759f94956c86931eb12e55e83e7",
          "Operations Treasury 0x4deafeaaf09a7887f9a6f17d51445b8beb0d7e2c",
          "Burn sink 0xf00a049719b4095f56e8d0ad86af7bed3c60efcf",
        ],
      },
      {
        heading: "Roles",
        body: [
          "The factory deploys tokens and curves and coordinates two-phase graduation. The hook applies v4 fees. The locker holds positions forever. The fee router accounts for reward, creator, burn, locker, and operations liabilities. The token vault handles reward locks, claims, bribes, and orphans. The universal locker is reward-free. The basket and TWAP executors convert reserves. The pair registry stores allowlists, oracle bounds, phantom liquidity, and thresholds.",
        ],
      },
    ],
  },
  {
    slug: "api",
    title: "API and realtime data",
    kicker: "Reference",
    summary: "Indexed reads for discovery. Contract calls for anything you might sign.",
    sections: [
      {
        heading: "REST",
        body: [
          "Lists take limit (1–100) and an opaque cursor. Stop when nextCursor is null.",
          "Core routes include /v1/tokens, /v1/tokens/:token, curve trades, trades, candles, locks, reward claims, bribes, /v1/accounts/:account/locks, /v1/buybacks, /v1/protocol/revenue, /v1/protocol/feeze-burns, /v1/pairs, and /v1/baskets. Sort tokens by recent, market_cap, or last_trade. Filter by pair, graduation, and venue.",
        ],
      },
      {
        heading: "Stream",
        body: [
          "Connect to /v1/stream for trade, accrual, and burn notifications. Treat them as cache invalidations, not as a full state snapshot. Balances, quotes, allowances, and claimable rewards should be read from the chain.",
        ],
      },
    ],
  },
  {
    slug: "safety",
    title: "Safety and risk",
    kicker: "Reference",
    summary: "Prices move, locks do not open early, and schedules do not cancel.",
    sections: [
      {
        heading: "Before you sign on mainnet",
        body: [
          "Confirm chain ID 4663. Compare token and protocol addresses with the explorer and the directory above. Read the pair, phase, fee split, creator tax, and tax destination. Set a minimum received. Read the lock expiry or the buyback interval before funding.",
          "Liquidity can be thin. Oracles, adapters, Uniswap v4, and the chain add technical risk. Fiat figures in the interface depend on indicative prices and can lag. These pages describe intended behavior. They are not an audit or a promise of profit.",
        ],
      },
    ],
  },
];

export function getDoc(slug: string): DocPage | undefined {
  return DOCS.find((page) => page.slug === slug);
}
