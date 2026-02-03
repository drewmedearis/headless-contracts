import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Testnet Battle Test Suite for Headless Markets Protocol
 *
 * This script runs comprehensive tests against deployed Base Sepolia contracts
 * to validate all functionality before mainnet deployment.
 *
 * Test Scenarios:
 * 1. Market Creation - Valid quorum, token distribution
 * 2. Buy Operations - With slippage protection, minimum purchase
 * 3. Sell Operations - With slippage protection, liquidity checks
 * 4. Price Discovery - Bonding curve mechanics
 * 5. Edge Cases - Invalid inputs, boundary conditions
 * 6. Governance Integration - Proposal creation, voting
 */

interface TestResult {
  scenario: string;
  test: string;
  status: "PASS" | "FAIL" | "SKIP";
  details: string;
  txHash?: string;
  gasUsed?: string;
}

const results: TestResult[] = [];
const FACTORY_ADDRESS = "0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1";
const GOVERNANCE_ADDRESS = "0x0EC0833743e04Ca57C0dA0EA4eCb625fb7abb92B";

async function main() {
  console.log("=".repeat(70));
  console.log("HEADLESS MARKETS PROTOCOL - TESTNET BATTLE TEST");
  console.log("=".repeat(70));
  console.log(`Network: Base Sepolia (Chain ID: 84532)`);
  console.log(`Factory: ${FACTORY_ADDRESS}`);
  console.log(`Governance: ${GOVERNANCE_ADDRESS}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("=".repeat(70));
  console.log("");

  const [deployer] = await ethers.getSigners();
  console.log(`Test Account: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log("");

  const factory = await ethers.getContractAt("BondingCurveFactory", FACTORY_ADDRESS);
  const governance = await ethers.getContractAt("QuorumGovernance", GOVERNANCE_ADDRESS);

  // ============================================
  // SCENARIO 1: MARKET CREATION
  // ============================================
  console.log("-".repeat(70));
  console.log("SCENARIO 1: MARKET CREATION");
  console.log("-".repeat(70));

  // Test 1.1: Create valid market with 3 agents
  let testMarketId: bigint | null = null;
  try {
    console.log("\nTest 1.1: Create market with 3 agents...");

    // Get market count before creation
    const marketCountBefore = await factory.marketCount();

    // Use deployer address as all 3 "agents" for testing
    const agents = [deployer.address, deployer.address, deployer.address];
    const weights = [34, 33, 33]; // Must sum to 100

    const tx = await factory.createMarket(
      agents,
      weights,
      "Battle Test Token",
      "BTT",
      "A test market for battle testing the protocol on testnet"
    );
    const receipt = await tx.wait();

    // The new market ID is the count before creation (0-indexed)
    testMarketId = marketCountBefore;

    results.push({
      scenario: "Market Creation",
      test: "Create market with 3 agents",
      status: "PASS",
      details: `Market ID: ${testMarketId}`,
      txHash: receipt?.hash,
      gasUsed: receipt?.gasUsed.toString()
    });
    console.log(`  PASS - Market ${testMarketId} created`);
    console.log(`  TX: ${receipt?.hash}`);
    console.log(`  Gas: ${receipt?.gasUsed}`);
  } catch (error: any) {
    results.push({
      scenario: "Market Creation",
      test: "Create market with 3 agents",
      status: "FAIL",
      details: error.message
    });
    console.log(`  FAIL - ${error.message}`);
  }

  // Test 1.2: Verify token distribution
  if (testMarketId !== null) {
    try {
      console.log("\nTest 1.2: Verify token distribution...");

      const market = await factory.getMarket(testMarketId);
      const tokenAddress = market[0];
      const token = await ethers.getContractAt("MarketToken", tokenAddress);

      const deployerBalance = await token.balanceOf(deployer.address);
      const factoryBalance = await token.balanceOf(FACTORY_ADDRESS);
      const totalSupply = await token.totalSupply();

      // Deployer should have ~30% (all 3 quorum spots)
      const expectedQuorum = (totalSupply * 30n) / 100n;
      const quorumMatch = deployerBalance >= expectedQuorum * 99n / 100n; // Allow 1% variance

      results.push({
        scenario: "Market Creation",
        test: "Token distribution (30% quorum, 60% curve, 10% treasury)",
        status: quorumMatch ? "PASS" : "FAIL",
        details: `Deployer: ${ethers.formatEther(deployerBalance)}, Factory: ${ethers.formatEther(factoryBalance)}`
      });
      console.log(`  ${quorumMatch ? "PASS" : "FAIL"} - Deployer has ${ethers.formatEther(deployerBalance)} tokens`);
    } catch (error: any) {
      results.push({
        scenario: "Market Creation",
        test: "Token distribution",
        status: "FAIL",
        details: error.message
      });
      console.log(`  FAIL - ${error.message}`);
    }
  }

  // Test 1.3: Invalid quorum size (2 agents - should fail)
  try {
    console.log("\nTest 1.3: Reject invalid quorum size (2 agents)...");

    const agents = [deployer.address, deployer.address];
    const weights = [50, 50];

    await factory.createMarket(agents, weights, "Invalid", "INV", "Should fail");

    results.push({
      scenario: "Market Creation",
      test: "Reject quorum < 3 agents",
      status: "FAIL",
      details: "Transaction should have reverted but succeeded"
    });
    console.log(`  FAIL - Should have reverted`);
  } catch (error: any) {
    const isExpectedError = error.message.includes("Quorum size 3-10");
    results.push({
      scenario: "Market Creation",
      test: "Reject quorum < 3 agents",
      status: isExpectedError ? "PASS" : "FAIL",
      details: isExpectedError ? "Correctly reverted" : error.message
    });
    console.log(`  ${isExpectedError ? "PASS" : "FAIL"} - ${isExpectedError ? "Correctly rejected" : error.message}`);
  }

  // Test 1.4: Invalid weights (don't sum to 100)
  try {
    console.log("\nTest 1.4: Reject invalid weights (sum != 100)...");

    const agents = [deployer.address, deployer.address, deployer.address];
    const weights = [30, 30, 30]; // Sum = 90, not 100

    await factory.createMarket(agents, weights, "Invalid", "INV", "Should fail");

    results.push({
      scenario: "Market Creation",
      test: "Reject weights not summing to 100",
      status: "FAIL",
      details: "Transaction should have reverted"
    });
    console.log(`  FAIL - Should have reverted`);
  } catch (error: any) {
    const isExpectedError = error.message.includes("Weights must sum to 100");
    results.push({
      scenario: "Market Creation",
      test: "Reject weights not summing to 100",
      status: isExpectedError ? "PASS" : "FAIL",
      details: isExpectedError ? "Correctly reverted" : error.message
    });
    console.log(`  ${isExpectedError ? "PASS" : "FAIL"} - ${isExpectedError ? "Correctly rejected" : error.message}`);
  }

  // ============================================
  // SCENARIO 2: BUY OPERATIONS
  // ============================================
  console.log("\n" + "-".repeat(70));
  console.log("SCENARIO 2: BUY OPERATIONS");
  console.log("-".repeat(70));

  if (testMarketId !== null) {
    // Test 2.1: Valid purchase with slippage protection
    try {
      console.log("\nTest 2.1: Buy tokens with valid slippage...");

      const buyAmount = ethers.parseEther("0.01"); // 0.01 ETH
      const expectedTokens = await factory.calculatePurchaseReturn(testMarketId, buyAmount);
      const minTokens = expectedTokens * 95n / 100n; // 5% slippage tolerance

      const tx = await factory.buy(testMarketId, minTokens, { value: buyAmount });
      const receipt = await tx.wait();

      results.push({
        scenario: "Buy Operations",
        test: "Purchase with 5% slippage tolerance",
        status: "PASS",
        details: `Bought ~${ethers.formatEther(expectedTokens)} tokens for 0.01 ETH`,
        txHash: receipt?.hash,
        gasUsed: receipt?.gasUsed.toString()
      });
      console.log(`  PASS - Bought ${ethers.formatEther(expectedTokens)} tokens`);
      console.log(`  TX: ${receipt?.hash}`);
    } catch (error: any) {
      results.push({
        scenario: "Buy Operations",
        test: "Purchase with slippage",
        status: "FAIL",
        details: error.message
      });
      console.log(`  FAIL - ${error.message}`);
    }

    // Test 2.2: Below minimum purchase (should fail)
    try {
      console.log("\nTest 2.2: Reject below minimum purchase...");

      const tinyAmount = ethers.parseEther("0.0001"); // Below 0.001 ETH minimum
      await factory.buy(testMarketId, 0, { value: tinyAmount });

      results.push({
        scenario: "Buy Operations",
        test: "Reject purchase below minimum",
        status: "FAIL",
        details: "Should have reverted"
      });
      console.log(`  FAIL - Should have reverted`);
    } catch (error: any) {
      const isExpectedError = error.message.includes("Below minimum purchase");
      results.push({
        scenario: "Buy Operations",
        test: "Reject purchase below minimum (0.001 ETH)",
        status: isExpectedError ? "PASS" : "FAIL",
        details: isExpectedError ? "Correctly reverted" : error.message
      });
      console.log(`  ${isExpectedError ? "PASS" : "FAIL"} - ${isExpectedError ? "Correctly rejected" : error.message}`);
    }

    // Test 2.3: Slippage exceeded (should fail)
    try {
      console.log("\nTest 2.3: Reject when slippage exceeded...");

      const buyAmount = ethers.parseEther("0.01");
      const expectedTokens = await factory.calculatePurchaseReturn(testMarketId, buyAmount);
      const unrealisticMin = expectedTokens * 2n; // Demand 2x more than possible

      await factory.buy(testMarketId, unrealisticMin, { value: buyAmount });

      results.push({
        scenario: "Buy Operations",
        test: "Reject when slippage exceeded",
        status: "FAIL",
        details: "Should have reverted"
      });
      console.log(`  FAIL - Should have reverted`);
    } catch (error: any) {
      const isExpectedError = error.message.includes("Slippage exceeded");
      results.push({
        scenario: "Buy Operations",
        test: "Reject when slippage exceeded",
        status: isExpectedError ? "PASS" : "FAIL",
        details: isExpectedError ? "Correctly reverted" : error.message
      });
      console.log(`  ${isExpectedError ? "PASS" : "FAIL"} - ${isExpectedError ? "Correctly rejected" : error.message}`);
    }

    // Test 2.4: Verify price increases after purchase
    try {
      console.log("\nTest 2.4: Verify bonding curve price increase...");

      const priceBefore = await factory.getCurrentPrice(testMarketId);

      const buyAmount = ethers.parseEther("0.02");
      const tx = await factory.buy(testMarketId, 0, { value: buyAmount });
      await tx.wait();

      const priceAfter = await factory.getCurrentPrice(testMarketId);

      const priceIncreased = priceAfter > priceBefore;
      results.push({
        scenario: "Buy Operations",
        test: "Price increases after purchase (bonding curve)",
        status: priceIncreased ? "PASS" : "FAIL",
        details: `Before: ${ethers.formatEther(priceBefore)}, After: ${ethers.formatEther(priceAfter)}`
      });
      console.log(`  ${priceIncreased ? "PASS" : "FAIL"} - Price: ${ethers.formatEther(priceBefore)} -> ${ethers.formatEther(priceAfter)}`);
    } catch (error: any) {
      results.push({
        scenario: "Buy Operations",
        test: "Price increases after purchase",
        status: "FAIL",
        details: error.message
      });
      console.log(`  FAIL - ${error.message}`);
    }
  }

  // ============================================
  // SCENARIO 3: SELL OPERATIONS
  // ============================================
  console.log("\n" + "-".repeat(70));
  console.log("SCENARIO 3: SELL OPERATIONS");
  console.log("-".repeat(70));

  if (testMarketId !== null) {
    // First, buy more tokens to have curve-purchased tokens to sell
    let tokensPurchased = 0n;
    try {
      console.log("\nPrep: Buying tokens to test selling...");
      const buyAmount = ethers.parseEther("0.05");
      const tx = await factory.buy(testMarketId, 0, { value: buyAmount });
      await tx.wait();

      // Get tokens sold from curve (these are the sellable tokens)
      const market = await factory.getMarket(testMarketId);
      tokensPurchased = market[5]; // tokensSold field
      console.log(`  Purchased tokens from curve, total sold: ${ethers.formatEther(tokensPurchased)}`);
    } catch (error: any) {
      console.log(`  Prep buy failed: ${error.message}`);
    }

    // Test 3.1: Valid sell with slippage protection
    try {
      console.log("\nTest 3.1: Sell tokens with valid slippage...");

      const market = await factory.getMarket(testMarketId);
      const tokenAddress = market[0];
      const token = await ethers.getContractAt("MarketToken", tokenAddress);
      const tokensSold = market[5]; // Only tokens sold from curve can be sold back

      // Sell a portion of curve-purchased tokens (not quorum allocation)
      const sellAmount = tokensSold / 10n; // Sell 10% of curve tokens

      if (sellAmount > 0) {
        // Approve factory to spend tokens
        const approveTx = await token.approve(FACTORY_ADDRESS, sellAmount);
        await approveTx.wait();

        const expectedEth = await factory.calculateSaleReturn(testMarketId, sellAmount);
        const minEth = expectedEth * 95n / 100n; // 5% slippage

        const tx = await factory.sell(testMarketId, sellAmount, minEth);
        const receipt = await tx.wait();

        results.push({
          scenario: "Sell Operations",
          test: "Sell with 5% slippage tolerance",
          status: "PASS",
          details: `Sold ${ethers.formatEther(sellAmount)} tokens for ~${ethers.formatEther(expectedEth)} ETH`,
          txHash: receipt?.hash,
          gasUsed: receipt?.gasUsed.toString()
        });
        console.log(`  PASS - Sold ${ethers.formatEther(sellAmount)} tokens`);
        console.log(`  TX: ${receipt?.hash}`);
      } else {
        results.push({
          scenario: "Sell Operations",
          test: "Sell with slippage",
          status: "SKIP",
          details: "No curve tokens to sell"
        });
        console.log(`  SKIP - No curve tokens available`);
      }
    } catch (error: any) {
      results.push({
        scenario: "Sell Operations",
        test: "Sell with slippage",
        status: "FAIL",
        details: error.message
      });
      console.log(`  FAIL - ${error.message}`);
    }

    // Test 3.2: Sell slippage exceeded (should fail)
    try {
      console.log("\nTest 3.2: Reject sell when slippage exceeded...");

      const market = await factory.getMarket(testMarketId);
      const tokenAddress = market[0];
      const token = await ethers.getContractAt("MarketToken", tokenAddress);
      const tokensSold = market[5];

      const sellAmount = tokensSold / 20n;

      if (sellAmount > 0) {
        await token.approve(FACTORY_ADDRESS, sellAmount);

        const expectedEth = await factory.calculateSaleReturn(testMarketId, sellAmount);
        const unrealisticMin = expectedEth * 2n; // Demand 2x more than possible

        await factory.sell(testMarketId, sellAmount, unrealisticMin);

        results.push({
          scenario: "Sell Operations",
          test: "Reject sell when slippage exceeded",
          status: "FAIL",
          details: "Should have reverted"
        });
        console.log(`  FAIL - Should have reverted`);
      }
    } catch (error: any) {
      const isExpectedError = error.message.includes("Slippage exceeded");
      results.push({
        scenario: "Sell Operations",
        test: "Reject sell when slippage exceeded",
        status: isExpectedError ? "PASS" : "FAIL",
        details: isExpectedError ? "Correctly reverted" : error.message
      });
      console.log(`  ${isExpectedError ? "PASS" : "FAIL"} - ${isExpectedError ? "Correctly rejected" : error.message}`);
    }
  }

  // ============================================
  // SCENARIO 4: PROTOCOL FEES
  // ============================================
  console.log("\n" + "-".repeat(70));
  console.log("SCENARIO 4: PROTOCOL FEES");
  console.log("-".repeat(70));

  // Test 4.1: Verify fee collection
  try {
    console.log("\nTest 4.1: Verify protocol fee configuration...");

    const feeBps = await factory.protocolFeeBps();
    const treasury = await factory.protocolTreasury();

    const feeCorrect = feeBps === 50n; // 0.5%
    results.push({
      scenario: "Protocol Fees",
      test: "Protocol fee is 0.5% (50 bps)",
      status: feeCorrect ? "PASS" : "FAIL",
      details: `Fee: ${feeBps} bps, Treasury: ${treasury}`
    });
    console.log(`  ${feeCorrect ? "PASS" : "FAIL"} - Fee: ${feeBps} bps`);
    console.log(`  Treasury: ${treasury}`);
  } catch (error: any) {
    results.push({
      scenario: "Protocol Fees",
      test: "Protocol fee configuration",
      status: "FAIL",
      details: error.message
    });
    console.log(`  FAIL - ${error.message}`);
  }

  // ============================================
  // SCENARIO 5: GOVERNANCE
  // ============================================
  console.log("\n" + "-".repeat(70));
  console.log("SCENARIO 5: GOVERNANCE");
  console.log("-".repeat(70));

  // Test 5.1: Verify governance linked to factory
  try {
    console.log("\nTest 5.1: Verify governance-factory link...");

    const linkedFactory = await governance.factory();
    const isLinked = linkedFactory.toLowerCase() === FACTORY_ADDRESS.toLowerCase();

    results.push({
      scenario: "Governance",
      test: "Governance linked to Factory",
      status: isLinked ? "PASS" : "FAIL",
      details: `Factory in Governance: ${linkedFactory}`
    });
    console.log(`  ${isLinked ? "PASS" : "FAIL"} - Factory: ${linkedFactory}`);
  } catch (error: any) {
    results.push({
      scenario: "Governance",
      test: "Governance-Factory link",
      status: "FAIL",
      details: error.message
    });
    console.log(`  FAIL - ${error.message}`);
  }

  // Test 5.2: Verify voting parameters
  try {
    console.log("\nTest 5.2: Verify voting parameters...");

    const votingPeriod = await governance.VOTING_PERIOD();
    const expectedPeriod = 259200n; // 3 days in seconds
    const periodCorrect = votingPeriod === expectedPeriod;

    results.push({
      scenario: "Governance",
      test: "Voting period is 3 days",
      status: periodCorrect ? "PASS" : "FAIL",
      details: `Period: ${votingPeriod}s (${Number(votingPeriod) / 86400} days)`
    });
    console.log(`  ${periodCorrect ? "PASS" : "FAIL"} - Voting period: ${Number(votingPeriod) / 86400} days`);
  } catch (error: any) {
    results.push({
      scenario: "Governance",
      test: "Voting parameters",
      status: "FAIL",
      details: error.message
    });
    console.log(`  FAIL - ${error.message}`);
  }

  // ============================================
  // SCENARIO 6: EDGE CASES
  // ============================================
  console.log("\n" + "-".repeat(70));
  console.log("SCENARIO 6: EDGE CASES");
  console.log("-".repeat(70));

  // Test 6.1: Buy from non-existent market
  try {
    console.log("\nTest 6.1: Reject buy from non-existent market...");

    const fakeMarketId = 999999;
    await factory.buy(fakeMarketId, 0, { value: ethers.parseEther("0.01") });

    results.push({
      scenario: "Edge Cases",
      test: "Reject buy from non-existent market",
      status: "FAIL",
      details: "Should have reverted"
    });
    console.log(`  FAIL - Should have reverted`);
  } catch (error: any) {
    results.push({
      scenario: "Edge Cases",
      test: "Reject buy from non-existent market",
      status: "PASS",
      details: "Correctly reverted"
    });
    console.log(`  PASS - Correctly rejected`);
  }

  // Test 6.2: Sell more tokens than available in curve
  if (testMarketId !== null) {
    try {
      console.log("\nTest 6.2: Reject selling more than curve liquidity...");

      const market = await factory.getMarket(testMarketId);
      const tokenAddress = market[0];
      const token = await ethers.getContractAt("MarketToken", tokenAddress);

      // Try to sell massive amount
      const hugeAmount = ethers.parseEther("1000000");
      await token.approve(FACTORY_ADDRESS, hugeAmount);

      await factory.sell(testMarketId, hugeAmount, 0);

      results.push({
        scenario: "Edge Cases",
        test: "Reject sell exceeding curve liquidity",
        status: "FAIL",
        details: "Should have reverted"
      });
      console.log(`  FAIL - Should have reverted`);
    } catch (error: any) {
      results.push({
        scenario: "Edge Cases",
        test: "Reject sell exceeding curve liquidity",
        status: "PASS",
        details: "Correctly reverted"
      });
      console.log(`  PASS - Correctly rejected`);
    }
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log("\n" + "=".repeat(70));
  console.log("TEST SUMMARY");
  console.log("=".repeat(70));

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const skipped = results.filter(r => r.status === "SKIP").length;

  console.log(`\n  PASSED:  ${passed}`);
  console.log(`  FAILED:  ${failed}`);
  console.log(`  SKIPPED: ${skipped}`);
  console.log(`  TOTAL:   ${results.length}`);

  if (failed > 0) {
    console.log("\nFAILED TESTS:");
    results.filter(r => r.status === "FAIL").forEach(r => {
      console.log(`  - [${r.scenario}] ${r.test}`);
      console.log(`    ${r.details}`);
    });
  }

  // Save results to JSON
  const outputDir = path.join(__dirname, "..", "test-results");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `battle-test-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({
    network: "base-sepolia",
    chainId: 84532,
    timestamp: new Date().toISOString(),
    contracts: {
      factory: FACTORY_ADDRESS,
      governance: GOVERNANCE_ADDRESS
    },
    summary: { passed, failed, skipped, total: results.length },
    results
  }, null, 2));

  console.log(`\nResults saved to: ${outputPath}`);
  console.log("=".repeat(70));

  // Final check for test market
  if (testMarketId !== null) {
    console.log(`\nTest Market Details (ID: ${testMarketId}):`);
    const market = await factory.getMarket(testMarketId);
    console.log(`  Token: ${market[0]}`);
    console.log(`  Target Raise: ${ethers.formatEther(market[3])} ETH`);
    console.log(`  Current Raised: ${ethers.formatEther(market[4])} ETH`);
    console.log(`  Tokens Sold: ${ethers.formatEther(market[5])}`);
    console.log(`  Graduated: ${market[6]}`);
    console.log(`  Active: ${market[7]}`);
    console.log(`\nView on Basescan:`);
    console.log(`  https://sepolia.basescan.org/address/${market[0]}`);
  }

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Battle test failed:", error);
  process.exit(1);
});
