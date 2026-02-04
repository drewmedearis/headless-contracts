/**
 * Bonding Curve Economics Comparison
 *
 * Models: pump.fun vs Headless Markets (current) vs Headless Markets (adjusted)
 */

// ============ PUMP.FUN MODEL ============
// pump.fun uses Constant Product Market Maker (CPMM) with virtual reserves
// Formula: Price = virtualSOL / virtualTokens
// As tokens bought, virtualTokens decreases, price increases

interface PumpFunParams {
  totalSupply: number;           // 1 billion
  tokensOnCurve: number;         // 800 million
  virtualSolReserve: number;     // ~30 SOL initial
  virtualTokenReserve: number;   // ~1.073 billion initial
  graduationSol: number;         // ~85 SOL to graduate
}

function modelPumpFun() {
  const params: PumpFunParams = {
    totalSupply: 1_000_000_000,
    tokensOnCurve: 800_000_000,
    virtualSolReserve: 30,
    virtualTokenReserve: 1_073_000_000,
    graduationSol: 85,
  };

  // CPMM constant: k = virtualSOL * virtualTokens
  const k = params.virtualSolReserve * params.virtualTokenReserve;

  // Initial price
  const initialPrice = params.virtualSolReserve / params.virtualTokenReserve;

  // After graduation (85 SOL added)
  const finalVirtualSol = params.virtualSolReserve + params.graduationSol;
  const finalVirtualTokens = k / finalVirtualSol;
  const tokensBought = params.virtualTokenReserve - finalVirtualTokens;
  const finalPrice = finalVirtualSol / finalVirtualTokens;

  // FDV at graduation
  const fdvAtGraduation = finalPrice * params.totalSupply;

  // Liquidity deposited to Raydium (~$12K worth, roughly 80% of raised)
  const liquidityToRaydium = params.graduationSol * 0.85; // ~72 SOL

  // FDV:Liquidity ratio
  const fdvLiquidityRatio = fdvAtGraduation / params.graduationSol;

  console.log("============ PUMP.FUN MODEL ============");
  console.log(`Total Supply: ${(params.totalSupply / 1e9).toFixed(1)}B tokens`);
  console.log(`Tokens on Curve: ${(params.tokensOnCurve / 1e6).toFixed(0)}M (${(params.tokensOnCurve / params.totalSupply * 100).toFixed(0)}%)`);
  console.log(`\nInitial Price: ${initialPrice.toFixed(10)} SOL`);
  console.log(`Graduation Threshold: ${params.graduationSol} SOL (~$${(params.graduationSol * 140).toLocaleString()} @ $140/SOL)`);
  console.log(`\nTokens Bought at Graduation: ${(tokensBought / 1e6).toFixed(1)}M (${(tokensBought / params.tokensOnCurve * 100).toFixed(1)}% of curve)`);
  console.log(`Final Price: ${finalPrice.toFixed(10)} SOL`);
  console.log(`Price Multiple: ${(finalPrice / initialPrice).toFixed(1)}x`);
  console.log(`\nFDV at Graduation: ${fdvAtGraduation.toFixed(1)} SOL (~$${(fdvAtGraduation * 140 / 1000).toFixed(0)}K)`);
  console.log(`Liquidity Raised: ${params.graduationSol} SOL`);
  console.log(`FDV:Liquidity Ratio: ${fdvLiquidityRatio.toFixed(1)}x`);

  return { fdvLiquidityRatio, finalPrice, tokensBought, fdvAtGraduation };
}

// ============ HEADLESS MARKETS - CURRENT ============
interface HeadlessParams {
  totalSupply: number;
  tokensOnCurve: number;
  basePrice: number;        // ETH
  slope: number;            // ETH per token
  targetRaise: number;      // ETH
}

function getTotalCost(basePrice: number, slope: number, tokens: number): number {
  // Total cost = basePrice * tokens + slope * tokens^2 / 2
  const linearCost = basePrice * tokens;
  const quadraticCost = (slope * tokens * tokens) / 2;
  return linearCost + quadraticCost;
}

