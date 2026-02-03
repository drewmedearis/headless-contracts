import { ethers } from "hardhat";

const FACTORY_ADDRESS = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";

async function main() {
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("BondingCurveFactory", FACTORY_ADDRESS);

  console.log("Deployer:", deployer.address);
  console.log("");

  // Create Pincer Protocol
  console.log("Creating Pincer Protocol ($PINCH)...");
  const agents = [deployer.address, deployer.address, deployer.address];
  const weights = [34, 33, 33];

  try {
    const tx = await factory.createMarket(
      agents,
      weights,
      "Pincer Protocol",
      "PINCH",
      "Multi-agent market intelligence syndicate. Real-time signal generation, sentiment analysis, and coordinated trading strategies."
    );
    console.log("  TX:", tx.hash);
    await tx.wait();
    console.log("  Created!");
  } catch (e: any) {
    console.log("  Already exists or error:", e.message.slice(0, 100));
  }

  // Now buy tokens for all crab markets to show activity
  const count = await factory.marketCount();
  console.log(`\nTotal markets: ${count}`);

  for (let i = 3; i < count; i++) {
    const market = await factory.getMarket(i);
    const token = await ethers.getContractAt("IERC20Metadata", market[0]);
    const symbol = await token.symbol();

    if (symbol === "BTT") continue; // Skip battle test tokens

    const raised = parseFloat(ethers.formatEther(market[4]));
    console.log(`\nMarket ${i}: $${symbol} - Raised: ${raised} ETH`);

    if (raised < 0.01) {
      console.log("  Buying tokens...");
      try {
        const buyAmount = ethers.parseEther("0.015");
        const buyTx = await factory.buy(i, 0, { value: buyAmount });
        await buyTx.wait();
        console.log("  Bought for 0.015 ETH");
      } catch (e: any) {
        console.log("  Buy error:", e.message.slice(0, 50));
      }
    }
  }

  // Final summary
  console.log("\n" + "=".repeat(60));
  console.log("FINAL MARKET SUMMARY");
  console.log("=".repeat(60));

  const finalCount = await factory.marketCount();
  const crabMarkets = [];

  for (let i = 0; i < finalCount; i++) {
    const market = await factory.getMarket(i);
    const token = await ethers.getContractAt("IERC20Metadata", market[0]);
    const name = await token.name();
    const symbol = await token.symbol();

    if (symbol !== "BTT") {
      const raised = ethers.formatEther(market[4]);
      const tokensSold = ethers.formatEther(market[5]);
      crabMarkets.push({
        id: i,
        name,
        symbol,
        token: market[0],
        raised,
        tokensSold,
        active: market[7],
      });

      console.log(`\n$${symbol} - ${name}`);
      console.log(`  Market ID: ${i}`);
      console.log(`  Token: ${market[0]}`);
      console.log(`  Raised: ${raised} ETH`);
      console.log(`  Tokens Sold: ${tokensSold}`);
    }
  }

  // Output JSON for frontend
  console.log("\n\nFRONTEND DATA (copy this):");
  console.log(JSON.stringify(crabMarkets, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(console.error);
