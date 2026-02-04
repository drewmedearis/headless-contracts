import { ethers } from "hardhat";

async function main() {
  const oldFactoryAddress = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";
  
  console.log("=== OLD Factory Activity ===\n");

  // Use raw calls since ABI might differ
  const provider = ethers.provider;

  // Market count
  const countData = await provider.call({
    to: oldFactoryAddress,
    data: "0x1933fcbd" // marketCount()
  });
  const marketCount = parseInt(countData, 16);
  console.log("Total markets:", marketCount);

  // Get contract ETH balance  
  const ethBalance = await provider.getBalance(oldFactoryAddress);
  console.log("Contract ETH:", ethers.formatEther(ethBalance));

  // Try to get events using low-level filter
  console.log("\n=== Searching for Purchase Events ===");
  
  // TokensPurchased event signature
  const purchaseEventSig = ethers.id("TokensPurchased(uint256,address,uint256,uint256,uint256)");
  
  const currentBlock = await provider.getBlockNumber();
  const logs = await provider.getLogs({
    address: oldFactoryAddress,
    topics: [purchaseEventSig],
    fromBlock: currentBlock - 50000,
    toBlock: currentBlock
  });

  console.log("Purchase events found:", logs.length);

  for (const log of logs) {
    const block = await provider.getBlock(log.blockNumber);
    console.log("\nBlock:", log.blockNumber);
    console.log("  Time:", new Date((block?.timestamp || 0) * 1000).toISOString());
    console.log("  TX:", log.transactionHash);
    
    // Decode the data
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ["uint256", "uint256", "uint256"],
      log.data
    );
    console.log("  ETH Amount:", ethers.formatEther(decoded[0]));
    console.log("  Token Amount:", ethers.formatEther(decoded[1]));
    
    // Get buyer from topics
    if (log.topics[2]) {
      const buyer = "0x" + log.topics[2].slice(26);
      console.log("  Buyer:", buyer);
    }
  }

  // Also check TokensSold events
  console.log("\n=== Searching for Sell Events ===");
  const sellEventSig = ethers.id("TokensSold(uint256,address,uint256,uint256)");
  
  const sellLogs = await provider.getLogs({
    address: oldFactoryAddress,
    topics: [sellEventSig],
    fromBlock: currentBlock - 50000,
    toBlock: currentBlock
  });

  console.log("Sell events found:", sellLogs.length);

  for (const log of sellLogs) {
    const block = await provider.getBlock(log.blockNumber);
    console.log("\nBlock:", log.blockNumber);
    console.log("  Time:", new Date((block?.timestamp || 0) * 1000).toISOString());
    console.log("  TX:", log.transactionHash);
  }

  // Check MarketCreated events
  console.log("\n=== Market Created Events ===");
  const createEventSig = ethers.id("MarketCreated(uint256,address,address[],string)");
  
  const createLogs = await provider.getLogs({
    address: oldFactoryAddress,
    topics: [createEventSig],
    fromBlock: 0,
    toBlock: currentBlock
  });

  console.log("MarketCreated events:", createLogs.length);
  
  for (const log of createLogs) {
    const block = await provider.getBlock(log.blockNumber);
    console.log("\nBlock:", log.blockNumber);
    console.log("  Time:", new Date((block?.timestamp || 0) * 1000).toISOString());
    console.log("  TX:", log.transactionHash);
    
    // Market ID from topics
    if (log.topics[1]) {
      console.log("  Market ID:", parseInt(log.topics[1], 16));
    }
    // Token address from topics
    if (log.topics[2]) {
      const tokenAddr = "0x" + log.topics[2].slice(26);
      console.log("  Token:", tokenAddr);
    }
  }
}

main().catch(console.error);
