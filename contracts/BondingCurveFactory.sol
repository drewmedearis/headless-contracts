// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IUniswapV2.sol";

/**
 * @title MarketToken
 * @dev ERC20 token created for each market
 */
contract MarketToken is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address factory
    ) ERC20(name, symbol) {
        _mint(factory, initialSupply);
    }
}

/**
 * @title BondingCurveFactory
 * @dev Deploys markets with bonding curve mechanics for Headless Markets Protocol
 *
 * Token Distribution:
 * - 30% to founding quorum (split by contribution weights)
 * - 60% bonded to curve (available for purchase)
 * - 10% to protocol treasury
 */
contract BondingCurveFactory is Ownable, ReentrancyGuard {
    // ============ Structs ============

    struct Market {
        address tokenAddress;
        address lpPair;             // Uniswap V2 LP pair address
        address[] quorumAgents;
        uint256[] agentWeights;
        uint256 targetRaise;        // ETH target for graduation
        uint256 currentRaised;      // ETH raised so far
        uint256 tokensSold;         // Tokens sold from curve
        uint256 basePrice;          // Starting price in wei
        uint256 slope;              // Price increase per token
        bool graduated;             // True if graduated to DEX
        bool active;                // True if market is active
        string thesis;              // Business thesis
    }

    // ============ State Variables ============

    mapping(uint256 => Market) public markets;
    uint256 public marketCount;

    address public protocolTreasury;
    uint256 public protocolFeeBps = 50; // 0.5%

    uint256 public constant QUORUM_ALLOCATION_BPS = 3000;  // 30%
    uint256 public constant CURVE_ALLOCATION_BPS = 6000;   // 60%
    uint256 public constant TREASURY_ALLOCATION_BPS = 1000; // 10%
    uint256 public constant TOTAL_SUPPLY = 1_000_000 * 10**18; // 1M tokens
    uint256 public constant MIN_PURCHASE = 0.001 ether;    // Minimum purchase amount (HM-07)
    uint256 public constant BPS_DENOMINATOR = 10000;       // Basis points denominator
    uint256 public constant PAUSE_DELAY = 24 hours;        // Timelock for pause (HM-03)

    // Default bonding curve parameters
    // Slope calibrated for ~22x FDV:Liquidity ratio at graduation
    // This balances excitement for early buyers with sustainable post-graduation trading
    // See docs/BONDING_CURVE_ECONOMICS.md for full analysis
    uint256 public defaultBasePrice = 0.0001 ether;
    uint256 public defaultSlope = 0.000000002 ether;  // 5x lower than original for healthier economics
    uint256 public defaultTargetRaise = 10 ether;

    // Governance contract address
    address public governance;

    // Uniswap V2 Router for DEX graduation
    IUniswapV2Router02 public uniswapRouter;

    // Pending pause requests (marketId => timestamp when pause can execute)
    mapping(uint256 => uint256) public pendingPause;

    // ============ Events ============

    event MarketCreated(
        uint256 indexed marketId,
        address indexed tokenAddress,
        address[] quorumAgents,
        string thesis
    );

    event TokensPurchased(
        uint256 indexed marketId,
        address indexed buyer,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 newPrice
    );

    event TokensSold(
        uint256 indexed marketId,
        address indexed seller,
        uint256 tokenAmount,
        uint256 ethAmount
    );

    event MarketGraduated(
        uint256 indexed marketId,
        uint256 totalRaised,
        address lpPair
    );

    event LiquidityAdded(
        uint256 indexed marketId,
        address indexed lpPair,
        uint256 tokenAmount,
        uint256 ethAmount,
        uint256 liquidity
    );

    event ProtocolFeeCollected(
        uint256 indexed marketId,
        uint256 feeAmount
    );

    event GovernanceUpdated(address indexed newGovernance);

    event UniswapRouterUpdated(address indexed newRouter);

    event MarketPaused(uint256 indexed marketId);

    event MarketUnpaused(uint256 indexed marketId);

    event EmergencyWithdrawal(address indexed token, uint256 amount, address indexed recipient);

    event GraduatedMarketRescued(uint256 indexed marketId, uint256 ethAmount, uint256 tokenAmount);

    event PauseRequested(uint256 indexed marketId, uint256 executeTime);

    event PauseCancelled(uint256 indexed marketId);

    event DefaultParametersUpdated(
        uint256 basePrice,
        uint256 slope,
        uint256 targetRaise
    );

    // ============ Constructor ============

    constructor(address _treasury, address _uniswapRouter) Ownable(msg.sender) {
        protocolTreasury = _treasury;
        if (_uniswapRouter != address(0)) {
            uniswapRouter = IUniswapV2Router02(_uniswapRouter);
        }
    }

    // ============ External Functions ============

    /**
     * @dev Create a new market with bonding curve
     * @param quorumAgents Array of agent addresses in the quorum
     * @param weights Contribution weights for each agent (must sum to 100)
     * @param name Token name
     * @param symbol Token symbol
     * @param thesis Business thesis for the market
     */
    function createMarket(
        address[] calldata quorumAgents,
        uint256[] calldata weights,
        string calldata name,
        string calldata symbol,
        string calldata thesis
    ) external returns (uint256 marketId) {
        require(quorumAgents.length >= 3 && quorumAgents.length <= 10, "Quorum size 3-10");
        require(quorumAgents.length == weights.length, "Weights mismatch");
        require(_sumWeights(weights) == 100, "Weights must sum to 100");
        require(!_hasDuplicates(quorumAgents), "Duplicate agents");

        marketId = marketCount++;

        // Deploy token
        MarketToken token = new MarketToken(name, symbol, TOTAL_SUPPLY, address(this));

        // Calculate allocations
        uint256 quorumSupply = (TOTAL_SUPPLY * QUORUM_ALLOCATION_BPS) / 10000;
        uint256 treasurySupply = (TOTAL_SUPPLY * TREASURY_ALLOCATION_BPS) / 10000;
        // curveSupply = TOTAL_SUPPLY - quorumSupply - treasurySupply (stays in factory)

        // Distribute to quorum agents
        for (uint256 i = 0; i < quorumAgents.length; i++) {
            uint256 agentShare = (quorumSupply * weights[i]) / 100;
            token.transfer(quorumAgents[i], agentShare);
        }

        // Transfer to protocol treasury
        token.transfer(protocolTreasury, treasurySupply);

        // Store market data
        markets[marketId] = Market({
            tokenAddress: address(token),
            lpPair: address(0),
            quorumAgents: quorumAgents,
            agentWeights: weights,
            targetRaise: defaultTargetRaise,
            currentRaised: 0,
            tokensSold: 0,
            basePrice: defaultBasePrice,
            slope: defaultSlope,
            graduated: false,
            active: true,
            thesis: thesis
        });

        emit MarketCreated(marketId, address(token), quorumAgents, thesis);
    }

    /**
     * @dev Buy tokens from the bonding curve with slippage protection
     * @param marketId The market to buy from
     * @param minTokensOut Minimum tokens to receive (slippage protection against MEV)
     */
    function buy(uint256 marketId, uint256 minTokensOut) external payable nonReentrant {
        Market storage market = markets[marketId];
        require(market.active, "Market not active");
        require(!market.graduated, "Market graduated");
        require(msg.value >= MIN_PURCHASE, "Below minimum purchase");

        // Calculate protocol fee
        uint256 fee = (msg.value * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = msg.value - fee;

        // Calculate tokens to mint based on bonding curve
        uint256 tokenAmount = _calculatePurchase(market, netAmount);
        require(tokenAmount > 0, "Zero tokens");
        require(tokenAmount >= minTokensOut, "Slippage exceeded");

        // Update state
        market.currentRaised += netAmount;
        market.tokensSold += tokenAmount;

        // Transfer tokens to buyer
        MarketToken(market.tokenAddress).transfer(msg.sender, tokenAmount);

        // Transfer fee to protocol treasury
        if (fee > 0) {
            (bool feeSuccess, ) = protocolTreasury.call{value: fee}("");
            require(feeSuccess, "Fee transfer failed");
            emit ProtocolFeeCollected(marketId, fee);
        }

        emit TokensPurchased(
            marketId,
            msg.sender,
            msg.value,
            tokenAmount,
            getCurrentPrice(marketId)
        );

        // Check for graduation
        if (market.currentRaised >= market.targetRaise) {
            _graduate(marketId);
        }
    }

    /**
     * @dev Sell tokens back to the bonding curve with slippage protection
     * @param marketId The market to sell to
     * @param tokenAmount Amount of tokens to sell
     * @param minEthOut Minimum ETH to receive (slippage protection against MEV)
     */
    function sell(uint256 marketId, uint256 tokenAmount, uint256 minEthOut) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.active, "Market not active");
        require(!market.graduated, "Market graduated");
        require(tokenAmount > 0, "Zero tokens");

        // Calculate ETH to return
        uint256 ethAmount = _calculateSale(market, tokenAmount);
        require(ethAmount <= market.currentRaised, "Insufficient liquidity");

        // Calculate protocol fee
        uint256 fee = (ethAmount * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = ethAmount - fee;
        require(netAmount >= minEthOut, "Slippage exceeded");

        // Transfer tokens from seller to factory
        MarketToken(market.tokenAddress).transferFrom(msg.sender, address(this), tokenAmount);

        // Update state
        market.currentRaised -= ethAmount;
        market.tokensSold -= tokenAmount;

        // Transfer ETH to seller
        (bool success, ) = msg.sender.call{value: netAmount}("");
        require(success, "ETH transfer failed");

        // Transfer fee to protocol treasury
        if (fee > 0) {
            (bool feeSuccess, ) = protocolTreasury.call{value: fee}("");
            require(feeSuccess, "Fee transfer failed");
        }

        emit TokensSold(marketId, msg.sender, tokenAmount, netAmount);
    }

    // ============ View Functions ============

    /**
     * @dev Get current token price for a market
     */
    function getCurrentPrice(uint256 marketId) public view returns (uint256) {
        Market storage market = markets[marketId];
        return market.basePrice + (market.slope * market.tokensSold / 10**18);
    }

    /**
     * @dev Get market details
     */
    function getMarket(uint256 marketId) external view returns (
        address tokenAddress,
        address lpPair,
        address[] memory quorumAgents,
        uint256[] memory agentWeights,
        uint256 targetRaise,
        uint256 currentRaised,
        uint256 tokensSold,
        bool graduated,
        bool active,
        string memory thesis
    ) {
        Market storage market = markets[marketId];
        return (
            market.tokenAddress,
            market.lpPair,
            market.quorumAgents,
            market.agentWeights,
            market.targetRaise,
            market.currentRaised,
            market.tokensSold,
            market.graduated,
            market.active,
            market.thesis
        );
    }

    /**
     * @dev Calculate tokens received for ETH amount
     */
    function calculatePurchaseReturn(uint256 marketId, uint256 ethAmount) external view returns (uint256) {
        Market storage market = markets[marketId];
        return _calculatePurchase(market, ethAmount);
    }

    /**
     * @dev Calculate ETH received for token amount
     */
    function calculateSaleReturn(uint256 marketId, uint256 tokenAmount) external view returns (uint256) {
        Market storage market = markets[marketId];
        return _calculateSale(market, tokenAmount);
    }

    // ============ Admin Functions ============

    function setProtocolTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        protocolTreasury = _treasury;
    }

    function setProtocolFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "Fee too high"); // Max 5%
        protocolFeeBps = _feeBps;
    }

    function setDefaultParameters(
        uint256 _basePrice,
        uint256 _slope,
        uint256 _targetRaise
    ) external onlyOwner {
        require(_basePrice > 0, "Invalid base price");
        require(_targetRaise > 0, "Invalid target raise");
        defaultBasePrice = _basePrice;
        defaultSlope = _slope;
        defaultTargetRaise = _targetRaise;
        emit DefaultParametersUpdated(_basePrice, _slope, _targetRaise);
    }

    // ============ Internal Functions ============

    /**
     * @dev Calculate tokens from ETH using closed-form quadratic solution (HM-04)
     *
     * For linear bonding curve: Cost(n) = basePrice * n + slope * n^2 / 2
     * Solving for n given cost uses quadratic formula:
     * n = (-basePrice + sqrt(basePrice^2 + 2 * slope * cost)) / slope
     *
     * This replaces binary search for exact calculations with no precision loss.
     */
    function _calculatePurchase(Market storage market, uint256 ethAmount) internal view returns (uint256) {
        uint256 currentTokens = market.tokensSold;
        uint256 currentCost = _getTotalCost(market, currentTokens);
        uint256 targetCost = currentCost + ethAmount;

        // Use quadratic formula to find newTokens for targetCost
        // n = (-basePrice + sqrt(basePrice^2 + 2 * slope * targetCost * 10^18)) / slope
        // Note: we scale by 10^18 for precision since targetCost is in wei

        uint256 basePrice = market.basePrice;
        uint256 slope = market.slope;

        // Handle edge case where slope is 0 (linear pricing only)
        if (slope == 0) {
            // Simple linear: tokens = ethAmount * 10^18 / basePrice
            return (ethAmount * 10**18) / basePrice;
        }

        // Calculate discriminant: basePrice^2 + 2 * slope * targetCost * 10^18
        // Scale targetCost by 10^18 to match token units
        uint256 scaledTargetCost = targetCost * 10**18;
        uint256 discriminant = (basePrice * basePrice) + (2 * slope * scaledTargetCost / 10**18);

        // Calculate sqrt of discriminant
        uint256 sqrtDiscriminant = _sqrt(discriminant);

        // Calculate new total tokens: (-basePrice + sqrt) * 10^18 / slope
        // Since basePrice < sqrtDiscriminant for valid purchases, this won't underflow
        uint256 newTokens;
        if (sqrtDiscriminant > basePrice) {
            newTokens = ((sqrtDiscriminant - basePrice) * 10**18) / slope;
        } else {
            return 0;
        }

        // Return tokens purchased (difference from current)
        if (newTokens > currentTokens) {
            return newTokens - currentTokens;
        }
        return 0;
    }

    /**
     * @dev Integer square root using Babylonian method
     * @param x The number to find the square root of
     * @return y The square root of x
     */
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        y = x;

        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /**
     * @dev Calculate ETH from tokens for selling
     */
    function _calculateSale(Market storage market, uint256 tokenAmount) internal view returns (uint256) {
        uint256 currentTokens = market.tokensSold;
        require(tokenAmount <= currentTokens, "Not enough tokens sold");

        uint256 currentCost = _getTotalCost(market, currentTokens);
        uint256 newCost = _getTotalCost(market, currentTokens - tokenAmount);

        return currentCost - newCost;
    }

    /**
     * @dev Get total cost for a given number of tokens
     */
    function _getTotalCost(Market storage market, uint256 tokens) internal view returns (uint256) {
        // Total cost = basePrice * tokens + slope * tokens^2 / 2
        uint256 linearCost = (market.basePrice * tokens) / 10**18;
        uint256 quadraticCost = (market.slope * tokens * tokens) / (2 * 10**36);
        return linearCost + quadraticCost;
    }

    function _sumWeights(uint256[] calldata weights) internal pure returns (uint256 sum) {
        for (uint256 i = 0; i < weights.length; i++) {
            sum += weights[i];
        }
    }

    /**
     * @dev Check for duplicate addresses in array (NEW-05 FIX)
     */
    function _hasDuplicates(address[] calldata arr) internal pure returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            for (uint256 j = i + 1; j < arr.length; j++) {
                if (arr[i] == arr[j]) return true;
            }
        }
        return false;
    }

    function _graduate(uint256 marketId) internal {
        Market storage market = markets[marketId];
        market.graduated = true;

        // If Uniswap router is not set, skip DEX integration
        if (address(uniswapRouter) == address(0)) {
            emit MarketGraduated(marketId, market.currentRaised, address(0));
            return;
        }

        MarketToken token = MarketToken(market.tokenAddress);

        // Calculate remaining curve tokens (not yet sold)
        uint256 curveSupply = (TOTAL_SUPPLY * CURVE_ALLOCATION_BPS) / BPS_DENOMINATOR;
        uint256 remainingTokens = curveSupply - market.tokensSold;

        // Use raised ETH and remaining tokens for liquidity
        uint256 ethForLiquidity = market.currentRaised;
        uint256 tokensForLiquidity = remainingTokens;

        // Approve router to spend tokens
        token.approve(address(uniswapRouter), tokensForLiquidity);

        // Add liquidity to Uniswap V2
        // LP tokens go to protocol treasury for long-term protocol ownership
        (uint256 amountToken, uint256 amountETH, uint256 liquidity) = uniswapRouter.addLiquidityETH{value: ethForLiquidity}(
            address(token),
            tokensForLiquidity,
            (tokensForLiquidity * 95) / 100, // 5% slippage tolerance
            (ethForLiquidity * 95) / 100,    // 5% slippage tolerance
            protocolTreasury,                 // LP tokens to treasury
            block.timestamp + 1 hours         // Deadline
        );

        // Get the LP pair address
        address factory = uniswapRouter.factory();
        address weth = uniswapRouter.WETH();
        market.lpPair = IUniswapV2Factory(factory).getPair(address(token), weth);

        emit MarketGraduated(marketId, amountETH, market.lpPair);
        emit LiquidityAdded(marketId, market.lpPair, amountToken, amountETH, liquidity);
    }

    // ============ Governance Functions ============

    /**
     * @dev Force graduate a market before target is reached
     * Can only be called by governance contract
     * @param marketId The market to graduate
     */
    function forceGraduate(uint256 marketId) external {
        require(msg.sender == governance, "Only governance");
        Market storage market = markets[marketId];
        require(market.active, "Market not active");
        require(!market.graduated, "Already graduated");

        _graduate(marketId);
    }

    /**
     * @dev Set governance contract address (for permission checks)
     * @param _governance The governance contract address
     */
    function setGovernance(address _governance) external onlyOwner {
        require(_governance != address(0), "Zero address");
        governance = _governance;
        emit GovernanceUpdated(_governance);
    }

    /**
     * @dev Set the Uniswap V2 Router address for DEX graduation
     * @param _router The Uniswap V2 Router address
     */
    function setUniswapRouter(address _router) external onlyOwner {
        require(_router != address(0), "Zero address");
        uniswapRouter = IUniswapV2Router02(_router);
        emit UniswapRouterUpdated(_router);
    }

    // ============ Emergency Functions (with Timelock - HM-03) ============

    /**
     * @dev Request to pause a market (starts timelock)
     * @param marketId The market to pause
     */
    function requestPause(uint256 marketId) external onlyOwner {
        require(markets[marketId].active, "Market not active");
        require(pendingPause[marketId] == 0, "Pause already requested");

        uint256 executeTime = block.timestamp + PAUSE_DELAY;
        pendingPause[marketId] = executeTime;

        emit PauseRequested(marketId, executeTime);
    }

    /**
     * @dev Execute a pending pause after timelock expires
     * @param marketId The market to pause
     */
    function executePause(uint256 marketId) external onlyOwner {
        require(pendingPause[marketId] != 0, "No pending pause");
        require(block.timestamp >= pendingPause[marketId], "Timelock not expired");
        require(markets[marketId].active, "Market not active");

        pendingPause[marketId] = 0;
        markets[marketId].active = false;

        emit MarketPaused(marketId);
    }

    /**
     * @dev Cancel a pending pause request
     * @param marketId The market to cancel pause for
     */
    function cancelPause(uint256 marketId) external onlyOwner {
        require(pendingPause[marketId] != 0, "No pending pause");

        pendingPause[marketId] = 0;

        emit PauseCancelled(marketId);
    }

    /**
     * @dev Unpause a market (no timelock needed for unpause)
     * @param marketId The market to unpause
     */
    function unpause(uint256 marketId) external onlyOwner {
        require(!markets[marketId].active, "Market already active");
        markets[marketId].active = true;
        emit MarketUnpaused(marketId);
    }

    /**
     * @dev Emergency pause - bypasses timelock (use only for critical security issues)
     * @param marketId The market to pause immediately
     */
    function emergencyPause(uint256 marketId) external onlyOwner {
        require(markets[marketId].active, "Market not active");
        markets[marketId].active = false;
        pendingPause[marketId] = 0; // Clear any pending pause
        emit MarketPaused(marketId);
    }

    // ============ Emergency Withdrawal Functions ============

    /**
     * @dev Emergency withdraw ETH stuck in contract
     * Can only withdraw excess ETH (not reserved for markets)
     * SECURITY FIX (HM-NEW-01): Protects funds regardless of pause status
     * @param amount Amount of ETH to withdraw
     */
    function emergencyWithdrawETH(uint256 amount) external onlyOwner {
        uint256 contractBalance = address(this).balance;

        // Calculate total reserved ETH across ALL non-graduated markets
        // This protects user funds even if market is paused (HM-NEW-01 fix)
        uint256 reservedETH = 0;
        for (uint256 i = 0; i < marketCount; i++) {
            if (!markets[i].graduated) {
                reservedETH += markets[i].currentRaised;
            }
        }

        uint256 withdrawable = contractBalance > reservedETH ? contractBalance - reservedETH : 0;
        require(amount <= withdrawable, "Amount exceeds withdrawable");

        (bool success, ) = protocolTreasury.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit EmergencyWithdrawal(address(0), amount, protocolTreasury);
    }

    /**
     * @dev Emergency withdraw tokens stuck in contract
     * Cannot withdraw tokens that belong to market curves
     * SECURITY FIX (HM-NEW-01): Protects tokens regardless of pause status
     * @param token Token address to withdraw
     * @param amount Amount to withdraw
     */
    function emergencyWithdrawTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token");

        // Check if this token belongs to any non-graduated market (active or paused)
        // This protects user tokens even if market is paused (HM-NEW-01 fix)
        for (uint256 i = 0; i < marketCount; i++) {
            if (markets[i].tokenAddress == token && !markets[i].graduated) {
                // Calculate reserved tokens for this market's curve
                uint256 curveSupply = (TOTAL_SUPPLY * CURVE_ALLOCATION_BPS) / BPS_DENOMINATOR;
                uint256 remainingCurve = curveSupply - markets[i].tokensSold;
                uint256 tokenBalance = IERC20(token).balanceOf(address(this));
                uint256 withdrawable = tokenBalance > remainingCurve ? tokenBalance - remainingCurve : 0;
                require(amount <= withdrawable, "Amount exceeds withdrawable");
            }
        }

        IERC20(token).transfer(protocolTreasury, amount);
        emit EmergencyWithdrawal(token, amount, protocolTreasury);
    }

    /**
     * @dev Force withdraw all funds from a graduated market to treasury
     * Use only if graduation DEX integration failed
     * @param marketId The graduated market ID
     */
    function rescueGraduatedMarketFunds(uint256 marketId) external onlyOwner {
        Market storage market = markets[marketId];
        require(market.graduated, "Market not graduated");
        require(market.lpPair == address(0), "LP already created");

        // Send any remaining ETH for this market to treasury
        uint256 ethToRescue = market.currentRaised;
        if (ethToRescue > 0 && address(this).balance >= ethToRescue) {
            market.currentRaised = 0; // Mark as rescued
            (bool success, ) = protocolTreasury.call{value: ethToRescue}("");
            require(success, "ETH rescue failed");
        }

        // Send remaining curve tokens to treasury
        MarketToken token = MarketToken(market.tokenAddress);
        uint256 tokenBalance = token.balanceOf(address(this));
        if (tokenBalance > 0) {
            token.transfer(protocolTreasury, tokenBalance);
        }

        emit GraduatedMarketRescued(marketId, ethToRescue, tokenBalance);
    }

    receive() external payable {}
}
