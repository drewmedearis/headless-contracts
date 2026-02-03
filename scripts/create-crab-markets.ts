import { ethers } from "hardhat";

/**
 * Create crab-themed test markets for Headless Markets Protocol
 * Aligned with OpenClaw culture
 */

const FACTORY_ADDRESS = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";

const CRAB_MARKETS = [
  {
    name: "CrabDAO Collective",
    symbol: "CLAW",
    thesis: "Autonomous art collective creating generative visual and audio experiences. Agents collaborate on multimedia NFT drops and immersive installations.",
  },
  {
    name: "Pincer Protocol",
    symbol: "PINCH",
    thesis: "Multi-agent market intelligence syndicate. Real-time signal generation, sentiment analysis, and coordinated trading strategies.",
  },
  {
    name: "Shell Syndicate",
    symbol: "SHELL",
    thesis: "Agent-powered developer tools and deployment infrastructure. Code review, testing automation, and CI/CD orchestration.",
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Creating crab markets with:", deployer.address);

  const factory = await ethers.getContractAt("BondingCurveFactory", FACTORY_ADDRESS);

  for (const market of CRAB_MARKETS) {
    console.log(`\nCreating ${market.name} ($${market.symbol})...`);

    // Use deployer as all 3 quorum agents for testing
    const agents = [deployer.address, deployer.address, deployer.address];
    const weights = [34, 33, 33];

    try {
      const tx = await factory.createMarket(
        agents,
        weights,
        market.name,
        market.symbol,
        market.thesis
      );

      console.log(`  TX: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`  Gas used: ${receipt?.gasUsed}`);

      // Get the new market ID
      const marketCount = await factory.marketCount();
      const marketId = marketCount - 1n;
      const marketData = await factory.getMarket(marketId);

      console.log(`  Market ID: ${marketId}`);
      console.log(`  Token Address: ${marketData[0]}`);
      console.log(`  Basescan: https://sepolia.basescan.org/address/${marketData[0]}`);

      // Buy some tokens to show activity
      console.log(`  Buying tokens to show activity...`);
      const buyAmount = ethers.parseEther("0.01");
      const buyTx = await factory.buy(marketId, 0, { value: buyAmount });
      await buyTx.wait();
      console.log(`  Bought tokens for 0.01 ETH`);

    } catch (error: any) {
      console.log(`  ERROR: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("CRAB MARKETS CREATED");
  console.log("=".repeat(60));

  // List all markets
  const count = await factory.marketCount();
  console.log(`\nTotal Markets: ${count}\n`);

  for (let i = 0; i < count; i++) {
    const market = await factory.getMarket(i);
    const token = await ethers.getContractAt("IERC20Metadata", market[0]);
    const name = await token.name();
    const symbol = await token.symbol();
    const raised = ethers.formatEther(market[4]);

    console.log(`${i}: $${symbol} - ${name}`);
    console.log(`   Token: ${market[0]}`);
    console.log(`   Raised: ${raised} ETH`);
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
