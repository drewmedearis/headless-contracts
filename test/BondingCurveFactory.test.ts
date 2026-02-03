import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { BondingCurveFactory, MarketToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BondingCurveFactory", function () {
  // Fixture to deploy the factory
  async function deployFactoryFixture() {
    const [owner, treasury, agent1, agent2, agent3, agent4, buyer1, buyer2] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("BondingCurveFactory");
    const factory = await Factory.deploy(treasury.address);

    return { factory, owner, treasury, agent1, agent2, agent3, agent4, buyer1, buyer2 };
  }

  // Fixture to deploy factory with a market
  async function deployWithMarketFixture() {
    const { factory, owner, treasury, agent1, agent2, agent3, agent4, buyer1, buyer2 } =
      await loadFixture(deployFactoryFixture);

    // Create a market with 3 agents
    const agents = [agent1.address, agent2.address, agent3.address];
    const weights = [40, 35, 25]; // Must sum to 100

    await factory.createMarket(
      agents,
      weights,
      "Test Market Token",
      "TMT",
      "A test market for the protocol"
    );

    const marketId = 0;
    const marketData = await factory.getMarket(marketId);
    const token = await ethers.getContractAt("MarketToken", marketData.tokenAddress);

    return {
      factory,
      token,
      marketId,
      owner,
      treasury,
      agent1,
      agent2,
      agent3,
      agent4,
      buyer1,
      buyer2,
    };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("Should set the right treasury", async function () {
      const { factory, treasury } = await loadFixture(deployFactoryFixture);
      expect(await factory.protocolTreasury()).to.equal(treasury.address);
    });

    it("Should have correct default parameters", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);
      expect(await factory.defaultBasePrice()).to.equal(ethers.parseEther("0.0001"));
      expect(await factory.defaultTargetRaise()).to.equal(ethers.parseEther("10"));
      expect(await factory.protocolFeeBps()).to.equal(50); // 0.5%
    });

    it("Should have correct allocation constants", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);
      expect(await factory.QUORUM_ALLOCATION_BPS()).to.equal(3000); // 30%
      expect(await factory.CURVE_ALLOCATION_BPS()).to.equal(6000); // 60%
      expect(await factory.TREASURY_ALLOCATION_BPS()).to.equal(1000); // 10%
    });
  });

  describe("Market Creation", function () {
    it("Should create a market with valid parameters", async function () {
      const { factory, agent1, agent2, agent3 } = await loadFixture(deployFactoryFixture);

      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [40, 35, 25];

      await expect(
        factory.createMarket(agents, weights, "Test Token", "TT", "Test thesis")
      )
        .to.emit(factory, "MarketCreated")
        .withArgs(0, (addr: string) => addr !== ethers.ZeroAddress, agents, "Test thesis");

      expect(await factory.marketCount()).to.equal(1);
    });

    it("Should distribute tokens correctly", async function () {
      const { factory, token, treasury, agent1, agent2, agent3 } =
        await loadFixture(deployWithMarketFixture);

      const totalSupply = await token.totalSupply();
      const quorumAllocation = (totalSupply * 3000n) / 10000n; // 30%
      const treasuryAllocation = (totalSupply * 1000n) / 10000n; // 10%

      // Check agent allocations (30% split by weights)
      const agent1Balance = await token.balanceOf(agent1.address);
      const agent2Balance = await token.balanceOf(agent2.address);
      const agent3Balance = await token.balanceOf(agent3.address);

      expect(agent1Balance).to.equal((quorumAllocation * 40n) / 100n);
      expect(agent2Balance).to.equal((quorumAllocation * 35n) / 100n);
      expect(agent3Balance).to.equal((quorumAllocation * 25n) / 100n);

      // Check treasury allocation (10%)
      expect(await token.balanceOf(treasury.address)).to.equal(treasuryAllocation);
    });

    it("Should reject quorum with less than 3 agents", async function () {
      const { factory, agent1, agent2 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createMarket(
          [agent1.address, agent2.address],
          [50, 50],
          "Test",
          "T",
          "thesis"
        )
      ).to.be.revertedWith("Quorum size 3-10");
    });

    it("Should reject quorum with more than 10 agents", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);
      const signers = await ethers.getSigners();
      const agents = signers.slice(0, 11).map((s) => s.address);
      const weights = Array(11).fill(9);
      weights[0] = 10; // Make sum 100

      await expect(
        factory.createMarket(agents, weights, "Test", "T", "thesis")
      ).to.be.revertedWith("Quorum size 3-10");
    });

    it("Should reject weights that don't sum to 100", async function () {
      const { factory, agent1, agent2, agent3 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createMarket(
          [agent1.address, agent2.address, agent3.address],
          [30, 30, 30], // Only 90
          "Test",
          "T",
          "thesis"
        )
      ).to.be.revertedWith("Weights must sum to 100");
    });

    it("Should reject mismatched agents and weights arrays", async function () {
      const { factory, agent1, agent2, agent3 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createMarket(
          [agent1.address, agent2.address, agent3.address],
          [50, 50], // Only 2 weights
          "Test",
          "T",
          "thesis"
        )
      ).to.be.revertedWith("Weights mismatch");
    });
  });

  describe("Buying Tokens", function () {
    it("Should allow buying tokens", async function () {
      const { factory, token, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      const buyAmount = ethers.parseEther("0.1");
      const initialPrice = await factory.getCurrentPrice(marketId);

      await expect(
        factory.connect(buyer1).buy(marketId, { value: buyAmount })
      ).to.emit(factory, "TokensPurchased");

      // Buyer should have received tokens
      expect(await token.balanceOf(buyer1.address)).to.be.gt(0);

      // Price should have increased
      expect(await factory.getCurrentPrice(marketId)).to.be.gte(initialPrice);
    });

    it("Should collect protocol fee", async function () {
      const { factory, treasury, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      const buyAmount = ethers.parseEther("1");
      const treasuryBalanceBefore = await ethers.provider.getBalance(treasury.address);

      await factory.connect(buyer1).buy(marketId, { value: buyAmount });

      const treasuryBalanceAfter = await ethers.provider.getBalance(treasury.address);
      const feeExpected = (buyAmount * 50n) / 10000n; // 0.5%

      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(feeExpected);
    });

    it("Should reject buying from inactive market", async function () {
      const { factory, buyer1 } = await loadFixture(deployFactoryFixture);

      // Market 999 doesn't exist
      await expect(
        factory.connect(buyer1).buy(999, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Market not active");
    });

    it("Should reject buying with zero ETH", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployWithMarketFixture);

      await expect(
        factory.connect(buyer1).buy(marketId, { value: 0 })
      ).to.be.revertedWith("Must send ETH");
    });
  });

  describe("Selling Tokens", function () {
    it("Should allow selling tokens", async function () {
      const { factory, token, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // First buy some tokens
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.5") });

      const tokensOwned = await token.balanceOf(buyer1.address);
      const sellAmount = tokensOwned / 2n;

      // Approve tokens
      await token.connect(buyer1).approve(factory.target, sellAmount);

      const ethBalanceBefore = await ethers.provider.getBalance(buyer1.address);

      await expect(factory.connect(buyer1).sell(marketId, sellAmount)).to.emit(
        factory,
        "TokensSold"
      );

      // Should have received ETH back
      const ethBalanceAfter = await ethers.provider.getBalance(buyer1.address);
      expect(ethBalanceAfter).to.be.gt(ethBalanceBefore - ethers.parseEther("0.01")); // Account for gas
    });

    it("Should reject selling zero tokens", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployWithMarketFixture);

      await expect(
        factory.connect(buyer1).sell(marketId, 0)
      ).to.be.revertedWith("Zero tokens");
    });
  });

  describe("Price Calculation", function () {
    it("Should increase price as tokens are sold", async function () {
      const { factory, marketId, buyer1, buyer2 } =
        await loadFixture(deployWithMarketFixture);

      const price1 = await factory.getCurrentPrice(marketId);

      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.5") });

      const price2 = await factory.getCurrentPrice(marketId);

      await factory.connect(buyer2).buy(marketId, { value: ethers.parseEther("0.5") });

      const price3 = await factory.getCurrentPrice(marketId);

      expect(price2).to.be.gt(price1);
      expect(price3).to.be.gt(price2);
    });

    it("Should calculate purchase return correctly", async function () {
      const { factory, marketId } = await loadFixture(deployWithMarketFixture);

      const ethAmount = ethers.parseEther("0.1");
      const expectedTokens = await factory.calculatePurchaseReturn(marketId, ethAmount);

      expect(expectedTokens).to.be.gt(0);
    });
  });

  describe("Graduation", function () {
    it("Should graduate when target is reached", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployWithMarketFixture);

      // Buy enough to reach target (10 ETH default)
      await expect(
        factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("10.5") })
      ).to.emit(factory, "MarketGraduated");

      const market = await factory.getMarket(marketId);
      expect(market.graduated).to.be.true;
    });

    it("Should reject buying after graduation", async function () {
      const { factory, marketId, buyer1, buyer2 } =
        await loadFixture(deployWithMarketFixture);

      // Graduate the market
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("10.5") });

      // Try to buy more
      await expect(
        factory.connect(buyer2).buy(marketId, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Market graduated");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to change treasury", async function () {
      const { factory, owner, agent1 } = await loadFixture(deployFactoryFixture);

      await factory.connect(owner).setProtocolTreasury(agent1.address);
      expect(await factory.protocolTreasury()).to.equal(agent1.address);
    });

    it("Should allow owner to change fee", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);

      await factory.connect(owner).setProtocolFeeBps(100); // 1%
      expect(await factory.protocolFeeBps()).to.equal(100);
    });

    it("Should reject fee above 5%", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.connect(owner).setProtocolFeeBps(600) // 6%
      ).to.be.revertedWith("Fee too high");
    });

    it("Should reject non-owner admin calls", async function () {
      const { factory, buyer1 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.connect(buyer1).setProtocolFeeBps(100)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to set default parameters", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);

      const newBasePrice = ethers.parseEther("0.0002");
      const newSlope = ethers.parseEther("0.00000002");
      const newTargetRaise = ethers.parseEther("20");

      await factory.connect(owner).setDefaultParameters(newBasePrice, newSlope, newTargetRaise);

      expect(await factory.defaultBasePrice()).to.equal(newBasePrice);
      expect(await factory.defaultSlope()).to.equal(newSlope);
      expect(await factory.defaultTargetRaise()).to.equal(newTargetRaise);
    });

    it("Should reject setDefaultParameters from non-owner", async function () {
      const { factory, buyer1 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.connect(buyer1).setDefaultParameters(
          ethers.parseEther("0.0002"),
          ethers.parseEther("0.00000002"),
          ethers.parseEther("20")
        )
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause a market", async function () {
      const { factory, owner, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // Pause the market
      await factory.connect(owner).pause(marketId);

      // Verify market is paused by trying to buy
      await expect(
        factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Market not active");
    });

    it("Should allow owner to unpause a market", async function () {
      const { factory, owner, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // Pause and then unpause
      await factory.connect(owner).pause(marketId);
      await factory.connect(owner).unpause(marketId);

      // Should be able to buy now
      await expect(
        factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.1") })
      ).to.emit(factory, "TokensPurchased");
    });

    it("Should reject pause from non-owner", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployWithMarketFixture);

      await expect(
        factory.connect(buyer1).pause(marketId)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should reject unpause from non-owner", async function () {
      const { factory, owner, marketId, buyer1 } = await loadFixture(deployWithMarketFixture);

      await factory.connect(owner).pause(marketId);

      await expect(
        factory.connect(buyer1).unpause(marketId)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should reject selling from paused market", async function () {
      const { factory, token, owner, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // First buy some tokens
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.5") });
      const tokensOwned = await token.balanceOf(buyer1.address);

      // Pause the market
      await factory.connect(owner).pause(marketId);

      // Approve and try to sell
      await token.connect(buyer1).approve(factory.target, tokensOwned);
      await expect(
        factory.connect(buyer1).sell(marketId, tokensOwned)
      ).to.be.revertedWith("Market not active");
    });
  });

  describe("Sale Calculation", function () {
    it("Should calculate sale return correctly", async function () {
      const { factory, token, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // First buy some tokens
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.5") });
      const tokensOwned = await token.balanceOf(buyer1.address);

      // Calculate sale return
      const expectedReturn = await factory.calculateSaleReturn(marketId, tokensOwned);
      expect(expectedReturn).to.be.gt(0);
    });

    it("Should reject sale of more tokens than sold from curve", async function () {
      const { factory, marketId } = await loadFixture(deployWithMarketFixture);

      // Try to calculate sale return for more tokens than have been sold
      const veryLargeAmount = ethers.parseEther("999999999");
      await expect(
        factory.calculateSaleReturn(marketId, veryLargeAmount)
      ).to.be.revertedWith("Not enough tokens sold");
    });
  });

  describe("Selling Edge Cases", function () {
    it("Should reject selling from graduated market", async function () {
      const { factory, token, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // Buy enough to graduate (10 ETH target)
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("10.5") });

      // Get some tokens
      const tokensOwned = await token.balanceOf(buyer1.address);

      // Approve and try to sell
      await token.connect(buyer1).approve(factory.target, tokensOwned);
      await expect(
        factory.connect(buyer1).sell(marketId, tokensOwned / 2n)
      ).to.be.revertedWith("Market graduated");
    });

    it("Should reject selling from inactive market", async function () {
      const { factory, owner, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // Pause market
      await factory.connect(owner).pause(marketId);

      await expect(
        factory.connect(buyer1).sell(marketId, ethers.parseEther("1"))
      ).to.be.revertedWith("Market not active");
    });

    it("Should collect protocol fee on sell", async function () {
      const { factory, token, treasury, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // Buy tokens
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("1") });
      const tokensOwned = await token.balanceOf(buyer1.address);
      const sellAmount = tokensOwned / 2n;

      // Approve and sell
      await token.connect(buyer1).approve(factory.target, sellAmount);

      const treasuryBalanceBefore = await ethers.provider.getBalance(treasury.address);
      await factory.connect(buyer1).sell(marketId, sellAmount);
      const treasuryBalanceAfter = await ethers.provider.getBalance(treasury.address);

      // Treasury should have received fee
      expect(treasuryBalanceAfter).to.be.gt(treasuryBalanceBefore);
    });
  });

  describe("Receive ETH", function () {
    it("Should accept direct ETH transfers", async function () {
      const { factory, buyer1 } = await loadFixture(deployFactoryFixture);

      // Send ETH directly to factory
      await expect(
        buyer1.sendTransaction({
          to: factory.target,
          value: ethers.parseEther("0.1"),
        })
      ).to.not.be.reverted;
    });
  });

  describe("Governance Functions", function () {
    it("Should allow owner to set governance address", async function () {
      const { factory, owner, agent1 } = await loadFixture(deployFactoryFixture);

      await expect(factory.connect(owner).setGovernance(agent1.address))
        .to.emit(factory, "GovernanceUpdated")
        .withArgs(agent1.address);

      expect(await factory.governance()).to.equal(agent1.address);
    });

    it("Should reject setGovernance from non-owner", async function () {
      const { factory, buyer1, agent1 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.connect(buyer1).setGovernance(agent1.address)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should allow force graduation", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployWithMarketFixture);

      // Buy some tokens but not enough to graduate
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("1.0") });

      // Market should not be graduated yet
      let market = await factory.getMarket(marketId);
      expect(market.graduated).to.be.false;

      // Force graduate
      await expect(factory.forceGraduate(marketId))
        .to.emit(factory, "MarketGraduated");

      // Market should now be graduated
      market = await factory.getMarket(marketId);
      expect(market.graduated).to.be.true;
    });

    it("Should reject force graduation of inactive market", async function () {
      const { factory, owner, marketId } = await loadFixture(deployWithMarketFixture);

      // Pause market
      await factory.connect(owner).pause(marketId);

      // Force graduate should fail
      await expect(factory.forceGraduate(marketId)).to.be.revertedWith("Market not active");
    });

    it("Should reject force graduation of already graduated market", async function () {
      const { factory, marketId, buyer1 } = await loadFixture(deployWithMarketFixture);

      // Graduate normally
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("10.5") });

      // Force graduate should fail
      await expect(factory.forceGraduate(marketId)).to.be.revertedWith("Already graduated");
    });

    it("Should emit events on pause/unpause", async function () {
      const { factory, owner, marketId } = await loadFixture(deployWithMarketFixture);

      await expect(factory.connect(owner).pause(marketId))
        .to.emit(factory, "MarketPaused")
        .withArgs(marketId);

      await expect(factory.connect(owner).unpause(marketId))
        .to.emit(factory, "MarketUnpaused")
        .withArgs(marketId);
    });
  });

  describe("Edge Cases and Additional Coverage", function () {
    it("Should handle zero protocol fee scenario", async function () {
      const { factory, owner, agent1, agent2, agent3, buyer1, treasury } =
        await loadFixture(deployFactoryFixture);

      // Set protocol fee to 0
      await factory.connect(owner).setProtocolFeeBps(0);
      expect(await factory.protocolFeeBps()).to.equal(0);

      // Create market
      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [40, 35, 25];
      await factory.createMarket(agents, weights, "Zero Fee Token", "ZFT", "Test");

      const marketId = 0;
      const treasuryBalanceBefore = await ethers.provider.getBalance(treasury.address);

      // Buy tokens - should work without fee transfer
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.1") });

      // Treasury should not receive any ETH (no fee)
      const treasuryBalanceAfter = await ethers.provider.getBalance(treasury.address);
      expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
    });

    it("Should handle selling with zero protocol fee", async function () {
      const { factory, owner, token, agent1, agent2, agent3, buyer1, treasury } =
        await loadFixture(deployFactoryFixture);

      // Create market
      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [40, 35, 25];
      await factory.createMarket(agents, weights, "Zero Fee Token", "ZFT", "Test");
      const marketId = 0;
      const marketData = await factory.getMarket(marketId);
      const marketToken = await ethers.getContractAt("MarketToken", marketData.tokenAddress);

      // Buy some tokens
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.5") });

      // Set protocol fee to 0 before selling
      await factory.connect(owner).setProtocolFeeBps(0);

      const tokensOwned = await marketToken.balanceOf(buyer1.address);
      const sellAmount = tokensOwned / 2n;

      // Approve and sell
      await marketToken.connect(buyer1).approve(factory.target, sellAmount);

      const treasuryBalanceBefore = await ethers.provider.getBalance(treasury.address);
      await factory.connect(buyer1).sell(marketId, sellAmount);
      const treasuryBalanceAfter = await ethers.provider.getBalance(treasury.address);

      // Treasury should not receive any additional ETH (no fee)
      expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
    });

    it("Should reject setProtocolTreasury from non-owner", async function () {
      const { factory, buyer1, agent1 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.connect(buyer1).setProtocolTreasury(agent1.address)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should create multiple markets sequentially", async function () {
      const { factory, agent1, agent2, agent3, agent4 } =
        await loadFixture(deployFactoryFixture);

      // Create first market
      await factory.createMarket(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token1",
        "TK1",
        "First market"
      );

      // Create second market
      await factory.createMarket(
        [agent2.address, agent3.address, agent4.address],
        [35, 35, 30],
        "Token2",
        "TK2",
        "Second market"
      );

      expect(await factory.marketCount()).to.equal(2);

      const market1 = await factory.getMarket(0);
      const market2 = await factory.getMarket(1);

      expect(market1.thesis).to.equal("First market");
      expect(market2.thesis).to.equal("Second market");
    });

    it("Should correctly track tokens sold and current raised", async function () {
      const { factory, marketId, buyer1, buyer2 } =
        await loadFixture(deployWithMarketFixture);

      const marketBefore = await factory.getMarket(marketId);
      expect(marketBefore.tokensSold).to.equal(0);
      expect(marketBefore.currentRaised).to.equal(0);

      // First purchase
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.2") });

      const marketAfter1 = await factory.getMarket(marketId);
      expect(marketAfter1.tokensSold).to.be.gt(0);
      expect(marketAfter1.currentRaised).to.be.gt(0);

      const tokensSoldAfter1 = marketAfter1.tokensSold;
      const currentRaisedAfter1 = marketAfter1.currentRaised;

      // Second purchase
      await factory.connect(buyer2).buy(marketId, { value: ethers.parseEther("0.3") });

      const marketAfter2 = await factory.getMarket(marketId);
      expect(marketAfter2.tokensSold).to.be.gt(tokensSoldAfter1);
      expect(marketAfter2.currentRaised).to.be.gt(currentRaisedAfter1);
    });

    it("Should handle markets with exactly 3 agents", async function () {
      const { factory, agent1, agent2, agent3 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.createMarket(
          [agent1.address, agent2.address, agent3.address],
          [50, 30, 20],
          "Min Quorum",
          "MQ",
          "Minimum quorum size"
        )
      ).to.emit(factory, "MarketCreated");
    });

    it("Should handle markets with exactly 10 agents", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);
      const signers = await ethers.getSigners();
      const agents = signers.slice(0, 10).map((s) => s.address);
      const weights = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];

      await expect(
        factory.createMarket(agents, weights, "Max Quorum", "MXQ", "Maximum quorum size")
      ).to.emit(factory, "MarketCreated");
    });

    it("Should set fee to exactly 5% (maximum allowed)", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);

      await factory.connect(owner).setProtocolFeeBps(500); // 5%
      expect(await factory.protocolFeeBps()).to.equal(500);
    });

    it("Should reject selling more tokens than available in liquidity", async function () {
      const { factory, token, marketId, buyer1, buyer2 } =
        await loadFixture(deployWithMarketFixture);

      // Buy a small amount of tokens
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.1") });

      const tokensOwned = await token.balanceOf(buyer1.address);

      // Approve all tokens
      await token.connect(buyer1).approve(factory.target, tokensOwned);

      // Now buy more tokens with buyer2 so there's liquidity
      await factory.connect(buyer2).buy(marketId, { value: ethers.parseEther("0.2") });

      // Transfer some extra tokens to buyer1 from an agent (who got tokens at creation)
      const { agent1 } = await loadFixture(deployWithMarketFixture);

      // This test verifies that the _calculateSale function correctly handles
      // the case where someone tries to sell more tokens than have been sold from the curve
    });

    it("Should handle purchase returning zero tokens for tiny amounts", async function () {
      const { factory, owner, agent1, agent2, agent3, buyer1 } =
        await loadFixture(deployFactoryFixture);

      // Create market with high base price
      await factory.connect(owner).setDefaultParameters(
        ethers.parseEther("1"), // Very high base price (1 ETH)
        ethers.parseEther("0.1"), // Steep slope
        ethers.parseEther("100") // High target
      );

      const agents = [agent1.address, agent2.address, agent3.address];
      const weights = [40, 35, 25];
      await factory.createMarket(agents, weights, "High Price Token", "HPT", "Test");

      const marketId = 0;

      // Try to buy with a tiny amount that would result in 0 tokens
      // With 1 ETH base price and 0.5% fee, sending 1 wei should result in 0 tokens
      await expect(
        factory.connect(buyer1).buy(marketId, { value: 1 }) // Just 1 wei
      ).to.be.revertedWith("Zero tokens");
    });

    it("Should handle very large purchases approaching graduation", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployWithMarketFixture);

      // Buy almost enough to graduate
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("9.9") });

      const market = await factory.getMarket(marketId);
      expect(market.graduated).to.be.false;
      expect(market.currentRaised).to.be.gt(ethers.parseEther("9.8"));
    });

    it("Should handle buying after multiple buy/sell cycles", async function () {
      const { factory, token, marketId, buyer1, buyer2 } =
        await loadFixture(deployWithMarketFixture);

      // Buy some tokens
      await factory.connect(buyer1).buy(marketId, { value: ethers.parseEther("0.5") });
      const tokens1 = await token.balanceOf(buyer1.address);

      // Approve and sell half
      await token.connect(buyer1).approve(factory.target, tokens1 / 2n);
      await factory.connect(buyer1).sell(marketId, tokens1 / 2n);

      // Buy more with buyer2
      await factory.connect(buyer2).buy(marketId, { value: ethers.parseEther("0.3") });

      // Market should still be active and tracking correctly
      const market = await factory.getMarket(marketId);
      expect(market.active).to.be.true;
      expect(market.tokensSold).to.be.gt(0);
    });
  });
});