function getTokensForEth(basePrice: number, slope: number, currentTokens: number, ethAmount: number): number {
  // Quadratic formula solution
  const currentCost = getTotalCost(basePrice, slope, currentTokens);
  const targetCost = currentCost + ethAmount;

  // n = (-basePrice + sqrt(basePrice^2 + 2 * slope * targetCost)) / slope
  const discriminant = (basePrice * basePrice) + (2 * slope * targetCost);
  const sqrtDiscriminant = Math.sqrt(discriminant);
  const newTokens = (sqrtDiscriminant - basePrice) / slope;

  return newTokens - currentTokens;
}

function modelHeadless(label: string, params: HeadlessParams) {
  // Calculate tokens sold at graduation
  const tokensSold = getTokensForEth(params.basePrice, params.slope, 0, params.targetRaise);

  // Final price
  const finalPrice = params.basePrice + (params.slope * tokensSold);
  const initialPrice = params.basePrice;

  // FDV at graduation
  const fdvAtGraduation = finalPrice * params.totalSupply;

  // FDV:Liquidity ratio
  const fdvLiquidityRatio = fdvAtGraduation / params.targetRaise;

  console.log(`\n============ ${label} ============`);
  console.log(`Total Supply: ${(params.totalSupply / 1e6).toFixed(1)}M tokens`);
  console.log(`Tokens on Curve: ${(params.tokensOnCurve / 1e6).toFixed(0)}M (${(params.tokensOnCurve / params.totalSupply * 100).toFixed(0)}%)`);
  console.log(`\nBase Price: ${params.basePrice} ETH`);
  console.log(`Slope: ${params.slope} ETH/token`);
  console.log(`Target Raise: ${params.targetRaise} ETH (~$${(params.targetRaise * 2500).toLocaleString()} @ $2500/ETH)`);
  console.log(`\nTokens Sold at Graduation: ${tokensSold.toFixed(0)} (${(tokensSold / params.tokensOnCurve * 100).toFixed(1)}% of curve)`);
  console.log(`Final Price: ${finalPrice.toFixed(8)} ETH`);
  console.log(`Price Multiple: ${(finalPrice / initialPrice).toFixed(1)}x`);
  console.log(`\nFDV at Graduation: ${fdvAtGraduation.toFixed(1)} ETH (~$${(fdvAtGraduation * 2500 / 1000).toFixed(0)}K)`);
  console.log(`Liquidity Raised: ${params.targetRaise} ETH`);
  console.log(`FDV:Liquidity Ratio: ${fdvLiquidityRatio.toFixed(1)}x`);

  return { fdvLiquidityRatio, finalPrice, tokensSold, fdvAtGraduation, params };
}

// ============ RUN MODELS ============

console.log("\n" + "=".repeat(60));
console.log("BONDING CURVE ECONOMICS COMPARISON");
console.log("=".repeat(60));

// pump.fun
const pumpfun = modelPumpFun();

// Current Headless (47x)
const currentHeadless = modelHeadless("HEADLESS MARKETS - CURRENT (47x)", {
  totalSupply: 1_000_000,
  tokensOnCurve: 600_000,
  basePrice: 0.0001,
  slope: 0.00000001,
  targetRaise: 10,
});

// Adjusted for 20x (similar to pump.fun direction)
const headless20x = modelHeadless("HEADLESS MARKETS - ADJUSTED (20x)", {
  totalSupply: 1_000_000,
  tokensOnCurve: 600_000,
  basePrice: 0.0001,
  slope: 0.000000002,  // 5x lower slope
  targetRaise: 10,
});

// Adjusted for 25x
const headless25x = modelHeadless("HEADLESS MARKETS - ADJUSTED (25x)", {
  totalSupply: 1_000_000,
  tokensOnCurve: 600_000,
  basePrice: 0.0001,
  slope: 0.0000000025,  // 4x lower slope
  targetRaise: 10,
});

// Matching pump.fun's ~6x ratio
const headlessPumpMatch = modelHeadless("HEADLESS MARKETS - PUMP.FUN MATCH (~6x)", {
  totalSupply: 1_000_000,
  tokensOnCurve: 600_000,
  basePrice: 0.0001,
  slope: 0.0000000005,  // 20x lower slope
  targetRaise: 10,
});

