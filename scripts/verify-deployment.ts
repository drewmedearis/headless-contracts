import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeploymentInfo {
  network: string;
  chainId: number;
  deployedAt: string;
  contracts: {
    BondingCurveFactory?: string;
    QuorumGovernance?: string;
  };
}

async function main() {
  const network = await ethers.provider.getNetwork();
  console.log("=".repeat(60));
  console.log("POST-DEPLOYMENT VERIFICATION");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log("");

  // Load deployed addresses
  const addressesPath = path.join(
    __dirname,
    "..",
    "deployments",
    "base-sepolia",
    "addresses.json"
  );

  if (!fs.existsSync(addressesPath)) {
    console.log("ERROR: No deployment found at", addressesPath);
    console.log("Run 'npm run deploy:sepolia' first.");
    process.exit(1);
  }

  const deployment: DeploymentInfo = JSON.parse(
    fs.readFileSync(addressesPath, "utf8")
  );
  console.log("Deployment Info:");
  console.log(`  Deployed At: ${deployment.deployedAt}`);
  console.log("");

  const results: { check: string; status: string; details: string }[] = [];

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer Address: ${deployer.address}`);
  console.log("");

  // ============================================
  // BONDING CURVE FACTORY CHECKS
  // ============================================
  if (deployment.contracts.BondingCurveFactory) {
    console.log("-".repeat(60));
    console.log("BONDING CURVE FACTORY");
    console.log("-".repeat(60));
    console.log(`Address: ${deployment.contracts.BondingCurveFactory}`);

    try {
      const factory = await ethers.getContractAt(
        "BondingCurveFactory",
        deployment.contracts.BondingCurveFactory
      );

      // Check owner
      const owner = await factory.owner();
      const ownerMatch = owner.toLowerCase() === deployer.address.toLowerCase();
      results.push({
        check: "Factory: Owner matches deployer",
        status: ownerMatch ? "PASS" : "WARN",
        details: `Owner: ${owner}`,
      });
      console.log(`  Owner: ${owner} ${ownerMatch ? "✓" : "⚠"}`);

      // Check protocol fee
      const feeBps = await factory.protocolFeeBps();
      const feeCorrect = feeBps === 50n;
      results.push({
        check: "Factory: Protocol fee is 0.5%",
        status: feeCorrect ? "PASS" : "FAIL",
        details: `Fee: ${feeBps} bps`,
      });
      console.log(`  Protocol Fee: ${feeBps} bps ${feeCorrect ? "✓" : "✗"}`);

      // Check treasury
      const treasury = await factory.treasury();
      results.push({
        check: "Factory: Treasury set",
        status: treasury !== ethers.ZeroAddress ? "PASS" : "FAIL",
        details: `Treasury: ${treasury}`,
      });
      console.log(`  Treasury: ${treasury}`);

      // Check paused state
      const paused = await factory.paused();
      results.push({
        check: "Factory: Not paused",
        status: !paused ? "PASS" : "WARN",
        details: `Paused: ${paused}`,
      });
      console.log(`  Paused: ${paused} ${!paused ? "✓" : "⚠"}`);

      // Check market count
      const marketCount = await factory.marketCount();
      results.push({
        check: "Factory: Market count accessible",
        status: "PASS",
        details: `Markets: ${marketCount}`,
      });
      console.log(`  Market Count: ${marketCount}`);
    } catch (error: any) {
      console.log(`  ERROR: ${error.message}`);
      results.push({
        check: "Factory: Contract accessible",
        status: "FAIL",
        details: error.message,
      });
    }
  } else {
    console.log("BondingCurveFactory: NOT DEPLOYED");
    results.push({
      check: "Factory: Deployed",
      status: "FAIL",
      details: "Not found in addresses.json",
    });
  }

  console.log("");

  // ============================================
  // QUORUM GOVERNANCE CHECKS
  // ============================================
  if (deployment.contracts.QuorumGovernance) {
    console.log("-".repeat(60));
    console.log("QUORUM GOVERNANCE");
    console.log("-".repeat(60));
    console.log(`Address: ${deployment.contracts.QuorumGovernance}`);

    try {
      const governance = await ethers.getContractAt(
        "QuorumGovernance",
        deployment.contracts.QuorumGovernance
      );

      // Check owner
      const owner = await governance.owner();
      const ownerMatch = owner.toLowerCase() === deployer.address.toLowerCase();
      results.push({
        check: "Governance: Owner matches deployer",
        status: ownerMatch ? "PASS" : "WARN",
        details: `Owner: ${owner}`,
      });
      console.log(`  Owner: ${owner} ${ownerMatch ? "✓" : "⚠"}`);

      // Check factory link
      const factoryAddr = await governance.factory();
      const factoryLinked =
        factoryAddr.toLowerCase() ===
        deployment.contracts.BondingCurveFactory?.toLowerCase();
      results.push({
        check: "Governance: Linked to Factory",
        status: factoryLinked ? "PASS" : "FAIL",
        details: `Factory: ${factoryAddr}`,
      });
      console.log(`  Factory: ${factoryAddr} ${factoryLinked ? "✓" : "✗"}`);

      // Check voting period
      const votingPeriod = await governance.VOTING_PERIOD();
      const votingCorrect = votingPeriod === 259200n; // 3 days in seconds
      results.push({
        check: "Governance: Voting period is 3 days",
        status: votingCorrect ? "PASS" : "WARN",
        details: `Period: ${votingPeriod}s`,
      });
      console.log(
        `  Voting Period: ${votingPeriod}s (${Number(votingPeriod) / 86400} days) ${votingCorrect ? "✓" : "⚠"}`
      );

      // Check quorum threshold
      const quorumThreshold = await governance.QUORUM_THRESHOLD();
      const quorumCorrect = quorumThreshold === 6666n; // 66.66%
      results.push({
        check: "Governance: Quorum threshold is 66.66%",
        status: quorumCorrect ? "PASS" : "WARN",
        details: `Threshold: ${quorumThreshold} bps`,
      });
      console.log(
        `  Quorum Threshold: ${quorumThreshold} bps (${Number(quorumThreshold) / 100}%) ${quorumCorrect ? "✓" : "⚠"}`
      );

      // Check proposal count
      const proposalCount = await governance.proposalCount();
      results.push({
        check: "Governance: Proposal count accessible",
        status: "PASS",
        details: `Proposals: ${proposalCount}`,
      });
      console.log(`  Proposal Count: ${proposalCount}`);
    } catch (error: any) {
      console.log(`  ERROR: ${error.message}`);
      results.push({
        check: "Governance: Contract accessible",
        status: "FAIL",
        details: error.message,
      });
    }
  } else {
    console.log("QuorumGovernance: NOT DEPLOYED");
    results.push({
      check: "Governance: Deployed",
      status: "FAIL",
      details: "Not found in addresses.json",
    });
  }

  console.log("");

  // ============================================
  // SUMMARY
  // ============================================
  console.log("=".repeat(60));
  console.log("VERIFICATION SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.status === "PASS").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log(`  PASSED: ${passed}`);
  console.log(`  WARNINGS: ${warned}`);
  console.log(`  FAILED: ${failed}`);
  console.log("");

  // Print failures
  if (failed > 0) {
    console.log("FAILURES:");
    results
      .filter((r) => r.status === "FAIL")
      .forEach((r) => {
        console.log(`  ✗ ${r.check}`);
        console.log(`    ${r.details}`);
      });
  }

  // Print warnings
  if (warned > 0) {
    console.log("WARNINGS:");
    results
      .filter((r) => r.status === "WARN")
      .forEach((r) => {
        console.log(`  ⚠ ${r.check}`);
        console.log(`    ${r.details}`);
      });
  }

  console.log("");
  console.log("=".repeat(60));

  // Exit with appropriate code
  if (failed > 0) {
    console.log("RESULT: VERIFICATION FAILED");
    process.exit(1);
  } else if (warned > 0) {
    console.log("RESULT: VERIFICATION PASSED WITH WARNINGS");
    process.exit(0);
  } else {
    console.log("RESULT: ALL CHECKS PASSED");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Verification script failed:", error);
  process.exit(1);
});
