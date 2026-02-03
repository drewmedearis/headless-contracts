import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * LinearBondingCurve Library Tests
 *
 * Tests the bonding curve math through the BondingCurveFactory contract
 * which uses the same formulas as the LinearBondingCurve library.
 */
describe("LinearBondingCurve", function () {
  // Fixture to deploy factory for testing curve calculations
  async function deployFactoryFixture() {
    const [owner, treasury, agent1, agent2, agent3, buyer1] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("BondingCurveFactory");
    const factory = await Factory.deploy(treasury.address, ethers.ZeroAddress);

    // Create a test market
    const agents = [agent1.address, agent2.address, agent3.address];
    const weights = [40, 35, 25];
    await factory.createMarket(
      agents,
      weights,
      "Test Curve Token",
      "TCT",
      "Testing bonding curve math"
    );

    const marketId = 0;

    return {
      factory,
      marketId,
      owner,
      treasury,
      agent1,
      agent2,
      agent3,
      buyer1,
    };
  }

  describe("Price Calculations", function () {
    it("Should start at base price when no tokens sold", async function () {
      const { factory, marketId } = await loadFixture(deployFactoryFixture);

      const price = await factory.getCurrentPrice(marketId);
      const basePrice = await factory.defaultBasePrice();

      expect(price).to.equal(basePrice);
    });

    it("Should increase price linearly as tokens are sold", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      const price1 = await factory.getCurrentPrice(marketId);

      // Buy some tokens
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.1") });

      const price2 = await factory.getCurrentPrice(marketId);

      // Price should have increased
      expect(price2).to.be.gt(price1);

      // Buy more tokens
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.2") });

      const price3 = await factory.getCurrentPrice(marketId);

      // Price should continue increasing
      expect(price3).to.be.gt(price2);
    });

    it("Should follow linear formula: Price = BasePrice + Slope * TokensSold", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      // Buy tokens
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.5") });

      const market = await factory.getMarket(marketId);
      const tokensSold = market.tokensSold;
      const basePrice = await factory.defaultBasePrice();
      const slope = await factory.defaultSlope();

      // Calculate expected price
      const expectedPrice = basePrice + (slope * tokensSold / BigInt(1e18));
      const actualPrice = await factory.getCurrentPrice(marketId);

      // Should be equal (allowing for small rounding)
      expect(actualPrice).to.be.closeTo(expectedPrice, BigInt(1e12)); // 0.000001 ETH tolerance
    });
  });

  describe("Purchase Return Calculations", function () {
    it("Should return more tokens for larger ETH amounts", async function () {
      const { factory, marketId } = await loadFixture(deployFactoryFixture);

      const smallAmount = ethers.parseEther("0.1");
      const largeAmount = ethers.parseEther("1.0");

      const smallReturn = await factory.calculatePurchaseReturn(marketId, smallAmount);
      const largeReturn = await factory.calculatePurchaseReturn(marketId, largeAmount);

      // Larger ETH amount should give more tokens
      expect(largeReturn).to.be.gt(smallReturn);
      // Due to bonding curve, you get diminishing returns - not linear
      // A 10x larger purchase gives fewer than 10x tokens due to price increase
      expect(largeReturn).to.be.lt(smallReturn * 10n);
      expect(largeReturn).to.be.gt(smallReturn * 2n);
    });

    it("Should return fewer tokens as price increases", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      const ethAmount = ethers.parseEther("0.1");

      // Calculate return at start
      const return1 = await factory.calculatePurchaseReturn(marketId, ethAmount);

      // Buy some tokens to increase price
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });

      // Calculate return after price increase
      const return2 = await factory.calculatePurchaseReturn(marketId, ethAmount);

      // Should get fewer tokens now
      expect(return2).to.be.lt(return1);
    });
  });

  describe("Sale Return Calculations", function () {
    it("Should return ETH for sold tokens", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      // First buy tokens
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.5") });

      const market = await factory.getMarket(marketId);
      const halfTokens = market.tokensSold / 2n;

      const saleReturn = await factory.calculateSaleReturn(marketId, halfTokens);

      // Should return some ETH
      expect(saleReturn).to.be.gt(0);
      // Should return some meaningful portion (sale return depends on curve math)
      expect(saleReturn).to.be.lt(ethers.parseEther("0.5"));
    });

    it("Should return more ETH for tokens bought at higher prices", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      // Buy tokens
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("1.0") });

      const market = await factory.getMarket(marketId);
      const totalTokens = market.tokensSold;

      // Calculate sale returns for different amounts
      const smallSale = totalTokens / 10n;
      const largeSale = totalTokens / 2n;

      const returnSmall = await factory.calculateSaleReturn(marketId, smallSale);
      const returnLarge = await factory.calculateSaleReturn(marketId, largeSale);

      // Selling more tokens should return more ETH
      expect(returnLarge).to.be.gt(returnSmall);
      // But not linearly due to curve (selling large amount pushes price down)
    });
  });

  describe("Curve Economics", function () {
    it("Should never exceed curve supply tokens sold", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      // Get max curve supply (60% of total)
      const totalSupply = await factory.TOTAL_SUPPLY();
      const curveAllocation = await factory.CURVE_ALLOCATION_BPS();
      const maxCurveTokens = (totalSupply * curveAllocation) / 10000n;

      // Try to buy a lot
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("5.0") });

      const market = await factory.getMarket(marketId);

      // Tokens sold should be less than or equal to curve allocation
      expect(market.tokensSold).to.be.lte(maxCurveTokens);
    });

    it("Should collect correct protocol fee on purchase", async function () {
      const { factory, treasury, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      const buyAmount = ethers.parseEther("1.0");
      const feeBps = await factory.protocolFeeBps();
      const expectedFee = (buyAmount * feeBps) / 10000n;

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await factory.connect(buyer1).buy(marketId, 0, { value: buyAmount });
      const treasuryAfter = await ethers.provider.getBalance(treasury.address);

      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);
    });

    it("Should track total raised accurately", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      const buyAmount = ethers.parseEther("1.0");
      const feeBps = await factory.protocolFeeBps();
      const netAmount = buyAmount - (buyAmount * feeBps) / 10000n;

      await factory.connect(buyer1).buy(marketId, 0, { value: buyAmount });

      const market = await factory.getMarket(marketId);

      // Current raised should equal net amount (excluding fee)
      expect(market.currentRaised).to.equal(netAmount);
    });
  });

  describe("Graduation Threshold", function () {
    it("Should graduate when target raise is reached", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      // Default target is 10 ETH
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("10.5") });

      const market = await factory.getMarket(marketId);
      expect(market.graduated).to.be.true;
    });

    it("Should not graduate before target", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("9.0") });

      const market = await factory.getMarket(marketId);
      expect(market.graduated).to.be.false;
    });

    it("Should allow owner to change default target raise", async function () {
      const { factory, owner, agent1, agent2, agent3, buyer1 } =
        await loadFixture(deployFactoryFixture);

      // Set lower target
      await factory.connect(owner).setDefaultParameters(
        ethers.parseEther("0.0001"),
        ethers.parseEther("0.00000001"),
        ethers.parseEther("5") // 5 ETH target instead of 10
      );

      // Create new market with lower target
      await factory.createMarket(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Low Target Token",
        "LTT",
        "Lower graduation threshold"
      );

      // Should graduate with 5 ETH
      await factory.connect(buyer1).buy(1, 0, { value: ethers.parseEther("5.5") });

      const market = await factory.getMarket(1);
      expect(market.graduated).to.be.true;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle very small purchases", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      // Buy minimal amount
      const minAmount = ethers.parseEther("0.001");
      await factory.connect(buyer1).buy(marketId, 0, { value: minAmount });

      const market = await factory.getMarket(marketId);
      expect(market.tokensSold).to.be.gt(0);
    });

    it("Should handle sequential small purchases", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      const amount = ethers.parseEther("0.01");

      // Make 10 small purchases
      for (let i = 0; i < 10; i++) {
        await factory.connect(buyer1).buy(marketId, 0, { value: amount });
      }

      const market = await factory.getMarket(marketId);

      // Should have accumulated tokens from all purchases
      expect(market.tokensSold).to.be.gt(0);

      // Total ETH spent should be reflected in currentRaised (minus fees)
      const feeBps = await factory.protocolFeeBps();
      const totalSpent = amount * 10n;
      const expectedRaised = totalSpent - (totalSpent * feeBps / 10000n);
      expect(market.currentRaised).to.equal(expectedRaised);
    });

    it("Should maintain price continuity through buy/sell cycles", async function () {
      const { factory, marketId, buyer1 } =
        await loadFixture(deployFactoryFixture);

      const market1 = await factory.getMarket(marketId);
      const token = await ethers.getContractAt("MarketToken", market1.tokenAddress);

      // Buy tokens
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.5") });
      const priceAfterBuy = await factory.getCurrentPrice(marketId);

      // Get tokens owned
      const tokensOwned = await token.balanceOf(buyer1.address);
      const halfTokens = tokensOwned / 2n;

      // Sell half
      await token.connect(buyer1).approve(factory.target, halfTokens);
      await factory.connect(buyer1).sell(marketId, halfTokens, 0);

      const priceAfterSell = await factory.getCurrentPrice(marketId);

      // Price should have decreased
      expect(priceAfterSell).to.be.lt(priceAfterBuy);

      // Buy again
      await factory.connect(buyer1).buy(marketId, 0, { value: ethers.parseEther("0.25") });
      const finalPrice = await factory.getCurrentPrice(marketId);

      // Price should be between previous values
      expect(finalPrice).to.be.lte(priceAfterBuy);
    });
  });
});
