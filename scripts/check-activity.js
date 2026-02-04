const { ethers } = require("hardhat");

async function main() {
  console.log("=== Base Sepolia Contract Activity (Last 10 Hours) ===\n");

  const OLD_FACTORY = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";
  const NEW_FACTORY = "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99";
  const TREASURY = "0x79071295C5B70b6a2e84D2c2c1de6e529c23bc89";

  const provider = ethers.provider;

  // Get balances
  console.log("=== ETH Balances ===");
  const oldBal = await provider.getBalance(OLD_FACTORY);
  const newBal = await provider.getBalance(NEW_FACTORY);
  const treasuryBal = await provider.getBalance(TREASURY);

  console.log("Old Factory:", ethers.formatEther(oldBal), "ETH");
  console.log("New Factory:", ethers.formatEther(newBal), "ETH");
  console.log("Treasury:", ethers.formatEther(treasuryBal), "ETH");

  // Check new factory state
  console.log("\n=== New Factory (Current) ===");
  const newFactory = await ethers.getContractAt("BondingCurveFactory", NEW_FACTORY);
  const newMarketCount = await newFactory.marketCount();
  console.log("Markets:", newMarketCount.toString());

  if (newMarketCount > 0) {
    const market = await newFactory.getMarket(0);
    console.log("Market 0 raised:", ethers.formatEther(market.currentRaised), "ETH");
  }

  // Get recent blocks
  const currentBlock = await provider.getBlockNumber();
  const blocksIn10Hours = 18000; // ~10 hours at 2s/block
  const fromBlock = currentBlock - blocksIn10Hours;

  console.log("\n=== Scanning Events ===");
  console.log("From block:", fromBlock);
  console.log("To block:", currentBlock);

  // Scan in chunks to avoid RPC limits
  const chunkSize = 2000;
  let allLogs = [];

  for (let start = fromBlock; start < currentBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, currentBlock);
    try {
      // Check OLD factory
      const oldLogs = await provider.getLogs({
        address: OLD_FACTORY,
        fromBlock: start,
        toBlock: end
      });

      // Check NEW factory
      const newLogs = await provider.getLogs({
        address: NEW_FACTORY,
        fromBlock: start,
        toBlock: end
      });

      allLogs = allLogs.concat(oldLogs, newLogs);

      if (oldLogs.length > 0 || newLogs.length > 0) {
        console.log(`Blocks ${start}-${end}: ${oldLogs.length} old, ${newLogs.length} new events`);
      }
    } catch (e) {
      console.log(`Blocks ${start}-${end}: RPC error, skipping`);
    }
  }

  console.log("\nTotal events found:", allLogs.length);

  // Process events
  if (allLogs.length > 0) {
    console.log("\n=== Event Details ===");

    for (const log of allLogs) {
      const block = await provider.getBlock(log.blockNumber);
      const tx = await provider.getTransaction(log.transactionHash);

      console.log("\nTX:", log.transactionHash);
      console.log("  Contract:", log.address);
      console.log("  Block:", log.blockNumber);
      console.log("  Time:", new Date(block.timestamp * 1000).toISOString());
      console.log("  From:", tx.from);
      console.log("  Value:", ethers.formatEther(tx.value), "ETH");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
