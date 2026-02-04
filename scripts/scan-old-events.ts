import { ethers } from "hardhat";

async function main() {
  const oldFactoryAddress = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";
  
  console.log("=== Scanning ALL Events from OLD Factory ===\n");
  console.log("Address:", oldFactoryAddress);

  const provider = ethers.provider;
  const currentBlock = await provider.getBlockNumber();
  console.log("Current block:", currentBlock);

  // Get ETH balance
  const ethBalance = await provider.getBalance(oldFactoryAddress);
  console.log("Contract ETH:", ethers.formatEther(ethBalance), "ETH\n");

  // Get ALL logs from this address (no topic filter)
  console.log("Fetching all logs...");
  
  try {
    const logs = await provider.getLogs({
      address: oldFactoryAddress,
      fromBlock: currentBlock - 100000,
      toBlock: currentBlock
    });

    console.log("Total events found:", logs.length);

    // Group by transaction
    const txMap = new Map<string, any[]>();
    for (const log of logs) {
      if (!txMap.has(log.transactionHash)) {
        txMap.set(log.transactionHash, []);
      }
      txMap.get(log.transactionHash)!.push(log);
    }

    console.log("Unique transactions:", txMap.size);
    console.log("\n=== Transaction Details ===");

    for (const [txHash, txLogs] of txMap) {
      const tx = await provider.getTransaction(txHash);
      const receipt = await provider.getTransactionReceipt(txHash);
      const block = await provider.getBlock(txLogs[0].blockNumber);
      
      console.log("\nTX:", txHash);
      console.log("  Block:", txLogs[0].blockNumber);
      console.log("  Time:", new Date((block?.timestamp || 0) * 1000).toISOString());
      console.log("  From:", tx?.from);
      console.log("  Value:", tx?.value ? ethers.formatEther(tx.value) : "0", "ETH");
      console.log("  Gas Used:", receipt?.gasUsed.toString());
      console.log("  Events:", txLogs.length);
      
      // Show first topic of each event (function signature)
      for (const log of txLogs) {
        console.log("    Event sig:", log.topics[0]?.slice(0, 10));
      }
    }
  } catch (e: any) {
    console.log("Error fetching logs:", e.message);
    
    // Try smaller range
    console.log("\nTrying smaller range...");
    const logs = await provider.getLogs({
      address: oldFactoryAddress,
      fromBlock: currentBlock - 10000,
      toBlock: currentBlock
    });
    console.log("Events in last 10000 blocks:", logs.length);
  }
}

main().catch(console.error);
