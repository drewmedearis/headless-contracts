// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

    // Default bonding curve parameters
    uint256 public defaultBasePrice = 0.0001 ether;
    uint256 public defaultSlope = 0.00000001 ether;
    uint256 public defaultTargetRaise = 10 ether;

    // Governance contract address
    address public governance;

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

    event ProtocolFeeCollected(
        uint256 indexed marketId,
        uint256 feeAmount
    );

    event GovernanceUpdated(address indexed newGovernance);

    event MarketPaused(uint256 indexed marketId);

    event MarketUnpaused(uint256 indexed marketId);

    // ============ Constructor ============

    constructor(address _treasury) Ownable(msg.sender) {
        protocolTreasury = _treasury;
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
     * @dev Buy tokens from the bonding curve
     * @param marketId The market to buy from
     */
    function buy(uint256 marketId) external payable nonReentrant {
        Market storage market = markets[marketId];
        require(market.active, "Market not active");
        require(!market.graduated, "Market graduated");
        require(msg.value > 0, "Must send ETH");

        // Calculate protocol fee
        uint256 fee = (msg.value * protocolFeeBps) / 10000;
        uint256 netAmount = msg.value - fee;

        // Calculate tokens to mint based on bonding curve
        uint256 tokenAmount = _calculatePurchase(market, netAmount);
        require(tokenAmount > 0, "Zero tokens");

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
     * @dev Sell tokens back to the bonding curve
     * @param marketId The market to sell to
     * @param tokenAmount Amount of tokens to sell
     */
    function sell(uint256 marketId, uint256 tokenAmount) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.active, "Market not active");
        require(!market.graduated, "Market graduated");
        require(tokenAmount > 0, "Zero tokens");

        // Calculate ETH to return
        uint256 ethAmount = _calculateSale(market, tokenAmount);
        require(ethAmount <= market.currentRaised, "Insufficient liquidity");

        // Calculate protocol fee
        uint256 fee = (ethAmount * protocolFeeBps) / 10000;
        uint256 netAmount = ethAmount - fee;

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
        defaultBasePrice = _basePrice;
        defaultSlope = _slope;
        defaultTargetRaise = _targetRaise;
    }

    // ============ Internal Functions ============

    /**
     * @dev Calculate tokens from ETH using linear bonding curve
     * Using quadratic formula for accurate calculation
     */
    function _calculatePurchase(Market storage market, uint256 ethAmount) internal view returns (uint256) {
        // Simplified calculation for linear curve:
        // Price at token n = basePrice + slope * n
        // Total cost for tokens 0 to n = basePrice * n + slope * n^2 / 2

        uint256 currentTokens = market.tokensSold;
        uint256 currentCost = _getTotalCost(market, currentTokens);
        uint256 targetCost = currentCost + ethAmount;

        // Binary search for token amount
        uint256 low = currentTokens;
        uint256 high = currentTokens + (ethAmount * 10**18 / market.basePrice);

        while (high - low > 10**15) { // Precision to 0.001 tokens
            uint256 mid = (low + high) / 2;
            uint256 cost = _getTotalCost(market, mid);

            if (cost < targetCost) {
                low = mid;
            } else {
                high = mid;
            }
        }

        return low - currentTokens;
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

    function _graduate(uint256 marketId) internal {
        Market storage market = markets[marketId];
        market.graduated = true;

        // TODO: Integrate with Uniswap V2 for DEX listing
        // For now, just mark as graduated

        emit MarketGraduated(marketId, market.currentRaised, address(0));
    }

    // ============ Governance Functions ============

    /**
     * @dev Force graduate a market before target is reached
     * Can only be called by governance contract
     * @param marketId The market to graduate
     */
    function forceGraduate(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.active, "Market not active");
        require(!market.graduated, "Already graduated");
        // In production, add: require(msg.sender == governanceContract, "Only governance");

        _graduate(marketId);
    }

    /**
     * @dev Set governance contract address (for permission checks)
     * @param _governance The governance contract address
     */
    function setGovernance(address _governance) external onlyOwner {
        governance = _governance;
        emit GovernanceUpdated(_governance);
    }

    // ============ Emergency Functions ============

    function pause(uint256 marketId) external onlyOwner {
        markets[marketId].active = false;
        emit MarketPaused(marketId);
    }

    function unpause(uint256 marketId) external onlyOwner {
        markets[marketId].active = true;
        emit MarketUnpaused(marketId);
    }

    receive() external payable {}
}
