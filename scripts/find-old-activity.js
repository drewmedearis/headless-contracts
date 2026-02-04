const { ethers } = require("hardhat");

async function main() {
  console.log("=== Finding OLD Factory Activity ===\n");

  const OLD_FACTORY = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";
  const provider = ethers.provider;

  const currentBlock = await provider.getBlockNumber();
  console.log("Current block:", currentBlock);

  // Old factory has 0.15 ETH - let's find when it was deployed and activity
  // Scan backwards in larger chunks
  const chunkSize = 5000;
  let eventsFound = [];
  let scannedBlocks = 0;

  console.log("Scanning for events on OLD factory...\n");

  for (let end = currentBlock; end > currentBlock - 200000 && eventsFound.length === 0; end -= chunkSize) {
    const start = Math.max(end - chunkSize + 1, 0);
    scannedBlocks += (end - start);

    try {
      const logs = await provider.getLogs({
        address: OLD_FACTORY,
        fromBlock: start,
        toBlock: end
      });

      if (logs.length > 0) {
        console.log(`Found ${logs.length} events in blocks ${start}-${end}`);
        eventsFound = eventsFound.concat(logs);
      }
    } catch (e) {
      // Skip on error
    }

    if (scannedBlocks % 20000 === 0) {
      console.log(`Scanned ${scannedBlocks} blocks...`);
    }
  }

  console.log("\nTotal events found:", eventsFound.length);

  if (eventsFound.length > 0) {
    // Sort by block number
    eventsFound.sort((a, b) => a.blockNumber - b.blockNumber);

    console.log("\n=== Event Timeline ===");

    for (const log of eventsFound.slice(0, 20)) { // First 20
      try {
        const block = await provider.getBlock(log.blockNumber);
        const tx = await provider.getTransaction(log.transactionHash);

        console.log("\nBlock:", log.blockNumber);
        console.log("  Time:", new Date(block.timestamp * 1000).toISOString());
        console.log("  TX:", log.transactionHash);
        console.log("  From:", tx.from);
        console.log("  Value:", ethers.formatEther(tx.value), "ETH");
        console.log("  Event sig:", log.topics[0].slice(0, 10));
      } catch (e) {
        console.log("  Error reading tx details");
      }
    }

    if (eventsFound.length > 20) {
      console.log(`\n... and ${eventsFound.length - 20} more events`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
