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

/// @notice One curve per launch. The whole supply sits here. Phantom ETH sets the opening price, so creating it takes no ETH.
contract FeezeCurve {
    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address public constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address public constant LOCKED = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant PHANTOM = 1.68 ether;
    uint256 public constant THRESHOLD = 4.2 ether;
    uint256 public constant FEE_BPS = 100;
    uint24 public constant POOL_FEE = 10000;
    int24 public constant TICK_LOWER = -887200;
    int24 public constant TICK_UPPER = 887200;

    uint256 public immutable k;
    uint256 public immutable reservedTokens;
    uint256 public immutable creatorTaxBps;
    address public immutable creator;
    address public immutable token;

    uint256 public realQuote;
    uint256 public tokenReserve;
    uint256 public creatorFees;
    address public pool;
    bool public graduated;
    bool private locked;

    event CurveBuy(address indexed buyer, uint256 quoteIn, uint256 tokensOut, uint256 fee);
    event CurveSell(address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 fee);
    event Graduated(address indexed pool);
    event FeesClaimed(address indexed creator, uint256 amount);

    modifier lock() {
        require(!locked, "reentrancy");
        locked = true;
        _;
        locked = false;
    }

    constructor(address creator_, uint256 creatorTaxBps_, string memory name, string memory symbol) {
        require(creator_ != address(0), "creator");
        require(creatorTaxBps_ <= 1000, "tax");
        creator = creator_;
        creatorTaxBps = creatorTaxBps_;
        k = PHANTOM * SUPPLY;
        reservedTokens = (SUPPLY * PHANTOM) / (PHANTOM + THRESHOLD);
        token = address(new FeezeToken(name, symbol, SUPPLY, address(this)));
        tokenReserve = SUPPLY;
    }

    function quoteReserve() public view returns (uint256) {
        return PHANTOM + realQuote;
    }

    function buy(uint256 minTokensOut) external payable lock returns (uint256 tokensOut) {
        require(!graduated, "graduated");
        require(msg.value > 0, "amount");
        uint256 quoteIn = msg.value;
        uint256 maxNet = THRESHOLD - realQuote;
        require(maxNet > 0, "full");
        uint256 bps = FEE_BPS + creatorTaxBps;
        uint256 used = quoteIn;
        uint256 fee = (used * bps) / 10_000;
        uint256 netIn = used - fee;
        if (netIn > maxNet) {
            used = (maxNet * 10_000) / (10_000 - bps);
            if (used > quoteIn) used = quoteIn;
            fee = (used * bps) / 10_000;
            netIn = used - fee;
            if (netIn > maxNet) {
                netIn = maxNet;
                fee = used - netIn;
            }
        }
        uint256 refund = quoteIn - used;
        uint256 newX = quoteReserve() + netIn;
        uint256 newY = k / newX;
        tokensOut = tokenReserve - newY;
        require(tokensOut >= minTokensOut, "slippage");
        require(tokensOut > 0, "dust");
        realQuote += netIn;
        creatorFees += fee;
        tokenReserve = newY;
        require(FeezeToken(token).transfer(msg.sender, tokensOut), "transfer");
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "refund");
        }
        emit CurveBuy(msg.sender, used, tokensOut, fee);
        if (tokenReserve <= reservedTokens) _graduate();
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut) external lock returns (uint256 quoteOut) {
        require(!graduated, "graduated");
        require(tokensIn > 0, "amount");
        uint256 newY = tokenReserve + tokensIn;
        require(newY <= SUPPLY, "supply");
        uint256 newX = k / newY;
        uint256 grossOut = quoteReserve() - newX;
        require(grossOut > 0 && grossOut <= realQuote, "reserves");
        uint256 fee = (grossOut * (FEE_BPS + creatorTaxBps)) / 10_000;
        quoteOut = grossOut - fee;
        require(quoteOut >= minQuoteOut, "slippage");
        require(FeezeToken(token).transferFrom(msg.sender, address(this), tokensIn), "transfer");
        realQuote -= grossOut;
        creatorFees += fee;
        tokenReserve = newY;
        (bool ok,) = msg.sender.call{value: quoteOut}("");
        require(ok, "payout");
        emit CurveSell(msg.sender, tokensIn, quoteOut, fee);
    }

    function claim() external lock {
        uint256 amount = creatorFees;
        require(amount > 0, "fees");
        creatorFees = 0;
        (bool ok,) = creator.call{value: amount}("");
        require(ok, "claim");
        emit FeesClaimed(creator, amount);
    }

    function _graduate() internal {
        graduated = true;
        uint256 quoteAmt = realQuote;
        uint256 tokenAmt = tokenReserve;
        require(quoteAmt > 0 && tokenAmt > 0, "reserves");
        realQuote = 0;
        tokenReserve = 0;
        (address token0, address token1) = token < WETH ? (token, WETH) : (WETH, token);
        uint160 sqrtPriceX96 = token0 == token ? _priceX96(quoteAmt, tokenAmt) : _priceX96(tokenAmt, quoteAmt);
        uint256 amount0 = token0 == token ? tokenAmt : quoteAmt;
        uint256 amount1 = token0 == token ? quoteAmt : tokenAmt;
        require(FeezeToken(token).approve(POSITION_MANAGER, tokenAmt), "approve");
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
        IPositionManager(POSITION_MANAGER).multicall{value: quoteAmt}(calls);
        address created = IUniswapFactory(FACTORY).getPool(token, WETH, POOL_FEE);
        require(created != address(0), "pool");
        pool = created;
        emit Graduated(created);
    }

    function _priceX96(uint256 amount1, uint256 amount0) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "price");
        return uint160(_sqrt(_mulDiv(amount1, 1 << 192, amount0)));
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
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

/// @notice Deploys a curve and its token. The call itself takes no ETH.
contract FeezeCurveFactory {
    event Launched(address indexed token, address indexed curve, address indexed creator);

    function launch(string calldata name, string calldata symbol, uint256 creatorTaxBps)
        external
        returns (address token, address curve)
    {
        curve = address(new FeezeCurve(msg.sender, creatorTaxBps, name, symbol));
        token = FeezeCurve(payable(curve)).token();
        emit Launched(token, curve, msg.sender);
    }
}
