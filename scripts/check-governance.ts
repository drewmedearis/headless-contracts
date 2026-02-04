import { ethers } from "hardhat";

async function main() {
  const factoryAddress = "0x6064bB1536aff5A7F12CCDB47F297d1BA9967b99";
  const factory = await ethers.getContractAt("BondingCurveFactory", factoryAddress);
  
  const governance = await factory.governance();
  const treasury = await factory.protocolTreasury();
  const owner = await factory.owner();
  const feeBps = await factory.protocolFeeBps();
  
  console.log("=== BondingCurveFactory Status ===");
  console.log(`Owner: ${owner}`);
  console.log(`Treasury: ${treasury}`);
  console.log(`Governance: ${governance}`);
  console.log(`Fee (bps): ${feeBps}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
