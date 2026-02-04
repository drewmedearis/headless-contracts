// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LinearBondingCurve
 * @dev Library implementing linear bonding curve price calculations
 *
 * Price Formula: Price = BasePrice + (Slope * TokensSold)
 *
 * This creates a linear price increase as tokens are purchased from the curve.
 *
 * Default parameters (calibrated for ~22x FDV:Liquidity ratio):
 *   Base Price = 0.0001 ETH
 *   Slope = 0.000000002 ETH per token
 *   Target Raise = 10 ETH
 *
 * At graduation (10 ETH raised):
 *   Tokens sold: ~62,000 (10% of curve)
 *   Final price: ~0.000224 ETH (2.2x initial)
 *   FDV: ~224 ETH
 *   FDV:Liquidity ratio: ~22x
 *
 * This ratio balances early buyer advantage with sustainable post-graduation trading.
 * See docs/BONDING_CURVE_ECONOMICS.md for full analysis.
 */
library LinearBondingCurve {
    /**
     * @dev Calculate current price for a given amount of tokens already sold
     * @param basePrice The starting price in wei
     * @param slope Price increase per token (in wei per token unit)
     * @param tokensSold Current tokens sold from the curve
     * @return Current price in wei
     */
    function getCurrentPrice(
        uint256 basePrice,
        uint256 slope,
        uint256 tokensSold
    ) internal pure returns (uint256) {
        // Price = basePrice + slope * tokensSold / 10^18
        return basePrice + (slope * tokensSold / 1e18);
    }

    /**
     * @dev Calculate total cost for a given number of tokens from zero
     * @param basePrice The starting price in wei
     * @param slope Price increase per token
     * @param tokens Total tokens to calculate cost for
     * @return Total cost in wei
     *
     * Math: Total cost = basePrice * tokens + slope * tokens^2 / 2
     * This is the integral of the linear price function.
     */
    function getTotalCost(
        uint256 basePrice,
        uint256 slope,
        uint256 tokens
    ) internal pure returns (uint256) {
        // Linear component: basePrice * tokens / 10^18
        uint256 linearCost = (basePrice * tokens) / 1e18;

        // Quadratic component: slope * tokens^2 / (2 * 10^36)
        uint256 quadraticCost = (slope * tokens * tokens) / (2 * 1e36);

        return linearCost + quadraticCost;
    }

    /**
     * @dev Calculate tokens received for a given ETH amount
     * @param basePrice The starting price in wei
     * @param slope Price increase per token
     * @param currentTokensSold Current tokens already sold
     * @param ethAmount ETH amount to spend
     * @return Number of tokens received
     *
     * Uses binary search to find the token amount that matches the ETH spent.
     */
    function calculatePurchase(
        uint256 basePrice,
        uint256 slope,
        uint256 currentTokensSold,
        uint256 ethAmount
    ) internal pure returns (uint256) {
        uint256 currentCost = getTotalCost(basePrice, slope, currentTokensSold);
        uint256 targetCost = currentCost + ethAmount;

        // Binary search for token amount
        uint256 low = currentTokensSold;
        // Upper bound: estimate max tokens possible at base price
        uint256 high = currentTokensSold + (ethAmount * 1e18 / basePrice);

        // Ensure we don't overflow
        if (high < low) {
            high = type(uint256).max / 2;
        }

        while (high - low > 1e15) { // Precision to 0.001 tokens
            uint256 mid = (low + high) / 2;
            uint256 cost = getTotalCost(basePrice, slope, mid);

            if (cost < targetCost) {
                low = mid;
            } else {
                high = mid;
            }
        }

        return low - currentTokensSold;
    }

    /**
     * @dev Calculate ETH received for selling tokens
     * @param basePrice The starting price in wei
     * @param slope Price increase per token
     * @param currentTokensSold Current tokens sold
     * @param tokenAmount Tokens to sell
     * @return ETH amount received
     */
    function calculateSale(
        uint256 basePrice,
        uint256 slope,
        uint256 currentTokensSold,
        uint256 tokenAmount
    ) internal pure returns (uint256) {
        require(tokenAmount <= currentTokensSold, "Not enough tokens sold");

        uint256 currentCost = getTotalCost(basePrice, slope, currentTokensSold);
        uint256 newCost = getTotalCost(basePrice, slope, currentTokensSold - tokenAmount);

        return currentCost - newCost;
    }

    /**
     * @dev Estimate ETH needed to graduate (reach target raise)
     * @param basePrice The starting price
     * @param slope The price slope
     * @param currentTokensSold Current tokens sold
     * @param currentRaised Current ETH raised
     * @param targetRaise Target ETH to raise
     * @return Remaining ETH needed to graduate
     */
    function estimateToGraduation(
        uint256 basePrice,
        uint256 slope,
        uint256 currentTokensSold,
        uint256 currentRaised,
        uint256 targetRaise
    ) internal pure returns (uint256) {
        if (currentRaised >= targetRaise) {
            return 0;
        }
        return targetRaise - currentRaised;
    }

    /**
     * @dev Calculate average price for next N tokens
     * @param basePrice The starting price
     * @param slope The price slope
     * @param currentTokensSold Current tokens sold
     * @param tokenAmount Tokens to buy
     * @return Average price per token
     */
    function getAveragePrice(
        uint256 basePrice,
        uint256 slope,
        uint256 currentTokensSold,
        uint256 tokenAmount
    ) internal pure returns (uint256) {
        if (tokenAmount == 0) return getCurrentPrice(basePrice, slope, currentTokensSold);

        uint256 currentCost = getTotalCost(basePrice, slope, currentTokensSold);
        uint256 newCost = getTotalCost(basePrice, slope, currentTokensSold + tokenAmount);
        uint256 totalCost = newCost - currentCost;

        return (totalCost * 1e18) / tokenAmount;
    }

    /**
     * @dev Calculate market cap at current price
     * @param basePrice The starting price
     * @param slope The price slope
     * @param tokensSold Tokens sold from curve
     * @param totalSupply Total token supply
     * @return Market cap in wei
     */
    function getMarketCap(
        uint256 basePrice,
        uint256 slope,
        uint256 tokensSold,
        uint256 totalSupply
    ) internal pure returns (uint256) {
        uint256 price = getCurrentPrice(basePrice, slope, tokensSold);
        return (price * totalSupply) / 1e18;
    }
}
