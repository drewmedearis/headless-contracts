import { ethers } from "hardhat";

async function main() {
  const factory = await ethers.getContractAt('BondingCurveFactory', '0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1');
  console.log('Buying PINCH tokens (Market 5)...');
  const tx = await factory.buy(5, 0, { value: ethers.parseEther('0.02') });
  await tx.wait();
  console.log('Done!');

  const market = await factory.getMarket(5);
  console.log('Raised:', ethers.formatEther(market[4]), 'ETH');
  console.log('Tokens Sold:', ethers.formatEther(market[5]));
}

main().catch(console.error);
