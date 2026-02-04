import { ethers } from "hardhat";

async function main() {
  const factoryAddress = "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99";
  const governanceAddress = "0xcEB9e3257a5105FC1ea42013860aC43f5460a79e";

  console.log("Linking QuorumGovernance to BondingCurveFactory...");

  const factory = await ethers.getContractAt("BondingCurveFactory", factoryAddress);

  const tx = await factory.setGovernance(governanceAddress);
  await tx.wait();

  console.log("Governance linked successfully!");
  console.log(`Factory: ${factoryAddress}`);
  console.log(`Governance: ${governanceAddress}`);

  // Verify the link
  const linkedGovernance = await factory.governance();
  console.log(`Verified governance address: ${linkedGovernance}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
