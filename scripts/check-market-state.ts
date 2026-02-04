import { ethers } from "hardhat";

async function main() {
  const factoryAddress = "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99";
  const tokenAddress = "0x0f44161F1248E1DCd29A1A49cB8c99772b27a603";
  
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("BondingCurveFactory", factoryAddress);
  const token = await ethers.getContractAt("MarketToken", tokenAddress);

  console.log("=== Current State ===");
  
  const market = await factory.getMarket(0);
  console.log("Current Raised:", ethers.formatEther(market.currentRaised), "ETH");
  console.log("Tokens Sold:", ethers.formatEther(market.tokensSold));
  
  const deployerBalance = await token.balanceOf(deployer.address);
  console.log("Deployer tokens:", ethers.formatEther(deployerBalance));
  
  const factoryBalance = await token.balanceOf(factoryAddress);
  console.log("Factory tokens (curve):", ethers.formatEther(factoryBalance));
  
  const treasuryBalance = await token.balanceOf(deployer.address); // Treasury is deployer
  
  // Check contract ETH balance
  const contractEth = await ethers.provider.getBalance(factoryAddress);
  console.log("Factory ETH balance:", ethers.formatEther(contractEth));
  
  // Now do a fresh buy
  console.log("\n=== Fresh Buy Test ===");
  const buyAmount = ethers.parseEther("0.05");
  const expectedTokens = await factory.calculatePurchaseReturn(0, buyAmount);
  console.log("Buying with:", ethers.formatEther(buyAmount), "ETH");
  console.log("Expected tokens:", ethers.formatEther(expectedTokens));
  
  const minTokens = expectedTokens * 90n / 100n; // 10% slippage for safety
  const tx = await factory.buy(0, minTokens, { value: buyAmount });
  console.log("TX hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Gas used:", receipt?.gasUsed.toString());
  
  // Check events
  console.log("\n=== Events ===");
  const events = receipt?.logs || [];
  for (const log of events) {
    try {
      const parsed = factory.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed) {
        console.log("Event:", parsed.name);
        if (parsed.name === "TokensPurchased") {
          console.log("  Market ID:", parsed.args.marketId.toString());
          console.log("  Buyer:", parsed.args.buyer);
          console.log("  ETH Amount:", ethers.formatEther(parsed.args.ethAmount));
          console.log("  Token Amount:", ethers.formatEther(parsed.args.tokenAmount));
        }
        if (parsed.name === "ProtocolFeeCollected") {
          console.log("  Fee:", ethers.formatEther(parsed.args.feeAmount), "ETH");
        }
      }
    } catch (e) {
      // Ignore unparseable logs
    }
  }
  
  // Final state
  console.log("\n=== Final State ===");
  const marketAfter = await factory.getMarket(0);
  console.log("Current Raised:", ethers.formatEther(marketAfter.currentRaised), "ETH");
  console.log("Tokens Sold:", ethers.formatEther(marketAfter.tokensSold));
  
  const newBalance = await token.balanceOf(deployer.address);
  console.log("Deployer tokens:", ethers.formatEther(newBalance));
  
  const finalContractEth = await ethers.provider.getBalance(factoryAddress);
  console.log("Factory ETH balance:", ethers.formatEther(finalContractEth));
  
  console.log("\n=== SUCCESS ===");
  console.log("Token: https://sepolia.basescan.org/token/" + tokenAddress);
  console.log("Buy TX: https://sepolia.basescan.org/tx/" + tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
