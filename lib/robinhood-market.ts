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
import { CANONICAL_CURVE, CANONICAL_LAUNCHER } from "./chain-markets";
import { robinhood } from "./chain";
import type { ChainTrade } from "./chain-activity";
import { quoteCurveBuy, quoteCurveSell } from "./curve-math";
import { FEEZE_CURVE_ABI } from "./feeze-curve";
import { FEEZE_LAUNCHER_ABI, FEEZE_LAUNCHER_BYTECODE } from "./feeze-launcher";

export const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const SWAP_ROUTER = getAddress("0xCaf681a66D020601342297493863E78C959E5cb2");
// SwapRouter02 treats address(2) as itself, so the WETH can be unwrapped in the same call.
const ROUTER_SELF = "0x0000000000000000000000000000000000000002" as Address;
const QUOTER = getAddress("0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7");
const POOL_FEE = 10000;
const FACTORY = getAddress("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA");

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
  const message = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "Transaction failed";
  if (/unexpected error/i.test(message)) {
    return "Phantom could not reach Robinhood Chain. Approve adding that network in the wallet, then launch again.";
  }
  return message;
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

const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

export async function readUniswapPool(token: Address): Promise<Address | null> {
  const pool = await publicClient().readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "getPool",
    args: [token, WETH, POOL_FEE],
  });
  return pool && pool !== zeroAddress ? pool : null;
}

let activeProvider: Eip1193 | null = null;
let providerKind = "";

export function setChainProvider(provider: Eip1193 | null, kind?: string) {
  activeProvider = provider;
  providerKind = kind ?? "";
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

const robinhoodWalletChain = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
};

function isPhantom(provider: Eip1193): boolean {
  if (provider.isPhantom || providerKind === "phantom") return true;
  const phantom = (window as unknown as { phantom?: { ethereum?: Eip1193 } }).phantom?.ethereum;
  return phantom === provider;
}

async function chainIdOf(provider: Eip1193): Promise<string> {
  return ((await provider.request({ method: "eth_chainId" })) as string).toLowerCase();
}

async function addRobinhood(provider: Eip1193) {
  await provider.request({ method: "wallet_addEthereumChain", params: [robinhoodWalletChain] });
}

async function ensureRobinhood(provider: Eip1193) {
  // Phantom simulates through its own service unless this RPC is registered. That simulation
  // returns "Unexpected error" for launch even though the contract is fine on Robinhood Chain.
  if (isPhantom(provider) || (await chainIdOf(provider)) !== "0x1237") {
    try {
      await addRobinhood(provider);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 4001 && (await chainIdOf(provider)) !== "0x1237") {
        throw new Error("Add Robinhood Chain in the wallet to launch.");
      }
    }
  }
  if ((await chainIdOf(provider)) === "0x1237") return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4001) throw new Error("Switch the wallet to Robinhood Chain to launch.");
    if (code !== 4902) throw error;
    await addRobinhood(provider);
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

async function writeRobinhood(
  wallet: Awaited<ReturnType<typeof signer>>["wallet"],
  account: Address,
  client: ReturnType<typeof publicClient>,
  parameters: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  },
): Promise<Hex> {
  const data = encodeFunctionData({
    abi: parameters.abi,
    functionName: parameters.functionName,
    args: parameters.args,
  } as never);
  const gas = await client.estimateGas({
    account,
    to: parameters.address,
    data,
    value: parameters.value,
  });
  const fees = await client.estimateFeesPerGas();
  const nonce = await client.getTransactionCount({ address: account, blockTag: "pending" });
  return wallet.sendTransaction({
    account,
    chain: robinhood,
    to: parameters.address,
    data,
    value: parameters.value,
    gas: (gas * 13n) / 10n,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    type: "eip1559",
  });
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
  if (liquidity <= 0n) throw new Error("Add ETH liquidity so Uniswap and trading bots can buy the token.");
  const launcher = await ensureLauncher(wallet, account, client, input.onStatus);
  input.onStatus("Confirm the launch. This deploys the token and locks the Uniswap pool.");
  const launched = await send(
    () =>
      writeRobinhood(wallet, account, client, {
        address: launcher,
        abi: FEEZE_LAUNCHER_ABI,
        functionName: "launch",
        args: [input.name, input.symbol],
        value: liquidity,
      }),
    client,
  );
  const result = launchedFrom(launched);
  if (!result.pool) throw new Error("The Uniswap pool did not open. Add more ETH liquidity and try again.");
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
        writeRobinhood(wallet, account, client, {
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
        writeRobinhood(wallet, account, client, {
          address: input.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [SWAP_ROUTER, amountIn],
        }),
      client,
    );
  }
  input.onStatus("Confirm the sell.");
  const sold = await send(
    () =>
      writeRobinhood(wallet, account, client, {
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
      }),
    client,
  );
  return sold.transactionHash;
}

async function ensureCurveFactory(): Promise<Address> {
  return getAddress(CANONICAL_CURVE);
}

