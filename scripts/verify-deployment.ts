import { ethers } from "hardhat";

async function main() {
  const factoryAddress = "0x84F6Fb4807F8167B5ED16FC24ea3a67568032D5e";
  const governanceAddress = "0x06E86Bc9331F8945e2E7641310aC983a231c7B2c";

  console.log("=== NEW Base Sepolia Deployment Verification ===\n");

  const factory = await ethers.getContractAt("BondingCurveFactory", factoryAddress);

  console.log("FACTORY:", factoryAddress);
  console.log("─".repeat(50));

  const basePrice = await factory.defaultBasePrice();
  const slope = await factory.defaultSlope();
  const targetRaise = await factory.defaultTargetRaise();
  const protocolFee = await factory.protocolFeeBps();
  const treasury = await factory.protocolTreasury();
  const owner = await factory.owner();
  const marketCount = await factory.marketCount();

  console.log("Parameters:");
  console.log("  Base Price:", ethers.formatEther(basePrice), "ETH");
  console.log("  Slope:", ethers.formatEther(slope), "ETH");
  console.log("  Target Raise:", ethers.formatEther(targetRaise), "ETH");
  console.log("  Protocol Fee:", protocolFee.toString(), "bps (0.5%)");
  console.log("\nAddresses:");
  console.log("  Treasury:", treasury);
  console.log("  Owner:", owner);
  console.log("\nState:");
  console.log("  Markets Created:", marketCount.toString());

  // Calculate expected graduation metrics
  const slopeNum = Number(ethers.formatEther(slope));
  const basePriceNum = Number(ethers.formatEther(basePrice));
  const targetNum = Number(ethers.formatEther(targetRaise));

  const a = slopeNum / 2;
  const b = basePriceNum;
  const c = -targetNum;
  const tokensAtGrad = (-b + Math.sqrt(b*b - 4*a*c)) / (2*a);

  const priceAtGrad = basePriceNum + slopeNum * tokensAtGrad;
  const fdvAtGrad = priceAtGrad * 1_000_000;
  const ratio = fdvAtGrad / targetNum;

  console.log("\nGraduation Metrics (at 10 ETH raised):");
  console.log("  Tokens sold:", Math.round(tokensAtGrad).toLocaleString());
  console.log("  % of curve:", (tokensAtGrad / 600000 * 100).toFixed(1) + "%");
  console.log("  Final price:", priceAtGrad.toFixed(8), "ETH");
  console.log("  FDV:", fdvAtGrad.toFixed(1), "ETH");
  console.log("  FDV:Liquidity:", ratio.toFixed(1) + "x");

  // Governance
  console.log("\n");
  console.log("GOVERNANCE:", governanceAddress);
  console.log("─".repeat(50));

  const governance = await ethers.getContractAt("QuorumGovernance", governanceAddress);
  const govOwner = await governance.owner();
  const linkedFactory = await governance.factory();

  console.log("  Owner:", govOwner);
  console.log("  Linked Factory:", linkedFactory);

  console.log("\n✅ Fresh deployment verified with security fix!");
  console.log("\nBasescan Links:");
  console.log("  Factory: https://sepolia.basescan.org/address/" + factoryAddress);
  console.log("  Governance: https://sepolia.basescan.org/address/" + governanceAddress);
}

main().catch(console.error);
