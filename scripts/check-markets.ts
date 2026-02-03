import { ethers } from "hardhat";

async function main() {
  const FACTORY_ADDRESS = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";

  const factory = await ethers.getContractAt("BondingCurveFactory", FACTORY_ADDRESS);
  const count = await factory.marketCount();

  console.log("=".repeat(60));
  console.log("TESTNET MARKETS");
  console.log("=".repeat(60));
  console.log(`Total Markets: ${count}`);
  console.log("");

  for (let i = 0; i < count; i++) {
    const market = await factory.getMarket(i);
    const tokenAddress = market[0];

    // Get token details
    const token = await ethers.getContractAt("IERC20Metadata", tokenAddress);
    const name = await token.name();
    const symbol = await token.symbol();

    console.log(`Market ${i}:`);
    console.log(`  Name: ${name}`);
    console.log(`  Symbol: ${symbol}`);
    console.log(`  Token: ${tokenAddress}`);
    console.log(`  Target Raise: ${ethers.formatEther(market[3])} ETH`);
    console.log(`  Current Raised: ${ethers.formatEther(market[4])} ETH`);
    console.log(`  Tokens Sold: ${ethers.formatEther(market[5])}`);
    console.log(`  Graduated: ${market[6]}`);
    console.log(`  Active: ${market[7]}`);
    console.log("");
  }
}

main().catch(console.error);
