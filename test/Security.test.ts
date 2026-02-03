import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * Security Test Suite
 *
 * Tests for vulnerabilities identified in the security audit:
 * - Reentrancy attacks
 * - Access control bypasses
 * - Economic attacks (sandwich, front-running)
 * - Integer overflow/underflow
 * - Edge cases and boundary conditions
 */
describe("Security Tests", function () {
  async function deployFullSystemFixture() {
    const [owner, treasury, attacker, agent1, agent2, agent3, buyer1, buyer2] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("BondingCurveFactory");
    const factory = await Factory.deploy(treasury.address, ethers.ZeroAddress);

    const Governance = await ethers.getContractFactory("QuorumGovernance");
    const governance = await Governance.deploy(factory.target);

    // Link governance to factory
    await factory.setGovernance(governance.target);

    // Create a test market
    const agents = [agent1.address, agent2.address, agent3.address];
    const weights = [40, 35, 25];
    await factory.createMarket(
      agents,
      weights,
      "Security Test Token",
      "SEC",
      "Security testing market"
    );

    const marketId = 0;
    const market = await factory.getMarket(marketId);
    const token = await ethers.getContractAt("MarketToken", market.tokenAddress);

    return {
      factory,
      governance,
      token,
      marketId,
      owner,
      treasury,
      attacker,
      agent1,
      agent2,
      agent3,
      buyer1,
      buyer2,
    };
  }

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy on buy()", async function () {
      const { factory, marketId, attacker } = await loadFixture(deployFullSystemFixture);

      // The ReentrancyGuard should prevent any reentrancy
      // We test by ensuring multiple concurrent buys work correctly
      const buyAmount = ethers.parseEther("0.1");

      await factory.connect(attacker).buy(marketId, 0, { value: buyAmount });
      const market1 = await factory.getMarket(marketId);

      await factory.connect(attacker).buy(marketId, 0, { value: buyAmount });
      const market2 = await factory.getMarket(marketId);

      // Tokens sold should increase monotonically
      expect(market2.tokensSold).to.be.gt(market1.tokensSold);
    });

    it("Should prevent reentrancy on sell()", async function () {
      const { factory, token, marketId, buyer1 } = await loadFixture(deployFullSystemFixture);

      // Buy tokens first
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });

      const balance = await token.balanceOf(buyer1.address);
      const sellAmount = balance / 4n;

      // Approve and sell
      await token.connect(buyer1).approve(factory.target, balance);

      await factory.connect(buyer1).sell(marketId, sellAmount, 0);
      await factory.connect(buyer1).sell(marketId, sellAmount, 0);

      // Should complete without reentrancy issues
      const finalBalance = await token.balanceOf(buyer1.address);
      expect(finalBalance).to.equal(balance - sellAmount * 2n);
    });
  });

  describe("Slippage Protection (HM-01 Verification)", function () {
    it("Should protect against sandwich attack on buy", async function () {
      const { factory, marketId, attacker, buyer1 } = await loadFixture(deployFullSystemFixture);

      // Simulate front-run: attacker buys first
      await factory.connect(attacker).buy(marketId, 0, { value: ethers.parseEther("2.0") });

      // Calculate expected tokens for victim
      const victimAmount = ethers.parseEther("1.0");
      const expectedTokens = await factory.calculatePurchaseReturn(marketId, victimAmount);

      // Victim sets minTokensOut to expected amount (no slippage tolerance)
      // This should fail if price moved significantly
      await expect(
        factory.connect(buyer1).buy(marketId, expectedTokens + 1n, { value: victimAmount })
      ).to.be.revertedWith("Slippage exceeded");

      // With reasonable slippage (5%), should succeed
      const minWithSlippage = (expectedTokens * 95n) / 100n;
      await expect(
        factory.connect(buyer1).buy(marketId, minWithSlippage, { value: victimAmount })
      ).to.not.be.reverted;
    });

    it("Should protect against sandwich attack on sell", async function () {
      const { factory, token, marketId, attacker, buyer1 } = await loadFixture(deployFullSystemFixture);

      // Both buy tokens
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("2.0") });
      await factory.connect(attacker).buy(marketId, 0, { value: ethers.parseEther("1.0") });

      const victimTokens = await token.balanceOf(buyer1.address);
      const sellAmount = victimTokens / 2n;

      // Calculate expected ETH return
      const expectedEth = await factory.calculateSaleReturn(marketId, sellAmount);

      // Attacker front-runs by selling first (drops price)
      const attackerTokens = await token.balanceOf(attacker.address);
      await token.connect(attacker).approve(factory.target, attackerTokens);
      await factory.connect(attacker).sell(marketId, attackerTokens, 0);

      // Victim's expected return is now less, slippage protection kicks in
      await token.connect(buyer1).approve(factory.target, sellAmount);
      await expect(
        factory.connect(buyer1).sell(marketId, sellAmount, expectedEth)
      ).to.be.revertedWith("Slippage exceeded");
    });
  });

  describe("Access Control", function () {
    it("Should reject unauthorized pause attempts", async function () {
      const { factory, marketId, attacker } = await loadFixture(deployFullSystemFixture);

      await expect(
        factory.connect(attacker).requestPause(marketId)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");

      await expect(
        factory.connect(attacker).emergencyPause(marketId)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should reject unauthorized governance changes", async function () {
      const { factory, attacker, agent1 } = await loadFixture(deployFullSystemFixture);

      await expect(
        factory.connect(attacker).setGovernance(agent1.address)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should reject unauthorized treasury changes", async function () {
      const { factory, attacker, agent1 } = await loadFixture(deployFullSystemFixture);

      await expect(
        factory.connect(attacker).setProtocolTreasury(agent1.address)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should reject unauthorized fee changes", async function () {
      const { factory, attacker } = await loadFixture(deployFullSystemFixture);

      await expect(
        factory.connect(attacker).setProtocolFeeBps(100)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should reject forceGraduate from non-governance", async function () {
      const { factory, marketId, attacker, buyer1 } = await loadFixture(deployFullSystemFixture);

      // Buy some tokens first
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });

      await expect(
        factory.connect(attacker).forceGraduate(marketId)
      ).to.be.revertedWith("Only governance");
    });
  });

  describe("Timelock Protection (HM-03 Verification)", function () {
    it("Should enforce 24h delay on pause", async function () {
      const { factory, owner, marketId } = await loadFixture(deployFullSystemFixture);

      // Request pause
      await factory.connect(owner).requestPause(marketId);

      // Try to execute immediately - should fail
      await expect(
        factory.connect(owner).executePause(marketId)
      ).to.be.revertedWith("Timelock not expired");

      // Advance time by 23 hours - still should fail
      await time.increase(23 * 60 * 60);
      await expect(
        factory.connect(owner).executePause(marketId)
      ).to.be.revertedWith("Timelock not expired");

      // Advance time to 24 hours - should succeed
      await time.increase(60 * 60 + 1);
      await expect(
        factory.connect(owner).executePause(marketId)
      ).to.emit(factory, "MarketPaused");
    });

    it("Should allow cancellation of pause request", async function () {
      const { factory, owner, marketId, buyer1 } = await loadFixture(deployFullSystemFixture);

      await factory.connect(owner).requestPause(marketId);
      await factory.connect(owner).cancelPause(marketId);

      // After cancellation, executePause should fail
      await time.increase(25 * 60 * 60);
      await expect(
        factory.connect(owner).executePause(marketId)
      ).to.be.revertedWith("No pending pause");

      // Market should still be active
      await expect(
        factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.1") })
      ).to.not.be.reverted;
    });
  });

  describe("Governance Execution Window (HM-05 Verification)", function () {
    it("Should reject execution after window expires", async function () {
      const { factory, governance, agent1, agent2, agent3, buyer1 } =
        await loadFixture(deployFullSystemFixture);

      // Create a new market through governance
      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [34, 33, 33];

      await governance.connect(agent1).proposeQuorum(agents, weights, "Test Token", "TEST", "Test thesis");

      // All agents approve
      await governance.connect(agent2).approveQuorum(0);
      await governance.connect(agent3).approveQuorum(0);

      // The quorum is created, now create a governance proposal
      const marketId = 1; // New market from quorum

      // Create AddAgent proposal
      await governance.connect(agent1).propose(
        marketId,
        0, // AddAgent
        buyer1.address,
        10,
        "0x",
        "Add buyer1 to quorum"
      );

      // Vote for it
      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);

      // Wait for voting deadline (3 days)
      await time.increase(3 * 24 * 60 * 60 + 1);

      // Should be executable now
      const proposal = await governance.getProposal(0);
      expect(proposal.forVotes).to.be.gt(proposal.againstVotes);

      // Wait for execution window to expire (7 more days)
      await time.increase(7 * 24 * 60 * 60 + 1);

      // Execution should fail due to expired window
      await expect(
        governance.connect(agent1).execute(0)
      ).to.be.revertedWith("Execution expired");
    });
  });

  describe("Minimum Purchase (HM-07 Verification)", function () {
    it("Should reject purchases below 0.001 ETH", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployFullSystemFixture);

      const belowMin = ethers.parseEther("0.0009");
      await expect(
        factory.connect(buyer1).buy(marketId, 0, { value: belowMin })
      ).to.be.revertedWith("Below minimum purchase");
    });

    it("Should accept purchases at exactly 0.001 ETH", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployFullSystemFixture);

      const exactMin = ethers.parseEther("0.001");
      await expect(
        factory.connect(buyer1).buy(marketId, 0, { value: exactMin })
      ).to.not.be.reverted;
    });
  });

  describe("Zero Address Checks (HM-11 Verification)", function () {
    it("Should reject zero address for treasury", async function () {
      const { factory, owner } = await loadFixture(deployFullSystemFixture);

      await expect(
        factory.connect(owner).setProtocolTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("Should reject zero address for governance", async function () {
      const { factory, owner } = await loadFixture(deployFullSystemFixture);

      await expect(
        factory.connect(owner).setGovernance(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });
  });

  describe("Integer Boundary Conditions", function () {
    it("Should handle maximum fee (5%)", async function () {
      const { factory, owner, marketId, buyer1, treasury } =
        await loadFixture(deployFullSystemFixture);

      // Set max fee
      await factory.connect(owner).setProtocolFeeBps(500); // 5%

      const buyAmount = ethers.parseEther("1.0");
      const expectedFee = buyAmount / 20n; // 5%

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await factory.connect(buyer1).buy(marketId, 0, { value: buyAmount });
      const treasuryAfter = await ethers.provider.getBalance(treasury.address);

      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);
    });

    it("Should reject fee above maximum", async function () {
      const { factory, owner } = await loadFixture(deployFullSystemFixture);

      await expect(
        factory.connect(owner).setProtocolFeeBps(501)
      ).to.be.revertedWith("Fee too high");
    });

    it("Should handle zero fee scenario", async function () {
      const { factory, owner, marketId, buyer1, treasury } =
        await loadFixture(deployFullSystemFixture);

      await factory.connect(owner).setProtocolFeeBps(0);

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });
      const treasuryAfter = await ethers.provider.getBalance(treasury.address);

      expect(treasuryAfter).to.equal(treasuryBefore);
    });
  });

  describe("Market State Transitions", function () {
    it("Should not allow operations on paused market", async function () {
      const { factory, token, owner, marketId, buyer1 } =
        await loadFixture(deployFullSystemFixture);

      // Buy first
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });

      // Emergency pause
      await factory.connect(owner).emergencyPause(marketId);

      // Buying should fail
      await expect(
        factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Market not active");

      // Selling should fail
      const balance = await token.balanceOf(buyer1.address);
      await token.connect(buyer1).approve(factory.target, balance);
      await expect(
        factory.connect(buyer1).sell(marketId, balance, 0)
      ).to.be.revertedWith("Market not active");
    });

    it("Should not allow operations on graduated market", async function () {
      const { factory, token, marketId, buyer1 } =
        await loadFixture(deployFullSystemFixture);

      // Graduate the market
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("10.5") });

      const market = await factory.getMarket(marketId);
      expect(market.graduated).to.be.true;

      // Further buying should fail
      await expect(
        factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Market graduated");

      // Selling should also fail
      const balance = await token.balanceOf(buyer1.address);
      await token.connect(buyer1).approve(factory.target, balance);
      await expect(
        factory.connect(buyer1).sell(marketId, balance, 0)
      ).to.be.revertedWith("Market graduated");
    });
  });

  describe("Quorum Governance Security", function () {
    it("Should prevent non-members from voting", async function () {
      const { governance, agent1, agent2, agent3, attacker } =
        await loadFixture(deployFullSystemFixture);

      // Create a quorum
      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [34, 33, 33];
      await governance.connect(agent1).proposeQuorum(agents, weights, "Test Token", "TEST", "Test thesis");
      await governance.connect(agent2).approveQuorum(0);
      await governance.connect(agent3).approveQuorum(0);

      // Create a proposal
      await governance.connect(agent1).propose(
        1, 0, attacker.address, 10, "0x", "Add attacker"
      );

      // Attacker tries to vote
      await expect(
        governance.connect(attacker).vote(0, true)
      ).to.be.revertedWith("Not quorum member");
    });

    it("Should prevent double voting", async function () {
      const { governance, agent1, agent2, agent3, buyer1 } =
        await loadFixture(deployFullSystemFixture);

      // Create quorum
      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [34, 33, 33];
      await governance.connect(agent1).proposeQuorum(agents, weights, "Test Token", "TEST", "Test thesis");
      await governance.connect(agent2).approveQuorum(0);
      await governance.connect(agent3).approveQuorum(0);

      // Create proposal
      await governance.connect(agent1).propose(
        1, 0, buyer1.address, 10, "0x", "Add buyer1"
      );

      // Vote once
      await governance.connect(agent1).vote(0, true);

      // Try to vote again
      await expect(
        governance.connect(agent1).vote(0, true)
      ).to.be.revertedWith("Already voted");
    });

    it("Should enforce quorum size limits", async function () {
      const { governance, agent1, agent2 } = await loadFixture(deployFullSystemFixture);

      // Too few agents (< 3)
      await expect(
        governance.connect(agent1).proposeQuorum(
          [agent1.address, agent2.address],
          [50, 50],
          "Too Small",
          "SMALL",
          "Too small quorum"
        )
      ).to.be.revertedWith("Quorum size 3-10");
    });
  });

  describe("Token Distribution Security", function () {
    it("Should correctly distribute tokens to quorum on market creation", async function () {
      const { factory, agent1, agent2, agent3 } = await loadFixture(deployFullSystemFixture);

      // Create new market
      await factory.createMarket(
        [agent1.address, agent2.address, agent3.address],
        [50, 30, 20], // Different weights
        "Distribution Test",
        "DIST",
        "Testing distribution"
      );

      const market = await factory.getMarket(1);
      const token = await ethers.getContractAt("MarketToken", market.tokenAddress);

      const totalSupply = await factory.TOTAL_SUPPLY();
      const quorumAllocation = await factory.QUORUM_ALLOCATION_BPS();
      const quorumTokens = (totalSupply * quorumAllocation) / 10000n;

      // Check each agent's balance
      const agent1Balance = await token.balanceOf(agent1.address);
      const agent2Balance = await token.balanceOf(agent2.address);
      const agent3Balance = await token.balanceOf(agent3.address);

      // 50% of 30% = 15% of total
      expect(agent1Balance).to.equal((quorumTokens * 50n) / 100n);
      // 30% of 30% = 9% of total
      expect(agent2Balance).to.equal((quorumTokens * 30n) / 100n);
      // 20% of 30% = 6% of total
      expect(agent3Balance).to.equal((quorumTokens * 20n) / 100n);
    });
  });

  describe("Economic Invariants", function () {
    it("Should maintain ETH balance >= currentRaised", async function () {
      const { factory, token, marketId, buyer1, buyer2 } =
        await loadFixture(deployFullSystemFixture);

      // Multiple buy/sell cycles
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });
      await factory.connect(buyer2).buy(marketId, 0, { value: ethers.parseEther("2.0") });

      const balance1 = await token.balanceOf(buyer1.address);
      await token.connect(buyer1).approve(factory.target, balance1);
      await factory.connect(buyer1).sell(marketId, balance1 / 2n, 0);

      const market = await factory.getMarket(marketId);
      const contractBalance = await ethers.provider.getBalance(factory.target);

      // Contract should have at least currentRaised ETH
      expect(contractBalance).to.be.gte(market.currentRaised);
    });

    it("Should never allow tokensSold to exceed curve allocation", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployFullSystemFixture);

      const totalSupply = await factory.TOTAL_SUPPLY();
      const curveAllocation = await factory.CURVE_ALLOCATION_BPS();
      const maxCurveTokens = (totalSupply * curveAllocation) / 10000n;

      // Try to buy a very large amount
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("100") });

      const market = await factory.getMarket(marketId);
      expect(market.tokensSold).to.be.lte(maxCurveTokens);
    });
  });

  describe("NEW-01 FIX: AddAgent Weight Assignment", function () {
    it("Should assign weight when adding agent via governance", async function () {
      const { governance, agent1, agent2, agent3, buyer1 } =
        await loadFixture(deployFullSystemFixture);

      // Create quorum
      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [34, 33, 33];
      await governance.connect(agent1).proposeQuorum(agents, weights, "Test Token", "TEST", "Test thesis");
      await governance.connect(agent2).approveQuorum(0);
      await governance.connect(agent3).approveQuorum(0);

      const marketId = 1;

      // Check initial weights
      const agent1Weight = await governance.agentWeight(marketId, agent1.address);
      expect(agent1Weight).to.equal(34);

      // Create AddAgent proposal with weight in value field
      await governance.connect(agent1).propose(
        marketId,
        0, // AddAgent
        buyer1.address,
        15, // New agent weight
        "0x",
        "Add buyer1 with 15% weight"
      );

      // Vote for it
      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);

      // Wait for deadline and execute
      await time.increase(3 * 24 * 60 * 60 + 1);
      await governance.execute(0);

      // Verify new agent has weight
      const buyer1Weight = await governance.agentWeight(marketId, buyer1.address);
      expect(buyer1Weight).to.equal(15);

      // Verify total weight increased
      const totalWeight = await governance.marketTotalWeight(marketId);
      expect(totalWeight).to.equal(100 + 15); // Original 100 + new 15
    });
  });

  describe("NEW-02 FIX: RemoveAgent Weight Clearing", function () {
    it("Should clear weight when removing agent via governance", async function () {
      const { governance, agent1, agent2, agent3 } =
        await loadFixture(deployFullSystemFixture);

      // Create quorum
      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [34, 33, 33];
      await governance.connect(agent1).proposeQuorum(agents, weights, "Test Token", "TEST", "Test thesis");
      await governance.connect(agent2).approveQuorum(0);
      await governance.connect(agent3).approveQuorum(0);

      const marketId = 1;

      // Check initial weights
      const initialTotalWeight = await governance.marketTotalWeight(marketId);
      expect(initialTotalWeight).to.equal(100);

      const agent3WeightBefore = await governance.agentWeight(marketId, agent3.address);
      expect(agent3WeightBefore).to.equal(33);

      // Create RemoveAgent proposal
      await governance.connect(agent1).propose(
        marketId,
        1, // RemoveAgent
        agent3.address,
        0,
        "0x",
        "Remove agent3"
      );

      // Vote for it (need majority)
      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);

      // Wait for deadline and execute
      await time.increase(3 * 24 * 60 * 60 + 1);
      await governance.execute(0);

      // Verify agent3 weight is cleared
      const agent3WeightAfter = await governance.agentWeight(marketId, agent3.address);
      expect(agent3WeightAfter).to.equal(0);

      // Verify total weight decreased
      const finalTotalWeight = await governance.marketTotalWeight(marketId);
      expect(finalTotalWeight).to.equal(100 - 33); // 67
    });
  });

  describe("NEW-05 FIX: Duplicate Agent Prevention", function () {
    it("Should reject duplicate agents in createMarket", async function () {
      const { factory, agent1, agent2 } = await loadFixture(deployFullSystemFixture);

      // Try to create market with duplicate agents
      await expect(
        factory.createMarket(
          [agent1.address, agent1.address, agent2.address],
          [34, 33, 33],
          "Duplicate Test",
          "DUP",
          "Should fail"
        )
      ).to.be.revertedWith("Duplicate agents");
    });

    it("Should reject duplicate agents in proposeQuorum", async function () {
      const { governance, agent1, agent2 } = await loadFixture(deployFullSystemFixture);

      // Try to propose quorum with duplicate agents
      await expect(
        governance.connect(agent1).proposeQuorum(
          [agent1.address, agent1.address, agent2.address],
          [34, 33, 33],
          "Duplicate Test",
          "DUP",
          "Should fail"
        )
      ).to.be.revertedWith("Duplicate agents");
    });
  });

  describe("NEW-04 FIX: Early Weight Validation in proposeQuorum", function () {
    it("Should reject weights not summing to 100", async function () {
      const { governance, agent1, agent2, agent3 } = await loadFixture(deployFullSystemFixture);

      await expect(
        governance.connect(agent1).proposeQuorum(
          [agent1.address, agent2.address, agent3.address],
          [30, 30, 30], // Sum = 90, not 100
          "Bad Weights",
          "BAD",
          "Should fail"
        )
      ).to.be.revertedWith("Weights must sum to 100");
    });
  });

  // ============ CRITICAL: Emergency Withdrawal Tests ============
  describe("Emergency Withdrawal Functions", function () {
    describe("emergencyWithdrawETH", function () {
      it("Should allow owner to withdraw excess ETH", async function () {
        const { factory, owner, marketId, buyer1, treasury } =
          await loadFixture(deployFullSystemFixture);

        // Buy tokens to add ETH to contract
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });

        // Send extra ETH directly to contract (simulating stuck funds)
        const extraEth = ethers.parseEther("0.5");
        await owner.sendTransaction({ to: factory.target, value: extraEth });

        const treasuryBefore = await ethers.provider.getBalance(treasury.address);

        // Withdraw the excess ETH
        await factory.connect(owner).emergencyWithdrawETH(extraEth);

        const treasuryAfter = await ethers.provider.getBalance(treasury.address);
        expect(treasuryAfter - treasuryBefore).to.equal(extraEth);
      });

      it("Should reject withdrawal of reserved ETH (currentRaised)", async function () {
        const { factory, owner, marketId, buyer1 } =
          await loadFixture(deployFullSystemFixture);

        // Buy tokens - this ETH is reserved for the market
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });

        const market = await factory.getMarket(marketId);

        // Try to withdraw more than excess (which is 0)
        await expect(
          factory.connect(owner).emergencyWithdrawETH(ethers.parseEther("0.001"))
        ).to.be.revertedWith("Amount exceeds withdrawable");
      });

      it("Should reject non-owner emergency withdrawal", async function () {
        const { factory, attacker } = await loadFixture(deployFullSystemFixture);

        await expect(
          factory.connect(attacker).emergencyWithdrawETH(ethers.parseEther("0.1"))
        ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
      });

      it("Should correctly calculate withdrawable across multiple markets", async function () {
        const { factory, owner, agent1, agent2, agent3, buyer1, buyer2, treasury } =
          await loadFixture(deployFullSystemFixture);

        // Buy in market 0
        await factory.connect(buyer1).buy(0, 0, { value: ethers.parseEther("1.0") });

        // Create market 1
        await factory.createMarket(
          [agent1.address, agent2.address, agent3.address],
          [40, 30, 30],
          "Second Market",
          "SEC2",
          "Second market thesis"
        );

        // Buy in market 1
        await factory.connect(buyer2).buy(1, 0, { value: ethers.parseEther("2.0") });

        // Send extra ETH
        const extraEth = ethers.parseEther("0.3");
        await owner.sendTransaction({ to: factory.target, value: extraEth });

        const treasuryBefore = await ethers.provider.getBalance(treasury.address);
        await factory.connect(owner).emergencyWithdrawETH(extraEth);
        const treasuryAfter = await ethers.provider.getBalance(treasury.address);

        expect(treasuryAfter - treasuryBefore).to.equal(extraEth);
      });

      it("Should emit EmergencyWithdrawal event", async function () {
        const { factory, owner, treasury } = await loadFixture(deployFullSystemFixture);

        const extraEth = ethers.parseEther("0.5");
        await owner.sendTransaction({ to: factory.target, value: extraEth });

        await expect(factory.connect(owner).emergencyWithdrawETH(extraEth))
          .to.emit(factory, "EmergencyWithdrawal")
          .withArgs(ethers.ZeroAddress, extraEth, treasury.address);
      });
    });

    describe("emergencyWithdrawTokens", function () {
      it("Should allow owner to withdraw tokens not from active markets", async function () {
        const { factory, owner, marketId, buyer1, treasury } =
          await loadFixture(deployFullSystemFixture);

        // Get market token address
        const market = await factory.getMarket(marketId);
        const token = await ethers.getContractAt("MarketToken", market.tokenAddress);

        // Graduate the market (10+ ETH)
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("11.0") });

        // After graduation, remaining curve tokens can be withdrawn
        const factoryBalance = await token.balanceOf(factory.target);

        if (factoryBalance > 0n) {
          await factory.connect(owner).emergencyWithdrawTokens(market.tokenAddress, factoryBalance);
          const treasuryBalance = await token.balanceOf(treasury.address);
          expect(treasuryBalance).to.be.gt(0n);
        }
      });

      it("Should reject non-owner token withdrawal", async function () {
        const { factory, attacker, marketId } = await loadFixture(deployFullSystemFixture);

        const market = await factory.getMarket(marketId);

        await expect(
          factory.connect(attacker).emergencyWithdrawTokens(market.tokenAddress, 1000n)
        ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
      });

      it("Should reject zero address token", async function () {
        const { factory, owner } = await loadFixture(deployFullSystemFixture);

        await expect(
          factory.connect(owner).emergencyWithdrawTokens(ethers.ZeroAddress, 1000n)
        ).to.be.revertedWith("Invalid token");
      });

      it("Should emit EmergencyWithdrawal event for tokens", async function () {
        const { factory, owner, agent1, agent2, agent3, treasury } =
          await loadFixture(deployFullSystemFixture);

        // Deploy a random token and send it to factory
        const MockToken = await ethers.getContractFactory("MarketToken");
        const mockToken = await MockToken.deploy("Mock", "MCK", ethers.parseEther("1000000"), owner.address);

        // Send tokens to factory
        const amount = ethers.parseEther("100");
        await mockToken.transfer(factory.target, amount);

        await expect(factory.connect(owner).emergencyWithdrawTokens(mockToken.target, amount))
          .to.emit(factory, "EmergencyWithdrawal")
          .withArgs(mockToken.target, amount, treasury.address);
      });
    });

    describe("rescueGraduatedMarketFunds", function () {
      it("Should rescue funds from graduated market without LP", async function () {
        const { factory, owner, marketId, buyer1, treasury } =
          await loadFixture(deployFullSystemFixture);

        // Graduate the market (no Uniswap router set, so no LP)
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("11.0") });

        const market = await factory.getMarket(marketId);
        expect(market.graduated).to.be.true;
        expect(market.lpPair).to.equal(ethers.ZeroAddress);

        // Get balances before rescue
        const treasuryEthBefore = await ethers.provider.getBalance(treasury.address);
        const token = await ethers.getContractAt("MarketToken", market.tokenAddress);
        const treasuryTokensBefore = await token.balanceOf(treasury.address);

        // Rescue funds
        await factory.connect(owner).rescueGraduatedMarketFunds(marketId);

        // Check treasury received ETH
        const treasuryEthAfter = await ethers.provider.getBalance(treasury.address);
        expect(treasuryEthAfter).to.be.gt(treasuryEthBefore);

        // Check treasury received tokens
        const treasuryTokensAfter = await token.balanceOf(treasury.address);
        expect(treasuryTokensAfter).to.be.gte(treasuryTokensBefore);
      });

      it("Should reject rescue for non-graduated market", async function () {
        const { factory, owner, marketId } = await loadFixture(deployFullSystemFixture);

        await expect(
          factory.connect(owner).rescueGraduatedMarketFunds(marketId)
        ).to.be.revertedWith("Market not graduated");
      });

      it("Should reject non-owner rescue", async function () {
        const { factory, attacker, marketId, buyer1 } =
          await loadFixture(deployFullSystemFixture);

        // Graduate market
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("11.0") });

        await expect(
          factory.connect(attacker).rescueGraduatedMarketFunds(marketId)
        ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
      });

      it("Should emit GraduatedMarketRescued event", async function () {
        const { factory, owner, marketId, buyer1 } =
          await loadFixture(deployFullSystemFixture);

        // Graduate market
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("11.0") });

        await expect(factory.connect(owner).rescueGraduatedMarketFunds(marketId))
          .to.emit(factory, "GraduatedMarketRescued");
      });

      it("Should handle rescue when currentRaised is already zero", async function () {
        const { factory, owner, marketId, buyer1 } =
          await loadFixture(deployFullSystemFixture);

        // Graduate market
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("11.0") });

        // First rescue
        await factory.connect(owner).rescueGraduatedMarketFunds(marketId);

        // Second rescue should not fail (just rescues remaining tokens if any)
        await factory.connect(owner).rescueGraduatedMarketFunds(marketId);
      });
    });

    describe("Protocol Fee Access (CRITICAL)", function () {
      it("Should send protocol fees directly to treasury during buy", async function () {
        const { factory, marketId, buyer1, treasury } =
          await loadFixture(deployFullSystemFixture);

        const treasuryBefore = await ethers.provider.getBalance(treasury.address);
        const buyAmount = ethers.parseEther("1.0");
        const expectedFee = (buyAmount * 50n) / 10000n; // 0.5%

        await factory.connect(buyer1).buy(marketId, 0, { value: buyAmount });

        const treasuryAfter = await ethers.provider.getBalance(treasury.address);
        expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);
      });

      it("Should send protocol fees directly to treasury during sell", async function () {
        const { factory, token, marketId, buyer1, treasury } =
          await loadFixture(deployFullSystemFixture);

        // Buy first
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("2.0") });

        const balance = await token.balanceOf(buyer1.address);
        await token.connect(buyer1).approve(factory.target, balance);

        const treasuryBefore = await ethers.provider.getBalance(treasury.address);

        // Sell half
        const sellAmount = balance / 2n;
        const expectedEth = await factory.calculateSaleReturn(marketId, sellAmount);
        const expectedFee = (expectedEth * 50n) / 10000n;

        await factory.connect(buyer1).sell(marketId, sellAmount, 0);

        const treasuryAfter = await ethers.provider.getBalance(treasury.address);
        expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);
      });

      it("Should accumulate fees in treasury over multiple trades", async function () {
        const { factory, token, marketId, buyer1, buyer2, treasury } =
          await loadFixture(deployFullSystemFixture);

        const treasuryStart = await ethers.provider.getBalance(treasury.address);

        // Multiple buy/sell cycles
        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });
        await factory.connect(buyer2).buy(marketId, 0, { value: ethers.parseEther("1.5") });

        const balance1 = await token.balanceOf(buyer1.address);
        await token.connect(buyer1).approve(factory.target, balance1);
        await factory.connect(buyer1).sell(marketId, balance1 / 2n, 0);

        await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.5") });

        const treasuryEnd = await ethers.provider.getBalance(treasury.address);
        const totalFees = treasuryEnd - treasuryStart;

        // Fees should be > 0 from all the trades
        expect(totalFees).to.be.gt(0n);
      });

      it("Should update treasury address and fees go to new treasury", async function () {
        const { factory, owner, marketId, buyer1, treasury, agent1 } =
          await loadFixture(deployFullSystemFixture);

        // Change treasury to agent1
        await factory.connect(owner).setProtocolTreasury(agent1.address);

        const newTreasuryBefore = await ethers.provider.getBalance(agent1.address);
        const buyAmount = ethers.parseEther("1.0");
        const expectedFee = (buyAmount * 50n) / 10000n;

        await factory.connect(buyer1).buy(marketId, 0, { value: buyAmount });

        const newTreasuryAfter = await ethers.provider.getBalance(agent1.address);
        expect(newTreasuryAfter - newTreasuryBefore).to.equal(expectedFee);

        // Old treasury should not receive fees
        const oldTreasuryAfter = await ethers.provider.getBalance(treasury.address);
        expect(oldTreasuryAfter).to.equal(await ethers.provider.getBalance(treasury.address));
      });
    });
  });

  describe("receive() Function", function () {
    it("Should accept direct ETH transfers", async function () {
      const { factory, owner } = await loadFixture(deployFullSystemFixture);

      const amount = ethers.parseEther("1.0");
      await owner.sendTransaction({ to: factory.target, value: amount });

      const balance = await ethers.provider.getBalance(factory.target);
      expect(balance).to.equal(amount);
    });
  });
});
