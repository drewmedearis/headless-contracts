import { ethers } from "hardhat";

async function main() {
  const tokenAddress = "0x8cd27fb6b5269eae05e968658dca80df35b6bb07";

  console.log("=== Reading $HDLS Token Contract ===\n");
  console.log("Address:", tokenAddress);

  // Standard ERC20 ABI
  const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function owner() view returns (address)",
    "function allowance(address,address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
    "function transferFrom(address,address,uint256) returns (bool)",
    // Common extensions
    "function paused() view returns (bool)",
    "function maxWallet() view returns (uint256)",
    "function maxTransaction() view returns (uint256)",
    "function isFeeExempt(address) view returns (bool)",
    "function buyFee() view returns (uint256)",
    "function sellFee() view returns (uint256)",
  ];

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, ethers.provider);

  try {
    // Basic ERC20 info
    const name = await token.name();
    const symbol = await token.symbol();
    const decimals = await token.decimals();
    const totalSupply = await token.totalSupply();

    console.log("\n=== Basic Info ===");
    console.log("Name:", name);
    console.log("Symbol:", symbol);
    console.log("Decimals:", decimals);
    console.log("Total Supply:", ethers.formatUnits(totalSupply, decimals));

    // Try to get owner
    try {
      const owner = await token.owner();
      console.log("Owner:", owner);
    } catch (e) {
      console.log("Owner: (not accessible or no owner function)");
    }

    // Try to check if paused
    try {
      const paused = await token.paused();
      console.log("Paused:", paused);
    } catch (e) {
      // No pause function
    }

    // Try to get max wallet/tx limits
    console.log("\n=== Limits (if any) ===");
    try {
      const maxWallet = await token.maxWallet();
      console.log("Max Wallet:", ethers.formatUnits(maxWallet, decimals));
    } catch (e) {
      console.log("Max Wallet: (no limit)");
    }

    try {
      const maxTx = await token.maxTransaction();
      console.log("Max Transaction:", ethers.formatUnits(maxTx, decimals));
    } catch (e) {
      console.log("Max Transaction: (no limit)");
    }

    // Try to get fees
    console.log("\n=== Fees (if any) ===");
    try {
      const buyFee = await token.buyFee();
      console.log("Buy Fee:", buyFee.toString(), "bps");
    } catch (e) {
      console.log("Buy Fee: (no buy fee function)");
    }

    try {
      const sellFee = await token.sellFee();
      console.log("Sell Fee:", sellFee.toString(), "bps");
    } catch (e) {
      console.log("Sell Fee: (no sell fee function)");
    }

    // Check if our factory could receive this token
    console.log("\n=== Integration Analysis ===");
    console.log("This appears to be a standard ERC20 token.");
    console.log("Your BondingCurveFactory can receive this token via:");
    console.log("  1. Users calling token.transfer(factoryAddress, amount)");
    console.log("  2. Users calling token.approve(factoryAddress, amount) then factory pulling");
    console.log("\nTo integrate, you would need to add functions to BondingCurveFactory.sol:");
    console.log("  - receiveHDLS(uint256 amount) - for direct deposits");
    console.log("  - Or accept HDLS as parameter in existing functions");

  } catch (e: any) {
    console.log("Error reading token:", e.message);
  }
}

main().catch(console.error);
