import {
  BaseError,
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { CANONICAL_LAUNCHER } from "./chain-markets";
import { robinhood } from "./chain";
import { FEEZE_LAUNCHER_ABI, FEEZE_LAUNCHER_BYTECODE } from "./feeze-launcher";

export const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const SWAP_ROUTER = getAddress("0xCaf681a66D020601342297493863E78C959E5cb2");
// SwapRouter02 treats address(2) as itself, so the WETH can be unwrapped in the same call.
const ROUTER_SELF = "0x0000000000000000000000000000000000000002" as Address;
const QUOTER = getAddress("0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7");
const POOL_FEE = 10000;

const routerAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "unwrapWETH9",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data", type: "bytes[]" },
    ],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  providers?: Eip1193[];
};

export function explainTx(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return "Transaction failed";
}

export function isWethPair(pair: string): boolean {
  return pair.toLowerCase() === WETH.toLowerCase();
}

export function tokenExplorer(address: string): string {
  return `https://robinhoodchain.blockscout.com/token/${address}`;
}

export function txExplorer(hash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

export function dexScreener(pool: string): string {
  return `https://dexscreener.com/robinhood/${pool}`;
}

let activeProvider: Eip1193 | null = null;

export function setChainProvider(provider: Eip1193 | null) {
  activeProvider = provider;
}

function injected(): Eip1193 {
  if (activeProvider) return activeProvider;
  const ethereum = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!ethereum) throw new Error("Connect a wallet first.");
  const list = ethereum.providers?.length ? ethereum.providers : [ethereum];
  return list[0];
}

function publicClient() {
  return createPublicClient({ chain: robinhood, transport: http(robinhood.rpcUrls.default.http[0]) });
}

async function ensureRobinhood(provider: Eip1193) {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === "0x1237") return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x1237",
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
          blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
        },
      ],
    });
  }
}

async function signer() {
  const provider = injected();
  await ensureRobinhood(provider);
  const wallet = createWalletClient({ chain: robinhood, transport: custom(provider) });
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("The wallet did not return an account.");
  return { wallet, account, client: publicClient() };
}

async function send(
  run: () => Promise<Hex>,
  client: ReturnType<typeof publicClient>,
) {
  const hash = await run();
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("Transaction reverted.");
  return receipt;
}

const LAUNCHER_KEY = "feeze.launcher.v3";

function launchedFrom(receipt: TransactionReceipt): { token: Address; pool: Address | null } {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: FEEZE_LAUNCHER_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Launched") continue;
      const pool = decoded.args.pool;
      return { token: decoded.args.token, pool: pool === zeroAddress ? null : pool };
    } catch {
      // The receipt also contains the token and Uniswap logs.
    }
  }
  throw new Error("The launch transaction did not return a token address.");
}

async function ensureLauncher(
  wallet: Awaited<ReturnType<typeof signer>>["wallet"],
  account: Address,
  client: ReturnType<typeof publicClient>,
  onStatus: (message: string) => void,
): Promise<Address> {
  const shared = getAddress(CANONICAL_LAUNCHER);
  const sharedCode = await client.getBytecode({ address: shared });
  if (sharedCode && sharedCode !== "0x") {
    localStorage.setItem(LAUNCHER_KEY, shared);
    return shared;
  }
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(LAUNCHER_KEY);
  if (saved && isAddress(saved)) {
    const code = await client.getBytecode({ address: saved });
    if (code && code !== "0x") return saved;
  }
  onStatus("First launch installs the launcher. Confirm this once, then the token.");
  const deployed = await send(
    () =>
      wallet.deployContract({
        abi: FEEZE_LAUNCHER_ABI,
        bytecode: FEEZE_LAUNCHER_BYTECODE,
        account,
        chain: robinhood,
        args: [],
      }),
    client,
  );
  const launcher = deployed.contractAddress;
  if (!launcher) throw new Error("The launcher deploy did not return a contract address.");
  localStorage.setItem(LAUNCHER_KEY, launcher);
  return launcher;
}

