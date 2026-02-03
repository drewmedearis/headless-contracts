import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import * as fs from "fs";
import * as path from "path";

/**
 * Export deployed contract addresses to JSON
 *
 * Creates a deployments.json file with all contract addresses
 * for use by backend and frontend.
 */
const exportAddresses: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, network } = hre;
  const { get, log } = deployments;

  log("----------------------------------------------------");
  log(`Exporting addresses for ${network.name}...`);

  const addresses: Record<string, string> = {};

  // Get all deployed contracts
  try {
    const factory = await get("BondingCurveFactory");
    addresses.BondingCurveFactory = factory.address;
    log(`BondingCurveFactory: ${factory.address}`);
  } catch (e) {
    log("BondingCurveFactory not deployed");
  }

  try {
    const governance = await get("QuorumGovernance");
    addresses.QuorumGovernance = governance.address;
    log(`QuorumGovernance: ${governance.address}`);
  } catch (e) {
    log("QuorumGovernance not deployed");
  }

  // Create deployments directory
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Write network-specific addresses file
  const networkDir = path.join(deploymentsDir, network.name);
  if (!fs.existsSync(networkDir)) {
    fs.mkdirSync(networkDir, { recursive: true });
  }

  const addressesFile = path.join(networkDir, "addresses.json");
  fs.writeFileSync(
    addressesFile,
    JSON.stringify(
      {
        network: network.name,
        chainId: network.config.chainId,
        deployedAt: new Date().toISOString(),
        contracts: addresses,
      },
      null,
      2
    )
  );
  log(`Addresses exported to: ${addressesFile}`);

  // Also create a combined deployments.json at root
  const allDeploymentsFile = path.join(__dirname, "..", "deployments.json");
  let allDeployments: Record<string, any> = {};

  // Load existing if present
  if (fs.existsSync(allDeploymentsFile)) {
    try {
      allDeployments = JSON.parse(fs.readFileSync(allDeploymentsFile, "utf8"));
    } catch (e) {
      // Start fresh if corrupted
    }
  }

  // Update with current network
  allDeployments[network.name] = {
    chainId: network.config.chainId,
    deployedAt: new Date().toISOString(),
    contracts: addresses,
  };

  fs.writeFileSync(allDeploymentsFile, JSON.stringify(allDeployments, null, 2));
  log(`Combined deployments updated: ${allDeploymentsFile}`);

  // Generate .env snippet for easy copy-paste
  log("\n--- Environment Variables ---");
  if (addresses.BondingCurveFactory) {
    log(`FACTORY_ADDRESS=${addresses.BondingCurveFactory}`);
  }
  if (addresses.QuorumGovernance) {
    log(`GOVERNANCE_ADDRESS=${addresses.QuorumGovernance}`);
  }
  log("-----------------------------\n");

  log("----------------------------------------------------");
  return true;
};

exportAddresses.tags = ["export"];
exportAddresses.id = "ExportAddresses";
exportAddresses.dependencies = ["BondingCurveFactory", "QuorumGovernance"];
exportAddresses.runAtTheEnd = true;

export default exportAddresses;
