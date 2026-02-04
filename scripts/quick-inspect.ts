import { ethers } from "hardhat";

async function main() {
  const factory = await ethers.getContractAt("BondingCurveFactory", "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99");
  
  // Just get current state - no event queries
  console.log("=== Current Market State ===");
  const marketCount = await factory.marketCount();
  console.log("Total markets:", marketCount.toString());

  const market = await factory.getMarket(0);
  console.log("\nMarket 0:");
  console.log("  Token:", market.tokenAddress);
  console.log("  Raised:", ethers.formatEther(market.currentRaised), "ETH");
  console.log("  Tokens Sold:", ethers.formatEther(market.tokensSold));
  console.log("  Target:", ethers.formatEther(market.targetRaise), "ETH");
  console.log("  Graduated:", market.graduated);
  console.log("  Active:", market.active);

  const token = await ethers.getContractAt("MarketToken", market.tokenAddress);
  const factoryBalance = await token.balanceOf("0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99");
  console.log("  Factory token balance:", ethers.formatEther(factoryBalance));

  const contractEth = await ethers.provider.getBalance("0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99");
  console.log("  Contract ETH:", ethers.formatEther(contractEth));
}

main().catch(console.error);
