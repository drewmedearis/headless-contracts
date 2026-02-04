import { ethers } from "hardhat";

async function main() {
  const factoryAddress = "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99";
  
  console.log("=== Verifying Test Market on Base Sepolia ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const factory = await ethers.getContractAt("BondingCurveFactory", factoryAddress);

  // Get market count
  const marketCount = await factory.marketCount();
  console.log("Total markets:", marketCount.toString());

  if (marketCount === 0n) {
    console.log("No markets created yet");
    return;
  }

  // Get market 0
  const marketId = 0;
  const market = await factory.getMarket(marketId);
  
  console.log("\n=== Market 0 Details ===");
  console.log("Token Address:", market.tokenAddress);
  console.log("LP Pair:", market.lpPair);
  console.log("Target Raise:", ethers.formatEther(market.targetRaise), "ETH");
  console.log("Current Raised:", ethers.formatEther(market.currentRaised), "ETH");
  console.log("Tokens Sold:", ethers.formatEther(market.tokensSold));
  console.log("Graduated:", market.graduated);
  console.log("Active:", market.active);
  console.log("Thesis:", market.thesis);

  // Get current price
  const currentPrice = await factory.getCurrentPrice(marketId);
  console.log("Current Price:", ethers.formatEther(currentPrice), "ETH per token");

  // Check token details
  const token = await ethers.getContractAt("MarketToken", market.tokenAddress);
  const name = await token.name();
  const symbol = await token.symbol();
  const totalSupply = await token.totalSupply();
  
  console.log("\n=== Token Details ===");
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Total Supply:", ethers.formatEther(totalSupply));

  // Check deployer token balance
  const deployerBalance = await token.balanceOf(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(deployerBalance));

  // Test buy if deployer has ETH
  const deployerEth = await ethers.provider.getBalance(deployer.address);
  console.log("\nDeployer ETH:", ethers.formatEther(deployerEth));

  if (deployerEth > ethers.parseEther("0.02")) {
    console.log("\n=== Testing Buy Function ===");
    const buyAmount = ethers.parseEther("0.01");
    const expectedTokens = await factory.calculatePurchaseReturn(marketId, buyAmount);
    console.log("Buy amount:", ethers.formatEther(buyAmount), "ETH");
    console.log("Expected tokens:", ethers.formatEther(expectedTokens));

    const minTokensOut = expectedTokens * 95n / 100n;
    
    const buyTx = await factory.buy(marketId, minTokensOut, { value: buyAmount });
    console.log("Buy TX:", buyTx.hash);
    await buyTx.wait();
    console.log("Buy confirmed!");

    // Check new balance
    const newBalance = await token.balanceOf(deployer.address);
    console.log("New token balance:", ethers.formatEther(newBalance));

    // Check market state
    const marketAfter = await factory.getMarket(marketId);
    console.log("Current Raised:", ethers.formatEther(marketAfter.currentRaised), "ETH");
  }

  console.log("\n=== Links ===");
  console.log("Token on Basescan:", `https://sepolia.basescan.org/token/${market.tokenAddress}`);
  console.log("Factory on Basescan:", `https://sepolia.basescan.org/address/${factoryAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
