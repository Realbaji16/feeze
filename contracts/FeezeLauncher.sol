// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FeezeToken.sol";

interface IUniswapFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IPositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function refundETH() external payable;

    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);
}

/// @notice One transaction deploys a fixed-supply token and, when ETH is attached, locks a full-range Uniswap v3 position.
contract FeezeLauncher {
    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address public constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address public constant LOCKED = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant POOL_TOKENS = (SUPPLY * 80) / 100;
    uint24 public constant POOL_FEE = 10000;
    int24 public constant TICK_LOWER = -887200;
    int24 public constant TICK_UPPER = 887200;

    event Launched(address indexed token, address indexed pool, address indexed creator);

    function launch(string calldata tokenName, string calldata tokenSymbol)
        external
        payable
        returns (address token, address pool)
    {
        token = address(new FeezeToken(tokenName, tokenSymbol, SUPPLY, address(this)));
        pool = address(0);
        if (msg.value > 0) {
            (address token0, address token1) = token < WETH ? (token, WETH) : (WETH, token);
            uint256 amount0 = token0 == token ? POOL_TOKENS : msg.value;
            uint256 amount1 = token0 == token ? msg.value : POOL_TOKENS;
            uint160 sqrtPriceX96 = priceX96(amount1, amount0);
            require(FeezeToken(token).approve(POSITION_MANAGER, POOL_TOKENS), "approve");
            bytes[] memory calls = new bytes[](3);
            calls[0] = abi.encodeCall(
                IPositionManager.createAndInitializePoolIfNecessary, (token0, token1, POOL_FEE, sqrtPriceX96)
            );
            calls[1] = abi.encodeCall(
                IPositionManager.mint,
                (
                    IPositionManager.MintParams({
                        token0: token0,
                        token1: token1,
                        fee: POOL_FEE,
                        tickLower: TICK_LOWER,
                        tickUpper: TICK_UPPER,
                        amount0Desired: amount0,
                        amount1Desired: amount1,
                        amount0Min: 0,
                        amount1Min: 0,
                        recipient: LOCKED,
                        deadline: block.timestamp + 20 minutes
                    })
                )
            );
            calls[2] = abi.encodeCall(IPositionManager.refundETH, ());
            IPositionManager(POSITION_MANAGER).multicall{value: msg.value}(calls);
            pool = IUniswapFactory(FACTORY).getPool(token, WETH, POOL_FEE);
            require(pool != address(0), "pool");
        }
        uint256 left = FeezeToken(token).balanceOf(address(this));
        if (left > 0) require(FeezeToken(token).transfer(msg.sender, left), "transfer");
        if (address(this).balance > 0) {
            (bool ok,) = msg.sender.call{value: address(this).balance}("");
            require(ok, "refund");
        }
        emit Launched(token, pool, msg.sender);
    }

    /// @dev sqrt(amount1 / amount0) * 2^96, matching the pool's token order.
    function priceX96(uint256 amount1, uint256 amount0) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "price");
        return uint160(sqrt(mulDiv(amount1, 1 << 192, amount0)));
    }

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @dev Uniswap FullMath.mulDiv. Keeps the 512-bit product from overflowing.
    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                require(denominator > 0);
                assembly {
                    result := div(prod0, denominator)
                }
                return result;
            }
            require(denominator > prod1);
            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            result = prod0 * inverse;
        }
    }

    receive() external payable {}
}
