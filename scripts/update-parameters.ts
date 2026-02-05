import { ethers } from "hardhat";

async function main() {
  const factoryAddress = "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99";

  console.log("=== Updating Bonding Curve Parameters ===\n");

  const factory = await ethers.getContractAt("BondingCurveFactory", factoryAddress);

  // Current parameters
  const currentBasePrice = await factory.defaultBasePrice();
  const currentSlope = await factory.defaultSlope();
  const currentTargetRaise = await factory.defaultTargetRaise();

  console.log("Current Parameters:");
  console.log("  Base Price:", ethers.formatEther(currentBasePrice), "ETH");
  console.log("  Slope:", ethers.formatEther(currentSlope), "ETH");
  console.log("  Target Raise:", ethers.formatEther(currentTargetRaise), "ETH");

  // New parameters for 22x FDV:Liquidity ratio
  const newBasePrice = ethers.parseEther("0.0001");
  const newSlope = ethers.parseEther("0.000000002");  // 5x lower for better economics
  const newTargetRaise = ethers.parseEther("10");

  console.log("\nNew Parameters:");
  console.log("  Base Price:", ethers.formatEther(newBasePrice), "ETH");
  console.log("  Slope:", ethers.formatEther(newSlope), "ETH");
  console.log("  Target Raise:", ethers.formatEther(newTargetRaise), "ETH");

  // Check if update needed
  if (currentSlope.toString() === newSlope.toString()) {
    console.log("\n✓ Parameters already up to date!");
    return;
  }

  console.log("\nUpdating parameters...");

  const tx = await factory.setDefaultParameters(
    newBasePrice,
    newSlope,
    newTargetRaise
  );

  console.log("TX:", tx.hash);
  await tx.wait();

  console.log("\n✓ Parameters updated successfully!");

  // Verify
  const verifySlope = await factory.defaultSlope();
  console.log("\nVerified new slope:", ethers.formatEther(verifySlope), "ETH");
}

main().catch(console.error);
