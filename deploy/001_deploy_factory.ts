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

  // Note: protocolFeeBps is set to 50 (0.5%) in the contract by default
  // The constructor only takes treasury address

  const deployment = await deploy("BondingCurveFactory", {
    from: deployer,
    args: [treasury],
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
        constructorArguments: [treasury],
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