export async function deployFeezeCurve(input: {
  name: string;
  symbol: string;
  creatorTaxBps: number;
  onStatus: (message: string) => void;
}): Promise<{ token: Address; curve: Address; tx: Hex }> {
  const { wallet, account, client } = await signer();
  const factory = await ensureCurveFactory();
  input.onStatus("Confirm the launch. It costs gas only. The supply stays on the curve.");
  const launched = await send(
    () =>
      writeRobinhood(wallet, account, client, {
        address: factory,
        abi: FEEZE_CURVE_ABI,
        functionName: "launch",
        args: [input.name, input.symbol, BigInt(input.creatorTaxBps)],
      }),
    client,
  );
  for (const log of launched.logs) {
    try {
      const decoded = decodeEventLog({ abi: FEEZE_CURVE_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Launched") continue;
      return { token: decoded.args.token, curve: decoded.args.curve, tx: launched.transactionHash };
    } catch {
      // Token and curve logs share this receipt.
    }
  }
  throw new Error("The launch transaction did not return a token address.");
}

export async function readCurveState(curve: Address): Promise<{
  realQuote: bigint;
  tokenReserve: bigint;
  pool: Address;
  graduated: boolean;
  creatorTaxBps: bigint;
  token: Address;
}> {
  const client = publicClient();
  const [realQuote, tokenReserve, pool, graduated, creatorTaxBps, token] = await Promise.all([
    client.readContract({ address: curve, abi: FEEZE_CURVE_ABI, functionName: "realQuote" }),
    client.readContract({ address: curve, abi: FEEZE_CURVE_ABI, functionName: "tokenReserve" }),
    client.readContract({ address: curve, abi: FEEZE_CURVE_ABI, functionName: "pool" }),
    client.readContract({ address: curve, abi: FEEZE_CURVE_ABI, functionName: "graduated" }),
    client.readContract({ address: curve, abi: FEEZE_CURVE_ABI, functionName: "creatorTaxBps" }),
    client.readContract({ address: curve, abi: FEEZE_CURVE_ABI, functionName: "token" }),
  ]);
  return { realQuote, tokenReserve, pool, graduated, creatorTaxBps, token };
}

export async function tradeOnCurve(input: {
  curve: Address;
  side: "buy" | "sell";
  amount: string;
  slippageBps: number;
  onStatus: (message: string) => void;
}): Promise<Hex> {
  const { wallet, account, client } = await signer();
  const amountIn = parseEther(input.amount);
  const state = await readCurveState(input.curve);
  const slip = BigInt(Math.max(0, Math.min(10_000, input.slippageBps)));
  if (input.side === "buy") {
    const quoted = quoteCurveBuy({
      quoteIn: amountIn,
      realQuote: state.realQuote,
      tokenReserve: state.tokenReserve,
      creatorTaxBps: state.creatorTaxBps,
    });
    if (quoted.tokensOut <= 0n) throw new Error("That buy does not clear the curve.");
    const minOut = (quoted.tokensOut * (10_000n - slip)) / 10_000n;
    input.onStatus("Confirm the buy.");
    const bought = await send(
      () =>
        writeRobinhood(wallet, account, client, {
          address: input.curve,
          abi: FEEZE_CURVE_ABI,
          functionName: "buy",
          args: [minOut],
          value: amountIn,
        }),
      client,
    );
    return bought.transactionHash;
  }
  const quoted = quoteCurveSell({
    tokensIn: amountIn,
    realQuote: state.realQuote,
    tokenReserve: state.tokenReserve,
    creatorTaxBps: state.creatorTaxBps,
  });
  if (quoted.quoteOut <= 0n) throw new Error("The curve cannot buy that many tokens back.");
  const minOut = (quoted.quoteOut * (10_000n - slip)) / 10_000n;
  const allowance = await client.readContract({
    address: state.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, input.curve],
  });
  if (allowance < amountIn) {
    input.onStatus("Confirm the token approval, then the sell.");
    await send(
      () =>
        writeRobinhood(wallet, account, client, {
          address: state.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [input.curve, amountIn],
        }),
      client,
    );
  }
  input.onStatus("Confirm the sell.");
  const sold = await send(
    () =>
      writeRobinhood(wallet, account, client, {
        address: input.curve,
        abi: FEEZE_CURVE_ABI,
        functionName: "sell",
        args: [amountIn, minOut],
      }),
    client,
  );
  return sold.transactionHash;
}

export async function readCurveTrades(curve: Address): Promise<ChainTrade[]> {
  const client = publicClient();
  const latest = await client.getBlockNumber();
  const span = 49_999n;
  const start = latest > 500_000n ? latest - 500_000n : 0n;
  const logs = [];
  for (let from = start; from <= latest; from += span) {
    const to = from + span - 1n > latest ? latest : from + span - 1n;
    logs.push(...(await client.getLogs({ address: curve, fromBlock: from, toBlock: to })));
  }
  const rows: ChainTrade[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: FEEZE_CURVE_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "CurveBuy" && decoded.eventName !== "CurveSell") continue;
      const buy = decoded.eventName === "CurveBuy";
      const tokenAmount = Number(formatEther(buy ? decoded.args.tokensOut : decoded.args.tokensIn));
      const quoteAmount = Number(formatEther(buy ? decoded.args.quoteIn : decoded.args.quoteOut));
      rows.push({
        hash: log.transactionHash ?? "",
        side: buy ? "buy" : "sell",
        tokenAmount,
        quoteAmount,
        trader: (buy ? decoded.args.buyer : decoded.args.seller).toLowerCase(),
        time: Number(log.blockNumber),
      });
    } catch {
      // Pool and token logs are on other addresses.
    }
  }
  const stamps = new Map<bigint, number>();
  await Promise.all(
    [...new Set(rows.map((row) => BigInt(row.time)))].map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      stamps.set(blockNumber, Number(block.timestamp) * 1000);
    }),
  );
  return rows
    .map((row) => ({ ...row, time: stamps.get(BigInt(row.time)) ?? Date.now() }))
    .sort((a, b) => b.time - a.time);
}
