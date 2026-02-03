import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Estimate deployment costs
  console.log("\nEstimated deployment costs on Base Mainnet:");
  console.log("- BondingCurveFactory: ~0.002-0.005 ETH");
  console.log("- QuorumGovernance: ~0.001-0.003 ETH");
  console.log("- Total estimated: ~0.003-0.008 ETH");

  const minRequired = ethers.parseEther("0.01");
  if (balance < minRequired) {
    console.log("\n⚠️  WARNING: Insufficient balance for deployment!");
    console.log(`Please fund ${deployer.address} with at least 0.01 ETH`);
  } else {
    console.log("\n✅ Sufficient balance for deployment");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
