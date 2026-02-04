import { ethers } from "hardhat";

async function main() {
  const factoryAddress = "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99";
  
  console.log("=== Creating Test Market on Base Sepolia ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const factory = await ethers.getContractAt("BondingCurveFactory", factoryAddress);

  // Use deployer address for all 3 quorum agents (for testing)
  // In production, these would be different agent addresses
  const agents = [
    deployer.address,
    "0x1111111111111111111111111111111111111111", // Placeholder agent 2
    "0x2222222222222222222222222222222222222222", // Placeholder agent 3
  ];
  const weights = [34, 33, 33];

  console.log("Creating market with:");
  console.log("  Agents:", agents);
  console.log("  Weights:", weights);
  console.log("  Name: Headless Test Token");
  console.log("  Symbol: HTEST");
  console.log("  Thesis: First test market for Headless Markets Protocol\n");

  const tx = await factory.createMarket(
    agents,
    weights,
    "Headless Test Token",
    "HTEST",
    "First test market for Headless Markets Protocol - validating bonding curve mechanics"
  );

  console.log("Transaction sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("Transaction confirmed in block:", receipt?.blockNumber);

  // Get market details
  const marketCount = await factory.marketCount();
  const marketId = Number(marketCount) - 1;
  console.log("\nMarket ID:", marketId);

  const market = await factory.getMarket(marketId);
  console.log("\n=== Market Details ===");
  console.log("Token Address:", market.tokenAddress);
  console.log("Target Raise:", ethers.formatEther(market.targetRaise), "ETH");
  console.log("Current Raised:", ethers.formatEther(market.currentRaised), "ETH");
  console.log("Tokens Sold:", ethers.formatEther(market.tokensSold));
  console.log("Base Price:", ethers.formatEther(market.basePrice), "ETH");
  console.log("Graduated:", market.graduated);
  console.log("Active:", market.active);

  // Get current price
  const currentPrice = await factory.getCurrentPrice(marketId);
  console.log("Current Price:", ethers.formatEther(currentPrice), "ETH per token");

  // Test a small buy
  console.log("\n=== Testing Buy Function ===");
  const buyAmount = ethers.parseEther("0.01"); // 0.01 ETH
  const expectedTokens = await factory.calculatePurchaseReturn(marketId, buyAmount);
  console.log("Buy amount:", ethers.formatEther(buyAmount), "ETH");
  console.log("Expected tokens:", ethers.formatEther(expectedTokens));

  // 5% slippage
  const minTokensOut = expectedTokens * 95n / 100n;
  console.log("Min tokens (5% slippage):", ethers.formatEther(minTokensOut));

  const buyTx = await factory.buy(marketId, minTokensOut, { value: buyAmount });
  console.log("Buy TX:", buyTx.hash);
  await buyTx.wait();
  console.log("Buy confirmed!");

  // Check updated market
  const marketAfter = await factory.getMarket(marketId);
  console.log("\n=== Market After Buy ===");
  console.log("Current Raised:", ethers.formatEther(marketAfter.currentRaised), "ETH");
  console.log("Tokens Sold:", ethers.formatEther(marketAfter.tokensSold));

  // Check token balance
  const token = await ethers.getContractAt("MarketToken", market.tokenAddress);
  const balance = await token.balanceOf(deployer.address);
  console.log("Deployer token balance:", ethers.formatEther(balance));

  // Get new price
  const newPrice = await factory.getCurrentPrice(marketId);
  console.log("New Price:", ethers.formatEther(newPrice), "ETH per token");

  console.log("\n=== Test Complete ===");
  console.log("Market ID:", marketId);
  console.log("Token:", market.tokenAddress);
  console.log("View on Basescan: https://sepolia.basescan.org/address/" + market.tokenAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