// ============ SUMMARY TABLE ============

console.log("\n" + "=".repeat(60));
console.log("SUMMARY COMPARISON");
console.log("=".repeat(60));
console.log("\n| Model | FDV:Liquidity | Tokens Sold | Price Multiple | FDV |");
console.log("|-------|---------------|-------------|----------------|-----|");
console.log(`| pump.fun | ${pumpfun.fdvLiquidityRatio.toFixed(1)}x | ${(pumpfun.tokensBought / 1e6).toFixed(0)}M | ${(pumpfun.fdvAtGraduation / pumpfun.fdvLiquidityRatio / 30 * pumpfun.fdvAtGraduation / pumpfun.tokensBought).toFixed(1)}x | ${pumpfun.fdvAtGraduation.toFixed(0)} SOL |`);
console.log(`| Headless (current) | ${currentHeadless.fdvLiquidityRatio.toFixed(1)}x | ${currentHeadless.tokensSold.toFixed(0)} | ${(currentHeadless.finalPrice / currentHeadless.params.basePrice).toFixed(1)}x | ${currentHeadless.fdvAtGraduation.toFixed(0)} ETH |`);
console.log(`| Headless (20x) | ${headless20x.fdvLiquidityRatio.toFixed(1)}x | ${headless20x.tokensSold.toFixed(0)} | ${(headless20x.finalPrice / headless20x.params.basePrice).toFixed(1)}x | ${headless20x.fdvAtGraduation.toFixed(0)} ETH |`);
console.log(`| Headless (25x) | ${headless25x.fdvLiquidityRatio.toFixed(1)}x | ${headless25x.tokensSold.toFixed(0)} | ${(headless25x.finalPrice / headless25x.params.basePrice).toFixed(1)}x | ${headless25x.fdvAtGraduation.toFixed(0)} ETH |`);
console.log(`| Headless (pump match) | ${headlessPumpMatch.fdvLiquidityRatio.toFixed(1)}x | ${headlessPumpMatch.tokensSold.toFixed(0)} | ${(headlessPumpMatch.finalPrice / headlessPumpMatch.params.basePrice).toFixed(1)}x | ${headlessPumpMatch.fdvAtGraduation.toFixed(0)} ETH |`);

// ============ RECOMMENDATIONS ============

console.log("\n" + "=".repeat(60));
console.log("RECOMMENDATIONS");
console.log("=".repeat(60));
console.log(`
OPTION A: Match pump.fun (~6x FDV:Liquidity)
  slope = 0.0000000005 ETH
  Result: More conservative, healthier post-graduation trading
  Tokens sold: ~${headlessPumpMatch.tokensSold.toFixed(0)} (${(headlessPumpMatch.tokensSold / 600000 * 100).toFixed(0)}% of curve)

OPTION B: Middle ground (20-25x FDV:Liquidity)
  slope = 0.000000002 - 0.0000000025 ETH
  Result: Balance between excitement and sustainability
  Tokens sold: ~${headless20x.tokensSold.toFixed(0)}-${headless25x.tokensSold.toFixed(0)} (${(headless20x.tokensSold / 600000 * 100).toFixed(0)}-${(headless25x.tokensSold / 600000 * 100).toFixed(0)}% of curve)

OPTION C: Keep current (47x FDV:Liquidity)
  slope = 0.00000001 ETH
  Result: High excitement, but potential for harsh corrections
  Tokens sold: ~${currentHeadless.tokensSold.toFixed(0)} (${(currentHeadless.tokensSold / 600000 * 100).toFixed(0)}% of curve)

KEY INSIGHT:
pump.fun uses CPMM (constant product) which naturally limits FDV
We use linear curve which compounds price faster

JUSTIFICATION FOR DIFFERENCE:
1. Agent markets are HIGHER CONVICTION - agents form quorums deliberately
2. Our 30% quorum allocation creates stronger holder base
3. 10 ETH graduation vs 85 SOL means smaller initial markets
4. Linear curve is simpler for agents to understand and predict
`);
