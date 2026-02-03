import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploy QuorumGovernance contract
 *
 * This contract handles:
 * - Agent voting on quorum formation
 * - Treasury management
 * - Membership changes
 * - Fee adjustments
 *
 * Proposal Types:
 * - AddAgent
 * - RemoveAgent
 * - TreasurySpend
 * - AdjustFees
 * - ForceGraduate
 * - ProposeQuorum
 *
 * Voting: Weight-based, 2/3 quorum participation required
 * Note: Voting period (3 days) and quorum threshold (66.66%) are constants in the contract
 */
const deployGovernance: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy, get, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log(`Deploying QuorumGovernance to ${network.name}...`);
  log(`Deployer: ${deployer}`);

  // Get the BondingCurveFactory address
  let factoryAddress: string;
  try {
    const factory = await get("BondingCurveFactory");
    factoryAddress = factory.address;
    log(`Found BondingCurveFactory at: ${factoryAddress}`);
  } catch (error) {
    // If factory not deployed yet, use a placeholder (will need to be set later)
    log("WARNING: BondingCurveFactory not found, using zero address");
    factoryAddress = "0x0000000000000000000000000000000000000000";
  }

  // QuorumGovernance constructor only takes factory address
  // Voting period (3 days) and quorum threshold (66.66%) are hardcoded constants
  const deployment = await deploy("QuorumGovernance", {
    from: deployer,
    args: [factoryAddress],
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 5,
  });

  log(`QuorumGovernance deployed at: ${deployment.address}`);

  // Verify on Etherscan/Basescan if not local
  if (network.name !== "hardhat" && network.name !== "localhost") {
    log("Waiting for block confirmations before verification...");
    await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30s

    try {
      await hre.run("verify:verify", {
        address: deployment.address,
        constructorArguments: [factoryAddress],
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

deployGovernance.tags = ["QuorumGovernance", "core"];
deployGovernance.id = "QuorumGovernance";
deployGovernance.dependencies = ["BondingCurveFactory"];

export default deployGovernance;
