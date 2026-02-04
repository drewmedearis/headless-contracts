import { ethers } from "hardhat";

async function main() {
  // Old deployment addresses
  const oldFactoryAddress = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";
  
  console.log("=== Checking OLD Factory Deployment ===");
  console.log("Address:", oldFactoryAddress);

  try {
    const factory = await ethers.getContractAt("BondingCurveFactory", oldFactoryAddress);
    const marketCount = await factory.marketCount();
    console.log("Market count:", marketCount.toString());

    if (marketCount > 0n) {
      for (let i = 0; i < Number(marketCount); i++) {
        const market = await factory.getMarket(i);
        console.log("\nMarket", i);
        console.log("  Token:", market.tokenAddress);
        console.log("  Raised:", ethers.formatEther(market.currentRaised), "ETH");
        console.log("  Tokens Sold:", ethers.formatEther(market.tokensSold));
        console.log("  Graduated:", market.graduated);
        console.log("  Active:", market.active);
      }
    }
  } catch (e: any) {
    console.log("Error reading old factory:", e.message);
  }

  // Check contract ETH balance
  const oldBalance = await ethers.provider.getBalance(oldFactoryAddress);
  console.log("\nOld Factory ETH balance:", ethers.formatEther(oldBalance));
}

main().catch(console.error);