export async function deployRobinhoodToken(input: {
  name: string;
  symbol: string;
  liquidityEth: string;
  onStatus: (message: string) => void;
}): Promise<{ token: Address; tx: Hex; pool: Address | null }> {
  const { wallet, account, client } = await signer();
  const liquidity = input.liquidityEth.trim() ? parseEther(input.liquidityEth.trim()) : 0n;
  const launcher = await ensureLauncher(wallet, account, client, input.onStatus);
  input.onStatus(
    liquidity > 0n
      ? "Confirm the launch. This deploys the token and locks the Uniswap pool."
      : "Confirm the launch. This deploys the token.",
  );
  const launched = await send(
    () =>
      wallet.writeContract({
        address: launcher,
        abi: FEEZE_LAUNCHER_ABI,
        functionName: "launch",
        args: [input.name, input.symbol],
        value: liquidity,
        account,
        chain: robinhood,
      }),
    client,
  );
  const result = launchedFrom(launched);
  return { token: result.token, tx: launched.transactionHash, pool: result.pool };
}

export async function readHoldings(account: Address, token: Address) {
  const client = publicClient();
  const [eth, raw] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
  ]);
  return { eth: Number(formatEther(eth)), token: Number(formatEther(raw)) };
}

export async function quoteSwap(input: { token: Address; side: "buy" | "sell"; amount: string }) {
  const amountIn = parseEther(input.amount);
  const tokenIn = input.side === "buy" ? WETH : input.token;
  const tokenOut = input.side === "buy" ? input.token : WETH;
  const client = publicClient();
  const { result } = await client.simulateContract({
    address: QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: POOL_FEE, sqrtPriceLimitX96: 0n }],
  });
  return result[0];
}

export async function swapOnRobinhood(input: {
  token: Address;
  side: "buy" | "sell";
  amount: string;
  slippageBps: number;
  onStatus: (message: string) => void;
}) {
  const { wallet, account, client } = await signer();
  const amountIn = parseEther(input.amount);
  const quoted = await quoteSwap({ token: input.token, side: input.side, amount: input.amount });
  const amountOutMinimum = (quoted * BigInt(10_000 - input.slippageBps)) / 10_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  if (input.side === "buy") {
    input.onStatus("Confirm the buy.");
    const bought = await send(
      () =>
        wallet.writeContract({
          address: SWAP_ROUTER,
          abi: routerAbi,
          functionName: "multicall",
          args: [
            deadline,
            [
              encodeFunctionData({
                abi: routerAbi,
                functionName: "exactInputSingle",
                args: [
                  {
                    tokenIn: WETH,
                    tokenOut: input.token,
                    fee: POOL_FEE,
                    recipient: account,
                    amountIn,
                    amountOutMinimum,
                    sqrtPriceLimitX96: 0n,
                  },
                ],
              }),
            ],
          ],
          value: amountIn,
          account,
          chain: robinhood,
        }),
      client,
    );
    return bought.transactionHash;
  }
  const allowance = await client.readContract({
    address: input.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, SWAP_ROUTER],
  });
  if (allowance < amountIn) {
    input.onStatus("Confirm the token approval.");
    await send(
      () =>
        wallet.writeContract({
          address: input.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [SWAP_ROUTER, amountIn],
          account,
          chain: robinhood,
        }),
      client,
    );
  }
  input.onStatus("Confirm the sell.");
  const sold = await send(
    () =>
      wallet.writeContract({
        address: SWAP_ROUTER,
        abi: routerAbi,
        functionName: "multicall",
        args: [
          deadline,
          [
            encodeFunctionData({
              abi: routerAbi,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn: input.token,
                  tokenOut: WETH,
                  fee: POOL_FEE,
                  recipient: ROUTER_SELF,
                  amountIn,
                  amountOutMinimum,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
            encodeFunctionData({
              abi: routerAbi,
              functionName: "unwrapWETH9",
              args: [amountOutMinimum, account],
            }),
          ],
        ],
        account,
        chain: robinhood,
      }),
    client,
  );
  return sold.transactionHash;
}
