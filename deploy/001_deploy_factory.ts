import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploy BondingCurveFactory contract
 *
 * This is the core contract that creates markets with bonding curves.
 * Token distribution on market creation:
 * - 30% to founding quorum (split by contribution weights)
 * - 60% bonded to curve (available for purchase)
 * - 10% to protocol treasury
 */
const deployFactory: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log(`Deploying BondingCurveFactory to ${network.name}...`);
  log(`Deployer: ${deployer}`);

  // Get protocol treasury address (deployer for now, can be changed via governance)
  const treasury = deployer;

  // Uniswap V2 Router addresses by network
  // Base Sepolia uses Uniswap V2 fork or zero address for testing
  // Base Mainnet: 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24 (Uniswap V2)
  const uniswapRouters: { [key: string]: string } = {
    "base-mainnet": "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", // Uniswap V2 on Base
    "base-sepolia": "0x0000000000000000000000000000000000000000", // No DEX on testnet
    "hardhat": "0x0000000000000000000000000000000000000000",
  };

  const uniswapRouter = uniswapRouters[network.name] || "0x0000000000000000000000000000000000000000";
  log(`Using Uniswap Router: ${uniswapRouter}`);

  // Constructor takes (treasury, uniswapRouter)
  const deployment = await deploy("BondingCurveFactory", {
    from: deployer,
    args: [treasury, uniswapRouter],
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 5,
  });

  log(`BondingCurveFactory deployed at: ${deployment.address}`);

  // Verify on Etherscan/Basescan if not local
  if (network.name !== "hardhat" && network.name !== "localhost") {
    log("Waiting for block confirmations before verification...");
    await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30s

    try {
      await hre.run("verify:verify", {
        address: deployment.address,
        constructorArguments: [treasury, uniswapRouter],
      });
      log("Contract verified on Basescan!");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        log("Contract already verified");
      } else {
        log(`Verification failed: ${error.message}`);
      }
    }
  }

  log("----------------------------------------------------");
  return true;
};

deployFactory.tags = ["BondingCurveFactory", "core"];
deployFactory.id = "BondingCurveFactory";

export default deployFactory;
