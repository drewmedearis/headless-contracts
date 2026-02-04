import { ethers } from "hardhat";

async function main() {
  const factoryAddress = "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99";
  const tokenAddress = "0x0f44161F1248E1DCd29A1A49cB8c99772b27a603";

  console.log("=== Contract Activity Inspector ===\n");

  const factory = await ethers.getContractAt("BondingCurveFactory", factoryAddress);
  const token = await ethers.getContractAt("MarketToken", tokenAddress);

  const currentBlock = await ethers.provider.getBlockNumber();
  const fromBlock = currentBlock - 25000; // ~14 hours of blocks
  console.log("Scanning blocks", fromBlock, "to", currentBlock);

  // Get all purchase events
  console.log("\n=== TokensPurchased Events ===");
  const purchaseFilter = factory.filters.TokensPurchased();
  const purchases = await factory.queryFilter(purchaseFilter, fromBlock, currentBlock);
  console.log("Total purchases:", purchases.length);

  for (const event of purchases) {
    const block = await event.getBlock();
    const timestamp = new Date(block.timestamp * 1000).toISOString();
    console.log("\nTX:", event.transactionHash);
    console.log("  Time:", timestamp);
    console.log("  Buyer:", event.args[1]);
    console.log("  ETH:", ethers.formatEther(event.args[2]));
    console.log("  Tokens:", ethers.formatEther(event.args[3]));
  }

  // Get all sell events
  console.log("\n=== TokensSold Events ===");
  const sellFilter = factory.filters.TokensSold();
  const sells = await factory.queryFilter(sellFilter, fromBlock, currentBlock);
  console.log("Total sells:", sells.length);

  for (const event of sells) {
    const block = await event.getBlock();
    const timestamp = new Date(block.timestamp * 1000).toISOString();
    console.log("\nTX:", event.transactionHash);
    console.log("  Time:", timestamp);
    console.log("  Seller:", event.args[1]);
    console.log("  Tokens:", ethers.formatEther(event.args[2]));
    console.log("  ETH:", ethers.formatEther(event.args[3]));
  }

  // Get market created events
  console.log("\n=== MarketCreated Events ===");
  const createFilter = factory.filters.MarketCreated();
  const creates = await factory.queryFilter(createFilter, fromBlock, currentBlock);
  console.log("Total markets created:", creates.length);

  // Current state
  console.log("\n=== Current Market State ===");
  const marketCount = await factory.marketCount();
  console.log("Total markets:", marketCount.toString());

  for (let i = 0; i < Number(marketCount); i++) {
    const market = await factory.getMarket(i);
    console.log("\nMarket", i);
    console.log("  Token:", market[0]);
    console.log("  Raised:", ethers.formatEther(market[5]), "ETH");
    console.log("  Tokens Sold:", ethers.formatEther(market[6]));
    console.log("  Graduated:", market[9]);
    console.log("  Active:", market[10]);
  }

  // Unique buyers
  console.log("\n=== Unique Addresses ===");
  const buyers = new Set<string>();
  for (const event of purchases) {
    buyers.add(event.args[1]);
  }
  console.log("Unique buyers:", buyers.size);
  buyers.forEach(b => console.log("  ", b));
}

main().catch(console.error);
